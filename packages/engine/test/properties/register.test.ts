import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runsOr, SEED } from "./budget.ts";
import { freezeClock, isRefusal, openWorld, thawClock, type World } from "./world.ts";

const DAY = "2026-06-10";
const NEVER = 3_600_000;
const assertion = { numRuns: runsOr(20), seed: SEED, includeErrorInReport: true };

const amount = fc.integer({ min: -500_000, max: 500_000 }).filter((each) => each !== 0);
const memo = fc.option(fc.constantFrom("deposit", "half", "ünï"), { nil: null });
/** An index into the book's accounts or categories, whatever their number. */
const pick = fc.nat({ max: 99 });

const line = fc.record({
  to: fc.oneof(
    fc.record({ kind: fc.constant("category" as const), index: pick }),
    fc.record({ kind: fc.constant("uncategorized" as const) }),
    fc.record({ kind: fc.constant("transfer" as const), index: pick }),
  ),
  amount,
  memo,
});
type Line = typeof line extends fc.Arbitrary<infer A> ? A : never;

const shape = fc.oneof(
  fc.record({ kind: fc.constant("single" as const), line }),
  fc.record({
    kind: fc.constant("split" as const),
    lines: fc.array(line, { minLength: 1, maxLength: 4 }),
  }),
  fc.record({
    kind: fc.constant("journal" as const),
    legs: fc.array(
      fc.record({
        on: fc.oneof(
          fc.record({ kind: fc.constant("account" as const), index: pick }),
          fc.record({ kind: fc.constant("category" as const), index: pick }),
          fc.constant({ kind: "opening" as const }),
          fc.constant({ kind: "uncategorized" as const }),
        ),
        amount,
        memo,
        category: fc.option(pick, { nil: null, freq: 4 }),
      }),
      { minLength: 1, maxLength: 3 },
    ),
    closingAccount: pick,
  }),
  fc.record({ kind: fc.constant("opening" as const), amount }),
);

const entry = fc.record({
  shape,
  account: pick,
  transferCategory: fc.option(pick, { nil: null }),
  cleared: fc.boolean(),
  reconcile: fc.boolean(),
  otherAmount: amount,
});
type Entry = typeof entry extends fc.Arbitrary<infer A> ? A : never;

interface Book {
  readonly world: World;
  readonly accounts: ReadonlyArray<{ readonly id: string; readonly onBudget: boolean }>;
  readonly categories: ReadonlyArray<string>;
  readonly opening: string;
  readonly uncategorized: string;
}

const openBook = async (): Promise<Book> => {
  const world = await openWorld();
  const accounts = [];
  for (const [name, onBudget, type] of [
    ["Checking", true, "asset"],
    ["Card", true, "liability"],
    ["Savings", false, "asset"],
    ["Brokerage", false, "asset"],
  ] as const) {
    const { id } = await world.call("create_account", { name, onBudget, type });
    accounts.push({ id, onBudget });
  }
  const groups = await world.call<Array<any>>("list_categories");
  // The book makes its system accounts when they are first needed.
  await world.call("create_account", { name: "Old", balance: 1, date: DAY });
  await world.call("create_transaction", { date: DAY, account: accounts[0]!.id, amount: -1 });
  const ledger = await world.call<Array<any>>("list_ledger_accounts");
  const system = (name: string) => ledger.find((each) => each.system === name).id as string;
  return {
    world,
    accounts,
    categories: groups.flatMap((group) => group.categories.map((each: any) => each.id)),
    opening: system("opening"),
    uncategorized: system("uncategorized"),
  };
};

const of = <A>(items: ReadonlyArray<A>, index: number) => items[index % items.length]!;

const target = (book: Book, own: string, each: Line, transferCategory: number | null) => {
  switch (each.to.kind) {
    case "category":
      return { category: of(book.categories, each.to.index) };
    case "uncategorized":
      return {};
    case "transfer": {
      const others = book.accounts.filter((account) => account.id !== own);
      const to = of(others, each.to.index);
      const crosses = book.accounts.find((account) => account.id === own)!.onBudget && !to.onBudget;
      return {
        transferAccount: to.id,
        ...(crosses && transferCategory !== null
          ? { category: of(book.categories, transferCategory) }
          : {}),
      };
    }
  }
};

const splitLine = (book: Book, own: string, each: Line, transferCategory: number | null) => ({
  amount: each.amount,
  ...(each.memo === null ? {} : { memo: each.memo }),
  ...target(book, own, each, transferCategory),
});

const make = async (book: Book, drawn: Entry): Promise<string> => {
  const { world } = book;
  const own = of(book.accounts, drawn.account).id;
  const { shape: drawnShape, cleared, transferCategory } = drawn;
  const common = { date: DAY, account: own, cleared };
  switch (drawnShape.kind) {
    case "single": {
      const made = await world.call("create_transaction", {
        ...common,
        amount: drawnShape.line.amount,
        ...target(book, own, drawnShape.line, transferCategory),
      });
      return made.id;
    }
    case "split": {
      const made = await world.call("create_transaction", {
        ...common,
        amount: drawnShape.lines.reduce((sum, each) => sum + each.amount, 0),
        splits: drawnShape.lines.map((each) => splitLine(book, own, each, transferCategory)),
      });
      return made.id;
    }
    case "journal": {
      const legs = drawnShape.legs.map((leg) => ({
        amount: leg.amount,
        ...(leg.memo === null ? {} : { memo: leg.memo }),
        ...(leg.category === null ? {} : { category: of(book.categories, leg.category) }),
        account:
          leg.on.kind === "account"
            ? of(book.accounts, leg.on.index).id
            : leg.on.kind === "category"
              ? of(book.categories, leg.on.index)
              : leg.on.kind === "opening"
                ? book.opening
                : book.uncategorized,
      }));
      const made = await world.call("create_journal_entry", {
        date: DAY,
        postings: [
          ...legs,
          {
            account: of(book.accounts, drawnShape.closingAccount).id,
            amount: -legs.reduce((sum, leg) => sum + leg.amount, 0),
            cleared,
          },
        ],
      });
      return made.id;
    }
    case "opening": {
      const account = await world.call("create_account", {
        name: "Opened",
        balance: drawnShape.amount,
        date: DAY,
      });
      const { rows } = await world.call("list_transactions", { account: account.id });
      return rows[0].transactionId;
    }
  }
};

/** What a register row shows, in the shape update_transaction takes back. */
const restated = (row: any, tx: any) => {
  switch (row.counterpart.kind) {
    case "category":
    case "other":
      return { category: row.counterpart.id };
    case "uncategorized":
      return { category: null };
    case "transfer":
      return {
        transferAccount: row.counterpart.id,
        ...(row.splits.length === 1 ? { category: row.splits[0].accountId } : {}),
      };
    case "split":
      return {
        splits: row.splits.map((each: any) => ({
          amount: each.amount,
          memo: each.memo,
          ...(each.kind === "transfer"
            ? {
                transferAccount: each.accountId,
                // The row leaves out a transfer line's category; the transaction has it.
                category: tx.postings.find((p: any) => p.id === each.postingId).categoryId,
              }
            : { category: each.kind === "uncategorized" ? null : each.accountId }),
        })),
      };
  }
};

const sidesOf = async (book: Book, tx: any): Promise<ReadonlyArray<string>> => {
  const ledger = await book.world.call<Array<any>>("list_ledger_accounts");
  const isSide = (id: string) => {
    const type = ledger.find((each) => each.id === id)?.type;
    return type === "asset" || type === "liability";
  };
  return [...new Set<string>(tx.postings.map((p: any) => p.accountId).filter(isSide))];
};

const withTransaction = async (
  drawn: Entry,
  check: (book: Book, id: string, before: any) => Promise<void>,
) => {
  const book = await openBook();
  try {
    let id: string;
    try {
      id = await make(book, drawn);
    } catch (error) {
      if (isRefusal(error)) return;
      throw error;
    }
    if (drawn.reconcile) {
      const [side] = await sidesOf(book, await book.world.call("get_transaction", { id }));
      await book.world.call("reconcile_account", { id: side, balance: 0, adjust: true });
    }
    await check(book, id, await book.world.call("get_transaction", { id }));
  } finally {
    await book.world.close();
  }
};

beforeAll(freezeClock);
afterAll(thawClock);

describe("the register shape", () => {
  it(
    "restating what a transaction says changes no posting, from any side",
    { timeout: NEVER },
    () =>
      fc.assert(
        fc.asyncProperty(entry, (drawn) =>
          withTransaction(drawn, async (book, id, before) => {
            const { world } = book;
            const read = () => world.call("get_transaction", { id });
            await world.call("update_transaction", { id });
            expect(await read(), "setting nothing").toEqual(before);
            for (const account of await sidesOf(book, before)) {
              const own = before.postings.find((each: any) => each.accountId === account);
              const { rows } = await world.call("list_transactions", { account });
              const row = rows.find((each: any) => each.transactionId === id);
              const oneLine =
                before.postings.filter((each: any) => each.accountId === account).length === 1;
              const said = {
                "the amount": { amount: own.amount },
                "the cleared mark": { cleared: own.cleared },
                "the row": restated(row, before),
                "the row and its amount": { amount: own.amount, ...restated(row, before) },
              };
              for (const [what, input] of Object.entries(said)) {
                const saying = world.call("update_transaction", { id, account, ...input });
                // Two postings of one account are no one register line, so that edit may refuse.
                await (oneLine ? saying : saying.catch(() => null));
                expect(await read(), `restating ${what}`).toEqual(before);
              }
            }
          }),
        ),
        assertion,
      ),
  );

  it("a new amount on one line moves its two postings and nothing else", { timeout: NEVER }, () =>
    fc.assert(
      fc.asyncProperty(entry, (drawn) =>
        withTransaction(drawn, async (book, id, before) => {
          const { world } = book;
          const read = () => world.call("get_transaction", { id });
          if (before.postings.length !== 2) return;
          if (before.postings.some((each: any) => each.reconciled)) return;
          if (before.postings[0].accountId === before.postings[1].accountId) return;
          for (const account of await sidesOf(book, before)) {
            const own = before.postings.find((each: any) => each.accountId === account);
            await world.call("update_transaction", { id, account, amount: drawn.otherAmount });
            expect(await read(), "after the change").toEqual({
              ...before,
              postings: before.postings.map((each: any) => ({
                ...each,
                amount: each === own ? drawn.otherAmount : -drawn.otherAmount,
              })),
            });
            await world.call("update_transaction", { id, account, amount: own.amount });
            expect(await read(), "after changing it back").toEqual(before);
          }
        }),
      ),
      assertion,
    ),
  );

  it(
    "an entry reads back as entered, in its postings and its register row",
    { timeout: NEVER },
    () =>
      fc.assert(
        fc.asyncProperty(
          fc.array(line, { minLength: 1, maxLength: 4 }),
          pick,
          fc.option(pick, { nil: null }),
          async (lines, accountIndex, transferCategory) => {
            const book = await openBook();
            try {
              const account = of(book.accounts, accountIndex).id;
              const total = lines.reduce((sum, each) => sum + each.amount, 0);
              const inputs = lines.map((each) => splitLine(book, account, each, transferCategory));
              const single = lines[0]!;
              const made = await book.world.call(
                "create_transaction",
                lines.length === 1
                  ? {
                      date: DAY,
                      account,
                      amount: total,
                      ...target(book, account, single, transferCategory),
                    }
                  : { date: DAY, account, amount: total, splits: inputs },
              );
              const oneLineMemo = (each: Line) => (lines.length === 1 ? null : each.memo);
              expect(made.postings[0]).toMatchObject({ accountId: account, amount: total });
              expect(made.postings.slice(1)).toMatchObject(
                lines.map((each, index) => {
                  const input = inputs[index] as { category?: string; transferAccount?: string };
                  return {
                    accountId: input.transferAccount ?? input.category ?? book.uncategorized,
                    amount: -each.amount,
                    memo: oneLineMemo(each),
                    categoryId:
                      input.transferAccount === undefined ? null : (input.category ?? null),
                  };
                }),
              );
              const { rows } = await book.world.call("list_transactions", { account });
              const row = rows.find((each: any) => each.transactionId === made.id);
              expect(row.amount).toBe(total);
              const shown = (input: { category?: string; transferAccount?: string }) =>
                input.transferAccount === undefined ? { category: input.category ?? null } : input;
              expect(restated(row, made)).toEqual(
                lines.length === 1
                  ? shown(target(book, account, single, transferCategory))
                  : {
                      splits: inputs.map((input, index) => ({
                        amount: input.amount,
                        memo: lines[index]!.memo,
                        ...("transferAccount" in input
                          ? { transferAccount: input.transferAccount }
                          : {}),
                        category: ("category" in input ? input.category : null) ?? null,
                      })),
                    },
              );
            } finally {
              await book.world.close();
            }
          },
        ),
        assertion,
      ),
  );
});

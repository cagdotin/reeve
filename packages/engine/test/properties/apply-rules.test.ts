import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runsOr, SEED } from "./budget.ts";
import { dumpDifference, freezeClock, openWorld, thawClock, type World } from "./world.ts";

const NEVER = 3_600_000;
const settings = { numRuns: runsOr(20), seed: SEED, includeErrorInReport: true };
const DAY = "2026-06-10";

/** A condition on a field no action below writes, so a rule's matches stay what they were. */
const condition = fc.oneof(
  fc.record({
    op: fc.constant("contains"),
    field: fc.constant("imported_payee"),
    value: fc.constantFrom("a", "e", "x"),
  }),
  fc.record({
    op: fc.constantFrom("gt", "lt"),
    field: fc.constant("amount"),
    value: fc.constantFrom(-1000, 0, 1000),
  }),
  fc.record({ op: fc.constant("is"), field: fc.constant("date"), value: fc.constant(DAY) }),
);

const fixedAction = fc.oneof(
  fc.record({
    op: fc.constant("set"),
    field: fc.constant("category"),
    value: fc.nat({ max: 99 }),
  }),
  fc.record({
    op: fc.constant("set"),
    field: fc.constant("notes"),
    value: fc.constantFrom("from a rule", "other"),
  }),
  fc.record({ op: fc.constant("set"), field: fc.constant("cleared"), value: fc.boolean() }),
  fc.record({
    op: fc.constant("set"),
    field: fc.constant("payee"),
    value: fc.nat({ max: 99 }),
  }),
);

const splitting = [
  { op: "set-split-amount", splitIndex: 1, method: "fixed-percent", value: 50 },
  { op: "set-split-amount", splitIndex: 2, method: "remainder" },
];

const rule = fc.record({
  conditions: fc.array(condition, { minLength: 1, maxLength: 2 }),
  actions: fc.oneof(
    { weight: 5, arbitrary: fc.array(fixedAction, { minLength: 1, maxLength: 3 }) },
    { weight: 1, arbitrary: fc.constant(splitting) },
  ),
  stage: fc.constantFrom("pre", "default", "post"),
});

/** What a rule may do to money and to where it sits, none of which may refuse an existing entry. */
const moneyAction = fc.oneof(
  fc.record({
    op: fc.constant("set"),
    field: fc.constant("amount"),
    value: fc.constantFrom(-999, 123),
  }),
  fc.record({ op: fc.constant("set"), field: fc.constant("account"), value: fc.nat({ max: 2 }) }),
  fc.constant({ op: "append-notes", value: " more" }),
  fc.constant({ op: "prepend-notes", value: "more " }),
  fixedAction,
);

const transaction = fc.record({
  kind: fc.constantFrom("plain", "category", "transfer", "offBudgetTransfer", "split", "opening"),
  amount: fc.integer({ min: -5000, max: 5000 }).filter((each) => each !== 0),
  payee: fc.constantFrom("Rewe", "Aldi", "Shell"),
  cleared: fc.boolean(),
});
type Drawn = typeof transaction extends fc.Arbitrary<infer A> ? A : never;

interface Book {
  readonly world: World;
  readonly checking: string;
  readonly savings: string;
  readonly card: string;
  readonly categories: ReadonlyArray<string>;
  readonly payees: ReadonlyArray<string>;
}

const openBook = async (): Promise<Book> => {
  const world = await openWorld();
  const make = async (name: string, onBudget: boolean) =>
    (await world.call("create_account", { name, onBudget })).id as string;
  const payees = [];
  for (const name of ["Rewe", "Aldi", "Shell"])
    payees.push((await world.call("create_payee", { name })).id as string);
  return {
    world,
    checking: await make("Checking", true),
    savings: await make("Savings", false),
    card: await make("Card", true),
    categories: (await world.call<Array<any>>("list_categories")).flatMap((group) =>
      group.categories.map((each: any) => each.id),
    ),
    payees,
  };
};

const addTransaction = async (book: Book, each: Drawn, category: number) => {
  const { world, checking, savings, card, categories } = book;
  const base = {
    date: DAY,
    account: checking,
    amount: each.amount,
    payee: each.payee,
    cleared: each.cleared,
  };
  const pick = (index: number) => categories[index % categories.length]!;
  switch (each.kind) {
    case "plain":
      return world.call("create_transaction", base);
    case "category":
      return world.call("create_transaction", { ...base, category: pick(category) });
    case "transfer":
      return world.call("create_transaction", { ...base, transferAccount: card });
    case "offBudgetTransfer":
      return world.call("create_transaction", {
        ...base,
        transferAccount: savings,
        category: pick(category),
      });
    case "split":
      return world.call("create_transaction", {
        ...base,
        splits: [
          { amount: each.amount - 1, category: pick(category) },
          { amount: 1, category: pick(category + 1), memo: "the rest" },
        ],
      });
    case "opening":
      return world.call("create_account", {
        name: `Opened ${each.amount}`,
        balance: each.amount,
        date: DAY,
      });
  }
};

const writeRule = (
  book: Book,
  drawn: {
    readonly conditions: ReadonlyArray<unknown>;
    readonly stage: string;
    readonly actions: ReadonlyArray<{ op: string; field?: string; value?: unknown }>;
  },
) =>
  book.world.call("create_rule", {
    stage: drawn.stage,
    conditions: drawn.conditions,
    recategorize: false,
    actions: drawn.actions.map((action) => {
      const named: Record<string, ReadonlyArray<string>> = {
        category: book.categories,
        payee: book.payees,
        account: [book.checking, book.savings, book.card],
      };
      const from = action.field === undefined ? undefined : named[action.field];
      return from === undefined
        ? action
        : { ...action, value: from[Number(action.value) % from.length] };
    }),
  });

const allIds = async (world: World) => {
  const rows = world.all<{ id: string }>("SELECT id FROM transactions ORDER BY rowid");
  return rows.map((row) => row.id);
};

beforeAll(freezeClock);
afterAll(thawClock);

describe("apply_rules", () => {
  it(
    "twice is once, for rules that set fixed values on fields no condition reads",
    { timeout: NEVER },
    () =>
      fc.assert(
        fc.asyncProperty(
          fc.array(rule, { minLength: 1, maxLength: 4 }),
          fc.array(fc.tuple(transaction, fc.nat({ max: 99 })), { minLength: 1, maxLength: 6 }),
          async (rules, transactions) => {
            const book = await openBook();
            const { world } = book;
            try {
              for (const [each, category] of transactions)
                await addTransaction(book, each, category);
              for (const each of rules) await writeRule(book, each);
              const ids = await allIds(world);
              await world.call("apply_rules", { ids });
              const once = world.dump();
              const again = await world.call("apply_rules", { ids });
              expect(dumpDifference(once, world.dump()), "the second run").toBeNull();
              expect(
                again.updated.map((each: any) => each.id),
                "what the second run reports",
              ).toEqual([]);
            } finally {
              await world.close();
            }
          },
        ),
        settings,
      ),
  );

  it("a rule never makes it refuse, whatever it does to the money", { timeout: NEVER }, () =>
    fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            conditions: fc.array(condition, { minLength: 1, maxLength: 2 }),
            actions: fc.oneof(
              fc.array(moneyAction, { minLength: 1, maxLength: 3 }),
              fc.constant(splitting),
            ),
            stage: fc.constantFrom("pre", "default", "post"),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        fc.array(fc.tuple(transaction, fc.nat({ max: 99 })), { minLength: 1, maxLength: 6 }),
        fc.boolean(),
        async (rules, transactions, reconcile) => {
          const book = await openBook();
          const { world } = book;
          try {
            for (const [each, category] of transactions) await addTransaction(book, each, category);
            if (reconcile)
              await world.call("reconcile_account", {
                id: book.checking,
                balance: 0,
                adjust: true,
              });
            for (const each of rules) await writeRule(book, each);
            const ids = await allIds(world);
            const { updated, deleted } = await world.call("apply_rules", { ids });
            expect(updated.length + deleted.length).toBeLessThanOrEqual(ids.length);
          } finally {
            await world.close();
          }
        },
      ),
      settings,
    ),
  );

  it("a rule's notes grow every run, as in Actual, so running twice is not once", async () => {
    const book = await openBook();
    const { world } = book;
    try {
      const { id } = await world.call("create_transaction", {
        date: DAY,
        account: book.checking,
        amount: -100,
        notes: "lunch",
      });
      await world.call("create_rule", {
        conditions: [{ op: "lt", field: "amount", value: 0 }],
        actions: [{ op: "append-notes", value: " #food" }],
      });
      await world.call("apply_rules", { ids: [id] });
      await world.call("apply_rules", { ids: [id] });
      expect((await world.call("get_transaction", { id })).notes).toBe("lunch #food #food");
    } finally {
      await world.close();
    }
  });

  it("a rule feeding another rule's condition needs a second run, so twice is not once", async () => {
    const book = await openBook();
    const { world } = book;
    try {
      const { id } = await world.call("create_transaction", {
        date: DAY,
        account: book.checking,
        amount: -100,
      });
      await world.call("create_rule", {
        stage: "pre",
        conditions: [{ op: "is", field: "notes", value: "seen" }],
        actions: [{ op: "set", field: "cleared", value: true }],
      });
      await world.call("create_rule", {
        stage: "post",
        conditions: [{ op: "lt", field: "amount", value: 0 }],
        actions: [{ op: "set", field: "notes", value: "seen" }],
      });
      const cleared = async () =>
        (await world.call("get_transaction", { id })).postings.find(
          (each: any) => each.accountId === book.checking,
        ).cleared;
      await world.call("apply_rules", { ids: [id] });
      expect(await cleared()).toBe(false);
      await world.call("apply_rules", { ids: [id] });
      expect(await cleared()).toBe(true);
    } finally {
      await world.close();
    }
  });
});

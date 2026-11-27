import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runsOr, SEED } from "./budget.ts";
import { runSequence } from "./run.ts";
import { stepArbitrary } from "./steps.ts";
import { dumpDifference, freezeClock, openWorld, thawClock, type World } from "./world.ts";

const NEVER = 3_600_000;
const FORMATS = ["csv", "ofx", "qif", "camt", "rows"] as const;
type Format = (typeof FORMATS)[number];

const importSettings = { numRuns: runsOr(20), seed: SEED, includeErrorInReport: true };
const exportSettings = { numRuns: runsOr(12), seed: SEED, includeErrorInReport: true };
const restoreSettings = { numRuns: runsOr(3), seed: SEED, includeErrorInReport: true };

const row = fc.record({
  day: fc.integer({ min: 1, max: 28 }),
  amount: fc.oneof(
    { weight: 5, arbitrary: fc.constantFrom(-1000, 2500) },
    {
      weight: 1,
      arbitrary: fc.integer({ min: -500_000, max: 500_000 }).filter((each) => each !== 0),
    },
  ),
  payee: fc.constantFrom("REWE", "Aldi Süd", "Rent & Co", "Café, Bar"),
  notes: fc.option(fc.constantFrom("card 12", "lunch"), { nil: null }),
  id: fc.option(fc.constantFrom("a1", "a2", "a3", "a4", "a5", "a6"), { nil: null }),
});
type Row = typeof row extends fc.Arbitrary<infer A> ? A : never;

const dayOf = (each: Row) => `2026-06-${String(each.day).padStart(2, "0")}`;
const decimal = (cents: number) => (cents / 100).toFixed(2);
const quoted = (text: string) => `"${text.replaceAll('"', '""')}"`;
const escaped = (text: string) => text.replaceAll("&", "&amp;");

const FILES: Record<Exclude<Format, "rows">, (rows: ReadonlyArray<Row>) => object> = {
  csv: (rows) => ({
    fileName: "bank.csv",
    content: [
      "Date,Payee,Notes,Amount",
      ...rows.map((each) =>
        [dayOf(each), quoted(each.payee), quoted(each.notes ?? ""), decimal(each.amount)].join(","),
      ),
    ].join("\n"),
  }),
  ofx: (rows) => ({
    fileName: "bank.ofx",
    content: `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>${rows
      .map(
        (each) =>
          `<STMTTRN><TRNTYPE>OTHER</TRNTYPE><DTPOSTED>${dayOf(each).replaceAll("-", "")}</DTPOSTED><TRNAMT>${decimal(each.amount)}</TRNAMT>${
            each.id === null ? "" : `<FITID>${each.id}</FITID>`
          }<NAME>${escaped(each.payee)}</NAME>${each.notes === null ? "" : `<MEMO>${each.notes}</MEMO>`}</STMTTRN>`,
      )
      .join("")}</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`,
  }),
  qif: (rows) => ({
    fileName: "bank.qif",
    dateFormat: "yyyy mm dd",
    content: [
      "!Type:Bank",
      ...rows.flatMap((each) => [
        `D${dayOf(each)}`,
        `T${decimal(each.amount)}`,
        `P${each.payee}`,
        ...(each.notes === null ? [] : [`M${each.notes}`]),
        "^",
      ]),
      "",
    ].join("\n"),
  }),
  camt: (rows) => ({
    fileName: "bank.xml",
    content: `<?xml version="1.0"?><Document><BkToCstmrStmt><Stmt>${rows
      .map(
        (each) =>
          `<Ntry><Amt Ccy="EUR">${decimal(Math.abs(each.amount))}</Amt><CdtDbtInd>${
            each.amount < 0 ? "DBIT" : "CRDT"
          }</CdtDbtInd><ValDt><Dt>${dayOf(each)}</Dt></ValDt>${
            each.id === null ? "" : `<AcctSvcrRef>${each.id}</AcctSvcrRef>`
          }<AddtlNtryInf>${escaped(each.payee)}</AddtlNtryInf></Ntry>`,
      )
      .join("")}</Stmt></BkToCstmrStmt></Document>`,
  }),
};

const importInput = (format: Format, rows: ReadonlyArray<Row>) =>
  format === "rows"
    ? {
        rows: rows.map((each) => ({
          date: dayOf(each),
          amount: each.amount,
          payee: each.payee,
          ...(each.notes === null ? {} : { notes: each.notes }),
          ...(each.id === null ? {} : { importedId: each.id }),
        })),
      }
    : FILES[format](rows);

const ruleDraw = fc.constantFrom("none", "rename", "category", "notes", "delete");

const addRule = async (world: World, kind: string, categories: ReadonlyArray<string>) => {
  const conditions = [{ op: "contains", field: "imported_payee", value: "e" }];
  const payee = kind === "rename" ? (await world.call("create_payee", { name: "Shop" })).id : null;
  const actions = {
    rename: [{ op: "set", field: "payee", value: payee }],
    category: [{ op: "set", field: "category", value: categories[0] }],
    notes: [{ op: "append-notes", value: " ruled" }],
    delete: [{ op: "delete-transaction" }],
  }[kind];
  if (actions !== undefined)
    await world.call("create_rule", { conditions, actions, recategorize: false });
};

const balanceOf = async (world: World, account: string) => {
  const { rows } = await world.call<{ rows: Array<any> }>("list_transactions", { account });
  return rows.reduce((total, each) => total + each.amount, 0);
};

const withCategories = async (world: World) =>
  (await world.call<Array<any>>("list_categories")).flatMap((group) =>
    group.categories.map((each: any) => each.id as string),
  );

beforeAll(freezeClock);
afterAll(thawClock);

const secondImportChangesNothing = async (
  format: Format,
  rows: ReadonlyArray<Row>,
  already: ReadonlyArray<readonly [Row, boolean]>,
  rule: string,
) => {
  const world = await openWorld();
  try {
    const account = (await world.call("create_account", { name: "Checking" })).id;
    for (const [each, named] of already)
      await world.call("create_transaction", {
        date: dayOf(each),
        account,
        amount: each.amount,
        ...(named ? { payee: each.payee } : {}),
      });
    await addRule(world, rule, await withCategories(world));
    const input = { account, ...importInput(format, rows) };
    const before = await balanceOf(world, account);
    const first = await world.call("import_transactions", input);
    const added = first.added.map(async (id: string) => {
      const tx = await world.call("get_transaction", { id });
      return tx.postings.find((each: any) => each.accountId === account).amount;
    });
    const taken = (await Promise.all(added)).reduce((total, each) => total + each, 0);
    expect(await balanceOf(world, account), "the first import's money").toBe(before + taken);
    const dump = world.dump();
    const second = await world.call("import_transactions", input);
    expect(second.added, "the second import adds").toEqual([]);
    // A bank's id names one transaction: when a file reuses one, its rows merge by it.
    const ids = rows.flatMap((each) => (each.id === null ? [] : [each.id]));
    if (new Set(ids).size < ids.length) return;
    expect(second.updated, "the second import updates").toEqual([]);
    expect(dumpDifference(dump, world.dump()), "the second import").toBeNull();
  } finally {
    await world.close();
  }
};

const competing = (payee: Row["payee"]) =>
  row.map((each) => ({ ...each, day: (each.day % 10) + 1, amount: 2500, payee, id: null }));

describe("importing a bank file", () => {
  it("a second import of the same file adds nothing and changes nothing", { timeout: NEVER }, () =>
    expect(
      fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...FORMATS),
          fc.array(row, { minLength: 1, maxLength: 12 }),
          fc.array(fc.tuple(row, fc.boolean()), { maxLength: 4 }),
          ruleDraw,
          secondImportChangesNothing,
        ),
        importSettings,
      ),
    ).resolves.toBeUndefined(),
  );

  it("so does one whose rows compete for the same transactions", { timeout: NEVER }, () =>
    expect(
      fc.assert(
        fc.asyncProperty(
          fc.constantFrom<Format>("csv", "qif"),
          fc.array(competing("REWE"), { minLength: 2, maxLength: 8 }),
          fc.array(fc.tuple(competing("Aldi Süd"), fc.boolean()), { minLength: 1, maxLength: 3 }),
          (format, rows, already) => secondImportChangesNothing(format, rows, already, "none"),
        ),
        importSettings,
      ),
    ).resolves.toBeUndefined(),
  );
});

const money = fc.integer({ min: -100_000_000, max: 100_000_000 });

const exported = fc.record({
  day: fc.integer({ min: 1, max: 28 }),
  amount: money,
  shape: fc.constantFrom("uncategorized", "category", "transfer", "split"),
  payee: fc.option(fc.constantFrom("Rewe", "=SUM(A1)", "-minus", "Aldi, Süd"), { nil: null }),
  notes: fc.option(fc.constantFrom("lunch", "+1 more", 'say "hi"'), { nil: null }),
  cleared: fc.boolean(),
});
type Exported = typeof exported extends fc.Arbitrary<infer A> ? A : never;

const addExported = async (
  world: World,
  account: string,
  other: string,
  categories: ReadonlyArray<string>,
  each: Exported,
) => {
  const third = Math.trunc(each.amount / 3);
  const lines =
    each.shape === "split"
      ? {
          splits: [
            { amount: third, category: categories[0] },
            { amount: each.amount - third, category: categories[1], memo: "rest" },
          ],
        }
      : each.shape === "category"
        ? { category: categories[2] }
        : each.shape === "transfer"
          ? { transferAccount: other }
          : {};
  await world.call("create_transaction", {
    date: `2026-06-${String(each.day).padStart(2, "0")}`,
    account,
    amount: each.amount,
    payee: each.payee,
    notes: each.notes,
    cleared: each.cleared,
    ...lines,
  });
};

const daily = (rows: ReadonlyArray<any>) => {
  const days = new Map<string, number>();
  for (const each of rows) days.set(each.date, (days.get(each.date) ?? 0) + each.amount);
  return new Map(
    [...days].filter(([, total]) => total !== 0).toSorted(([a], [b]) => a.localeCompare(b)),
  );
};

describe("exporting and importing back", () => {
  it(
    "an account's CSV imported into an empty account gives the same money on the same days",
    { timeout: NEVER },
    () =>
      fc.assert(
        fc.asyncProperty(fc.array(exported, { maxLength: 10 }), async (drawn) => {
          const world = await openWorld();
          try {
            const account = (await world.call("create_account", { name: "Checking" })).id;
            const other = (await world.call("create_account", { name: "Savings" })).id;
            const copy = (await world.call("create_account", { name: "Copy" })).id;
            const categories = await withCategories(world);
            for (const each of drawn) await addExported(world, account, other, categories, each);
            const content = await world.call("export_transactions", { account });
            if (drawn.length > 0)
              await world.call("import_transactions", {
                account: copy,
                content,
                fileName: "export.csv",
              });
            const read = async (id: string) =>
              (await world.call("list_transactions", { account: id })).rows;
            expect(daily(await read(copy))).toEqual(daily(await read(account)));
          } finally {
            await world.close();
          }
        }),
        exportSettings,
      ),
  );

  it(
    "imported back into its own account, a CSV without splits adds nothing",
    { timeout: NEVER },
    () =>
      fc.assert(
        fc.asyncProperty(fc.array(exported, { minLength: 1, maxLength: 10 }), async (drawn) => {
          const world = await openWorld();
          try {
            const account = (await world.call("create_account", { name: "Checking" })).id;
            const other = (await world.call("create_account", { name: "Savings" })).id;
            const categories = await withCategories(world);
            for (const each of drawn)
              if (each.shape !== "split")
                await addExported(world, account, other, categories, each);
            const { rows } = await world.call("list_transactions", { account });
            if (rows.length === 0) return;
            const content = await world.call("export_transactions", { account });
            const result = await world.call("import_transactions", {
              account,
              content,
              fileName: "export.csv",
            });
            expect(result.added).toEqual([]);
          } finally {
            await world.close();
          }
        }),
        exportSettings,
      ),
  );

  it(
    "a book's backup restores every row and reads the same through operations",
    { timeout: NEVER },
    () =>
      fc.assert(
        fc.asyncProperty(fc.array(stepArbitrary, { maxLength: 25, size: "max" }), async (drawn) => {
          const folder = mkdtempSync(join(tmpdir(), "reeve-backup-"));
          try {
            await runSequence(drawn, new Map(), async (world) => {
              const path = join(folder, "backup.sqlite");
              await world.call("export_book", { path });
              const restored = await world.call("restore_book", { path, name: "Restored" });
              const book = restored.id;
              const copy = new DatabaseSync(restored.file, { readOnly: true });
              try {
                const rows = (table: string) =>
                  JSON.stringify(copy.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all());
                const original = world.dump();
                for (const table of Object.keys(original)) {
                  if (table === "__migrations") continue;
                  const source = (JSON.parse(original[table]!) as Array<any>).map(
                    ({ _rowid, ...each }) => each,
                  );
                  if (table === "book_settings" || table === "settings") continue;
                  expect([table, rows(table)]).toEqual([table, JSON.stringify(source)]);
                }
              } finally {
                copy.close();
              }
              for (const [op, input] of [
                ["list_accounts", {}],
                ["list_categories", {}],
                ["list_rules", {}],
                ["list_payees", {}],
                ["list_schedules", {}],
                ["get_budget", { month: "2026-06" }],
              ] as const)
                expect([op, await world.call(op, { ...input, book })]).toEqual([
                  op,
                  await world.call(op, input),
                ]);
              expect((await world.call("undo", { book })).done, "no undo history").toBe(false);
            });
          } finally {
            rmSync(folder, { recursive: true, force: true });
          }
        }),
        restoreSettings,
      ),
  );
});

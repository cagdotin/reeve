import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
let book: string;
let account: string;
let food: string;
let bills: string;
beforeEach(async () => {
  s = scratch();
  book = (await s.call("create_book", { name: "Test" })).id;
  account = (await s.call("create_account", { book, name: "Checking" })).id;
  const [usual] = await s.call("list_categories", { book });
  food = usual.categories.find((c: any) => c.name === "Food").id;
  bills = usual.categories.find((c: any) => c.name === "Bills").id;
});
afterEach(() => s.dispose());

const call = (name: string, input: Record<string, unknown> = {}) =>
  s.call(name, { book, ...input });
const payee = async (name: string) => (await call("create_payee", { name })).id as string;
const learns = async (id: string) =>
  (await call("list_payees")).find((each: any) => each.id === id).learnCategories as boolean;
const importLine = async (row: Record<string, unknown>) => {
  await call("import_transactions", { account, rows: [row] });
  const page = await call("list_transactions", { account });
  return page.rows.find((each: any) => each.importedId === row.importedId) ?? page.rows[0];
};

describe("transaction_rules", () => {
  it("replays an imported line: the rename, then the category it led to", async () => {
    const lidl = await payee("Lidl");
    const rename = await call("create_rule", {
      stage: "pre",
      conditions: [{ field: "imported_payee", op: "contains", value: "lidl" }],
      actions: [{ op: "set", field: "payee", value: lidl }],
    });
    const categorize = await call("create_rule", {
      conditions: [{ field: "payee", op: "is", value: lidl }],
      actions: [{ op: "set", field: "category", value: food }],
    });
    const row = await importLine({
      date: "2026-03-02",
      amount: -1250,
      payee: "LIDL 1234 BERLIN",
      importedId: "line-1",
    });

    const result = await call("transaction_rules", { id: row.transactionId });

    expect(result.origin).toBe("imported");
    expect(
      result.applied.map((each: any) => ({ rule: each.rule.id, changes: each.changes })),
      "the rename runs first, then the category rule it made match",
    ).toEqual([
      {
        rule: rename.id,
        changes: [{ field: "payee", from: "Lidl 1234 Berlin", to: "Lidl", holds: true }],
      },
      {
        rule: categorize.id,
        changes: [{ field: "category", from: null, to: "Food", holds: true }],
      },
    ]);
    expect(result.matching.map((each: any) => each.id)).toEqual([rename.id, categorize.id]);
  });

  it("says when the transaction no longer carries what a rule set", async () => {
    const lidl = await payee("Lidl");
    await call("create_rule", {
      conditions: [{ field: "payee", op: "is", value: lidl }],
      actions: [{ op: "set", field: "category", value: food }],
    });
    const tx = await call("create_transaction", {
      account,
      date: "2026-03-02",
      amount: -1250,
      payee: "Lidl",
    });
    await call("update_transaction", { id: tx.id, account, category: bills });

    const result = await call("transaction_rules", { id: tx.id });

    expect(result.origin).toBe("entered");
    expect(result.applied[0].changes).toEqual([
      { field: "category", from: null, to: "Food", holds: false },
    ]);
    expect(result.matching, "the rule's payee condition still matches").toHaveLength(1);
  });

  it("lists a rule that matches now but changed nothing on the replay", async () => {
    const tx = await call("create_transaction", {
      account,
      date: "2026-03-02",
      amount: -1250,
      payee: "Corner Shop",
      category: food,
    });
    const byCategory = await call("create_rule", {
      conditions: [{ field: "category", op: "is", value: food }],
      actions: [{ op: "append-notes", value: " (groceries)" }],
      recategorize: false,
    });

    const result = await call("transaction_rules", { id: tx.id });

    expect(result.applied, "the replay starts without the category").toEqual([]);
    expect(result.matching.map((each: any) => each.id)).toEqual([byCategory.id]);
  });

  it("refuses a transaction it cannot find or an account it is not on", async () => {
    const tx = await call("create_transaction", { account, date: "2026-03-02", amount: -1 });
    const other = (await call("create_account", { name: "Savings" })).id;
    expect((await s.fails("transaction_rules", { book, id: "nope" }))._tag).toBe("NotFound");
    expect((await s.fails("transaction_rules", { book, id: tx.id, account: other }))._tag).toBe(
      "InvalidRequest",
    );
  });
});

describe("a category rule written by hand", () => {
  it("turns learning off for the payees it names", async () => {
    const lidl = await payee("Lidl");
    const aldi = await payee("Aldi");
    const rewe = await payee("Rewe");
    await call("create_rule", {
      conditions: [{ field: "payee", op: "oneOf", value: [lidl, aldi] }],
      actions: [{ op: "set", field: "category", value: food }],
    });
    expect([await learns(lidl), await learns(aldi), await learns(rewe)]).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("leaves learning on for a rule that sets no category", async () => {
    const lidl = await payee("Lidl");
    await call("create_rule", {
      conditions: [{ field: "payee", op: "is", value: lidl }],
      actions: [{ op: "set", field: "notes", value: "groceries" }],
    });
    expect(await learns(lidl)).toBe(true);
  });

  it("stays as written when the payee's picks change", async () => {
    const lidl = await payee("Lidl");
    const rule = await call("create_rule", {
      conditions: [{ field: "payee", op: "is", value: lidl }],
      actions: [{ op: "set", field: "category", value: food }],
    });
    for (const date of ["2026-03-01", "2026-03-02", "2026-03-03"])
      await call("create_transaction", {
        account,
        date,
        amount: -1,
        payee: "Lidl",
        category: bills,
      });
    expect((await call("get_rule", { id: rule.id })).actions[0].value).toBe(food);
  });

  it("takes over a learned rule once edited, and undo gives learning back", async () => {
    const lidl = await payee("Lidl");
    for (const date of ["2026-03-01", "2026-03-02", "2026-03-03"])
      await call("create_transaction", {
        account,
        date,
        amount: -1,
        payee: "Lidl",
        category: food,
      });
    const [learned] = await call("list_rules", { payee: lidl });
    expect(await learns(lidl), "learning made the rule").toBe(true);

    await call("update_rule", {
      id: learned.id,
      actions: [{ op: "set", field: "category", value: bills }],
      recategorize: false,
    });
    expect(await learns(lidl)).toBe(false);

    await call("undo");
    expect(await learns(lidl)).toBe(true);
    expect((await call("get_rule", { id: learned.id })).actions[0].value).toBe(food);
  });
});

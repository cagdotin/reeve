// After a rename, merge or rename rule, today's category rules fill in uncategorized transactions;
// pending_rule_categories and apply_rule_categories do the same on request
// (docs/rules/rules-and-payees.md).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
let book: string;
let checking: string;
let food: string;
let general: string;
let spar: string;
beforeEach(async () => {
  s = scratch();
  book = (await s.call("create_book", { name: "Test" })).id;
  checking = (await s.call("create_account", { book, name: "Checking" })).id;
  const groups = await s.call("list_categories", { book });
  const named = (name: string) => groups[0].categories.find((c: any) => c.name === name).id;
  food = named("Food");
  general = named("General");
  spar = (await s.call("create_payee", { book, name: "Spar" })).id;
  await call("create_rule", {
    conditions: [{ field: "payee", op: "oneOf", value: [spar] }],
    actions: [{ op: "set", field: "category", value: food }],
  });
});
afterEach(() => s.dispose());

const call = (name: string, input: Record<string, unknown> = {}) =>
  s.call(name, { book, ...input });

const categoryOf = async (id: string) => {
  const tx = await call("get_transaction", { id });
  const other = tx.postings.find((p: any) => p.accountId !== checking);
  const groups = await call("list_categories");
  const known = groups.flatMap((g: any) => g.categories).some((c: any) => c.id === other.accountId);
  return known ? (other.accountId as string) : null;
};

/** An imported transaction from the bank's Spar Dankt 4802, uncategorized: no rule named it. */
const imported = async (importedId: string, amount = -970) => {
  await call("import_transactions", {
    account: checking,
    rows: [{ date: "2026-11-10", amount, payee: "Spar Dankt 4802", importedId }],
  });
  const page = await call("list_transactions", { account: checking });
  return page.rows.find((row: any) => row.amount === amount).transactionId as string;
};

const payeeId = async (name: string) =>
  (await call("list_payees")).find((p: any) => p.name === name).id as string;

describe("following a payee rename", () => {
  it("categorizes a renamed payee's uncategorized transactions by its rules", async () => {
    const id = await imported("a");
    expect(await categoryOf(id)).toBe(null);
    // A rename keeps the payee's id, so what holds after it is a rule reading the name.
    await call("create_rule", {
      conditions: [{ field: "payee_name", op: "is", value: "Spar Supermarkt" }],
      actions: [{ op: "set", field: "category", value: food }],
    });
    expect(await categoryOf(id)).toBe(null);
    await call("update_payee", { id: await payeeId("Spar Dankt 4802"), name: "Spar Supermarkt" });
    expect(await categoryOf(id), "the renamed payee's rule matches").toBe(food);
  });

  it("categorizes the transactions a merge moves, and only the uncategorized ones", async () => {
    const id = await imported("a");
    const byHand = await imported("b", -500);
    await call("update_transaction", { id: byHand, account: checking, category: general });
    await call("merge_payees", { target: spar, merge: [await payeeId("Spar Dankt 4802")] });
    expect(await categoryOf(id)).toBe(food);
    expect(await categoryOf(byHand), "a category set by hand stays").toBe(general);
    expect((await call("undo")).done).toBe(true);
    expect(await categoryOf(id), "merge and categorizing are one undo step").toBe(null);
  });

  it("categorizes what a new rename rule matches, writing only the category", async () => {
    const id = await imported("a");
    const byHand = await imported("b", -500);
    await call("update_transaction", { id: byHand, account: checking, category: general });
    const rule = await call("create_payee_rename_rule", {
      fromNames: ["Spar Dankt 4802"],
      to: spar,
    });
    expect(rule.categorized).toEqual([id]);
    expect(await categoryOf(id), "the category rule holds once renamed").toBe(food);
    expect(await categoryOf(byHand), "a category set by hand stays").toBe(general);
    expect((await call("get_transaction", { id })).payee, "the payee is left for apply").toBe(
      "Spar Dankt 4802",
    );
    expect((await call("undo")).done).toBe(true);
    expect(await categoryOf(id), "rule and categorizing are one undo step").toBe(null);
  });
});

describe("applying a rule's actions", () => {
  it("categorizes what the rule renames", async () => {
    const id = await imported("a");
    const applied = await call("apply_rules", {
      ids: [id],
      actions: [{ op: "set", field: "payee", value: spar }],
    });
    expect(applied.updated.map((tx: any) => tx.id)).toEqual([id]);
    expect((await call("get_transaction", { id })).payee).toBe("Spar");
    expect(await categoryOf(id), "the renamed payee's category rule holds").toBe(food);
  });
});

describe("rules that match but are not applied", () => {
  it("lists uncategorized transactions a rule would categorize, and applies them in one step", async () => {
    const one = await imported("a");
    const two = await imported("b", -500);
    const byHand = await imported("c", -300);
    await call("update_transaction", { id: byHand, account: checking, category: general });
    await call("update_transactions", { ids: [one, two, byHand], payee: "Spar" });
    expect(await categoryOf(one), "a bulk payee edit does not run rules").toBe(null);

    const pending = await call("pending_rule_categories", { account: checking });
    expect(pending.transactions.map((each: any) => each.id).toSorted()).toEqual(
      [one, two].toSorted(),
    );
    expect(pending.transactions.every((each: any) => each.category === food)).toBe(true);

    const applied = await call("apply_rule_categories", { account: checking });
    expect(applied.categorized.toSorted()).toEqual([one, two].toSorted());
    expect(await categoryOf(one)).toBe(food);
    expect(await categoryOf(byHand)).toBe(general);
    expect((await call("pending_rule_categories", {})).transactions).toEqual([]);

    expect((await call("undo")).done).toBe(true);
    expect(await categoryOf(one)).toBe(null);
    expect(await categoryOf(two), "applying is one undo step").toBe(null);
  });

  it("leaves off-budget accounts out", async () => {
    const savings = await call("create_account", { name: "Savings", onBudget: false });
    await call("create_transaction", {
      account: savings.id,
      date: "2026-11-10",
      amount: -100,
      payee: "Spar",
    });
    expect((await call("pending_rule_categories", {})).transactions).toEqual([]);
  });
});

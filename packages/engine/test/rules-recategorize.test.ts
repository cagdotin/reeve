// A rule's category goes on the existing transactions it matches when the rule is created with
// one or its category changes (docs/rules/rules-and-payees.md).
import { vi, afterEach, beforeEach, describe, expect, it } from "vitest";

// Frozen behavior stays covered without enabling purchases in the product.
vi.mock("@reeve/contract/features", () => ({ FEATURES: { purchases: true } }));
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
let book: string;
let checking: string;
let food: string;
let bills: string;
let general: string;
let lidl: string;
let aldi: string;
beforeEach(async () => {
  s = scratch();
  book = (await s.call("create_book", { name: "Test" })).id;
  checking = (await s.call("create_account", { book, name: "Checking" })).id;
  const groups = await s.call("list_categories", { book });
  const named = (name: string) => groups[0].categories.find((c: any) => c.name === name).id;
  food = named("Food");
  bills = named("Bills");
  general = named("General");
  lidl = (await s.call("create_payee", { book, name: "Lidl" })).id;
  aldi = (await s.call("create_payee", { book, name: "Aldi" })).id;
});
afterEach(() => s.dispose());

const call = (name: string, input: Record<string, unknown> = {}) =>
  s.call(name, { book, ...input });

const spend = (input: Record<string, unknown> = {}) =>
  call("create_transaction", {
    account: checking,
    date: "2026-10-10",
    amount: -1000,
    payee: "Lidl",
    ...input,
  });

const categoryOf = async (id: string) => {
  const tx = await call("get_transaction", { id });
  return tx.postings.length === 2 ? (tx.postings[1].accountId as string) : undefined;
};

/** A transaction categorized by hand, after the rules that ran when it was added. */
const spendByHand = async (category: string, input: Record<string, unknown> = {}) => {
  const tx = await spend(input);
  await call("update_transaction", { id: tx.id, account: checking, category });
  return tx;
};

const payeeIs = (payee: string) => [{ field: "payee", op: "is", value: payee }];
const setCategory = (value: string) => ({ op: "set", field: "category", value });

describe("recategorizing on create_rule", () => {
  it("sets a new rule's category on the transactions it matches", async () => {
    const a = await spend({ category: general });
    const b = await spend({ date: "2026-09-01" });
    const other = await spend({ payee: "Aldi", category: general });
    const rule = await call("create_rule", {
      conditions: payeeIs(lidl),
      actions: [setCategory(food)],
    });
    expect(new Set(rule.recategorized)).toEqual(new Set([a.id, b.id]));
    expect(await categoryOf(a.id)).toBe(food);
    expect(await categoryOf(b.id)).toBe(food);
    expect(await categoryOf(other.id)).toBe(general);
  });

  it("does not list a transaction that already has the category", async () => {
    await spend({ category: food });
    const rule = await call("create_rule", {
      conditions: payeeIs(lidl),
      actions: [setCategory(food)],
    });
    expect(rule.recategorized).toEqual([]);
  });

  it("changes only the category, never the rule's other actions", async () => {
    const tx = await spend({ category: general, notes: "weekly", cleared: true });
    await call("create_rule", {
      conditions: payeeIs(lidl),
      actions: [
        { op: "set", field: "notes", value: "rule notes" },
        { op: "set", field: "payee", value: aldi },
        { op: "set", field: "amount", value: -5 },
        { op: "set", field: "date", value: "2020-01-01" },
        { op: "set", field: "cleared", value: false },
        { op: "append-notes", value: "!" },
        setCategory(food),
      ],
    });
    const after = await call("get_transaction", { id: tx.id });
    expect(after).toMatchObject({
      date: tx.date,
      payee: "Lidl",
      notes: "weekly",
      importedPayee: tx.importedPayee,
      scheduleId: tx.scheduleId,
    });
    expect(after.postings[0]).toEqual(tx.postings[0]);
    expect(after.postings[1]).toMatchObject({ accountId: food, amount: 1000 });
  });

  it("recategorizes reconciled transactions, keeping them reconciled", async () => {
    const tx = await spend({ category: general, cleared: true });
    await call("reconcile_account", { id: checking, balance: -1000 });
    expect((await call("get_transaction", { id: tx.id })).postings[0].reconciled).toBe(true);
    const rule = await call("create_rule", {
      conditions: payeeIs(lidl),
      actions: [setCategory(food)],
    });
    expect(rule.recategorized).toEqual([tx.id]);
    const after = await call("get_transaction", { id: tx.id });
    expect(after.postings[0]).toMatchObject({ reconciled: true, cleared: true, amount: -1000 });
    expect(after.postings[1].accountId).toBe(food);
  });

  it("leaves splits alone, as apply_rules does", async () => {
    const split = await spend({
      splits: [
        { category: general, amount: -600 },
        { category: bills, amount: -400 },
      ],
    });
    const rule = await call("create_rule", {
      conditions: payeeIs(lidl),
      actions: [setCategory(food)],
    });
    expect(rule.recategorized).toEqual([]);
    const after = await call("get_transaction", { id: split.id });
    expect(after.postings.map((p: any) => p.accountId)).toEqual(
      split.postings.map((p: any) => p.accountId),
    );
  });

  it("leaves transfers alone, and recategorizes off-budget accounts' transactions", async () => {
    const savings = (await call("create_account", { name: "Savings", onBudget: false })).id;
    const transfer = await spend({ transferAccount: savings });
    const offBudget = await spend({ account: savings, category: general });
    const rule = await call("create_rule", {
      conditions: payeeIs(lidl),
      actions: [setCategory(food)],
    });
    expect(rule.recategorized).toEqual([offBudget.id]);
    expect(await call("get_transaction", { id: transfer.id })).toEqual(transfer);
  });

  it("leaves a transaction an applied receipt categorized", async () => {
    const tx = await spend({ category: general });
    const plain = await spend({ category: general, date: "2026-10-11" });
    const { receipt } = await call("create_receipt", {
      date: "2026-10-10",
      payee: "Lidl",
      total: 1000,
      lines: [{ text: "Soap", lineTotal: 1000, budgetCategoryId: bills }],
      payments: [{ transactionId: tx.id }],
    });
    await call("apply_receipt_to_transaction", { id: receipt.id });
    expect(await categoryOf(tx.id)).toBe(bills);
    const rule = await call("create_rule", {
      conditions: payeeIs(lidl),
      actions: [setCategory(food)],
    });
    expect(rule.recategorized).toEqual([plain.id]);
    expect(await categoryOf(tx.id)).toBe(bills);
    expect((await call("get_receipt", { id: receipt.id })).status.applied).toBe(true);
  });

  it("does nothing with recategorize false", async () => {
    const tx = await spend({ category: general });
    const rule = await call("create_rule", {
      conditions: payeeIs(lidl),
      actions: [setCategory(food)],
      recategorize: false,
    });
    expect(rule.recategorized).toEqual([]);
    expect(await categoryOf(tx.id)).toBe(general);
  });

  it("does nothing for a rule whose category is computed, cleared or split", async () => {
    const tx = await spend({ category: general });
    for (const actions of [
      [{ op: "set", field: "category", value: null }],
      [{ op: "set", field: "category", value: "", template: food }],
      [{ op: "set", field: "notes", value: "x" }],
      [
        setCategory(food),
        { op: "set", field: "category", value: bills, splitIndex: 1 },
        { op: "set-split-amount", splitIndex: 1, method: "remainder" },
      ],
    ]) {
      const rule = await call("create_rule", { conditions: payeeIs(lidl), actions });
      expect(rule.recategorized).toEqual([]);
      await call("delete_rules", { ids: [rule.id] });
    }
    expect(await categoryOf(tx.id)).toBe(general);
  });

  it("applies the last set-category action, as running the rule would", async () => {
    const tx = await spend();
    await call("create_rule", {
      conditions: payeeIs(lidl),
      actions: [setCategory(bills), setCategory(food)],
    });
    expect(await categoryOf(tx.id)).toBe(food);
  });

  it("applies only this rule's category, whatever later-stage rules set", async () => {
    const tx = await spend();
    await call("create_rule", {
      stage: "post",
      conditions: payeeIs(lidl),
      actions: [setCategory(bills)],
      recategorize: false,
    });
    await call("create_rule", { conditions: payeeIs(lidl), actions: [setCategory(food)] });
    expect(await categoryOf(tx.id)).toBe(food);
  });
});

describe("recategorizing on update_rule", () => {
  const lidlRule = async (category = general) =>
    (await call("create_rule", { conditions: payeeIs(lidl), actions: [setCategory(category)] }))
      .id as string;

  it("sets a changed category, over categories set by hand", async () => {
    const a = await spend();
    const id = await lidlRule();
    const b = await spendByHand(bills);
    expect(await categoryOf(b.id)).toBe(bills);
    const updated = await call("update_rule", { id, actions: [setCategory(food)] });
    expect(new Set(updated.recategorized)).toEqual(new Set([a.id, b.id]));
    expect(await categoryOf(a.id)).toBe(food);
    expect(await categoryOf(b.id)).toBe(food);
  });

  it("sets a category added to a rule that had none", async () => {
    const tx = await spend({ category: general });
    const { id } = await call("create_rule", {
      conditions: payeeIs(lidl),
      actions: [{ op: "set", field: "notes", value: "x" }],
    });
    expect(await categoryOf(tx.id)).toBe(general);
    const updated = await call("update_rule", {
      id,
      actions: [{ op: "set", field: "notes", value: "x" }, setCategory(food)],
    });
    expect(updated.recategorized).toEqual([tx.id]);
  });

  it("does nothing when only the conditions change", async () => {
    const id = await lidlRule();
    const tx = await spendByHand(bills, { payee: "Aldi" });
    const updated = await call("update_rule", { id, conditions: payeeIs(aldi) });
    expect(updated.recategorized).toEqual([]);
    expect(await categoryOf(tx.id)).toBe(bills);
  });

  it("does nothing when other actions, the stage or the join change", async () => {
    const id = await lidlRule();
    const tx = await spendByHand(bills);
    for (const change of [
      { actions: [{ op: "set", field: "notes", value: "x" }, setCategory(general)] },
      { stage: "post" },
      { conditionsOp: "or" },
      { actions: [setCategory(general)] },
    ]) {
      const updated = await call("update_rule", { id, ...change });
      expect(updated.recategorized).toEqual([]);
    }
    expect(await categoryOf(tx.id)).toBe(bills);
    expect((await call("get_transaction", { id: tx.id })).notes).toBe(null);
  });

  it("matches with the conditions as saved", async () => {
    const id = await lidlRule();
    const atLidl = await spendByHand(bills);
    const atAldi = await spendByHand(bills, { payee: "Aldi" });
    const updated = await call("update_rule", {
      id,
      conditions: payeeIs(aldi),
      actions: [setCategory(food)],
    });
    expect(updated.recategorized).toEqual([atAldi.id]);
    expect(await categoryOf(atLidl.id)).toBe(bills);
  });

  it("does nothing with recategorize false", async () => {
    const id = await lidlRule();
    const tx = await spendByHand(bills);
    const updated = await call("update_rule", {
      id,
      actions: [setCategory(food)],
      recategorize: false,
    });
    expect(updated.recategorized).toEqual([]);
    expect(await categoryOf(tx.id)).toBe(bills);
  });

  it("is one undo step with the rule change", async () => {
    const id = await lidlRule();
    const tx = await spendByHand(bills);
    await call("update_rule", { id, actions: [setCategory(food)] });
    expect(await categoryOf(tx.id)).toBe(food);
    expect((await call("undo")).done).toBe(true);
    expect(await categoryOf(tx.id)).toBe(bills);
    expect((await call("get_rule", { id })).actions).toEqual([setCategory(general)]);
    await call("redo");
    expect(await categoryOf(tx.id)).toBe(food);
    expect((await call("get_rule", { id })).actions).toEqual([setCategory(food)]);
  });

  it("keeps apply_rules applying every action of the rule", async () => {
    const tx = await spend({ category: general });
    const { id } = await call("create_rule", {
      conditions: payeeIs(lidl),
      actions: [{ op: "set", field: "notes", value: "applied" }, setCategory(food)],
      recategorize: false,
    });
    const applied = await call("apply_rules", { rule: id });
    expect(applied.updated.map((each: any) => each.id)).toEqual([tx.id]);
    expect(applied.updated[0].notes).toBe("applied");
    expect(await categoryOf(tx.id)).toBe(food);
  });
});

describe("preview_rule with a category", () => {
  it("counts what saving would recategorize, changing nothing", async () => {
    const savings = (await call("create_account", { name: "Savings", onBudget: false })).id;
    const plain = await spend({ category: general });
    await spend({ category: food });
    await spend({ transferAccount: savings });
    await spend({
      splits: [
        { category: general, amount: -600 },
        { category: bills, amount: -400 },
      ],
    });
    const preview = await call("preview_rule", {
      conditions: payeeIs(lidl),
      category: food,
      account: savings,
    });
    expect(preview.total).toBe(1);
    expect(preview.recategorizes).toBe(1);
    expect(await categoryOf(plain.id)).toBe(general);
    const without = await call("preview_rule", { conditions: payeeIs(lidl) });
    expect(without.total).toBe(5);
    expect(without.recategorizes).toBeUndefined();
    const rule = await call("create_rule", {
      conditions: payeeIs(lidl),
      actions: [setCategory(food)],
    });
    expect(rule.recategorized).toEqual([plain.id]);
  });
});

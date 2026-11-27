import { addMonths, currentMonth, today } from "@reeve/contract/rules";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scratch, writeOlderRule } from "./helpers.ts";

const month = currentMonth();
const day = today();

let s: ReturnType<typeof scratch>;
let checking: string;
let savings: string;
let food: string;
let general: string;
let bills: string;

beforeEach(async () => {
  s = scratch();
  checking = (await s.call("create_account", { name: "Checking", balance: 100_000 })).id;
  savings = (await s.call("create_account", { name: "Savings", onBudget: false })).id;
  const categories = (await s.call<Array<any>>("list_categories")).flatMap(
    (group) => group.categories,
  );
  const id = (name: string) => categories.find((each: any) => each.name === name).id;
  [food, general, bills] = [id("Food"), id("General"), id("Bills")];
});

afterEach(() => s.dispose());

const transfer = (extra: Record<string, unknown> = {}) =>
  s.call("create_transaction", {
    date: day,
    account: checking,
    amount: -1000,
    transferAccount: savings,
    ...extra,
  });
const postingOn = async (id: string, account: string) =>
  (await s.call("get_transaction", { id })).postings.find((p: any) => p.accountId === account);
const clearAndReconcileSavings = async (id: string) => {
  await s.call("update_transaction", { id, account: savings, cleared: true });
  await s.call("reconcile_account", { id: savings, balance: 1000 });
};
const categoryIn = async (category: string, at = month) =>
  (await s.call("get_budget", { month: at })).months[0].categories.find(
    (each: any) => each.id === category,
  );
const ruleFor = async (payee: string, category: string) =>
  s.call("create_rule", {
    conditions: [
      { op: "is", field: "payee", value: (await s.call("create_payee", { name: payee })).id },
    ],
    actions: [{ op: "set", field: "category", value: category }],
  });

describe("editing a transfer from one side", () => {
  it("refuses to change the other side's reconciled amount", async () => {
    const { id } = await transfer();
    await clearAndReconcileSavings(id);
    await s.fails("update_transaction", { id, account: checking, amount: -2000 });
    expect(await postingOn(id, savings)).toMatchObject({
      amount: 1000,
      cleared: true,
      reconciled: true,
    });
  });

  it("keeps the other side's marks when the amount stays", async () => {
    const { id } = await transfer();
    await clearAndReconcileSavings(id);
    await s.call("update_transaction", { id, account: checking, category: food });
    expect(await postingOn(id, savings)).toMatchObject({
      amount: 1000,
      cleared: true,
      reconciled: true,
      categoryId: food,
    });
  });

  it("keeps the other side cleared when the amount changes", async () => {
    const { id } = await transfer();
    await s.call("update_transaction", { id, account: savings, cleared: true });
    await s.call("update_transaction", { id, account: checking, amount: -2000 });
    expect(await postingOn(id, savings)).toMatchObject({ amount: 2000, cleared: true });
  });

  it("keeps the category when edited from the off-budget side, as the web form sends it", async () => {
    const { id } = await transfer({ category: food });
    await s.call("update_transaction", {
      id,
      account: savings,
      amount: 2000,
      category: null,
      transferAccount: checking,
    });
    expect((await postingOn(id, savings)).categoryId).toBe(food);
    expect((await categoryIn(food)).spent).toBe(-2000);
  });

  it("drops the category when the transfer goes somewhere else", async () => {
    const other = (await s.call("create_account", { name: "Other" })).id;
    const { id } = await transfer({ category: food });
    await s.call("update_transaction", { id, account: savings, transferAccount: other });
    expect((await postingOn(id, savings)).categoryId).toBe(null);
  });
});

describe("replacing a transaction's postings", () => {
  it.each([
    ["no postings", []],
    ["one posting of nothing", [{ amount: 0 }]],
  ])("refuses %s", async (_name, lines) => {
    const { id } = await transfer();
    await s.fails("update_transaction", {
      id,
      postings: lines.map((line: any) => ({ account: checking, ...line })),
    });
    expect((await s.call("get_transaction", { id })).postings).toHaveLength(2);
  });

  it("refuses a category on an on-budget posting", async () => {
    const { id } = await transfer();
    const failure = await s.fails("update_transaction", {
      id,
      postings: [
        { account: checking, amount: -1000, category: food },
        { account: savings, amount: 1000 },
      ],
    });
    expect(failure.message).toContain("off-budget");
  });

  it("refuses to change a reconciled posting, and keeps it when it stays the same", async () => {
    const { id } = await transfer();
    await clearAndReconcileSavings(id);
    await s.fails("update_transaction", {
      id,
      postings: [
        { account: checking, amount: -9999 },
        { account: savings, amount: 9999 },
      ],
    });
    await s.fails("update_transaction", {
      id,
      postings: [
        { account: checking, amount: -1000 },
        { account: food, amount: 1000 },
      ],
    });
    await s.call("update_transaction", {
      id,
      postings: [
        { account: checking, amount: -1000, memo: "same money" },
        { account: savings, amount: 1000 },
      ],
    });
    expect(await postingOn(id, savings)).toMatchObject({ cleared: true, reconciled: true });
  });
});

describe("deleting a reconciled transaction", () => {
  it("needs confirmReconciled, also when only the other side is reconciled", async () => {
    const { id } = await transfer();
    await clearAndReconcileSavings(id);
    const failure = await s.fails("delete_transactions", { ids: [id] });
    expect(failure.message).toContain("confirmReconciled");
    expect((await s.call("get_transaction", { id })).id).toBe(id);
    await s.call("delete_transactions", { ids: [id], confirmReconciled: true });
    await s.fails("get_transaction", { id });
  });

  it("needs nothing for one that is not reconciled", async () => {
    const { id } = await transfer();
    expect((await s.call("delete_transactions", { ids: [id] })).deleted).toEqual([id]);
  });

  it("is never done by a rule", async () => {
    const { id } = await transfer({ payee: "Broker" });
    await clearAndReconcileSavings(id);
    const payee = (await s.call("get_transaction", { id })).payeeId;
    const result = await s.call("apply_rules", {
      conditions: [{ op: "is", field: "payee", value: payee }],
      actions: [{ op: "delete-transaction" }],
    });
    expect(result.deleted).toEqual([]);
    expect((await s.call("get_transaction", { id })).id).toBe(id);
  });
});

describe("rollover", () => {
  it("goes on in months past the range it was set over", async () => {
    await s.call("set_carryover", { month, category: food, carryover: true });
    const { end } = (await s.call("get_budget", { month })).range;
    const past = addMonths(end, 1);
    expect((await categoryIn(food, past)).carryover).toBe(true);
    await s.call("create_transaction", {
      date: `${past}-05`,
      account: checking,
      amount: -500,
      category: food,
    });
    expect((await categoryIn(food, addMonths(end, 2))).balance).toBe(-500);
  });

  it("stays off past the range after being turned off, even in a row kept out there", async () => {
    await s.call("set_carryover", { month, category: food, carryover: true });
    const { end } = (await s.call("get_budget", { month })).range;
    const far = addMonths(end, 2);
    await s.call("set_budget", { month: far, category: food, amount: 0 });
    await s.call("set_carryover", { month, category: food, carryover: false });
    expect((await categoryIn(food, far)).carryover).toBe(false);
    expect((await categoryIn(food, addMonths(far, 1))).carryover).toBe(false);
  });

  it("starts in the month it is set, not before", async () => {
    await s.call("set_carryover", { month, category: food, carryover: true });
    expect((await categoryIn(food, addMonths(month, -1))).carryover).toBe(false);
  });
});

describe("rules and deleted categories", () => {
  it("follow a category that moves into another", async () => {
    const rule = await ruleFor("Rewe", food);
    await s.call("delete_category", { id: food, transferCategory: general });
    expect((await s.call("get_rule", { id: rule.id })).actions[0].value).toBe(general);
    const made = await s.call("create_transaction", {
      date: day,
      account: checking,
      amount: -100,
      payee: "Rewe",
    });
    expect(made.postings[1].accountId).toBe(general);
  });

  it("go with a category deleted outright, when that is all they did", async () => {
    const rule = await ruleFor("Rewe", food);
    await s.call("delete_category", { id: food });
    expect((await s.fails("get_rule", { id: rule.id }))._tag).toBe("NotFound");
  });

  it("lose a deleted category from a list, and go when it was the only one", async () => {
    const rule = await s.call("create_rule", {
      conditions: [{ op: "oneOf", field: "category", value: [food, general] }],
      actions: [{ op: "set", field: "notes", value: "seen" }],
    });
    await s.call("delete_category", { id: food });
    expect((await s.call("get_rule", { id: rule.id })).conditions[0].value).toEqual([general]);
    await s.call("delete_category", { id: general });
    await s.fails("get_rule", { id: rule.id });
  });

  it("go with a deleted group they name", async () => {
    const group = await s.call("create_category_group", { name: "Temporary" });
    const rule = await s.call("create_rule", {
      conditions: [{ op: "is", field: "category_group", value: group.id }],
      actions: [{ op: "set", field: "notes", value: "seen" }],
    });
    await s.call("delete_category_group", { id: group.id });
    expect((await s.fails("get_rule", { id: rule.id }))._tag).toBe("NotFound");
  });

  it("do not stop transactions when a rule from an older book names a missing category", async () => {
    const rule = await ruleFor("Rewe", food);
    writeOlderRule((await s.call("get_book")).file, rule.id, [
      { op: "set", field: "category", value: "no-such-category" },
    ]);
    const made = await s.call("create_transaction", {
      date: day,
      account: checking,
      amount: -100,
      payee: "Rewe",
    });
    expect(made.postings).toHaveLength(2);
    const imported = await s.call("import_transactions", {
      account: checking,
      rows: [{ date: day, amount: -200, payee: "Rewe" }],
    });
    expect(imported).toBeDefined();
  });

  it("can be undone with the category", async () => {
    const rule = await ruleFor("Rewe", food);
    await s.call("delete_category", { id: food, transferCategory: general });
    await s.call("undo");
    expect((await s.call("get_rule", { id: rule.id })).actions[0].value).toBe(food);
  });
});

describe("a rule on a transfer entered from off budget", () => {
  it("does not refuse the transfer, and leaves its category alone", async () => {
    await ruleFor("Broker", food);
    const made = await s.call("create_transaction", {
      date: day,
      account: savings,
      amount: -100,
      payee: "Broker",
      transferAccount: checking,
    });
    expect(made.postings.every((posting: any) => posting.categoryId === null)).toBe(true);
    expect((await categoryIn(food)).spent).toBe(0);
  });

  it("does not stop apply_rules over both sides of a transfer", async () => {
    const rule = await ruleFor("Broker", food);
    const { id } = await transfer({ payee: "Broker", category: general });
    await s.call("apply_rules", { rule: rule.id });
    expect((await postingOn(id, savings)).categoryId).toBe(food);
  });

  it("still refuses a category named from the off-budget side", async () => {
    const failure = await s.fails("create_transaction", {
      date: day,
      account: savings,
      amount: -100,
      transferAccount: checking,
      category: food,
    });
    expect(failure.message).toContain("budget account's side");
  });
});

describe("a rule and the category a person names", () => {
  it("keeps the pick on a new transaction, and fills it when left out", async () => {
    await ruleFor("Rewe", food);
    const entry = { date: day, account: checking, amount: -100, payee: "Rewe" };
    const picked = await s.call("create_transaction", { ...entry, category: general });
    expect(picked.postings[1].accountId).toBe(general);
    const left = await s.call("create_transaction", entry);
    expect(left.postings[1].accountId).toBe(food);
  });

  it("learns from picks once learning is back on, so the rule follows them", async () => {
    const rule = await ruleFor("Rewe", food);
    await s.call("update_payee", { id: rule.conditions[0].value, learnCategories: true });
    for (let index = 0; index < 3; index++)
      await s.call("create_transaction", {
        date: day,
        account: checking,
        amount: -100,
        payee: "Rewe",
        category: general,
      });
    expect((await s.call("get_rule", { id: rule.id })).actions[0].value).toBe(general);
  });
});

describe("learning categories", () => {
  it("leaves a rule for every other payee alone", async () => {
    const x = (await s.call("create_payee", { name: "X" })).id;
    const rule = await s.call("create_rule", {
      conditions: [{ op: "isNot", field: "payee", value: x }],
      actions: [{ op: "set", field: "category", value: bills }],
      recategorize: false,
    });
    for (let index = 0; index < 3; index++)
      await s.call("create_transaction", {
        date: day,
        account: checking,
        amount: -100,
        payee: "X",
        category: food,
      });
    expect((await s.call("get_rule", { id: rule.id })).actions[0].value).toBe(bills);
  });
});

describe("merging transactions", () => {
  const entry = (amount: number, extra: Record<string, unknown> = {}) =>
    s.call("create_transaction", { date: day, account: checking, amount, ...extra });

  it("refuses different amounts or accounts, as Actual", async () => {
    const [a, b] = [await entry(-100), await entry(-999)];
    await s.fails("merge_transactions", { keep: a.id, drop: b.id });
    const other = await s.call("create_transaction", {
      date: day,
      account: (await s.call("create_account", { name: "Other" })).id,
      amount: -100,
    });
    await s.fails("merge_transactions", { keep: a.id, drop: other.id });
    expect((await s.call("get_transaction", { id: b.id })).id).toBe(b.id);
  });

  it("gives an uncategorized copy the other's category", async () => {
    const [a, b] = [await entry(-100), await entry(-100, { category: food })];
    const merged = await s.call("merge_transactions", { keep: a.id, drop: b.id });
    expect(merged.postings).toHaveLength(2);
    expect(merged.postings[1].accountId).toBe(food);
    expect((await categoryIn(food)).spent).toBe(-100);
  });

  it("gives an uncategorized copy the other's transfer, category and all", async () => {
    const [a, b] = [await entry(-1000), await transfer({ category: food })];
    const merged = await s.call("merge_transactions", { keep: a.id, drop: b.id });
    expect(merged.postings.find((p: any) => p.accountId === savings).categoryId).toBe(food);
    expect(merged.postings.reduce((sum: number, p: any) => sum + p.amount, 0)).toBe(0);
  });

  it("keeps the kept category when both have one", async () => {
    const [a, b] = [
      await entry(-100, { category: general }),
      await entry(-100, { category: food }),
    ];
    const merged = await s.call("merge_transactions", { keep: a.id, drop: b.id });
    expect(merged.postings[1].accountId).toBe(general);
  });

  it("keeps what the dropped copy reconciled", async () => {
    const [a, b] = [await entry(-100), await entry(-100, { cleared: true })];
    const { cleared } = (await s.call("list_accounts")).find((x: any) => x.id === checking);
    await s.call("reconcile_account", { id: checking, balance: cleared });
    const merged = await s.call("merge_transactions", { keep: a.id, drop: b.id });
    expect(merged.postings[0]).toMatchObject({ cleared: true, reconciled: true });
  });
});

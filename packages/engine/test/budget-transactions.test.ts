import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
beforeEach(() => {
  s = scratch();
});
afterEach(() => s.dispose());

const setup = async () => {
  const book = (await s.call("create_book", { name: "Budget records" })).id as string;
  const groups = await s.call("list_categories", { book });
  const category = (name: string) =>
    groups.flatMap((g: any) => g.categories).find((c: any) => c.name === name);
  const checking = await s.call("create_account", {
    book,
    name: "Checking",
    balance: 100000,
    date: "2026-06-01",
  });
  const card = await s.call("create_account", { book, name: "Visa", type: "liability" });
  const brokerage = await s.call("create_account", {
    book,
    name: "Brokerage",
    onBudget: false,
    balance: 500000,
    date: "2026-06-01",
  });
  const add = (account: string, input: Record<string, unknown>) =>
    s.call("create_transaction", { book, account, date: "2026-06-10", ...input });
  return {
    book,
    food: category("Food"),
    bills: category("Bills"),
    income: category("Income"),
    checking,
    card,
    brokerage,
    add,
  };
};

const spent = async (book: string, category: string) => {
  const view = await s.call("get_budget", { book, month: "2026-06" });
  return view.months[0].categories.find((c: any) => c.id === category).spent;
};

describe("budget_transactions", () => {
  it("lists what makes up a category's spent figure, and sums to it", async () => {
    const { book, food, bills, checking, card, brokerage, add } = await setup();
    const plain = await add(checking.id, { amount: -4200, payee: "Grocer", category: food.id });
    const split = await add(checking.id, {
      amount: -10000,
      payee: "Market",
      splits: [
        { amount: -5500, category: food.id },
        { amount: -4500, category: bills.id },
      ],
    });
    const onCard = await add(card.id, { amount: -1800, payee: "Bakery", category: food.id });
    const transfer = await add(checking.id, {
      amount: -20000,
      transferAccount: brokerage.id,
      category: food.id,
    });
    await add(brokerage.id, { amount: -900, payee: "Off budget", category: food.id });
    await s.call("create_transaction", {
      book,
      account: checking.id,
      date: "2026-05-30",
      amount: -600,
      category: food.id,
    });

    const records = await s.call("budget_transactions", {
      book,
      category: food.id,
      month: "2026-06",
    });
    expect(
      await spent(book, food.id),
      "grocer, the split's food line, the card, the transfer",
    ).toBe(-4200 - 5500 - 1800 - 20000);
    expect(records.total, "the rows sum to the budget's figure").toBe(await spent(book, food.id));
    const counted = new Map(records.rows.map((r: any) => [r.row.transactionId, r.counted]));
    expect(new Set(counted.keys()), "not May, nor the off-budget purchase").toEqual(
      new Set([plain.id, split.id, onCard.id, transfer.id]),
    );
    expect(counted.get(split.id), "a split counts only its food line").toBe(-5500);
    const transferRow = records.rows.find((r: any) => r.row.transactionId === transfer.id).row;
    expect(transferRow.accountId, "a transfer shows from the budget side").toBe(checking.id);
  });

  it("counts a parent's subcategories with it, and a group's every category", async () => {
    const { book, food, bills, checking, add } = await setup();
    const fruit = await s.call("create_category", { book, name: "Fruit", parent: food.id });
    const apples = await s.call("create_category", { book, name: "Apples", parent: fruit.id });
    const own = await add(checking.id, { amount: -1000, payee: "Grocer", category: food.id });
    const child = await add(checking.id, { amount: -300, payee: "Stall", category: fruit.id });
    const grandchild = await add(checking.id, {
      amount: -200,
      payee: "Orchard",
      category: apples.id,
    });
    const split = await add(checking.id, {
      amount: -900,
      payee: "Market",
      splits: [
        { amount: -400, category: fruit.id },
        { amount: -500, category: bills.id },
      ],
    });

    const view = (await s.call("get_budget", { book, month: "2026-06" })).months[0];
    const parent = await s.call("budget_transactions", {
      book,
      category: food.id,
      month: "2026-06",
    });
    expect(
      view.categories.find((c: any) => c.id === food.id).total.spent,
      "food, fruit, apples and the split's fruit line",
    ).toBe(-1000 - 300 - 200 - 400);
    expect(parent.total, "a parent sums to its rolled-up total").toBe(
      view.categories.find((c: any) => c.id === food.id).total.spent,
    );
    expect(new Set(parent.rows.map((r: any) => r.row.transactionId))).toEqual(
      new Set([own.id, child.id, grandchild.id, split.id]),
    );
    const middle = await s.call("budget_transactions", {
      book,
      category: fruit.id,
      month: "2026-06",
    });
    expect(middle.total, "a middle category leaves out its parent").toBe(-300 - 200 - 400);

    const group = await s.call("budget_transactions", {
      book,
      group: food.groupId,
      month: "2026-06",
    });
    expect(group.total, "a group sums to its spent figure").toBe(
      view.groups.find((g: any) => g.id === food.groupId).spent,
    );
    expect(
      group.rows.find((r: any) => r.row.transactionId === split.id).counted,
      "both split lines are in the group",
    ).toBe(-900);
    expect(await s.fails("budget_transactions", { book, month: "2026-06" })).toMatchObject({
      _tag: "InvalidRequest",
    });
  });

  it("lists income a category received, positive", async () => {
    const { book, income, checking, add } = await setup();
    await add(checking.id, { amount: 300000, payee: "Employer", category: income.id });
    const records = await s.call("budget_transactions", {
      book,
      category: income.id,
      month: "2026-06",
    });
    expect(records.total).toBe(300000);
    expect(records.total).toBe(await spent(book, income.id));
  });
});

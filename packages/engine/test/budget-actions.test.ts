import { addMonths, currentMonth, firstDay } from "@reeve/contract/rules";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
beforeEach(() => {
  s = scratch();
});
afterEach(() => s.dispose());

const month = currentMonth();

/** Food and a second expense category, each budgeted 100.00 every month from four months back to two ahead, and Food spending 30.00 a month before this one. */
const setup = async () => {
  const { id: book } = await s.call("create_book", { name: "Test" });
  const expenses = (await s.call("list_categories", { book })).find((g: any) => !g.isIncome);
  const [food, other] = expenses.categories;
  const checking = await s.call("create_account", {
    book,
    name: "Checking",
    balance: 1_000_000,
    date: firstDay(addMonths(month, -6)),
  });
  for (let i = -4; i <= 2; i++) {
    const at = addMonths(month, i);
    for (const category of [food, other])
      await s.call("set_budget", { book, month: at, category: category.id, amount: 10_000 });
    if (i < 0)
      await s.call("create_transaction", {
        book,
        account: checking.id,
        date: firstDay(at),
        amount: -3_000,
        category: food.id,
      });
  }
  const budgeted = async (category: string) => {
    const view = await s.call("get_budget", { book, month: addMonths(month, -4), count: 7 });
    return view.months.map(
      (each: any) => each.categories.find((row: any) => row.id === category).budgeted,
    );
  };
  return { book, food, other, budgeted };
};

describe("an income category in an envelope budget", () => {
  const income = async (book: string) =>
    (await s.call("list_categories", { book })).find((g: any) => g.isIncome).categories[0].id;

  const REFUSED = /envelope budget/;

  it("refuses an amount, on every operation that assigns one", async () => {
    const { book, food } = await setup();
    const salary = await income(book);
    const budgetBefore = await s.call("get_budget", { book, month, count: 1 });

    const writes = [
      () => s.call("set_budget", { book, month, category: salary, amount: 300_000 }),
      () => s.call("move_budget", { book, month, from: "to-budget", to: salary, amount: 100 }),
      () => s.call("move_budget", { book, month, from: salary, to: food.id, amount: 100 }),
      () => s.call("apply_budget_action", { book, month, action: "set-zero", category: salary }),
      () => s.call("cover_overspending", { book, month, category: food.id, from: salary }),
      () => s.call("cover_overbudgeted", { book, month, category: salary }),
    ];
    for (const write of writes) await expect(write()).rejects.toThrow(REFUSED);

    expect(await s.call("get_budget", { book, month, count: 1 })).toEqual(budgetBefore);
  });

  it("skips its month-end rules and says so, leaving the rest of the cleanup to run", async () => {
    const { book, food, other } = await setup();
    const salary = await income(book);
    await s.call("set_category_targets", {
      book,
      category: salary,
      leftovers: [{ kind: "give-back" }],
    });
    await s.call("set_category_targets", {
      book,
      category: food.id,
      leftovers: [{ kind: "send", to: other.id }],
    });

    const result = await s.call("cleanup_templates", { book, month });

    expect(result.warnings.join()).toMatch(/income category/);
    const budget = await s.call("get_budget", { book, month, count: 1 });
    const budgeted = (id: string) =>
      budget.months[0].categories.find((row: any) => row.id === id).budgeted;
    expect(budgeted(food.id), "Food's leftovers leave it").toBeLessThan(10_000);
    expect(budgeted(other.id), "the receiving category gets them").toBeGreaterThan(10_000);
  });

  it("still takes a hold-for-next-month mark", async () => {
    const { book } = await setup();
    const salary = await income(book);
    await s.call("set_carryover", { book, month, category: salary, carryover: true });
    const budget = await s.call("get_budget", { book, month, count: 1 });
    const row = budget.months[0].categories.find((category: any) => category.id === salary);
    expect(row.carryover).toBe(true);
  });

  it("takes an amount again once the book is a tracking budget", async () => {
    const { book } = await setup();
    const salary = await income(book);
    await s.call("update_book", { book, budgetType: "tracking" });
    await s.call("set_budget", { book, month, category: salary, amount: 300_000 });
    const budget = await s.call("get_budget", { book, month, count: 1 });
    expect(budget.months[0].summary.budgetedIncome).toBe(300_000);
  });
});

describe("budget actions", () => {
  it("change only the month they are applied to", async () => {
    const { book, food, other, budgeted } = await setup();
    await s.call("apply_budget_action", { book, month, action: "average-3" });
    expect(await budgeted(food.id)).toEqual([
      10_000, 10_000, 10_000, 10_000, 3_000, 10_000, 10_000,
    ]);
    expect(await budgeted(other.id)).toEqual([10_000, 10_000, 10_000, 10_000, 0, 10_000, 10_000]);
  });

  it("change only the category given", async () => {
    const { book, food, other, budgeted } = await setup();
    for (const action of ["set-zero", "average-6", "copy-last", "set-to-spent"] as const) {
      await s.call("apply_budget_action", { book, month, action, category: food.id });
      expect(await budgeted(other.id)).toEqual(Array(7).fill(10_000));
    }
    await s.call("apply_budget_action", { book, month, action: "average-3", category: food.id });
    expect((await budgeted(food.id))[4]).toBe(3_000);
  });

  it("copy to the rest of the year only from the month on", async () => {
    const { book, food, budgeted } = await setup();
    await s.call("set_budget", { book, month, category: food.id, amount: 5_000 });
    await s.call("apply_budget_action", {
      book,
      month,
      action: "copy-until-year-end",
      category: food.id,
    });
    const year = month.slice(0, 4);
    const expected = Array.from({ length: 7 }, (_, i) => {
      const at = addMonths(month, i - 4);
      return at < month ? 10_000 : at.slice(0, 4) === year ? 5_000 : 10_000;
    });
    expect(await budgeted(food.id)).toEqual(expected);
  });
});

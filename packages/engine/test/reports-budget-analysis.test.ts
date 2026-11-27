/**
 * Actual's `budget-analysis-spreadsheet.test.ts` on the engine's budget analysis functions, and the
 * report through `budget_analysis_report`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getNextRunningBalance,
  isBaseCategory,
  summarizeMonthCategories,
} from "../src/reports/budget-analysis.ts";
import { scratch } from "./helpers.ts";

describe("isBaseCategory", () => {
  const visibleExpense = { is_income: 0, hidden: 0 };
  const hiddenExpense = { is_income: 0, hidden: 1 };
  const income = { is_income: 1, hidden: 0 };
  const hiddenIncome = { is_income: 1, hidden: 1 };

  it("keeps visible expense categories, hidden ones only when asked", () => {
    expect(isBaseCategory(visibleExpense, false)).toBe(true);
    expect(isBaseCategory(hiddenExpense, false)).toBe(false);
    expect(isBaseCategory(hiddenExpense, true)).toBe(true);
  });

  it("always leaves out income categories", () => {
    for (const shown of [false, true]) {
      expect(isBaseCategory(income, shown)).toBe(false);
      expect(isBaseCategory(hiddenIncome, shown)).toBe(false);
    }
  });
});

describe("summarizeMonthCategories", () => {
  const row = (
    id: string,
    budgeted: number,
    spent: number,
    balance: number,
    carryover = false,
  ) => ({
    id,
    budgeted,
    spent,
    balance,
    carryover,
  });
  const c1 = [{ id: "c1" }];

  it("reports no budget data for an empty or never-budgeted month", () => {
    const empty = {
      budgeted: 0,
      spent: 0,
      carryoverToNextMonth: 0,
      overspendingThisMonth: 0,
      hasBudgetData: false,
    };
    expect(summarizeMonthCategories([], c1)).toEqual(empty);
    expect(summarizeMonthCategories([row("c1", 0, 0, 0)], c1)).toEqual(empty);
  });

  it("carries a positive balance to the next month", () => {
    expect(summarizeMonthCategories([row("c1", 10000, -4000, 6000)], c1)).toMatchObject({
      carryoverToNextMonth: 6000,
      overspendingThisMonth: 0,
      hasBudgetData: true,
    });
  });

  it("treats an overspend without carryover as an overspending adjustment", () => {
    expect(summarizeMonthCategories([row("c1", 0, -10000, -10000)], c1)).toMatchObject({
      carryoverToNextMonth: 0,
      overspendingThisMonth: -10000,
      hasBudgetData: true,
    });
  });

  it("carries a negative balance forward when carryover is enabled", () => {
    expect(summarizeMonthCategories([row("c1", 0, -10000, -10000, true)], c1)).toMatchObject({
      carryoverToNextMonth: -10000,
      overspendingThisMonth: 0,
    });
  });

  it("only counts the categories it is given", () => {
    expect(
      summarizeMonthCategories([row("c1", 10000, 0, 10000), row("c2", 5000, 0, 5000)], c1),
    ).toMatchObject({ budgeted: 10000, carryoverToNextMonth: 10000 });
  });
});

describe("getNextRunningBalance", () => {
  it("hands off only what carries over when the month has data", () => {
    expect(
      getNextRunningBalance({
        hasBudgetData: true,
        carryoverToNextMonth: 6000,
        runningBalance: 20000,
      }),
    ).toBe(6000);
    expect(
      getNextRunningBalance({
        hasBudgetData: true,
        carryoverToNextMonth: 0,
        runningBalance: 20000,
      }),
    ).toBe(0);
  });

  it("passes the running balance through a run of months with no budget data", () => {
    let runningBalance = 15000;
    for (let i = 0; i < 6; i++)
      runningBalance = getNextRunningBalance({
        hasBudgetData: false,
        carryoverToNextMonth: 0,
        runningBalance,
      });
    expect(runningBalance).toBe(15000);
  });

  it("does not carry a non-carryover overspend into later empty months", () => {
    let runningBalance = getNextRunningBalance({
      hasBudgetData: true,
      carryoverToNextMonth: 0,
      runningBalance: 0,
    });
    for (let i = 0; i < 3; i++)
      runningBalance = getNextRunningBalance({
        hasBudgetData: false,
        carryoverToNextMonth: 0,
        runningBalance,
      });
    expect(runningBalance).toBe(0);
  });
});

describe("budget_analysis_report", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => {
    s = scratch();
  });
  afterEach(() => s.dispose());

  const setup = async () => {
    const book = (await s.call("create_book", { name: "Analysis" })).id as string;
    const groups = await s.call("list_categories", { book });
    const category = (name: string) =>
      groups.flatMap((g: any) => g.categories).find((c: any) => c.name === name);
    const checking = await s.call("create_account", {
      book,
      name: "Checking",
      balance: 500000,
      date: "2026-01-01",
    });
    const tx = (input: Record<string, unknown>) =>
      s.call("create_transaction", { book, account: checking.id, ...input });
    const budget = (month: string, id: string, amount: number) =>
      s.call("set_budget", { book, month, category: id, amount });
    return {
      book,
      tx,
      budget,
      food: category("Food").id as string,
      bills: category("Bills").id as string,
      savings: category("Savings").id as string,
      usual: groups[0].id as string,
    };
  };

  it("runs the balance through the months, resetting overspending that does not carry over", async () => {
    const { book, tx, budget, food, bills } = await setup();
    await budget("2025-12", food, 5000);
    await budget("2026-01", food, 10000);
    await budget("2026-01", bills, 20000);
    await tx({ date: "2026-01-05", amount: -4000, category: food });
    await tx({ date: "2026-01-06", amount: -25000, category: bills });
    await budget("2026-02", food, 10000);
    await tx({ date: "2026-02-05", amount: -3000, category: food });

    const report = await s.call("budget_analysis_report", {
      book,
      start: "2026-01",
      end: "2026-03",
    });
    expect(report.start).toBe("2026-01-01");
    expect(report.end).toBe("2026-03-31");
    expect(report.intervals).toEqual([
      // December's 50.00 for food carries in.
      { date: "2026-01", budgeted: 30000, spent: -29000, balance: 6000, overspendingAdjustment: 0 },
      // Food's 110.00 carries; bills' -50.00 resets and shows as February's adjustment.
      {
        date: "2026-02",
        budgeted: 10000,
        spent: -3000,
        balance: 18000,
        overspendingAdjustment: 5000,
      },
      { date: "2026-03", budgeted: 0, spent: 0, balance: 18000, overspendingAdjustment: 0 },
    ]);
    expect(report).toMatchObject({
      totalBudgeted: 40000,
      totalSpent: -32000,
      totalOverspendingAdjustment: 5000,
      finalOverspendingAdjustment: 0,
      endingBalance: 18000,
    });
  });

  it("carries negative balances of categories that roll overspending over", async () => {
    const { book, tx, food } = await setup();
    await s.call("set_carryover", { book, month: "2026-01", category: food, carryover: true });
    await tx({ date: "2026-01-05", amount: -4000, category: food });
    const report = await s.call("budget_analysis_report", {
      book,
      start: "2026-01",
      end: "2026-02",
    });
    expect(report.intervals.map((i: any) => [i.balance, i.overspendingAdjustment])).toEqual([
      [-4000, 0],
      [-4000, 0],
    ]);
    expect(report.finalOverspendingAdjustment).toBe(0);
  });

  it("starts from what the month before the range carries over", async () => {
    const { book, budget, food } = await setup();
    await budget("2026-01", food, 10000);
    const report = await s.call("budget_analysis_report", {
      book,
      start: "2026-02",
      end: "2026-02",
    });
    expect(report.intervals[0]).toMatchObject({ budgeted: 0, balance: 10000 });
  });

  it("counts only the categories the category filters name, and hidden ones when asked", async () => {
    const { book, budget, food, bills, savings, usual } = await setup();
    await budget("2026-01", food, 10000);
    await budget("2026-01", bills, 20000);
    await budget("2026-01", savings, 40000);
    const run = (input: Record<string, unknown>) =>
      s.call("budget_analysis_report", { book, start: "2026-01", end: "2026-01", ...input });

    expect((await run({})).totalBudgeted).toBe(70000);
    const one = await run({ conditions: [{ field: "category", op: "is", value: food }] });
    expect(one.totalBudgeted).toBe(10000);
    const group = await run({
      conditions: [{ field: "category_group", op: "is", value: usual }],
    });
    expect(group.totalBudgeted).toBe(30000);
    const either = await run({
      conditions: [
        { field: "category", op: "is", value: food },
        { field: "category", op: "contains", value: "sav" },
      ],
      conditionsOp: "or",
    });
    expect(either.totalBudgeted).toBe(50000);
    const both = await run({
      conditions: [
        { field: "category", op: "is", value: food },
        { field: "category", op: "contains", value: "sav" },
      ],
    });
    expect(both.totalBudgeted).toBe(0);
    // Conditions on other fields do not apply.
    const payee = await run({ conditions: [{ field: "payee", op: "is", value: "x" }] });
    expect(payee.totalBudgeted).toBe(70000);

    await s.call("update_category", { book, id: savings, hidden: true });
    expect((await run({})).totalBudgeted).toBe(30000);
    expect((await run({ showHiddenCategories: true })).totalBudgeted).toBe(70000);
  });
});

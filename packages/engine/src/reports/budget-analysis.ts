/**
 * Actual's budget analysis (`budget-analysis-spreadsheet.ts`): per month what the expense
 * categories were budgeted and spent, the overspending reset at the month before's end, and a
 * running balance that carries over as the budget does.
 */
import type { BudgetAnalysisReport, TimeFrameMode } from "./types.ts";
import type { CategoryMonthResult } from "@reeve/contract/rules";
import { firstDay, intToDay, lastDay, monthOf, monthRange, prevMonth } from "@reeve/contract/rules";
import type { Book } from "../book.ts";
import { computeMonths } from "../budget/view.ts";
import {
  categoryRows,
  filterCategoriesByConditions,
  isSupportedCategoryCondition,
  type CategoryRow,
} from "./context.ts";
import { resolveTimeFrame } from "./dates.ts";
import { transactionBounds, type Condition, type ConditionsOp } from "./lines.ts";

/** The categories the report can count: expense ones, hidden ones only when asked. */
export const isBaseCategory = (
  category: { readonly is_income: number | boolean; readonly hidden: number | boolean },
  showHiddenCategories: boolean,
): boolean => !category.is_income && (showHiddenCategories || !category.hidden);

export interface MonthCategoryTotals {
  readonly budgeted: number;
  readonly spent: number;
  /** Balances that roll into next month: positive ones, and negative ones that carry over. */
  readonly carryoverToNextMonth: number;
  /** Negative balances that do not carry over: next month's overspending adjustment. */
  readonly overspendingThisMonth: number;
  /** Whether the month has any value at all; an unbudgeted future month has none. */
  readonly hasBudgetData: boolean;
}

/** A month's computed category rows reduced to the report's totals, for the given categories. */
export const summarizeMonthCategories = (
  rows: ReadonlyArray<CategoryMonthResult>,
  categories: ReadonlyArray<{ readonly id: string }>,
): MonthCategoryTotals => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  let budgeted = 0;
  let spent = 0;
  let carryoverToNextMonth = 0;
  let overspendingThisMonth = 0;
  let hasBudgetData = false;
  for (const category of categories) {
    const row = byId.get(category.id);
    const balance = row?.balance ?? 0;
    if ((row?.budgeted ?? 0) !== 0 || (row?.spent ?? 0) !== 0 || balance !== 0)
      hasBudgetData = true;
    budgeted += row?.budgeted ?? 0;
    spent += row?.spent ?? 0;
    if (balance > 0 || (balance < 0 && row?.carryover)) carryoverToNextMonth += balance;
    else if (balance < 0) overspendingThisMonth += balance;
  }
  return { budgeted, spent, carryoverToNextMonth, overspendingThisMonth, hasBudgetData };
};

/** What seeds next month: what carries over, or the balance untouched after an empty month. */
export const getNextRunningBalance = (month: {
  readonly hasBudgetData: boolean;
  readonly carryoverToNextMonth: number;
  readonly runningBalance: number;
}): number => (month.hasBudgetData ? month.carryoverToNextMonth : month.runningBalance);

export interface BudgetAnalysisInput {
  readonly start?: string;
  readonly end?: string;
  readonly mode?: TimeFrameMode;
  readonly showHiddenCategories?: boolean;
  readonly conditions?: ReadonlyArray<Condition>;
  readonly conditionsOp?: ConditionsOp;
}

/** The categories the category and category group conditions keep, as Actual's report does. */
const categoriesOf = (
  base: ReadonlyArray<CategoryRow>,
  conditions: ReadonlyArray<Condition>,
  op: ConditionsOp,
): Array<CategoryRow> => {
  const relevant = conditions.filter(
    (condition) => condition.field === "category" || condition.field === "category_group",
  );
  if (relevant.length === 0) return [...base];
  const sets = relevant.map((condition) => {
    // A condition that cannot be checked on the categories matches none, as in Actual.
    const kept = filterCategoriesByConditions(base, [condition], "and");
    return new Set(
      (isSupportedCategoryCondition(condition) ? kept : []).map((category) => category.id),
    );
  });
  return base.filter((category) =>
    op === "or"
      ? sets.some((set) => set.has(category.id))
      : sets.every((set) => set.has(category.id)),
  );
};

export const budgetAnalysisReport = (
  book: Book,
  input: BudgetAnalysisInput,
): BudgetAnalysisReport => {
  const { latest } = transactionBounds(book);
  const range = resolveTimeFrame(
    input.start,
    input.end,
    input.mode ?? "static",
    latest === null ? null : intToDay(latest),
  );
  const start = monthOf(range.start);
  const end = monthOf(range.end);
  const categories = categoriesOf(
    categoryRows(book).filter((row) => isBaseCategory(row, input.showHiddenCategories ?? false)),
    input.conditions ?? [],
    input.conditionsOp ?? "and",
  );
  const computed = computeMonths(book, end);
  const rowsOf = (month: string) => computed.months.get(month)?.categories ?? [];

  let runningBalance = summarizeMonthCategories(
    rowsOf(prevMonth(start)),
    categories,
  ).carryoverToNextMonth;
  let totalBudgeted = 0;
  let totalSpent = 0;
  let totalOverspendingAdjustment = 0;
  let overspendingFromPrevMonth = 0;
  const intervals = monthRange(start, end).map((month) => {
    const totals = summarizeMonthCategories(rowsOf(month), categories);
    const overspendingAdjustment = Math.abs(overspendingFromPrevMonth);
    const balance = totals.budgeted + totals.spent + runningBalance;
    totalBudgeted += totals.budgeted;
    totalSpent += totals.spent;
    totalOverspendingAdjustment += overspendingAdjustment;
    runningBalance = getNextRunningBalance({ ...totals, runningBalance });
    overspendingFromPrevMonth = totals.overspendingThisMonth;
    return {
      date: month,
      budgeted: totals.budgeted,
      spent: totals.spent,
      balance,
      overspendingAdjustment,
    };
  });
  return {
    start: firstDay(start),
    end: lastDay(end),
    intervals,
    totalBudgeted,
    totalSpent,
    totalOverspendingAdjustment,
    finalOverspendingAdjustment: overspendingFromPrevMonth,
    endingBalance: intervals.at(-1)?.balance ?? 0,
  };
};

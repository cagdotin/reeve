/** Actual's crossover (financial independence) report. */
import type { CrossoverReport, TimeFrameMode } from "./types.ts";
import {
  addMonths,
  dayToInt,
  firstDay,
  intToDay,
  lastDay,
  monthRange,
} from "@reeve/contract/rules";
import { differenceInMonths } from "date-fns";
import type { Book } from "../book.ts";
import { categoryRows } from "./context.ts";
import { resolveTimeFrame } from "./dates.ts";
import { queryLines, sqlOf, transactionBounds } from "./lines.ts";

export interface CrossoverInput {
  readonly start?: string;
  readonly end?: string;
  readonly mode?: TimeFrameMode;
  readonly expenseCategories?: ReadonlyArray<string>;
  readonly accounts?: ReadonlyArray<string>;
  readonly safeWithdrawalRate?: number;
  readonly estimatedReturn?: number | null;
  readonly expectedContribution?: number | null;
  readonly projectionType?: "hampel" | "median" | "mean";
  readonly expenseAdjustmentFactor?: number;
}

const median = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
};

const mean = (values: ReadonlyArray<number>): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

/** The median of the values left after dropping outliers by the Hampel identifier. */
export const hampelMedian = (values: ReadonlyArray<number>): number => {
  if (values.length <= 1) return values[0] ?? 0;
  const center = median(values);
  const mad = median(values.map((value) => Math.abs(value - center)));
  const spread = 1.4826 * mad * 3;
  return median(values.filter((value) => value >= center - spread && value <= center + spread));
};

export const crossoverReport = (book: Book, input: CrossoverInput): CrossoverReport => {
  const { latest } = transactionBounds(book);
  const { start, end } = resolveTimeFrame(
    input.start,
    input.end,
    input.mode ?? "static",
    latest === null ? null : intToDay(latest),
  );
  const swr = input.safeWithdrawalRate ?? 0.04;
  const accounts =
    input.accounts ??
    (
      book.client
        .prepare("SELECT id FROM accounts WHERE type IN ('asset', 'liability')")
        .all() as Array<{ id: string }>
    ).map((row) => row.id);
  const categories =
    input.expenseCategories ??
    categoryRows(book)
      .filter((category) => category.is_income === 0)
      .map((category) => category.id);
  const empty: CrossoverReport = {
    start,
    end,
    points: [],
    crossoverMonth: null,
    lastKnownBalance: 0,
    lastKnownMonthlyIncome: 0,
    lastKnownMonthlyExpenses: 0,
    historicalReturn: null,
    yearsToRetire: null,
    targetMonthlyIncome: null,
    targetNestEgg: null,
  };
  if (accounts.length === 0) return empty;

  const months = monthRange(start, end);
  const expenses = new Map<string, number>();
  if (categories.length > 0)
    for (const row of queryLines<{ month: number; amount: number }>(
      book,
      "l.date / 100 AS month, sum(l.amount) AS amount",
      sqlOf(
        `l.category_id IN (${categories.map(() => "?").join(", ")}) AND l.date >= ? AND l.date <= ?`,
        ...categories,
        dayToInt(firstDay(start)),
        dayToInt(lastDay(end)),
      ),
      "GROUP BY 1",
    ))
      expenses.set(`${String(row.month).slice(0, 4)}-${String(row.month).slice(4)}`, -row.amount);

  const placeholders = accounts.map(() => "?").join(", ");
  const starting = (
    book.client
      .prepare(
        `SELECT coalesce(sum(p.amount), 0) AS amount FROM postings p
           JOIN transactions t ON t.id = p.transaction_id
           WHERE p.account_id IN (${placeholders}) AND t.date <= ?`,
      )
      .get(...accounts, dayToInt(lastDay(start))) as { amount: number }
  ).amount;
  const deltas = new Map(
    (
      book.client
        .prepare(
          `SELECT t.date / 100 AS month, sum(p.amount) AS amount FROM postings p
           JOIN transactions t ON t.id = p.transaction_id
           WHERE p.account_id IN (${placeholders}) AND t.date > ? AND t.date <= ?
           GROUP BY 1`,
        )
        .all(...accounts, dayToInt(lastDay(start)), dayToInt(lastDay(end))) as Array<{
        month: number;
        amount: number;
      }>
    ).map((row) => [`${String(row.month).slice(0, 4)}-${String(row.month).slice(4)}`, row.amount]),
  );
  let running = starting;
  const balances = months.map((month) => (running += deltas.get(month) ?? 0));

  const monthlySwr = swr / 12;
  const points: Array<CrossoverReport["points"][number]> = months.map((month, i) => ({
    month,
    investmentIncome: Math.round(balances[i]! * monthlySwr),
    expenses: expenses.get(month) ?? 0,
    nestEgg: balances[i]!,
    isProjection: false,
  }));
  const lastBalance = balances.at(-1) ?? 0;
  const lastExpense = expenses.get(months.at(-1) ?? "") ?? 0;

  let historicalMonthly: number | null = null;
  if (balances.length >= 2) {
    let first = balances[0]!;
    const final = balances.at(-1)!;
    if (first === 0) first = balances.find((balance) => balance !== 0) ?? 0;
    const cagr = Math.pow(final / first, 1 / (balances.length - 1)) - 1;
    historicalMonthly = first > 0 && final > 0 ? (Number.isFinite(cagr) ? cagr : 0) : 0;
  }
  const monthlyReturn =
    input.estimatedReturn !== undefined && input.estimatedReturn !== null
      ? Math.pow(1 + input.estimatedReturn, 1 / 12) - 1
      : historicalMonthly;
  const contribution = input.expectedContribution ?? 0;
  const factor = input.expenseAdjustmentFactor ?? 1;
  const history = months.map((month) => expenses.get(month) ?? 0);
  const flatExpense =
    input.projectionType === "median"
      ? median(history)
      : input.projectionType === "mean"
        ? mean(history)
        : hampelMedian(history);

  let crossover: number | null = null;
  if (months.length > 0) {
    let projected = lastBalance;
    let cursor = months.at(-1)!;
    for (let i = 1; i <= 600; i++) {
      cursor = addMonths(cursor, 1);
      projected += contribution;
      if (monthlyReturn !== null) projected *= 1 + monthlyReturn;
      const income = projected * monthlySwr;
      const expense = Math.max(0, flatExpense);
      const adjusted = expense * factor;
      points.push({
        month: cursor,
        investmentIncome: Math.round(income),
        expenses: Math.round(expense),
        nestEgg: Math.round(projected),
        adjustedExpenses: Math.round(adjusted),
        isProjection: true,
      });
      if (Math.round(income) >= Math.round(adjusted)) {
        crossover = points.length - 1;
        break;
      }
    }
  }

  const point = crossover === null ? undefined : points[crossover];
  const targetMonthlyIncome = point?.adjustedExpenses ?? null;
  const monthsToGo =
    point === undefined
      ? null
      : differenceInMonths(new Date(`${point.month}-01T00:00:00`), new Date());
  return {
    start,
    end,
    points,
    crossoverMonth: point?.month ?? null,
    lastKnownBalance: lastBalance,
    lastKnownMonthlyIncome: Math.round(lastBalance * monthlySwr),
    lastKnownMonthlyExpenses: lastExpense,
    historicalReturn: historicalMonthly === null ? null : Math.pow(1 + historicalMonthly, 12) - 1,
    yearsToRetire: monthsToGo === null ? null : monthsToGo > 0 ? monthsToGo / 12 : 0,
    targetMonthlyIncome,
    targetNestEgg:
      targetMonthlyIncome === null ? null : Math.round(targetMonthlyIncome / monthlySwr),
  };
};

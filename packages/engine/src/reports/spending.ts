import type { FigureRecords, SpendingReport } from "./types.ts";
import {
  addMonths,
  currentMonth,
  daysInMonth,
  dayToInt,
  firstDay,
  intToDay,
  lastDay,
  monthOf,
  monthRange,
  monthToInt,
  today,
} from "@reeve/contract/rules";
import type { AccountScope } from "@reeve/contract/catalog";
import type { Book } from "../book.ts";
import { listRegister } from "../ledger/register.ts";
import { budgetedRows, categoryRows, filterCategoriesByConditions } from "./context.ts";
import { dayRange } from "./dates.ts";
import {
  allOf,
  queryLines,
  sqlOf,
  transactionBounds,
  reportFilters,
  type Condition,
  type ConditionsOp,
  type Where,
} from "./lines.ts";

export type AverageRange =
  | "last-3-months"
  | "last-6-months"
  | "last-12-months"
  | "year-to-date"
  | "all-time";

export interface SpendingInput {
  readonly compare?: string;
  readonly compareTo?: string;
  readonly averageRange?: AverageRange;
  readonly conditions?: ReadonlyArray<Condition>;
  readonly conditionsOp?: ConditionsOp;
  readonly scope?: AccountScope;
}

/** The months the average covers, as Actual's `resolveSpendingAverageRange`. */
export const resolveAverageRange = (
  range: AverageRange | undefined,
  compare: string,
  earliestMonth: string | null,
): SpendingReport["averageRange"] => {
  const endMonth = addMonths(compare, -1);
  const startMonth =
    range === "last-6-months"
      ? addMonths(compare, -6)
      : range === "last-12-months"
        ? addMonths(compare, -12)
        : range === "year-to-date"
          ? `${compare.slice(0, 4)}-01`
          : range === "all-time"
            ? earliestMonth
            : addMonths(compare, -3);
  if (startMonth === null || startMonth > endMonth)
    return { startMonth: null, endMonth: null, months: [] };
  return { startMonth, endMonth, months: monthRange(startMonth, endMonth) };
};

type SpendingFilters = Pick<SpendingInput, "conditions" | "conditionsOp" | "scope">;

const spendingLines = (book: Book, input: SpendingFilters): Where =>
  allOf(reportFilters(book, input), sqlOf("l.on_budget = 1 AND l.category_income = 0"));

/** The register rows behind a category's figure in a month: the lines `categorySpending` sums. */
export const spendingTransactions = (
  book: Book,
  input: SpendingFilters & {
    readonly category: string;
    readonly month: string;
  },
): FigureRecords => {
  const counted = queryLines<{ tid: string; account_id: string; amount: number }>(
    book,
    "l.tid, l.account_id, sum(l.amount) AS amount",
    allOf(
      spendingLines(book, input),
      sqlOf("l.category_id = ? AND l.date / 100 = ?", input.category, monthToInt(input.month)),
    ),
    "GROUP BY 1, 2",
  );
  const amounts = new Map(counted.map((line) => [`${line.tid}:${line.account_id}`, line.amount]));
  const register = listRegister(book, {
    ids: [...new Set(counted.map((line) => line.tid))],
    limit: Number.MAX_SAFE_INTEGER,
  });
  const seen = new Set<string>();
  const rows = register.rows.flatMap((row) => {
    const key = `${row.transactionId}:${row.accountId}`;
    const amount = amounts.get(key);
    if (amount === undefined || seen.has(key)) return [];
    seen.add(key);
    return [{ counted: amount, row }];
  });
  return { total: rows.reduce((sum, each) => sum + each.counted, 0), rows };
};

const DAYS = Array.from({ length: 28 }, (_, i) => String(i + 1).padStart(2, "0"));

/**
 * Actual's spending spreadsheet: the budget accounts' lines outside income categories, cumulated
 * per day of month for the compare month, the compare-to month and the months averaged.
 */
export const spendingReport = (book: Book, input: SpendingInput): SpendingReport => {
  const compare = input.compare ?? currentMonth();
  const compareTo = input.compareTo ?? addMonths(compare, -1);
  const endDate = lastDay(compare);
  const startDateTo = firstDay(compareTo);
  const endDateTo = lastDay(compareTo);
  const { earliest } = transactionBounds(book);
  const averageRange = resolveAverageRange(
    input.averageRange,
    compare,
    earliest === null ? null : monthOf(intToDay(earliest)),
  );
  const averageMonths = new Set(averageRange.months);
  const startDate = firstDay(averageRange.startMonth ?? compare);
  const separate = endDateTo < startDate || startDateTo > endDate;

  const spending = spendingLines(book, input);
  const inRange = (from: string, to: string): Where =>
    sqlOf("l.date >= ? AND l.date <= ?", dayToInt(from), dayToInt(to));
  const byDay = (where: Where) =>
    queryLines<{ date: number; assets: number; debts: number }>(
      book,
      `l.date, sum(CASE WHEN l.amount > 0 THEN l.amount ELSE 0 END) AS assets,
       sum(CASE WHEN l.amount < 0 THEN l.amount ELSE 0 END) AS debts`,
      where,
      "GROUP BY l.date",
    );
  const totalsByDate = new Map<string, { assets: number; debts: number }>();
  for (const row of [
    ...byDay(allOf(spending, inRange(startDate, endDate))),
    ...(separate ? byDay(allOf(spending, inRange(startDateTo, endDateTo))) : []),
  ])
    totalsByDate.set(intToDay(row.date), { assets: row.assets, debts: row.debts });

  const categories = categoryRows(book).filter((category) => category.is_income === 0);
  const budgetCategories = new Set(
    filterCategoriesByConditions(categories, input.conditions, input.conditionsOp).map(
      (category) => category.id,
    ),
  );
  const budgeted = budgetedRows(book, monthToInt(compare), monthToInt(compare)).filter((row) =>
    budgetCategories.has(row.category_id),
  );
  const dailyBudget = budgeted.reduce((sum, row) => sum + row.amount, 0) / daysInMonth(compare);

  const intervals = dayRange(startDate, endDate);
  if (separate) intervals.push(...dayRange(startDateTo, endDateTo));
  const months = monthRange(monthOf(startDate), compare).map((month) => ({
    month,
    assets: 0,
    debts: 0,
  }));
  if (separate) months.unshift({ month: compareTo, assets: 0, debts: 0 });
  const byMonthDay = Map.groupBy(
    intervals,
    (day) => `${monthOf(day)}:${Number(day.slice(8)) >= 28 ? "28" : day.slice(8)}`,
  );

  const now = today();
  let totalAssets = 0;
  let totalDebts = 0;
  let totalBudget = 0;
  const days = DAYS.map((day) => {
    let averageSum = 0;
    let monthCount = 0;
    const monthData: Record<string, { date: string; cumulative: number | null; daily: number }> =
      {};
    for (const month of months) {
      const data = (byMonthDay.get(`${month.month}:${day}`) ?? []).map((date) => {
        const totals = totalsByDate.get(date) ?? { assets: 0, debts: 0 };
        totalAssets += totals.assets;
        totalDebts += totals.debts;
        if (month.month === compare) totalBudget -= dailyBudget;
        month.assets += totals.assets;
        month.debts += totals.debts;
        const cumulative = month.assets + month.debts;
        if (averageMonths.has(month.month) && (day !== "28" || date === lastDay(month.month))) {
          averageSum += cumulative;
          monthCount += 1;
        }
        return {
          date,
          total: totals.assets + totals.debts,
          cumulative: date <= now ? cumulative : null,
        };
      });
      const last = data.reduce((a, b) => (b.cumulative === null ? a : b));
      monthData[month.month] = {
        date: data[0]!.date,
        cumulative: last.cumulative,
        daily: data.reduce((sum, each) => sum + each.total, 0),
      };
    }
    return {
      day,
      months: monthData,
      average: monthCount === 0 ? 0 : Math.round(averageSum / monthCount),
      compare: monthData[compare]?.cumulative ?? null,
      compareTo: monthData[compareTo]?.cumulative ?? null,
      budget: Math.round(totalBudget),
    };
  });

  return {
    compare,
    compareTo,
    start: startDate,
    end: endDate,
    averageRange,
    days,
    categories: categorySpending(book, {
      categories,
      filters: spending,
      compare,
      compareTo,
      averageMonths: averageRange.months,
      budgeted,
    }),
    totalAssets,
    totalDebts,
    totalTotals: totalAssets + totalDebts,
  };
};

/** Each expense category's spending in the compared months and on average. */
const categorySpending = (
  book: Book,
  options: {
    readonly categories: ReturnType<typeof categoryRows>;
    readonly filters: Where;
    readonly compare: string;
    readonly compareTo: string;
    readonly averageMonths: ReadonlyArray<string>;
    readonly budgeted: ReadonlyArray<{ category_id: string; amount: number }>;
  },
): SpendingReport["categories"] => {
  const { categories, compare, compareTo, averageMonths } = options;
  const months = [compare, compareTo, ...averageMonths];
  const rows = queryLines<{ category_id: string; month: number; amount: number }>(
    book,
    "l.category_id, l.date / 100 AS month, sum(l.amount) AS amount",
    allOf(
      options.filters,
      sqlOf(
        `l.category_id IS NOT NULL AND l.date / 100 IN (${months.map(() => "?").join(", ")})`,
        ...months.map(monthToInt),
      ),
    ),
    "GROUP BY 1, 2",
  );
  const amount = new Map(rows.map((row) => [`${row.category_id}:${row.month}`, row.amount]));
  const of = (id: string, month: string) => amount.get(`${id}:${monthToInt(month)}`) ?? 0;
  return categories.map((category) => ({
    id: category.id,
    name: category.name,
    groupId: category.group_id,
    compare: of(category.id, compare),
    compareTo: of(category.id, compareTo),
    average:
      averageMonths.length === 0
        ? 0
        : Math.round(
            averageMonths.reduce((sum, month) => sum + of(category.id, month), 0) /
              averageMonths.length,
          ),
    budgeted: options.budgeted
      .filter((row) => row.category_id === category.id)
      .reduce((sum, row) => sum + row.amount, 0),
  }));
};

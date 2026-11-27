import type { CalendarReport, TimeFrameMode } from "./types.ts";
import {
  addDays,
  dayToInt,
  firstDay,
  intToDay,
  lastDay,
  monthOf,
  monthRange,
} from "@reeve/contract/rules";
import type { AccountScope } from "@reeve/contract/catalog";
import type { Book } from "../book.ts";
import { firstDayOfWeek } from "./context.ts";
import { resolveTimeFrame, weekOf } from "./dates.ts";
import {
  allOf,
  queryLines,
  sqlOf,
  transactionBounds,
  reportFilters,
  type Condition,
  type ConditionsOp,
} from "./lines.ts";

export interface CalendarInput {
  readonly start?: string;
  readonly end?: string;
  readonly mode?: TimeFrameMode;
  readonly conditions?: ReadonlyArray<Condition>;
  readonly conditionsOp?: ConditionsOp;
  readonly scope?: AccountScope;
}

const share = (value: number, total: number) => {
  const result = total > 0 ? (Math.abs(value) / total) * 100 : 0;
  return Number.isFinite(result) ? result : 0;
};

/** Actual's calendar spreadsheet: each day's income and expenses, laid out in whole weeks. */
export const calendarReport = (book: Book, input: CalendarInput): CalendarReport => {
  const { latest } = transactionBounds(book);
  const range = resolveTimeFrame(
    input.start,
    input.end,
    input.mode ?? "static",
    latest === null ? null : intToDay(latest),
  );
  const start = firstDay(monthOf(range.start));
  const end = lastDay(monthOf(range.end));
  const rows = queryLines<{ date: number; income: number; expense: number }>(
    book,
    `l.date, sum(CASE WHEN l.amount > 0 THEN l.amount ELSE 0 END) AS income,
     sum(CASE WHEN l.amount < 0 THEN l.amount ELSE 0 END) AS expense`,
    allOf(
      sqlOf("l.date >= ? AND l.date <= ?", dayToInt(start), dayToInt(end)),
      reportFilters(book, input),
    ),
    "GROUP BY l.date",
  );
  const byDay = new Map(rows.map((row) => [intToDay(row.date), row]));
  const weekStart = firstDayOfWeek(book);

  return {
    months: monthRange(monthOf(start), monthOf(end)).map((month) => {
      const inMonth = rows.filter((row) => monthOf(intToDay(row.date)) === month);
      const totalIncome = inMonth.reduce((sum, row) => sum + row.income, 0);
      const totalExpense = inMonth.reduce((sum, row) => sum - row.expense, 0);
      const first = firstDay(month);
      const begin = weekOf(first, weekStart);
      const lead = Math.round((Date.parse(first) - Date.parse(begin)) / 86_400_000);
      const count = Math.ceil((lead + Number(lastDay(month).slice(8))) / 7) * 7;
      return {
        month,
        start: first,
        end: lastDay(month),
        totalIncome,
        totalExpense,
        days: Array.from({ length: count }, (_, i) => {
          const date = addDays(begin, i);
          const row = monthOf(date) === month ? byDay.get(date) : undefined;
          return {
            date,
            inMonth: monthOf(date) === month,
            income: row?.income ?? 0,
            expense: -(row?.expense ?? 0),
            incomeSize: share(row?.income ?? 0, totalIncome),
            expenseSize: share(row?.expense ?? 0, totalExpense),
          };
        }),
      };
    }),
  };
};

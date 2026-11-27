import type { SummaryReport, TimeFrameMode } from "./types.ts";
import {
  currentMonth,
  daysBetween,
  daysInMonth,
  dayToInt,
  firstDay,
  intToDay,
  lastDay,
  monthOf,
  monthRange,
  today,
} from "@reeve/contract/rules";
import type { AccountScope } from "@reeve/contract/catalog";
import { invalid, type Book } from "../book.ts";
import { resolveTimeFrame } from "./dates.ts";
import {
  allOf,
  queryLines,
  sqlOf,
  transactionBounds,
  reportFilters,
  scopeWhere,
  whereOf,
  type Condition,
  type ConditionsOp,
} from "./lines.ts";

export type SummaryContent = "sum" | "avgPerMonth" | "avgPerYear" | "avgPerTransact" | "percentage";

export interface SummaryInput {
  readonly start?: string;
  readonly end?: string;
  readonly mode?: TimeFrameMode;
  readonly content?: SummaryContent;
  readonly conditions?: ReadonlyArray<Condition>;
  readonly conditionsOp?: ConditionsOp;
  readonly scope?: AccountScope;
  readonly divisorConditions?: ReadonlyArray<Condition>;
  readonly divisorConditionsOp?: ConditionsOp;
  readonly divisorAllTimeDateRange?: boolean;
}

/** Actual's summary spreadsheet: one number over every matching line in the range. */
export const summaryReport = (book: Book, input: SummaryInput): SummaryReport => {
  const { latest } = transactionBounds(book);
  const range = resolveTimeFrame(
    input.start,
    input.end,
    input.mode ?? "static",
    latest === null ? null : intToDay(latest),
  );
  const start = firstDay(monthOf(range.start));
  const end = monthOf(range.end) === currentMonth() ? today() : lastDay(monthOf(range.end));
  if (start > end) return invalid("Start date must be before or equal to end date.");
  const dates = sqlOf("l.date >= ? AND l.date <= ?", dayToInt(start), dayToInt(end));
  const { amount, count } = queryLines<{ amount: number | null; count: number }>(
    book,
    "sum(l.amount) AS amount, count(*) AS count",
    allOf(dates, reportFilters(book, input)),
  )[0]!;
  const sum = amount ?? 0;
  const result = (total: number, dividend: number, divisor: number): SummaryReport => ({
    start,
    end,
    total,
    dividend,
    divisor,
  });

  switch (input.content ?? "sum") {
    case "sum":
      return result(sum, sum, 0);
    case "avgPerTransact":
      return result(count === 0 ? 0 : sum / count, sum, count);
    case "avgPerMonth": {
      if (count === 0) return result(0, 0, 0);
      const months = monthRange(monthOf(start), monthOf(end)).length;
      const divisor = months - 1 + Number(end.slice(8)) / daysInMonth(monthOf(end));
      return result(sum / divisor, sum, divisor);
    }
    case "avgPerYear": {
      if (count === 0) return result(0, 0, 0);
      const divisor = (daysBetween(start, end) + 1) / 365.25;
      return result(sum / divisor, sum, divisor);
    }
    case "percentage": {
      const divisor =
        queryLines<{ amount: number | null }>(
          book,
          "sum(l.amount) AS amount",
          allOf(
            whereOf(input.divisorConditions, input.divisorConditionsOp),
            scopeWhere(book, input.scope),
            input.divisorAllTimeDateRange === true ? sqlOf("1") : dates,
          ),
        )[0]!.amount ?? 0;
      return result(divisor === 0 ? 0 : Math.round((sum / divisor) * 10000) / 100, sum, divisor);
    }
  }
};

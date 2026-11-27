import type { CashFlowReport, TimeFrameMode } from "./types.ts";
import { daysBetween, dayToInt, firstDay, intToDay, lastDay, today } from "@reeve/contract/rules";
import type { AccountScope } from "@reeve/contract/catalog";
import type { Book } from "../book.ts";
import { dayRange, intervalRange, resolveTimeFrame } from "./dates.ts";
import {
  allOf,
  queryLines,
  sqlOf,
  transactionBounds,
  reportFilters,
  type Condition,
  type ConditionsOp,
} from "./lines.ts";

export interface CashFlowInput {
  readonly start?: string;
  readonly end?: string;
  readonly mode?: TimeFrameMode;
  readonly interval?: "Daily" | "Monthly";
  readonly conditions?: ReadonlyArray<Condition>;
  readonly conditionsOp?: ConditionsOp;
  readonly scope?: AccountScope;
}

/**
 * Actual's cash flow spreadsheet: the budget accounts' lines up to today, split into income
 * (positive), expenses (negative) and transfers (lines whose other side is an account).
 */
export const cashFlowReport = (book: Book, input: CashFlowInput): CashFlowReport => {
  const { latest } = transactionBounds(book);
  const range = resolveTimeFrame(
    input.start,
    input.end,
    input.mode ?? "static",
    latest === null ? null : intToDay(latest),
  );
  const start = firstDay(range.start);
  const end = lastDay(range.end);
  const fixedEnd = end > today() ? today() : end;
  const interval =
    input.interval ??
    (daysBetween(firstDay(range.start), firstDay(range.end)) > 31 * 3 ? "Monthly" : "Daily");
  const filters = reportFilters(book, input);
  const onBudget = sqlOf("l.on_budget = 1");

  const startingBalance =
    queryLines<{ amount: number | null }>(
      book,
      "sum(l.amount) AS amount",
      allOf(filters, onBudget, sqlOf("l.date < ?", dayToInt(start))),
    )[0]?.amount ?? 0;

  const key = interval === "Monthly" ? "l.date / 100" : "l.date";
  const rows = queryLines<{
    key: number;
    transfer: number;
    income: number;
    expense: number;
  }>(
    book,
    `${key} AS key, l.transfer_account IS NOT NULL AS transfer,
     sum(CASE WHEN l.amount > 0 THEN l.amount ELSE 0 END) AS income,
     sum(CASE WHEN l.amount < 0 THEN l.amount ELSE 0 END) AS expense`,
    allOf(
      filters,
      onBudget,
      sqlOf("l.date >= ? AND l.date <= ?", dayToInt(start), dayToInt(fixedEnd)),
    ),
    "GROUP BY 1, 2",
  );
  const flows = new Map<string, { income: number; expense: number; transfers: number }>();
  for (const row of rows) {
    const date =
      interval === "Monthly"
        ? `${String(row.key).slice(0, 4)}-${String(row.key).slice(4)}`
        : intToDay(row.key);
    const flow = flows.get(date) ?? { income: 0, expense: 0, transfers: 0 };
    if (row.transfer === 1) flow.transfers += row.income + row.expense;
    else {
      flow.income += row.income;
      flow.expense += row.expense;
    }
    flows.set(date, flow);
  }

  const dates =
    fixedEnd < start
      ? []
      : interval === "Monthly"
        ? intervalRange(start, fixedEnd, "Monthly", 0)
        : dayRange(start, fixedEnd);
  let balance = startingBalance;
  let totalIncome = 0;
  let totalExpenses = 0;
  let totalTransfers = 0;
  const points = dates.map((date) => {
    const flow = flows.get(date) ?? { income: 0, expense: 0, transfers: 0 };
    totalIncome += flow.income;
    totalExpenses += flow.expense;
    totalTransfers += flow.transfers;
    balance += flow.income + flow.expense + flow.transfers;
    return {
      date,
      income: flow.income,
      expenses: flow.expense,
      transfers: flow.transfers,
      balance,
    };
  });
  return {
    start,
    end: fixedEnd,
    interval,
    startingBalance,
    points,
    totalIncome,
    totalExpenses,
    totalTransfers,
    balance,
    totalChange: points.length === 0 ? 0 : balance - points[0]!.balance,
  };
};

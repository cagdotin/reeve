import type { SpendingReport } from "@reeve/contract/catalog";
import { currentMonth, today } from "@reeve/contract/rules";
import { shortMonth, type SpendingMode } from "./meta";

/** What the compare month is set against: another month, its budget, or the average. */
export const comparisonLabel = (mode: SpendingMode, report: SpendingReport) =>
  mode === "budget" ? "Budgeted" : mode === "average" ? "Average" : shortMonth(report.compareTo);

/** The day of month (1–28) the comparison stops at: today in the current month, else the 28th. */
export const comparisonDay = (report: SpendingReport) =>
  report.compare === currentMonth() ? Math.min(Number(today().slice(8, 10)), 28) : 28;

/** How much more (positive) the compare month spent than its comparison, by the comparison day. */
export const spendingDifference = (report: SpendingReport, mode: SpendingMode) => {
  const row = spendingRows(report, mode)[comparisonDay(report) - 1];
  return row === undefined ? 0 : (row.compare ?? 0) - (row.other ?? 0);
};

/** Spending as positive amounts, per day: the compare month and what it is set against. */
export const spendingRows = (report: SpendingReport, mode: SpendingMode) =>
  report.days.map((day) => ({
    day: day.day,
    compare: day.compare === null ? null : -day.compare,
    other:
      mode === "budget"
        ? -day.budget
        : mode === "average"
          ? -day.average
          : day.compareTo === null
            ? null
            : -day.compareTo,
  }));

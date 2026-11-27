import type { ReportCondition, TimeFrameMode } from "@reeve/contract/catalog";
import { addMonths, currentMonth, monthOf, today } from "@reeve/contract/rules";
import { format, parse } from "date-fns";

export type ConditionsOp = "and" | "or";

/** A widget's time frame as Actual stores it: months or days, and how it moves with time. */
export interface TimeFrame {
  readonly start: string;
  readonly end: string;
  readonly mode: TimeFrameMode;
}

interface Filtered {
  readonly name?: string | undefined;
  readonly conditions?: ReadonlyArray<ReportCondition> | undefined;
  readonly conditionsOp?: ConditionsOp | undefined;
}

export interface NetWorthMeta extends Filtered {
  readonly timeFrame?: TimeFrame | undefined;
  readonly interval?: "Daily" | "Weekly" | "Monthly" | "Yearly" | undefined;
  readonly mode?: "trend" | "stacked" | undefined;
}

export interface CashFlowMeta extends Filtered {
  readonly timeFrame?: TimeFrame | undefined;
  readonly showBalance?: boolean | undefined;
}

export type SpendingMode = "single-month" | "budget" | "average";

export type SpendingAverage =
  | { readonly mode: "last-n-months"; readonly months: 3 | 6 | 12 }
  | { readonly mode: "year-to-date" }
  | { readonly mode: "all-time" };

export interface SpendingMeta extends Filtered {
  readonly compare?: string | undefined;
  readonly compareTo?: string | undefined;
  readonly isLive?: boolean | undefined;
  readonly mode?: SpendingMode | undefined;
  readonly averageRange?: SpendingAverage | undefined;
}

export type SummaryContentType =
  | "sum"
  | "avgPerMonth"
  | "avgPerYear"
  | "avgPerTransact"
  | "percentage";

export interface SummaryContent {
  readonly type: SummaryContentType;
  readonly divisorConditions?: ReadonlyArray<ReportCondition> | undefined;
  readonly divisorConditionsOp?: ConditionsOp | undefined;
  readonly divisorAllTimeDateRange?: boolean | undefined;
}

export interface SummaryMeta extends Filtered {
  readonly timeFrame?: TimeFrame | undefined;
  readonly content?: SummaryContent | undefined;
}

export interface CalendarMeta extends Filtered {
  readonly timeFrame?: TimeFrame | undefined;
}

export interface CrossoverMeta {
  readonly name?: string | undefined;
  readonly expenseCategoryIds?: ReadonlyArray<string> | undefined;
  readonly incomeAccountIds?: ReadonlyArray<string> | undefined;
  readonly timeFrame?: TimeFrame | undefined;
  readonly safeWithdrawalRate?: number | undefined;
  readonly estimatedReturn?: number | null | undefined;
  readonly expectedContribution?: number | null | undefined;
  readonly projectionType?: "hampel" | "median" | "mean" | undefined;
  readonly expenseAdjustmentFactor?: number | undefined;
}

export interface BudgetAnalysisMeta extends Filtered {
  readonly timeFrame?: TimeFrame | undefined;
  readonly interval?: "Daily" | "Weekly" | "Monthly" | "Yearly" | undefined;
  readonly graphType?: "Line" | "Bar" | undefined;
  readonly showBalance?: boolean | undefined;
  readonly balanceOnly?: boolean | undefined;
  readonly showHiddenCategories?: boolean | undefined;
}

export type SankeyLayer =
  | "payee"
  | "income_category"
  | "account"
  | "budget"
  | "category_group"
  | "category";

export interface SankeyMeta extends Filtered {
  readonly timeFrame?: TimeFrame | undefined;
  readonly mode?: "budgeted" | "spent" | undefined;
  readonly topNcategories?: number | undefined;
  readonly categorySort?: "per-group" | "global" | "budget-order" | undefined;
  readonly showPercentages?: boolean | undefined;
  readonly groupAccounts?: boolean | undefined;
  readonly showTransfers?: boolean | undefined;
  readonly layerFrom?: string | undefined;
  readonly layerTo?: string | undefined;
}

export interface AgeOfMoneyMeta extends Filtered {
  readonly timeFrame?: TimeFrame | undefined;
  readonly granularity?: "daily" | "weekly" | "monthly" | undefined;
}

export interface ForecastSeriesMeta {
  readonly id: string;
  readonly name: string;
  readonly accounts?: ReadonlyArray<string> | undefined;
  readonly conditions: ReadonlyArray<ReportCondition>;
  readonly conditionsOp: ConditionsOp;
}

export interface BalanceForecastMeta extends Filtered {
  readonly startDate?: string | undefined;
  readonly endDate?: string | undefined;
  readonly accounts?: ReadonlyArray<string> | undefined;
  readonly timeFrame?: TimeFrame | undefined;
  readonly granularity?: "Daily" | "Monthly" | undefined;
  readonly yAxisBase?: "Zero-Based" | "Auto" | undefined;
  readonly source?: "schedules" | "tracking-budget" | undefined;
  readonly series?: ReadonlyArray<ForecastSeriesMeta> | undefined;
}

export type { MonteCarloMeta } from "@reeve/contract/monte-carlo";

export interface FormulaQueryMeta {
  readonly conditions?: ReadonlyArray<ReportCondition> | undefined;
  readonly conditionsOp?: ConditionsOp | undefined;
  readonly timeFrame?: TimeFrame | undefined;
}

export interface FormulaMeta {
  readonly name?: string | undefined;
  readonly formula?: string | undefined;
  readonly queries?: Readonly<Record<string, FormulaQueryMeta>> | undefined;
}

export interface MarkdownMeta {
  readonly content?: string | undefined;
  readonly text_align?: "left" | "right" | "center";
}

export const summaryContent = (meta: SummaryMeta): SummaryContent =>
  meta.content ?? { type: "sum" };

/** The last six months, moving with time: the default frame of most widgets. */
export const defaultFrame = (months = 6): TimeFrame => ({
  start: addMonths(currentMonth(), -(months - 1)),
  end: currentMonth(),
  mode: "sliding-window",
});

const quarterOf = (month: string) => {
  const m = Number(month.slice(5, 7));
  return `${month.slice(0, 4)}-${String(m - ((m - 1) % 3)).padStart(2, "0")}`;
};

const monthsBetween = (from: string, to: string) =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
  Number(to.slice(5, 7)) -
  Number(from.slice(5, 7));

/** The months a time frame covers today, as the engine resolves it (Actual's calculateTimeRange). */
export const resolveFrame = (frame: TimeFrame): { start: string; end: string } => {
  const now = currentMonth();
  const from = monthOf(frame.start);
  const to = monthOf(frame.end);
  switch (frame.mode) {
    case "full":
      return { start: from, end: now };
    case "sliding-window": {
      const offset = monthsBetween(from, to);
      return { start: addMonths(now, -offset), end: now };
    }
    case "lastMonth":
      return { start: addMonths(now, -1), end: addMonths(now, -1) };
    case "lastYear": {
      const year = Number(now.slice(0, 4)) - 1;
      return { start: `${year}-01`, end: `${year}-12` };
    }
    case "yearToDate":
      return { start: `${now.slice(0, 4)}-01`, end: now };
    case "priorYearToDate": {
      const year = Number(now.slice(0, 4)) - 1;
      return { start: `${year}-01`, end: `${year}-${today().slice(5, 7)}` };
    }
    case "currentQuarter":
      return { start: quarterOf(now), end: addMonths(quarterOf(now), 2) };
    case "previousQuarter": {
      const quarter = addMonths(quarterOf(now), -3);
      return { start: quarter, end: addMonths(quarter, 2) };
    }
    case "static":
      return { start: from, end: to };
  }
};

/** A time frame as the report operations take it: months and the mode. */
export const frameInput = (frame: TimeFrame) => ({
  start: monthOf(frame.start),
  end: monthOf(frame.end),
  mode: frame.mode,
});

export interface FramePreset {
  readonly label: string;
  readonly frame: (earliest: string) => TimeFrame;
}

const live = (months: number): TimeFrame => defaultFrame(months);

/** Actual's quick ranges for a report's dates. */
export const FRAME_PRESETS: ReadonlyArray<FramePreset> = [
  { label: "1 month", frame: () => live(1) },
  { label: "3 months", frame: () => live(3) },
  { label: "6 months", frame: () => live(6) },
  { label: "1 year", frame: () => live(12) },
  { label: "Year to date", frame: () => ({ ...live(1), mode: "yearToDate" }) },
  { label: "Last month", frame: () => ({ ...live(1), mode: "lastMonth" }) },
  { label: "Last year", frame: () => ({ ...live(12), mode: "lastYear" }) },
  { label: "Prior year to date", frame: () => ({ ...live(12), mode: "priorYearToDate" }) },
  { label: "Current quarter", frame: () => ({ ...live(3), mode: "currentQuarter" }) },
  { label: "Previous quarter", frame: () => ({ ...live(3), mode: "previousQuarter" }) },
  {
    label: "All time",
    frame: (earliest) => ({ start: earliest, end: currentMonth(), mode: "full" }),
  },
];

export const MODE_LABELS: Record<TimeFrameMode, string> = {
  "sliding-window": "Live",
  static: "Static",
  full: "All time",
  lastMonth: "Last month",
  lastYear: "Last year",
  yearToDate: "Year to date",
  priorYearToDate: "Prior year to date",
  currentQuarter: "Current quarter",
  previousQuarter: "Previous quarter",
};

export const shortMonth = (month: string) =>
  format(parse(month, "yyyy-MM", new Date()), "MMM yyyy");

export const longMonth = (month: string) =>
  format(parse(month, "yyyy-MM", new Date()), "MMMM yyyy");

/** An interval key (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`, `YYYY-Qn`) as an axis label. */
export const intervalLabel = (key: string) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return format(parse(key, "yyyy-MM-dd", new Date()), "MMM d");
  if (/^\d{4}-\d{2}$/.test(key)) return format(parse(key, "yyyy-MM", new Date()), "MMM yy");
  return key;
};

export const rangeLabel = (start: string, end: string) => {
  const from = shortMonth(monthOf(start));
  const to = shortMonth(monthOf(end));
  return from === to ? from : `${from} – ${to}`;
};

export const formulaText = (result: number | string | boolean | null) =>
  result === null
    ? "—"
    : typeof result === "number"
      ? result.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : String(result);

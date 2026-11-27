import type {
  AccountScope,
  ReportType,
  Widget,
  WidgetType as WidgetTypeSchema,
} from "@reeve/contract/catalog";
import type { ComponentType } from "react";
import type { WidgetBodyProps } from "./card-body";
import type { WidgetTarget } from "./widget-state";
import { AgeOfMoneyBody } from "./age-of-money";
import { BudgetAnalysisBody } from "./budget-analysis";
import {
  BalanceForecastBody,
  CalendarBody,
  CashFlowBody,
  CrossoverBody,
  CustomBody,
  FormulaBody,
  MarkdownBody,
  MonteCarloBody,
  NetWorthBody,
  SpendingBody,
  SummaryBody,
} from "./cards";
import {
  AccountBalancesBody,
  CategoryPaceBody,
  MonthStatusBody,
  UPCOMING_DAYS,
  UpcomingTransactionsBody,
} from "@/components/home/widgets";
import { SankeyBody } from "./sankey";
import { savedReportPlace } from "@/lib/report-library";
import { RecentTransactionsBody } from "./recent-transactions";

type WidgetType = typeof WidgetTypeSchema.Type;

/**
 * What a widget is: a placement of a saved report, a summary of the book, a list of records to
 * work through, or text. Only report widgets have a full report to open.
 */
export type WidgetKind = "report" | "summary" | "work-list" | "text";

interface Size {
  readonly w: number;
  readonly h: number;
}

/** A whole-number setting a placement may change in Widget settings. */
export interface WidgetField {
  readonly key: string;
  readonly label: string;
  readonly default: number;
  readonly min: number;
  readonly max: number;
}

interface WidgetSpec {
  /** The title when neither the placement nor its saved report names it. */
  readonly label: string;
  readonly kind: WidgetKind;
  readonly report?: ReportType;
  /** The smallest size it reads at, as Actual's. */
  readonly min: Size;
  /** How the add menu offers it, and what a new one starts with. */
  readonly add?: {
    readonly label: string;
    readonly settings?: Record<string, unknown>;
    readonly height?: number;
  };
  /** The default font size, for a widget whose placement may set one. */
  readonly fontSize?: number;
  readonly fields?: ReadonlyArray<WidgetField>;
  /** Its live content; a type without one is persisted but not shown yet. */
  readonly Body?: ComponentType<WidgetBodyProps<never>>;
  readonly target?: WidgetTarget;
}

const report = (
  type: ReportType,
  label: string,
  min: Size,
  add?: WidgetSpec["add"],
): Omit<WidgetSpec, "Body"> => ({
  label,
  kind: "report",
  report: type,
  min,
  ...(add === undefined ? {} : { add }),
});

/** Every widget type, in the order the add menu offers them (the reports in Actual's order). */
export const WIDGETS: Readonly<Record<WidgetType, WidgetSpec>> = {
  "cash-flow-card": {
    ...report("cash-flow", "Cash Flow", { w: 2, h: 2 }, { label: "Cash flow graph" }),
    Body: CashFlowBody,
  },
  "net-worth-card": {
    ...report("net-worth", "Net Worth", { w: 3, h: 2 }, { label: "Net worth graph" }),
    Body: NetWorthBody,
  },
  "crossover-card": {
    ...report("crossover", "Crossover Point", { w: 3, h: 2 }, { label: "Crossover point" }),
    Body: CrossoverBody,
  },
  "age-of-money-card": {
    ...report("age-of-money", "Age of Money", { w: 3, h: 2 }, { label: "Age of Money" }),
    Body: AgeOfMoneyBody,
  },
  "spending-card": {
    ...report("spending", "Monthly Spending", { w: 3, h: 2 }, { label: "Spending analysis" }),
    Body: SpendingBody,
  },
  "budget-analysis-card": {
    ...report("budget-analysis", "Budget Analysis", { w: 3, h: 2 }, { label: "Budget analysis" }),
    Body: BudgetAnalysisBody,
  },
  "balance-forecast-card": {
    ...report(
      "balance-forecast",
      "Balance Forecast",
      { w: 3, h: 2 },
      { label: "Balance forecast" },
    ),
    Body: BalanceForecastBody,
  },
  "monte-carlo-card": {
    ...report(
      "monte-carlo",
      "Monte Carlo Analysis",
      { w: 3, h: 2 },
      {
        label: "Monte Carlo analysis",
      },
    ),
    Body: MonteCarloBody,
  },
  "markdown-card": {
    label: "Text",
    kind: "text",
    min: { w: 2, h: 1 },
    add: {
      label: "Text widget",
      settings: {
        content: "### Text Widget\n\nEdit this widget to change the **markdown** content.",
      },
    },
    Body: MarkdownBody,
  },
  "summary-card": {
    ...report("summary", "Summary", { w: 2, h: 2 }, { label: "Summary card" }),
    fontSize: 20,
    Body: SummaryBody,
  },
  "calendar-card": {
    ...report("calendar", "Calendar", { w: 3, h: 2 }, { label: "Calendar card" }),
    Body: CalendarBody,
  },
  "formula-card": {
    ...report(
      "formula",
      "Formula",
      { w: 1, h: 1 },
      {
        label: "Formula card",
        settings: { formula: "=1+1" },
      },
    ),
    fontSize: 28,
    Body: FormulaBody,
  },
  "sankey-card": {
    ...report("sankey", "Sankey", { w: 3, h: 3 }, { label: "Sankey card", height: 3 }),
    Body: SankeyBody,
  },
  "custom-report": {
    ...report("custom", "Custom report", { w: 2, h: 1 }),
    Body: CustomBody,
  },
  "home-insight": {
    label: "This month",
    kind: "summary",
    min: { w: 3, h: 3 },
    add: { label: "This month", height: 3 },
    Body: MonthStatusBody,
    target: { to: "/budget", label: "Open budget" },
  },
  "category-pace": {
    label: "Categories",
    kind: "summary",
    min: { w: 3, h: 2 },
    add: { label: "Category pace", height: 3 },
    Body: CategoryPaceBody,
    target: { to: "/budget", label: "Open budget" },
  },
  "account-balances": {
    label: "Accounts",
    kind: "summary",
    min: { w: 3, h: 2 },
    add: { label: "Account balances", height: 3 },
    Body: AccountBalancesBody,
    target: { to: "/accounts/$account", params: { account: "all" }, label: "All transactions" },
  },
  "upcoming-transactions": {
    label: "Coming up",
    kind: "work-list",
    min: { w: 3, h: 2 },
    add: { label: "Coming up", height: 3 },
    fields: [{ key: "daysAhead", label: "Days ahead", default: UPCOMING_DAYS, min: 1, max: 366 }],
    Body: UpcomingTransactionsBody,
    target: { to: "/schedules", label: "All schedules" },
  },
  "recent-transactions": {
    label: "Latest transactions",
    kind: "work-list",
    min: { w: 3, h: 2 },
    add: { label: "Latest transactions", height: 3 },
    Body: RecentTransactionsBody,
    target: { to: "/accounts/$account", params: { account: "all" }, label: "All transactions" },
  },
};

/** The spec of a stored widget, or none for a type this version does not know. */
export const specOf = (type: string): WidgetSpec | undefined =>
  Object.hasOwn(WIDGETS, type) ? WIDGETS[type as WidgetType] : undefined;

/** A widget's title: its placement's, else its saved report's name, else its type's. */
export const widgetName = (widget: Widget, reportName?: string) =>
  widget.config?.title ||
  reportName ||
  specOf(widget.type)?.label ||
  widget.type.replace(/-card$/, "").replace(/-/g, " ");

/** Where a widget leads: a report widget to its full report, another to its records, if any. */
export const widgetTarget = (
  widget: Widget,
  name: string,
  scope?: AccountScope,
): WidgetTarget | null => {
  const spec = specOf(widget.type);
  if (spec === undefined || widget.availability !== "available") return null;
  if (spec.report === undefined || widget.reportId === null) return spec.target ?? null;
  const place = savedReportPlace(spec.report, widget.reportId);
  return {
    ...place,
    search: scope === undefined ? place.search : { ...place.search, scope },
    label: `Open ${name}`,
  };
};

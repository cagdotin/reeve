/** Reports, the dashboard, custom reports and tags. */
import { Schema } from "effect";
import { monteCarloPlanFields } from "./monte-carlo-plan.ts";
import { Amount, Day, FigureRecords, Id, Month } from "../domain.ts";
import { BookField, IdField, cli, inBook, type Operation } from "../operation.ts";
import { RuleField, RuleOp } from "./rules.ts";

// ---------------------------------------------------------------------------------------------
// Filters and time frames
// ---------------------------------------------------------------------------------------------

/** A filter condition, shaped as a rule's; reports can also filter on the category group. */
export const ReportCondition = Schema.Struct({
  field: Schema.Union([RuleField, Schema.Literal("category_group")]),
  op: RuleOp,
  value: Schema.optionalKey(Schema.Unknown),
});
export type ReportCondition = typeof ReportCondition.Type;

export const ConditionsOp = Schema.Literals(["and", "or"]);

export const filterFields = {
  conditions: Schema.optionalKey(Schema.Array(ReportCondition)).annotate({
    description:
      "Filters on the transactions, as rule conditions: field (account, category, category_group, payee, notes, date, amount, amount_inflow, amount_outflow, cleared, reconciled, transfer, imported_payee), op and value",
  }),
  conditionsOp: Schema.optionalKey(ConditionsOp).annotate({
    description: "Whether every condition (and, the default) or any (or) must match",
  }),
};

/** Which accounts a report covers; `selected` names asset and liability accounts. */
export const AccountScope = Schema.Union([
  Schema.Struct({ mode: Schema.Literal("all") }),
  Schema.Struct({ mode: Schema.Literal("budgeted") }),
  Schema.Struct({ mode: Schema.Literal("offbudget") }),
  Schema.Struct({
    mode: Schema.Literal("selected"),
    ids: Schema.Array(Id).pipe(Schema.check(Schema.isMinLength(1))),
  }),
]);
export type AccountScope = typeof AccountScope.Type;

export const scopeField = {
  scope: Schema.optionalKey(AccountScope).annotate({
    description:
      "Only the lines of these accounts: all (the default), budgeted, offbudget or selected ids. It narrows the conditions, an or group included, and never widens them",
  }),
};

/** A month (`YYYY-MM`) or a day (`YYYY-MM-DD`). */
export const MonthOrDay = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/, {
      message: "Use a month such as 2026-11 or a day such as 2026-11-05",
    }),
  ),
);

export const TimeFrameMode = Schema.Literals([
  "sliding-window",
  "static",
  "full",
  "lastMonth",
  "lastYear",
  "yearToDate",
  "priorYearToDate",
  "currentQuarter",
  "previousQuarter",
]);
export type TimeFrameMode = typeof TimeFrameMode.Type;

const timeFrameFields = {
  start: Schema.optionalKey(Month).annotate({
    description: "First month; five months ago by default",
  }),
  end: Schema.optionalKey(Month).annotate({ description: "Last month; this month by default" }),
  mode: Schema.optionalKey(TimeFrameMode).annotate({
    description:
      "How the range moves with time, as a dashboard widget's: static (as given, the default here), sliding-window (same length, ending this month), full (from start to now), yearToDate, lastYear, priorYearToDate, lastMonth, currentQuarter, previousQuarter",
  }),
};

export const TimeFrame = Schema.Struct({
  start: Schema.optionalKey(MonthOrDay),
  end: Schema.optionalKey(MonthOrDay),
  mode: Schema.optionalKey(TimeFrameMode),
});

const AccountIds = Schema.optionalKey(Schema.Array(Id)).annotate({
  description: "Account ids; every account by default",
});

// ---------------------------------------------------------------------------------------------
// Report results
// ---------------------------------------------------------------------------------------------

const NamedId = Schema.Struct({ id: Id, name: Schema.String });

export const NetWorthReport = Schema.Struct({
  start: Day,
  end: Day,
  interval: Schema.Literals(["Daily", "Weekly", "Monthly", "Yearly"]),
  points: Schema.Array(
    Schema.Struct({
      /** The interval: a day, a week's first day, a month or a year. */
      date: Schema.String,
      /** The sum of the accounts with a positive balance. */
      assets: Amount,
      /** The sum of the negative balances, as a positive number. */
      debt: Amount,
      netWorth: Amount,
      change: Amount,
      /** Each account's balance at the end of the interval. */
      balances: Schema.Record(Schema.String, Amount),
    }),
  ),
  netWorth: Amount,
  totalChange: Amount,
  lowest: Schema.NullOr(Amount),
  highest: Schema.NullOr(Amount),
  /** The accounts with a balance in the range. */
  accounts: Schema.Array(NamedId),
});
export type NetWorthReport = typeof NetWorthReport.Type;

export const CashFlowReport = Schema.Struct({
  start: Day,
  end: Day,
  interval: Schema.Literals(["Daily", "Monthly"]),
  /** The balance of the budget accounts before the range. */
  startingBalance: Amount,
  points: Schema.Array(
    Schema.Struct({
      date: Schema.String,
      income: Amount,
      expenses: Amount,
      transfers: Amount,
      balance: Amount,
    }),
  ),
  totalIncome: Amount,
  totalExpenses: Amount,
  totalTransfers: Amount,
  balance: Amount,
  totalChange: Amount,
});
export type CashFlowReport = typeof CashFlowReport.Type;

const SpendingMonth = Schema.Struct({
  date: Day,
  cumulative: Schema.NullOr(Amount),
  daily: Amount,
});

export const AverageRange = Schema.Literals([
  "last-3-months",
  "last-6-months",
  "last-12-months",
  "year-to-date",
  "all-time",
]);

export const SpendingReport = Schema.Struct({
  compare: Month,
  compareTo: Month,
  start: Day,
  end: Day,
  averageRange: Schema.Struct({
    startMonth: Schema.NullOr(Month),
    endMonth: Schema.NullOr(Month),
    months: Schema.Array(Month),
  }),
  /** Days 01 to 28 of each month; day 28 takes the days after it. */
  days: Schema.Array(
    Schema.Struct({
      day: Schema.String,
      months: Schema.Record(Schema.String, SpendingMonth),
      average: Amount,
      compare: Schema.NullOr(Amount),
      compareTo: Schema.NullOr(Amount),
      /** What the month's budget allows spending by this day, negative. */
      budget: Amount,
    }),
  ),
  /** Spending per expense category: the compare month, the compare-to month and the average. */
  categories: Schema.Array(
    Schema.Struct({
      id: Id,
      name: Schema.String,
      groupId: Id,
      compare: Amount,
      compareTo: Amount,
      average: Amount,
      budgeted: Amount,
    }),
  ),
  totalAssets: Amount,
  totalDebts: Amount,
  totalTotals: Amount,
});
export type SpendingReport = typeof SpendingReport.Type;

export const SummaryContent = Schema.Literals([
  "sum",
  "avgPerMonth",
  "avgPerYear",
  "avgPerTransact",
  "percentage",
]);

export const SummaryReport = Schema.Struct({
  start: Day,
  end: Day,
  total: Schema.Number,
  dividend: Schema.Number,
  divisor: Schema.Number,
});
export type SummaryReport = typeof SummaryReport.Type;

export const CalendarReport = Schema.Struct({
  months: Schema.Array(
    Schema.Struct({
      month: Month,
      start: Day,
      end: Day,
      totalIncome: Amount,
      totalExpense: Amount,
      /** Whole weeks around the month; days of other months are empty. */
      days: Schema.Array(
        Schema.Struct({
          date: Day,
          inMonth: Schema.Boolean,
          income: Amount,
          expense: Amount,
          /** The day's share of the month's income or expense, in percent. */
          incomeSize: Schema.Number,
          expenseSize: Schema.Number,
        }),
      ),
    }),
  ),
});
export type CalendarReport = typeof CalendarReport.Type;

export const GroupBy = Schema.Literals([
  "Category",
  "Group",
  "CategoryGroup",
  "Payee",
  "Account",
  "Tag",
  "Interval",
]);
export const ReportInterval = Schema.Literals([
  "Daily",
  "Weekly",
  "Monthly",
  "Quarterly",
  "Yearly",
]);
export const BalanceType = Schema.Literals([
  "Payment",
  "Deposit",
  "Net",
  "Net Payment",
  "Net Deposit",
  "Budgeted",
]);
export const SortBy = Schema.Literals(["asc", "desc", "name", "budget"]);
export const DateRange = Schema.Literals([
  "This week",
  "Last week",
  "This month",
  "Last month",
  "Current quarter",
  "Previous quarter",
  "Last 30 days",
  "Last 3 months",
  "Last 6 months",
  "Last 12 months",
  "Year to date",
  "Last year",
  "Prior year to date",
  "All time",
]);
export const TagScope = Schema.Union([
  Schema.Struct({ mode: Schema.Literal("all") }),
  Schema.Struct({ mode: Schema.Literal("selected"), tagIds: Schema.Array(Id) }),
]);

const totals = {
  totalAssets: Amount,
  totalDebts: Amount,
  netAssets: Amount,
  netDebts: Amount,
  totalTotals: Amount,
};

const IntervalTotals = Schema.Struct({
  date: Schema.String,
  ...totals,
  change: Amount,
  intervalStartDate: Day,
  intervalEndDate: Day,
});

const ReportGroupFields = {
  id: Schema.String,
  name: Schema.String,
  /** For the buckets of lines without a category: other (uncategorized), transfer, off_budget, all. */
  uncategorizedId: Schema.NullOr(Schema.String),
  /** The tags of a tag bucket. */
  tagNames: Schema.optionalKey(Schema.Array(Schema.String)),
  ...totals,
  intervals: Schema.Array(IntervalTotals),
};
export const ReportGroup = Schema.Struct({
  ...ReportGroupFields,
  categories: Schema.optionalKey(Schema.Array(Schema.Struct(ReportGroupFields))),
});

export const CustomReportResult = Schema.Struct({
  start: Day,
  end: Day,
  groups: Schema.Array(ReportGroup),
  /** Every group summed per interval, with each group's amount for the balance type. */
  intervals: Schema.Array(
    Schema.Struct({
      date: Schema.String,
      ...totals,
      intervalStartDate: Day,
      intervalEndDate: Day,
      stacked: Schema.Record(Schema.String, Amount),
    }),
  ),
  /** Category groups with their categories, as the table shows grouped rows. */
  groupedData: Schema.Array(ReportGroup),
  ...totals,
});
export type CustomReportResult = typeof CustomReportResult.Type;

const customReportFields = {
  startDate: Schema.optionalKey(Day).annotate({ description: "First day of a static range" }),
  endDate: Schema.optionalKey(Day).annotate({ description: "Last day of a static range" }),
  isDateStatic: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Use startDate and endDate as given; otherwise dateRange moves with time",
  }),
  dateRange: Schema.optionalKey(DateRange).annotate({ description: "Last 6 months by default" }),
  includeCurrentInterval: Schema.optionalKey(Schema.Boolean),
  mode: Schema.optionalKey(Schema.Literals(["total", "time"])),
  groupBy: Schema.optionalKey(GroupBy).annotate({ description: "Category by default" }),
  interval: Schema.optionalKey(ReportInterval).annotate({ description: "Monthly by default" }),
  balanceType: Schema.optionalKey(BalanceType).annotate({ description: "Payment by default" }),
  sortBy: Schema.optionalKey(SortBy),
  showEmpty: Schema.optionalKey(Schema.Boolean),
  showOffBudget: Schema.optionalKey(Schema.Boolean),
  showHiddenCategories: Schema.optionalKey(Schema.Boolean),
  showUncategorized: Schema.optionalKey(Schema.Boolean),
  trimIntervals: Schema.optionalKey(Schema.Boolean),
  showTrendLines: Schema.optionalKey(Schema.Boolean),
  graphType: Schema.optionalKey(Schema.String),
  tagScope: Schema.optionalKey(TagScope),
  ...filterFields,
};

/** A saved custom report, as Actual's: what to show and how. */
export const CustomReport = Schema.Struct({
  id: Id,
  name: Schema.String,
  startDate: Day,
  endDate: Day,
  isDateStatic: Schema.Boolean,
  dateRange: DateRange,
  includeCurrentInterval: Schema.Boolean,
  mode: Schema.Literals(["total", "time"]),
  groupBy: GroupBy,
  interval: ReportInterval,
  balanceType: BalanceType,
  sortBy: SortBy,
  showEmpty: Schema.Boolean,
  showOffBudget: Schema.Boolean,
  showHiddenCategories: Schema.Boolean,
  showUncategorized: Schema.Boolean,
  trimIntervals: Schema.Boolean,
  showTrendLines: Schema.Boolean,
  graphType: Schema.String,
  tagScope: Schema.optionalKey(TagScope),
  conditions: Schema.Array(ReportCondition),
  conditionsOp: ConditionsOp,
});
export type CustomReport = typeof CustomReport.Type;

export const CrossoverReport = Schema.Struct({
  start: Month,
  end: Month,
  points: Schema.Array(
    Schema.Struct({
      month: Month,
      investmentIncome: Amount,
      expenses: Amount,
      nestEgg: Amount,
      adjustedExpenses: Schema.optionalKey(Amount),
      isProjection: Schema.Boolean,
    }),
  ),
  crossoverMonth: Schema.NullOr(Month),
  lastKnownBalance: Amount,
  lastKnownMonthlyIncome: Amount,
  lastKnownMonthlyExpenses: Amount,
  /** The yearly return the balances grew at, from the first to the last month. */
  historicalReturn: Schema.NullOr(Schema.Number),
  yearsToRetire: Schema.NullOr(Schema.Number),
  targetMonthlyIncome: Schema.NullOr(Amount),
  targetNestEgg: Schema.NullOr(Amount),
});
export type CrossoverReport = typeof CrossoverReport.Type;

export const BudgetAnalysisReport = Schema.Struct({
  start: Day,
  end: Day,
  intervals: Schema.Array(
    Schema.Struct({
      date: Month,
      budgeted: Amount,
      /** Negative when money was spent. */
      spent: Amount,
      /** The running balance at the month's end, carried over as the budget carries it. */
      balance: Amount,
      /** Last month's overspending in categories that do not carry it over, reset this month. */
      overspendingAdjustment: Amount,
    }),
  ),
  totalBudgeted: Amount,
  totalSpent: Amount,
  totalOverspendingAdjustment: Amount,
  /** The last month's overspending, reset in the month after the range. */
  finalOverspendingAdjustment: Amount,
  endingBalance: Amount,
});
export type BudgetAnalysisReport = typeof BudgetAnalysisReport.Type;

export const SankeyLayer = Schema.Literals([
  "payee",
  "income_category",
  "account",
  "budget",
  "category_group",
  "category",
]);
export const SankeySort = Schema.Literals(["per-group", "global", "budget-order"]);

export const SankeyReport = Schema.Struct({
  start: Month,
  end: Month,
  view: Schema.Literals(["spent", "budgeted"]),
  layerFrom: SankeyLayer,
  layerTo: SankeyLayer,
  nodes: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      name: Schema.String,
      layer: SankeyLayer,
      /** A padding node that lines its column up; it is not drawn. */
      hidden: Schema.Boolean,
      value: Amount,
      /** The node's share of its column, in percent. */
      percentage: Schema.NullOr(Schema.Number),
      /** series: colored by its key; the others stand for to budget, overspending, months, totals. */
      tone: Schema.Literals(["series", "positive", "negative", "neutral", "primary"]),
    }),
  ),
  links: Schema.Array(
    Schema.Struct({
      source: Schema.Int,
      target: Schema.Int,
      /** Padding links are -1. */
      value: Amount,
      /** The node whose color the link takes. */
      colorNode: Schema.NullOr(Schema.Int),
      /** What an "Other" link folds together. */
      tooltip: Schema.Array(Schema.Struct({ name: Schema.String, value: Amount })),
    }),
  ),
});
export type SankeyReport = typeof SankeyReport.Type;

export const AgeOfMoneyGranularity = Schema.Literals(["daily", "weekly", "monthly"]);

export const AgeOfMoneyReport = Schema.Struct({
  start: Day,
  end: Day,
  granularity: AgeOfMoneyGranularity,
  /** The average age of the last ten outflows up to each period: a day, a week's Monday or a month. */
  points: Schema.Array(Schema.Struct({ date: Schema.String, ageOfMoney: Schema.Int })),
  /** The average age, in days, of the last ten outflows in the range. */
  currentAge: Schema.NullOr(Schema.Int),
  trend: Schema.Literals(["up", "down", "stable"]),
  /** Some outflow found no income left to spend. */
  insufficientData: Schema.Boolean,
});
export type AgeOfMoneyReport = typeof AgeOfMoneyReport.Type;

export const FormulaQuery = Schema.Struct({
  ...filterFields,
  timeFrame: Schema.optionalKey(TimeFrame),
});

export const FormulaResult = Schema.Struct({
  result: Schema.NullOr(Schema.Union([Schema.Number, Schema.String, Schema.Boolean])),
  error: Schema.NullOr(Schema.String),
});

// ---------------------------------------------------------------------------------------------
// Dashboard and tags
// ---------------------------------------------------------------------------------------------

export const PersistedReportCondition = Schema.Struct({
  field: ReportCondition.fields.field,
  op: RuleOp,
  value: Schema.optionalKey(
    Schema.NullOr(
      Schema.Union([
        Schema.String,
        Schema.Number,
        Schema.Boolean,
        Schema.Array(Schema.NullOr(Schema.Union([Schema.String, Schema.Number, Schema.Boolean]))),
        Schema.Struct({ num1: Schema.Number, num2: Schema.Number }),
      ]),
    ),
  ),
});
const persistedFilterFields = {
  conditions: Schema.optionalKey(Schema.Array(PersistedReportCondition)),
  conditionsOp: Schema.optionalKey(ConditionsOp),
};
const savedFilters = { ...persistedFilterFields, timeFrame: Schema.optionalKey(TimeFrame) };
const optional = Schema.optionalKey;
const ids = Schema.Array(Id);
export const reportSettings = {
  "net-worth": Schema.Struct({
    ...savedFilters,
    interval: optional(Schema.Literals(["Daily", "Weekly", "Monthly", "Yearly"])),
    mode: optional(Schema.Literals(["trend", "stacked"])),
  }),
  "cash-flow": Schema.Struct({ ...savedFilters, showBalance: optional(Schema.Boolean) }),
  spending: Schema.Struct({
    ...persistedFilterFields,
    compare: optional(Month),
    compareTo: optional(Month),
    isLive: optional(Schema.Boolean),
    mode: optional(Schema.Literals(["single-month", "budget", "average"])),
    averageRange: optional(
      Schema.Union([
        Schema.Struct({
          mode: Schema.Literal("last-n-months"),
          months: Schema.Literals([3, 6, 12]),
        }),
        Schema.Struct({ mode: Schema.Literal("year-to-date") }),
        Schema.Struct({ mode: Schema.Literal("all-time") }),
      ]),
    ),
  }),
  summary: Schema.Struct({
    ...savedFilters,
    content: optional(
      Schema.Struct({
        type: SummaryContent,
        divisorConditions: optional(Schema.Array(PersistedReportCondition)),
        divisorConditionsOp: optional(ConditionsOp),
        divisorAllTimeDateRange: optional(Schema.Boolean),
      }),
    ),
  }),
  calendar: Schema.Struct(savedFilters),
  crossover: Schema.Struct({
    expenseCategoryIds: optional(ids),
    incomeAccountIds: optional(ids),
    timeFrame: optional(TimeFrame),
    safeWithdrawalRate: optional(Schema.Number),
    estimatedReturn: optional(Schema.NullOr(Schema.Number)),
    expectedContribution: optional(Schema.NullOr(Amount)),
    projectionType: optional(Schema.Literals(["hampel", "median", "mean"])),
    expenseAdjustmentFactor: optional(Schema.Number),
  }),
  "budget-analysis": Schema.Struct({
    ...savedFilters,
    interval: optional(Schema.Literals(["Daily", "Weekly", "Monthly", "Yearly"])),
    graphType: optional(Schema.Literals(["Line", "Bar"])),
    showBalance: optional(Schema.Boolean),
    balanceOnly: optional(Schema.Boolean),
    showHiddenCategories: optional(Schema.Boolean),
  }),
  sankey: Schema.Struct({
    ...savedFilters,
    mode: optional(Schema.Literals(["budgeted", "spent"])),
    topNcategories: optional(Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)))),
    categorySort: optional(SankeySort),
    showPercentages: optional(Schema.Boolean),
    groupAccounts: optional(Schema.Boolean),
    showTransfers: optional(Schema.Boolean),
    layerFrom: optional(SankeyLayer),
    layerTo: optional(SankeyLayer),
  }),
  "age-of-money": Schema.Struct({ ...savedFilters, granularity: optional(AgeOfMoneyGranularity) }),
  "balance-forecast": Schema.Struct({
    ...savedFilters,
    startDate: optional(Day),
    endDate: optional(Day),
    accounts: optional(ids),
    granularity: optional(Schema.Literals(["Daily", "Monthly"])),
    yAxisBase: optional(Schema.Literals(["Zero-Based", "Auto"])),
    source: optional(Schema.Literals(["schedules", "tracking-budget"])),
    series: optional(
      Schema.Array(
        Schema.Struct({
          id: Schema.String,
          name: Schema.String,
          accounts: optional(ids),
          conditions: Schema.Array(PersistedReportCondition),
          conditionsOp: ConditionsOp,
        }),
      ),
    ),
  }),
  formula: Schema.Struct({
    formula: optional(Schema.String),
    queries: optional(
      Schema.Record(
        Schema.String,
        Schema.Struct({ ...persistedFilterFields, timeFrame: Schema.optionalKey(TimeFrame) }),
      ),
    ),
  }),
  custom: Schema.Struct({ ...customReportFields, ...persistedFilterFields }),
  "monte-carlo": Schema.Struct(monteCarloPlanFields),
};
export type ReportType = keyof typeof reportSettings;

const definition = <T extends ReportType, S extends Schema.Top>(type: T, settings: S) =>
  Schema.Struct({
    version: Schema.Literal(1),
    type: Schema.Literal(type),
    settings,
    scope: Schema.Struct({ accounts: AccountScope }),
  });
export const SavedReportDefinition = Schema.Union([
  definition("net-worth", reportSettings["net-worth"]),
  definition("cash-flow", reportSettings["cash-flow"]),
  definition("spending", reportSettings["spending"]),
  definition("summary", reportSettings["summary"]),
  definition("calendar", reportSettings["calendar"]),
  definition("crossover", reportSettings["crossover"]),
  definition("budget-analysis", reportSettings["budget-analysis"]),
  definition("sankey", reportSettings["sankey"]),
  definition("age-of-money", reportSettings["age-of-money"]),
  definition("balance-forecast", reportSettings["balance-forecast"]),
  definition("formula", reportSettings["formula"]),
  definition("custom", reportSettings["custom"]),
  definition("monte-carlo", reportSettings["monte-carlo"]),
]);
export type SavedReportDefinition = typeof SavedReportDefinition.Type;
export const SavedReport = Schema.Struct({
  id: Id,
  name: Schema.String,
  createdAt: Schema.Number,
  definition: SavedReportDefinition,
});
export type SavedReport = typeof SavedReport.Type;
export const SavedReportInfo = Schema.Union([
  SavedReport,
  Schema.Struct({
    id: Id,
    name: Schema.String,
    createdAt: Schema.Number,
    availability: Schema.Literals(["unsupported", "invalid-config"]),
  }),
]);
export type SavedReportInfo = typeof SavedReportInfo.Type;

export const PlacementScope = Schema.Struct({
  accounts: Schema.Union([
    Schema.Struct({ mode: Schema.Literal("inherit") }),
    Schema.Struct({ mode: Schema.Literal("fixed"), value: AccountScope }),
  ]),
});
export type PlacementScope = typeof PlacementScope.Type;
export const PlacementPresentation = Schema.Struct({
  collapsed: optional(Schema.Boolean),
  fontSize: optional(Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 8, maximum: 96 })))),
});
const placementFields = {
  version: Schema.Literal(1),
  title: Schema.NullOr(Schema.String),
  presentation: PlacementPresentation,
};
export const ReportPlacementConfig = Schema.Struct({ ...placementFields, scope: PlacementScope });
export const localWidgetSettings = {
  "home-insight": Schema.Struct({}),
  "category-pace": Schema.Struct({
    limit: optional(Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 50 })))),
  }),
  "account-balances": Schema.Struct({}),
  "upcoming-transactions": Schema.Struct({
    daysAhead: optional(
      Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 366 }))),
    ),
    limit: optional(Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 50 })))),
  }),
  "recent-transactions": Schema.Struct({
    limit: optional(Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 50 })))),
  }),
  "markdown-card": Schema.Struct({
    content: optional(Schema.String),
    text_align: optional(Schema.Literals(["left", "right", "center"])),
  }),
};
export const LocalPlacementConfig = Schema.Struct({
  ...placementFields,
  scope: optional(PlacementScope),
  settings: Schema.Union([
    localWidgetSettings["home-insight"],
    localWidgetSettings["category-pace"],
    localWidgetSettings["account-balances"],
    localWidgetSettings["upcoming-transactions"],
    localWidgetSettings["recent-transactions"],
    localWidgetSettings["markdown-card"],
  ]),
});
export const WidgetConfig = Schema.Union([LocalPlacementConfig, ReportPlacementConfig]);
export type WidgetConfig = typeof WidgetConfig.Type;
/** The operational pages that may hold widgets. Rules and Schedules hold none. */
export const PageHost = Schema.Literals(["transactions", "payees"]);

export const SavedReportUsage = Schema.Struct({
  reportId: Id,
  placements: Schema.Array(
    Schema.Struct({
      id: Id,
      pageId: Id,
      host: Schema.NullOr(PageHost),
      pageName: Schema.String,
      title: Schema.String,
    }),
  ),
});

export const WidgetType = Schema.Literals([
  "net-worth-card",
  "cash-flow-card",
  "spending-card",
  "crossover-card",
  "budget-analysis-card",
  "markdown-card",
  "summary-card",
  "calendar-card",
  "formula-card",
  "custom-report",
  "sankey-card",
  "balance-forecast-card",
  "age-of-money-card",
  "monte-carlo-card",
  "home-insight",
  "category-pace",
  "account-balances",
  "upcoming-transactions",
  "recent-transactions",
]);

export const Widget = Schema.Struct({
  id: Id,
  pageId: Id,
  type: Schema.String,
  x: Schema.Int,
  y: Schema.Int,
  width: Schema.Int,
  height: Schema.Int,
  reportId: Schema.NullOr(Id),
  config: Schema.NullOr(WidgetConfig),
  availability: Schema.Literals([
    "available",
    "missing-reference",
    "unsupported",
    "invalid-config",
  ]),
});
export type Widget = typeof Widget.Type;

export const PageWidgets = Schema.Struct({
  host: PageHost,
  /** Top to bottom; empty until the first widget is added. */
  widgets: Schema.Array(Widget),
});

export const DashboardPage = Schema.Struct({
  id: Id,
  name: Schema.String,
  sortOrder: Schema.Int,
  isDefault: Schema.Boolean,
  widgets: Schema.Array(Widget),
});
export type DashboardPage = typeof DashboardPage.Type;

const WidgetLayout = Schema.Struct({
  id: Id,
  x: Schema.optionalKey(Schema.Int),
  y: Schema.optionalKey(Schema.Int),
  width: Schema.optionalKey(Schema.Int),
  height: Schema.optionalKey(Schema.Int),
});

export const Tag = Schema.Struct({
  id: Id,
  tag: Schema.String,
  color: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  /** Hidden from the tag pickers, as Actual's hidden tags. */
  hidden: Schema.Boolean,
  /** How many transactions name it in their notes. */
  count: Schema.Int,
});
export type Tag = typeof Tag.Type;

const PageId = IdField("Dashboard page id");
const WidgetId = IdField("Widget id");
const TagId = IdField("Tag id");

export const reports = {
  list_saved_reports: {
    description: "List saved report definitions.",
    readonly: true,
    input: Schema.Struct({ book: BookField }),
    success: Schema.Array(SavedReportInfo),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/saved-reports" },
    cli: { command: ["reports", "definitions"], description: "List saved report definitions." },
  },
  get_saved_report: {
    description: "Read a saved report definition or its unavailable descriptor.",
    readonly: true,
    input: Schema.Struct({ book: BookField, id: IdField("Saved report id") }),
    success: SavedReportInfo,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/saved-reports/:id" },
    cli: { command: ["reports", "get"], description: "Read a saved report definition." },
  },
  create_saved_report: {
    description: "Create an independent saved report.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      name: Schema.NonEmptyString,
      definition: SavedReportDefinition,
    }),
    success: SavedReport,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/saved-reports" },
  },
  update_saved_report: {
    description: "Replace supplied settings or scope of a linked report.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book: BookField,
      id: IdField("Saved report id"),
      name: optional(Schema.NonEmptyString),
      settings: optional(Schema.Union(Object.values(reportSettings))),
      scope: optional(Schema.Struct({ accounts: AccountScope })),
    }),
    success: SavedReport,
    error: inBook(),
    http: { method: "PATCH", path: "/books/:book/saved-reports/:id" },
  },
  duplicate_saved_report: {
    description: "Duplicate a report without copying placements.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      id: IdField("Saved report id"),
      name: Schema.NonEmptyString,
    }),
    success: SavedReport,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/saved-reports/:id/duplicate" },
    cli: {
      command: ["reports", "duplicate"],
      description: "Duplicate a report without copying placements.",
    },
  },
  get_saved_report_usage: {
    description: "Review all placements linked to a report.",
    readonly: true,
    input: Schema.Struct({ book: BookField, id: IdField("Saved report id") }),
    success: SavedReportUsage,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/saved-reports/:id/usage" },
    cli: {
      command: ["reports", "usage"],
      description: "Review all placements linked to a report.",
    },
  },
  delete_saved_report: {
    description: "Delete a report and its reviewed placements in one undo step.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({
      book: BookField,
      id: IdField("Saved report id"),
      expectedPlacementIds: Schema.Array(Id),
    }),
    success: Schema.Struct({ deleted: Id }),
    error: inBook(),
    http: { method: "DELETE", path: "/books/:book/saved-reports/:id" },
    cli: {
      command: ["reports", "remove"],
      description: "Delete a report and its reviewed placements in one undo step.",
    },
  },
  set_default_dashboard: {
    description: "Choose the book default dashboard.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({ book: BookField, id: PageId }),
    success: DashboardPage,
    error: inBook(),
    http: { method: "PUT", path: "/books/:book/dashboard/:id/default" },
    cli: { command: ["dashboard", "default"], description: "Choose the book default dashboard." },
  },
  reorder_dashboard_pages: {
    description: "Reorder all dashboards.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({ book: BookField, ids: Schema.Array(Id) }),
    success: Schema.Array(DashboardPage),
    error: inBook(),
    http: { method: "PUT", path: "/books/:book/dashboard-order" },
  },
  duplicate_dashboard_page: {
    description: "Duplicate a dashboard with linked reports.",
    readonly: false,
    input: Schema.Struct({ book: BookField, id: PageId, name: Schema.NonEmptyString }),
    success: DashboardPage,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/dashboard/:id/duplicate" },
    cli: {
      command: ["dashboard", "duplicate"],
      description: "Duplicate a dashboard with linked reports.",
    },
  },
  repair_widget: {
    description: "Repair an unavailable widget while retaining legacy metadata.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      id: WidgetId,
      type: WidgetType,
      reportId: optional(Id),
      config: WidgetConfig,
    }),
    success: Widget,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/widgets/:id/repair" },
  },

  // -------------------------------------------------------------------------------------------
  // Reports
  // -------------------------------------------------------------------------------------------
  net_worth_report: {
    description:
      "Net worth over time, as Actual's net worth report: per interval the balance of each account, assets (positive balances), debt (negative balances), net worth and its change. Filters apply to the accounts' transactions.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      ...timeFrameFields,
      interval: Schema.optionalKey(
        Schema.Literals(["Daily", "Weekly", "Monthly", "Yearly"]),
      ).annotate({ description: "Monthly by default" }),
      accounts: AccountIds,
      ...filterFields,
      ...scopeField,
    }),
    success: NetWorthReport,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/reports/net-worth" },
    cli: {
      command: ["reports", "net-worth"],
      description: "Show net worth over time",
      examples: [
        {
          command: "reeve reports net-worth --start 2026-01 --end 2026-10",
          description: "This year by month",
        },
      ],
    },
  },
  cash_flow_report: {
    description:
      "Cash flow of the budget accounts, as Actual's cash flow report: income, expenses and transfers per day or month, and the running balance. Totals are the cash flow widget's values.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      ...timeFrameFields,
      interval: Schema.optionalKey(Schema.Literals(["Daily", "Monthly"])).annotate({
        description: "Daily, or Monthly when the range is longer than three months (the default)",
      }),
      ...filterFields,
      ...scopeField,
    }),
    success: CashFlowReport,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/reports/cash-flow" },
    cli: { command: ["reports", "cash-flow"], description: "Show income, expenses and transfers" },
  },
  spending_report: {
    description:
      "Spending of one month against another and an average of earlier months, as Actual's spending report: cumulative spending per day of month (day 28 takes the rest), the month's budget spread over its days, and spending per expense category.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      compare: Schema.optionalKey(Month).annotate({ description: "This month by default" }),
      compareTo: Schema.optionalKey(Month).annotate({
        description: "The month before compare by default",
      }),
      averageRange: Schema.optionalKey(AverageRange).annotate({
        description: "The months averaged before compare; last-3-months by default",
      }),
      ...filterFields,
      ...scopeField,
    }),
    success: SpendingReport,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/reports/spending" },
    cli: { command: ["reports", "spending"], description: "Compare a month's spending" },
  },
  spending_transactions: {
    description:
      "The transactions behind one category's figure in spending_report for one month, under the same filters: each register row with what it counts toward the figure, which for a split is only its lines in that category. Their counted amounts sum to the figure.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      category: Id.annotate({ description: "An expense category id", ...cli({ alias: "c" }) }),
      month: Month.annotate({ description: "The compare or compare-to month" }),
      ...filterFields,
      ...scopeField,
    }),
    success: FigureRecords,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/reports/spending/transactions" },
    cli: {
      command: ["reports", "spending-transactions"],
      description: "List the transactions behind a category's spending in a month",
    },
  },
  summary_report: {
    description:
      "A summary widget's value, as Actual's: the sum of the matching transactions, their average per month, per year or per transaction, or their sum as a percentage of what divisorConditions match.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      ...timeFrameFields,
      content: Schema.optionalKey(SummaryContent).annotate({ description: "sum by default" }),
      ...filterFields,
      divisorConditions: Schema.optionalKey(Schema.Array(ReportCondition)),
      divisorConditionsOp: Schema.optionalKey(ConditionsOp),
      divisorAllTimeDateRange: Schema.optionalKey(Schema.Boolean).annotate({
        description: "Divide by every matching transaction, not only those in the range",
      }),
      ...scopeField,
    }),
    success: SummaryReport,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/reports/summary" },
    cli: { command: ["reports", "summary"], description: "Sum or average transactions" },
  },
  calendar_report: {
    description: "Income and expenses per day, month by month, as Actual's calendar report.",
    readonly: true,
    input: Schema.Struct({ book: BookField, ...timeFrameFields, ...filterFields, ...scopeField }),
    success: CalendarReport,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/reports/calendar" },
    cli: { command: ["reports", "calendar"], description: "Show income and expenses per day" },
  },
  run_custom_report: {
    description:
      "Run a custom report, as Actual's custom reports: the transactions grouped by category, group, payee, account, tag or interval, per day, week, month, quarter or year, as payments, deposits, net, net payments, net deposits or budgeted amounts. Give id to run a saved report; other fields override it.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      id: Schema.optionalKey(Id).annotate({ description: "A saved report to run" }),
      ...customReportFields,
      ...scopeField,
    }),
    success: CustomReportResult,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/reports/custom" },
    cli: {
      command: ["reports", "custom"],
      description: "Run a custom report",
      examples: [
        {
          command: "reeve reports custom --group-by Payee --date-range 'Last 3 months'",
          description: "Spending per payee",
        },
      ],
    },
  },
  crossover_report: {
    description:
      "Actual's crossover (financial independence) report: monthly expenses of the chosen categories against what the chosen accounts would pay at a safe withdrawal rate, projected until the income covers the expenses.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      ...timeFrameFields,
      expenseCategories: Schema.optionalKey(Schema.Array(Id)).annotate({
        description: "Categories that count as expenses; every expense category by default",
      }),
      accounts: AccountIds,
      safeWithdrawalRate: Schema.optionalKey(Schema.Number).annotate({
        description: "Yearly rate, 0.04 by default",
      }),
      estimatedReturn: Schema.optionalKey(Schema.NullOr(Schema.Number)).annotate({
        description: "Yearly return for the projection; the historical return by default",
      }),
      expectedContribution: Schema.optionalKey(Schema.NullOr(Amount)).annotate({
        description: "Monthly contribution during the projection",
      }),
      projectionType: Schema.optionalKey(Schema.Literals(["hampel", "median", "mean"])).annotate({
        description: "How the monthly expense is projected; hampel by default",
      }),
      expenseAdjustmentFactor: Schema.optionalKey(Schema.Number),
    }),
    success: CrossoverReport,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/reports/crossover" },
    cli: { command: ["reports", "crossover"], description: "Project financial independence" },
  },
  budget_analysis_report: {
    description:
      "Actual's budget analysis: per month what the expense categories were budgeted and spent, the overspending reset from the month before (categories without rollover), and a running balance that carries over as the budget does. Only category and category_group conditions apply.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      ...timeFrameFields,
      showHiddenCategories: Schema.optionalKey(Schema.Boolean),
      ...filterFields,
    }),
    success: BudgetAnalysisReport,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/reports/budget-analysis" },
    cli: { command: ["reports", "budget-analysis"], description: "Show budgeted against spent" },
  },
  sankey_report: {
    description:
      "Actual's Sankey report: money flowing from payees and income categories through accounts (spent) or the budget (budgeted) to category groups and categories, over a range of months. The smallest nodes of each layer fold into Other past topN; hidden nodes and -1 links only line the columns up. In the budgeted view only category and category_group conditions apply.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      ...timeFrameFields,
      view: Schema.optionalKey(Schema.Literals(["spent", "budgeted"])).annotate({
        description: "spent (transactions, the default) or budgeted (the budget's months)",
      }),
      topN: Schema.optionalKey(Schema.Int).annotate({
        description: "Nodes per layer before the rest fold into Other; 15 by default",
      }),
      categorySort: Schema.optionalKey(SankeySort).annotate({
        description: "per-group (the default), global or budget-order",
      }),
      groupAccounts: Schema.optionalKey(Schema.Boolean).annotate({
        description: "One Income node for every account (spent view)",
      }),
      showTransfers: Schema.optionalKey(Schema.Boolean).annotate({
        description: "Links between budget accounts for transfers (spent view)",
      }),
      layerFrom: Schema.optionalKey(SankeyLayer),
      layerTo: Schema.optionalKey(SankeyLayer),
      ...filterFields,
    }),
    success: SankeyReport,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/reports/sankey" },
    cli: { command: ["reports", "sankey"], description: "Show where money flows" },
  },
  age_of_money_report: {
    description:
      "Actual's age of money: every inflow to the budget accounts is a lot, every outflow spends the oldest lots first (FIFO), and an outflow's age is the days since the last lot it drew from. currentAge is the average age of the last ten outflows in the range. Transfers between budget accounts do not count, unless the account conditions leave the other account out.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      ...timeFrameFields,
      granularity: Schema.optionalKey(AgeOfMoneyGranularity).annotate({
        description: "daily, weekly (from Monday) or monthly (the default)",
      }),
      ...filterFields,
      ...scopeField,
    }),
    success: AgeOfMoneyReport,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/reports/age-of-money" },
    cli: { command: ["reports", "age-of-money"], description: "Show how old spent money is" },
  },
  evaluate_formula: {
    description:
      'Evaluate a formula widget\'s formula with HyperFormula, as Actual\'s formula card: spreadsheet functions plus QUERY("name") (the sum of a named query, in currency units), QUERY_COUNT, BALANCE_OF("account"), BUDGET_QUERY(dimension, categories, start, end), QUERY_EXTRACT_CATEGORIES, QUERY_EXTRACT_TIMEFRAME_START/END, INTEGER_TO_AMOUNT, FIXED, FORMATNUMBER and FORMATCURRENCY.',
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      formula: Schema.String.annotate({
        description: "Starts with =",
        ...cli({ positional: true }),
      }),
      queries: Schema.optionalKey(Schema.Record(Schema.String, FormulaQuery)),
      namedExpressions: Schema.optionalKey(
        Schema.Record(Schema.String, Schema.Union([Schema.Number, Schema.String])),
      ),
    }),
    success: FormulaResult,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/reports/formula" },
    cli: {
      command: ["reports", "formula"],
      description: "Evaluate a formula",
      examples: [{ command: "reeve reports formula '=BALANCE_OF(\"Checking\")'", description: "" }],
    },
  },

  // -------------------------------------------------------------------------------------------
  // Custom reports
  // -------------------------------------------------------------------------------------------
  list_custom_reports: {
    description: "List the saved custom reports, by name.",
    readonly: true,
    input: Schema.Struct({ book: BookField }),
    success: Schema.Array(CustomReport),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/custom-reports" },
    cli: { command: ["reports", "saved"], description: "List saved custom reports" },
  },
  create_custom_report: {
    description: "Save a custom report under a name no other report has.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      name: Schema.NonEmptyString.annotate(cli({ positional: true })),
      ...customReportFields,
    }),
    success: CustomReport,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/custom-reports" },
    cli: { command: ["reports", "save"], description: "Save a custom report" },
  },
  update_custom_report: {
    description: "Change a saved custom report; the fields given replace its own.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book: BookField,
      id: IdField("Custom report id"),
      name: Schema.optionalKey(Schema.NonEmptyString),
      ...customReportFields,
    }),
    success: CustomReport,
    error: inBook(),
    http: { method: "PATCH", path: "/books/:book/custom-reports/:id" },
  },
  delete_custom_report: {
    description: "Delete a saved custom report and the dashboard widgets that show it.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({
      book: BookField,
      id: IdField("Custom report id"),
      expectedPlacementIds: Schema.optionalKey(Schema.Array(Id)),
    }),
    success: Schema.Struct({ deleted: Id }),
    error: inBook(),
    http: { method: "DELETE", path: "/books/:book/custom-reports/:id" },
    cli: { command: ["reports", "delete"], description: "Delete a saved custom report" },
  },

  // -------------------------------------------------------------------------------------------
  // Dashboard
  // -------------------------------------------------------------------------------------------
  list_dashboard_pages: {
    description:
      "List dashboards with their widgets and default selection. This operation never initializes data.",
    readonly: true,
    input: Schema.Struct({ book: BookField }),
    success: Schema.Array(DashboardPage),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/dashboard" },
    cli: { command: ["dashboard", "list"], description: "List dashboard pages and widgets" },
  },
  create_dashboard_page: {
    description: "Add an empty dashboard page.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      name: Schema.NonEmptyString.annotate(cli({ positional: true })),
    }),
    success: DashboardPage,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/dashboard" },
    cli: { command: ["dashboard", "create"], description: "Add a dashboard page" },
  },
  rename_dashboard_page: {
    description: "Rename a dashboard page.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({ book: BookField, id: PageId, name: Schema.NonEmptyString }),
    success: DashboardPage,
    error: inBook(),
    http: { method: "PATCH", path: "/books/:book/dashboard/:id" },
    cli: { command: ["dashboard", "rename"], description: "Rename a dashboard page" },
  },
  delete_dashboard_page: {
    description: "Delete a dashboard page and its widgets; the last page stays.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({ book: BookField, id: PageId }),
    success: Schema.Struct({ deleted: Id }),
    error: inBook(),
    http: { method: "DELETE", path: "/books/:book/dashboard/:id" },
    cli: { command: ["dashboard", "delete"], description: "Delete a dashboard page" },
  },
  reset_dashboard_page: {
    description:
      "Replace a dashboard page's widgets with the Today template, retaining saved reports.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({ book: BookField, id: PageId }),
    success: DashboardPage,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/dashboard/:id/reset" },
    cli: { command: ["dashboard", "reset"], description: "Restore a page's default widgets" },
  },
  add_widget: {
    description:
      "Add a widget to a dashboard page. Without x and y it goes after the last widget on the 12-column grid.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      pageId: Id.annotate({ description: "Dashboard page id" }),
      type: WidgetType,
      width: Schema.optionalKey(Schema.Int).annotate({ description: "Grid columns, 4 by default" }),
      height: Schema.optionalKey(Schema.Int).annotate({ description: "Grid rows, 2 by default" }),
      x: Schema.optionalKey(Schema.Int),
      y: Schema.optionalKey(Schema.Int),
      reportId: Schema.optionalKey(Id).annotate({
        description: "The saved report a report widget shows",
      }),
      report: Schema.optionalKey(
        Schema.Struct({
          name: optional(Schema.NonEmptyString),
          settings: optional(Schema.Union(Object.values(reportSettings))),
        }),
      ).annotate({
        description:
          "Create a saved report for this report widget and link it, instead of reportId; the name defaults to the report type's",
      }),
      config: Schema.optionalKey(WidgetConfig),
    }),
    success: Widget,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/dashboard/:pageId/widgets" },
    cli: { command: ["dashboard", "add"], description: "Add a widget" },
  },
  update_widget: {
    description:
      "Move, resize or change a widget's placement settings; edit what a report widget shows with update_saved_report.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book: BookField,
      id: WidgetId,
      x: Schema.optionalKey(Schema.Int),
      y: Schema.optionalKey(Schema.Int),
      width: Schema.optionalKey(Schema.Int),
      height: Schema.optionalKey(Schema.Int),
      config: Schema.optionalKey(WidgetConfig),
    }),
    success: Widget,
    error: inBook(),
    http: { method: "PATCH", path: "/books/:book/widgets/:id" },
    cli: { command: ["dashboard", "move"], description: "Move or resize a widget" },
  },
  update_widgets: {
    description: "Change the layout of several widgets at once, as dragging on the grid does.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({ book: BookField, widgets: Schema.Array(WidgetLayout) }),
    success: Schema.Array(Widget),
    error: inBook(),
    http: { method: "PATCH", path: "/books/:book/widgets" },
  },
  remove_widget: {
    description: "Remove a widget from its page.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({ book: BookField, id: WidgetId }),
    success: Schema.Struct({ deleted: Id }),
    error: inBook(),
    http: { method: "DELETE", path: "/books/:book/widgets/:id" },
    cli: { command: ["dashboard", "remove"], description: "Remove a widget" },
  },
  copy_widget: {
    description: "Copy a widget to the end of another (or the same) dashboard page.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      id: WidgetId,
      pageId: Id.annotate({ description: "The page to copy it to" }),
    }),
    success: Widget,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/widgets/:id/copy" },
    cli: { command: ["dashboard", "copy"], description: "Copy a widget to a page" },
  },
  list_page_widgets: {
    description:
      "The widgets on an operational page (transactions or payees): one short stack per book, shared by every account, empty until a widget is added.",
    readonly: true,
    input: Schema.Struct({ book: BookField, host: PageHost }),
    success: PageWidgets,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/page-widgets/:host" },
    cli: { command: ["page-widgets", "list"], description: "List a page's widgets" },
  },
  add_page_widget: {
    description:
      "Add a report widget below a page's others, at most three. Only reports that follow accounts may go there (net worth, cash flow, spending, summary, calendar, custom but not budgeted, balance forecast, age of money). The widget follows the page's account scope unless its config fixes one. Change its title, presentation or scope with update_widget and remove it with remove_widget.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      host: PageHost,
      type: WidgetType,
      reportId: Schema.optionalKey(Id).annotate({ description: "The saved report it shows" }),
      report: Schema.optionalKey(
        Schema.Struct({
          name: optional(Schema.NonEmptyString),
          settings: optional(Schema.Union(Object.values(reportSettings))),
        }),
      ).annotate({ description: "Create a saved report for it instead of reportId" }),
      config: Schema.optionalKey(ReportPlacementConfig),
    }),
    success: Widget,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/page-widgets/:host" },
    cli: { command: ["page-widgets", "add"], description: "Add a report widget to a page" },
  },
  move_page_widget: {
    description: "Move a page widget to a position in its page's stack, 0 at the top.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({ book: BookField, id: WidgetId, index: Schema.Int }),
    success: PageWidgets,
    error: inBook(),
    http: { method: "PUT", path: "/books/:book/page-widgets/move/:id" },
    cli: { command: ["page-widgets", "move"], description: "Move a page widget" },
  },

  // -------------------------------------------------------------------------------------------
  // Tags
  // -------------------------------------------------------------------------------------------
  list_tags: {
    description: "List the tags with how many transactions name each in their notes (#tag).",
    readonly: true,
    input: Schema.Struct({ book: BookField }),
    success: Schema.Array(Tag),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/tags" },
    cli: { command: ["tags", "list"], description: "List tags and their use" },
  },
  discover_tags: {
    description:
      "Add every tag the transactions' notes use that is not listed yet, as Actual's discover, and list them all.",
    readonly: false,
    input: Schema.Struct({ book: BookField }),
    success: Schema.Array(Tag),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/tags/discover" },
    cli: { command: ["tags", "discover"], description: "Add the tags used in notes" },
  },
  create_tag: {
    description: "Create a tag, or update the one with that name.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book: BookField,
      tag: Schema.NonEmptyString.annotate({
        description: "The tag without #",
        ...cli({ positional: true }),
      }),
      color: Schema.optionalKey(Schema.NullOr(Schema.String)),
      description: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
    success: Tag,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/tags" },
    cli: { command: ["tags", "create"], description: "Create a tag" },
  },
  update_tag: {
    description:
      "Change a tag's color or description, or rename it: a new name is written into every note that uses the old one.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book: BookField,
      id: TagId,
      tag: Schema.optionalKey(Schema.NonEmptyString).annotate({ description: "New name" }),
      hidden: Schema.optionalKey(Schema.Boolean),
      color: Schema.optionalKey(Schema.NullOr(Schema.String)),
      description: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
    success: Tag,
    error: inBook(),
    http: { method: "PATCH", path: "/books/:book/tags/:id" },
    cli: { command: ["tags", "update"], description: "Rename or recolor a tag" },
  },
  delete_tags: {
    description: "Delete tags. Notes keep their text.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({
      book: BookField,
      ids: Schema.Array(Id).annotate({ description: "Tag ids" }),
    }),
    success: Schema.Struct({ deleted: Schema.Array(Id) }),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/tags/delete" },
    cli: { command: ["tags", "delete"], description: "Delete tags" },
  },
} satisfies Record<string, Operation>;

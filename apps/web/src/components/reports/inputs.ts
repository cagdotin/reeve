import type { OperationName } from "@reeve/contract/catalog";
import type { Input } from "@/lib/api";
import type { MonteCarloMeta } from "@reeve/contract/monte-carlo";
import {
  type AgeOfMoneyMeta,
  type BudgetAnalysisMeta,
  type SankeyMeta,
  defaultFrame,
  frameInput,
  summaryContent,
  type BalanceForecastMeta,
  type CalendarMeta,
  type CashFlowMeta,
  type CrossoverMeta,
  type NetWorthMeta,
  type SpendingAverage,
  type SpendingMeta,
  type SummaryMeta,
} from "./meta";

type In<K extends OperationName> = Omit<Input<K>, "book">;

const filters = (meta: {
  conditions?: ReadonlyArray<unknown> | undefined;
  conditionsOp?: "and" | "or" | undefined;
}) => ({
  // A saved widget's conditions are stored data; keep only the keys the operation accepts.
  conditions: ((meta.conditions ?? []) as NonNullable<In<"net_worth_report">["conditions"]>).map(
    ({ field, op, value }) => ({ field, op, value }),
  ),
  conditionsOp: meta.conditionsOp ?? "and",
});

export const netWorthInput = (meta: NetWorthMeta): In<"net_worth_report"> => ({
  ...frameInput(meta.timeFrame ?? defaultFrame()),
  interval: meta.interval ?? (meta.timeFrame?.mode === "lastMonth" ? "Weekly" : "Monthly"),
  ...filters(meta),
});

export const cashFlowInput = (meta: CashFlowMeta): In<"cash_flow_report"> => ({
  ...frameInput(meta.timeFrame ?? defaultFrame()),
  ...filters(meta),
});

const AVERAGE: Record<string, In<"spending_report">["averageRange"]> = {
  "last-n-months:3": "last-3-months",
  "last-n-months:6": "last-6-months",
  "last-n-months:12": "last-12-months",
  "year-to-date": "year-to-date",
  "all-time": "all-time",
};

export const averageKey = (range: SpendingAverage | undefined) =>
  range === undefined
    ? "last-n-months:3"
    : range.mode === "last-n-months"
      ? `last-n-months:${range.months}`
      : range.mode;

export const spendingInput = (meta: SpendingMeta): In<"spending_report"> => ({
  ...(meta.isLive === false && meta.compare !== undefined ? { compare: meta.compare } : {}),
  ...(meta.isLive === false && meta.compareTo !== undefined ? { compareTo: meta.compareTo } : {}),
  averageRange: AVERAGE[averageKey(meta.averageRange)] ?? "last-3-months",
  ...filters(meta),
});

export const summaryInput = (meta: SummaryMeta): In<"summary_report"> => {
  const content = summaryContent(meta);
  return {
    ...frameInput(meta.timeFrame ?? defaultFrame()),
    content: content.type,
    ...filters(meta),
    ...(content.type === "percentage"
      ? {
          divisorConditions: (content.divisorConditions ?? []) as NonNullable<
            In<"summary_report">["conditions"]
          >,
          divisorConditionsOp: content.divisorConditionsOp ?? "and",
          divisorAllTimeDateRange: content.divisorAllTimeDateRange ?? false,
        }
      : {}),
  };
};

export const calendarInput = (meta: CalendarMeta): In<"calendar_report"> => ({
  ...frameInput(meta.timeFrame ?? defaultFrame(3)),
  ...filters(meta),
});

export const crossoverInput = (meta: CrossoverMeta): In<"crossover_report"> => ({
  ...frameInput(meta.timeFrame ?? defaultFrame(12)),
  ...(meta.expenseCategoryIds && meta.expenseCategoryIds.length > 0
    ? { expenseCategories: meta.expenseCategoryIds }
    : {}),
  ...(meta.incomeAccountIds && meta.incomeAccountIds.length > 0
    ? { accounts: meta.incomeAccountIds }
    : {}),
  safeWithdrawalRate: meta.safeWithdrawalRate ?? 0.04,
  ...(meta.estimatedReturn !== undefined ? { estimatedReturn: meta.estimatedReturn } : {}),
  ...(meta.expectedContribution !== undefined
    ? { expectedContribution: meta.expectedContribution }
    : {}),
  projectionType: meta.projectionType ?? "hampel",
  ...(meta.expenseAdjustmentFactor !== undefined
    ? { expenseAdjustmentFactor: meta.expenseAdjustmentFactor }
    : {}),
});

export const budgetAnalysisInput = (meta: BudgetAnalysisMeta): In<"budget_analysis_report"> => ({
  ...frameInput(meta.timeFrame ?? defaultFrame()),
  showHiddenCategories: meta.showHiddenCategories ?? false,
  ...filters(meta),
});

const LAYERS = new Set([
  "payee",
  "income_category",
  "account",
  "budget",
  "category_group",
  "category",
]);
const layerOf = (value: string | undefined) =>
  value !== undefined && LAYERS.has(value)
    ? (value as NonNullable<In<"sankey_report">["layerFrom"]>)
    : undefined;

/** Actual's limit for "All". */
export const ALL_NODES = 1e5;

/** How many nodes a column of this height has room for, as Actual's `topNNodes`. */
export const nodesThatFit = (height: number) => Math.max(2, Math.floor(height / 35));

/** A Sankey widget's report; `fits` caps the nodes per column at what the box has room for. */
export const sankeyInput = (meta: SankeyMeta, fits = ALL_NODES): In<"sankey_report"> => {
  const layerFrom = layerOf(meta.layerFrom);
  const layerTo = layerOf(meta.layerTo);
  return {
    ...frameInput(meta.timeFrame ?? defaultFrame()),
    view: meta.mode ?? "spent",
    topN: Math.min(meta.topNcategories ?? 15, fits),
    categorySort: meta.categorySort ?? "per-group",
    groupAccounts: meta.groupAccounts ?? false,
    showTransfers: meta.showTransfers ?? false,
    ...(layerFrom && layerTo ? { layerFrom, layerTo } : {}),
    ...filters(meta),
  };
};

export const ageOfMoneyInput = (meta: AgeOfMoneyMeta): In<"age_of_money_report"> => ({
  ...frameInput(meta.timeFrame ?? defaultFrame()),
  granularity: meta.granularity ?? "monthly",
  ...filters(meta),
});

/**
 * A balance forecast widget's report, as Actual's card asks for it: its time frame (or the older
 * startDate and endDate), and its lines or else its own accounts and filters.
 */
export const balanceForecastInput = (
  meta: BalanceForecastMeta,
  tracking: boolean,
): In<"balance_forecast_report"> => {
  const start = meta.timeFrame?.start ?? meta.startDate;
  const end = meta.timeFrame?.end ?? meta.endDate;
  const source = meta.source === "tracking-budget" && tracking ? "tracking-budget" : "schedules";
  return {
    ...(start === undefined ? {} : { start }),
    ...(end === undefined ? {} : { end }),
    mode: meta.timeFrame?.mode ?? "static",
    granularity: meta.granularity ?? "Monthly",
    source,
    ...(meta.accounts === undefined ? {} : { accounts: meta.accounts }),
    ...filters(meta),
    ...(meta.series !== undefined && meta.series.length > 0
      ? {
          series: meta.series.map((line) => ({
            id: line.id,
            name: line.name,
            ...(line.accounts === undefined ? {} : { accounts: line.accounts }),
            ...filters(line),
          })),
        }
      : {}),
  };
};

const PLAN_KEYS = [
  "pots",
  "withdrawalStrategy",
  "returnModel",
  "withdrawalRule",
  "minimumSpending",
  "spendingPhases",
  "contributions",
  "incomeStreams",
  "inflationMean",
  "inflationStdDev",
  "taxModel",
  "taxBands",
  "currentAge",
  "targetAge",
  "simulationCount",
  "historicalBlockLength",
] as const;

/** A Monte Carlo widget's plan as the report takes it: the meta's plan fields, without its name. */
export const monteCarloInput = (
  meta: MonteCarloMeta,
  options: { todaysMoney: boolean; captureRunDetail?: number | undefined },
): In<"monte_carlo_report"> =>
  ({
    ...Object.fromEntries(
      PLAN_KEYS.filter((key) => meta[key] !== undefined).map((key) => [key, meta[key]]),
    ),
    todaysMoney: options.todaysMoney,
    ...(options.captureRunDetail === undefined
      ? {}
      : { captureRunDetail: options.captureRunDetail }),
  }) as In<"monte_carlo_report">;

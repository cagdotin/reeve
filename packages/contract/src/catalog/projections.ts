/** Projections: the balance forecast and Monte Carlo dashboard widgets' reports. */
import { Schema } from "effect";
import { monteCarloPlanFields } from "./monte-carlo-plan.ts";
import { Amount, Day, Id } from "../domain.ts";
import { BookField, inBook, type Operation } from "../operation.ts";
import {
  ConditionsOp,
  MonthOrDay,
  ReportCondition,
  TimeFrameMode,
  filterFields,
  scopeField,
} from "./reports.ts";

// ---------------------------------------------------------------------------------------------
// Balance forecast
// ---------------------------------------------------------------------------------------------

export const ForecastGranularity = Schema.Literals(["Daily", "Monthly"]);

/** A line of a forecast comparison, as Actual's `ForecastSeries`. */
export const ForecastSeries = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  accounts: Schema.optionalKey(Schema.Array(Id)).annotate({
    description: "Account ids; every account (and schedules without one) by default",
  }),
  conditions: Schema.Array(ReportCondition),
  conditionsOp: ConditionsOp,
});
export type ForecastSeries = typeof ForecastSeries.Type;

const ChartPoint = Schema.Struct({
  /** A day for daily points, a month for monthly ones. */
  date: MonthOrDay,
  balance: Amount,
});

const ForecastContributor = Schema.Struct({
  scheduleId: Id,
  scheduleName: Schema.String,
  amount: Amount,
  count: Schema.Int,
  isTransfer: Schema.Boolean,
  isAccountless: Schema.Boolean,
});

export const BalanceForecastReport = Schema.Struct({
  start: MonthOrDay,
  end: MonthOrDay,
  granularity: ForecastGranularity,
  source: Schema.Literals(["schedules", "tracking-budget"]),
  lines: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      /** Empty for the single line of a widget without a comparison. */
      name: Schema.String,
      /** The key of the line's balance in `chartData`: `balance`, `series1`, `series2`… */
      dataKey: Schema.String,
      points: Schema.Array(ChartPoint),
      endingPoint: Schema.NullOr(ChartPoint),
      lowestPoint: Schema.NullOr(ChartPoint),
    }),
  ),
  /** One row per date, with each line's balance under its `dataKey`; a line without data is absent. */
  chartData: Schema.Array(
    Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number])),
  ),
  /** Where the first line crosses zero, as a percentage from the top of its range; null when it doesn't. */
  zeroCrossingOffset: Schema.NullOr(Schema.Number),
  hasNegativeBalance: Schema.Boolean,
  /** Scheduled occurrences in the range, each counted once. */
  scheduledOccurrences: Schema.Int,
  /** What drives a single-line schedules forecast; null for a comparison or a tracking budget. */
  contributors: Schema.NullOr(
    Schema.Struct({
      openingBalance: Amount,
      endingBalance: Amount,
      recordedNet: Amount,
      scheduledNet: Amount,
      inflows: Schema.Array(ForecastContributor),
      outflows: Schema.Array(ForecastContributor),
      internalTransferCount: Schema.Int,
    }),
  ),
  forecastStartDate: Day,
  forecastEndDate: Day,
});
export type BalanceForecastReport = typeof BalanceForecastReport.Type;

// ---------------------------------------------------------------------------------------------
// Monte Carlo
// ---------------------------------------------------------------------------------------------

export { monteCarloPlanFields } from "./monte-carlo-plan.ts";
const Band = Schema.Struct({
  year: Schema.Int,
  p5: Schema.Number,
  p10: Schema.Number,
  p25: Schema.Number,
  p30: Schema.Number,
  p50: Schema.Number,
  p70: Schema.Number,
  p75: Schema.Number,
  p90: Schema.Number,
});

export const MonteCarloReport = Schema.Struct({
  /** The plan as simulated: every default filled, linked pots at their account's balance. */
  config: Schema.Struct(monteCarloPlanFields),
  successRate: Schema.Number,
  percentileBands: Schema.Array(Band),
  depletionHistogram: Schema.Array(Schema.Struct({ year: Schema.Int, count: Schema.Int })),
  depletionProbabilityByYear: Schema.Array(Schema.Number),
  medianEndingBalance: Schema.Number,
  medianTotalWithdrawn: Schema.Number,
  medianDepletionYear: Schema.NullOr(Schema.Number),
  earliestDepletionYear: Schema.NullOr(Schema.Number),
  latestDepletionYear: Schema.NullOr(Schema.Number),
  worstRunPath: Schema.Array(Schema.Number),
  endingBalances: Schema.Array(Schema.Number),
  /** -1 for a simulation that lasted the whole horizon. */
  depletionYearBySimulation: Schema.Array(Schema.Int),
  totalWithdrawnBySimulation: Schema.Array(Schema.Number),
  /** Every simulation index, the worst outcome first. */
  rankedRuns: Schema.Array(Schema.Int),
  /** Year by year rows of the simulation `captureRunDetail` names. */
  runDetail: Schema.optionalKey(Schema.Array(Schema.Record(Schema.String, Schema.Unknown))),
  simulationCount: Schema.Int,
  horizonYears: Schema.Int,
});
export type MonteCarloReport = typeof MonteCarloReport.Type;

export const projections = {
  balance_forecast_report: {
    description:
      "Actual's balance forecast widget: the running balance of the chosen accounts (or the running total of the transactions the conditions match) from recorded transactions plus the schedules' coming ones, by day or month, for one line or a comparison of up to four, with the schedules that drive it. With source tracking-budget, a tracking budget's budgeted income and expenses month by month.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      start: Schema.optionalKey(MonthOrDay).annotate({ description: "This month by default" }),
      end: Schema.optionalKey(MonthOrDay).annotate({
        description: "Eleven months from now by default",
      }),
      mode: Schema.optionalKey(TimeFrameMode).annotate({
        description: "How the range moves with time; static by default",
      }),
      granularity: Schema.optionalKey(ForecastGranularity).annotate({
        description: "Monthly (default) or Daily points; a day-shaped range stays exact when daily",
      }),
      accounts: Schema.optionalKey(Schema.Array(Id)).annotate({
        description: "Account ids; every account, and schedules without one, by default",
      }),
      ...filterFields,
      source: Schema.optionalKey(Schema.Literals(["schedules", "tracking-budget"])),
      series: Schema.optionalKey(Schema.Array(ForecastSeries)).annotate({
        description:
          "Lines to compare, each with its own accounts and conditions (replacing accounts and conditions); up to four",
      }),
      ...scopeField,
    }),
    success: BalanceForecastReport,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/reports/balance-forecast" },
    cli: { command: ["reports", "balance-forecast"], description: "Forecast balances" },
  },
  monte_carlo_report: {
    description:
      "Actual's Monte Carlo retirement simulation: thousands of seeded runs of pots drawn down from currentAge to targetAge under random or historical returns, with spending phases, contributions, income streams, withdrawal rules, fees and tax. Takes a Monte Carlo widget's plan; a pot linked to an account starts at that account's balance. The same seed gives the same result.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      ...monteCarloPlanFields,
      seed: Schema.optionalKey(Schema.Int).annotate({ description: "1234 by default, as Actual" }),
      captureRunDetail: Schema.optionalKey(Schema.Int).annotate({
        description: "A simulation index whose year by year rows to return",
      }),
      todaysMoney: Schema.optionalKey(Schema.Boolean).annotate({
        description:
          "Show amounts in today's money, deflated by the plan's inflation; true by default",
      }),
    }),
    success: MonteCarloReport,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/reports/monte-carlo" },
    cli: { command: ["reports", "monte-carlo"], description: "Simulate retirement outcomes" },
  },
} satisfies Record<string, Operation>;

/**
 * Actual's balance forecast report: the schedules' forecast (`forecast_balances`) of one or more
 * lines, each its own accounts and filters, as chart points by day or month, with the schedules
 * that drive it. Actual builds the chart in the browser (`balanceForecastChartData.ts`,
 * `balanceForecastSeries.ts`, `shared/forecast-contributors.ts`); the same arithmetic runs here.
 */
import {
  addMonths,
  currentMonth,
  firstDay,
  intToDay,
  lastDay,
  monthOf,
} from "@reeve/contract/rules";
import type { AccountScope } from "@reeve/contract/catalog";
import { invalid, type Book } from "../book.ts";
import { forecastBalances, type ForecastFilters } from "../schedules/forecast.ts";
import { dayRange, resolveTimeFrame, type TimeFrameMode } from "./dates.ts";
import { scopeIds, transactionBounds, type Condition } from "./lines.ts";

export type Granularity = "Daily" | "Monthly";

export interface ChartDataPoint {
  readonly date: string;
  readonly balance: number;
}

export interface ForecastTransactionLike {
  readonly amount: number;
  readonly payee: string | null;
  readonly scheduleId: string;
  readonly scheduleName: string;
  readonly occurrenceDate?: string | undefined;
  readonly isTransfer?: boolean | undefined;
  readonly isAccountless?: boolean | undefined;
}

export interface ForecastDataPointLike {
  readonly date: string;
  readonly balance: number;
  readonly accountId: string;
  readonly accountName: string;
  readonly transactions: ReadonlyArray<ForecastTransactionLike>;
  readonly recordedAmount?: number | undefined;
}

export interface ForecastLike {
  readonly dataPoints: ReadonlyArray<ForecastDataPointLike>;
  readonly lowestBalance?: unknown;
  readonly forecastStartDate: string;
  readonly forecastEndDate: string;
}

export interface ForecastSeries {
  readonly id: string;
  readonly name: string;
  readonly accounts?: ReadonlyArray<string> | undefined;
  readonly conditions: ReadonlyArray<Condition>;
  readonly conditionsOp: "and" | "or";
}

export const MAX_FORECAST_SERIES = 4;

const isMonth = (value: string) => /^\d{4}-\d{2}$/.test(value);

/** Monthly points represent complete months; Daily keeps exact day bounds. */
export const getForecastRange = (start: string, end: string, granularity: Granularity) => ({
  startDate: granularity === "Daily" && !isMonth(start) ? start : firstDay(monthOf(start)),
  endDate: granularity === "Daily" && !isMonth(end) ? end : lastDay(monthOf(end)),
});

/** The latest balance of each account per key (a day or a month), summed over the accounts. */
const combinedBalanceBy = (forecast: ForecastLike, keyOf: (date: string) => string) => {
  const byKeyAndAccount = new Map<string, Map<string, number>>();
  for (const point of forecast.dataPoints) {
    const key = keyOf(point.date);
    const accounts = byKeyAndAccount.get(key) ?? new Map<string, number>();
    accounts.set(point.accountId, point.balance);
    byKeyAndAccount.set(key, accounts);
  }
  return new Map(
    [...byKeyAndAccount].map(([key, accounts]) => [
      key,
      [...accounts.values()].reduce((sum, balance) => sum + balance, 0),
    ]),
  );
};

export const buildBalanceForecastChartData = ({
  forecastData,
  start,
  end,
  granularity,
}: {
  forecastData: ForecastLike | null;
  start: string;
  end: string;
  granularity: Granularity;
}): Array<ChartDataPoint> => {
  if (forecastData === null || forecastData.dataPoints.length === 0) return [];
  if (granularity === "Daily") {
    const combined = combinedBalanceBy(forecastData, (date) => date);
    const { startDate, endDate } = getForecastRange(start, end, granularity);
    // Carry the balance from the last point before the range, so a day-shaped start doesn't begin at zero.
    const prior = [...combined.keys()]
      .filter((date) => date < startDate)
      .sort()
      .at(-1);
    let running = prior === undefined ? 0 : combined.get(prior)!;
    return dayRange(startDate, endDate).map((date) => {
      running = combined.get(date) ?? running;
      return { date, balance: running };
    });
  }
  const combined = combinedBalanceBy(forecastData, (date) => date.slice(0, 7));
  const result: Array<ChartDataPoint> = [];
  let running = 0;
  const endMonth = monthOf(end);
  for (let month = monthOf(start); month <= endMonth; month = addMonths(month, 1)) {
    running = combined.get(month) ?? running;
    result.push({ date: month, balance: running });
  }
  return result;
};

/** The scheduled occurrences the chart shows, each counted once whichever legs it has. */
export const countForecastScheduledOccurrences = ({
  forecastData,
  start,
  end,
  granularity,
}: {
  forecastData: ForecastLike | null | undefined;
  start: string;
  end: string;
  granularity: Granularity;
}): number => {
  if (!forecastData?.dataPoints.length) return 0;
  const { startDate, endDate } = getForecastRange(start, end, granularity);
  const keys = new Set<string>();
  for (const point of forecastData.dataPoints) {
    if (point.date < startDate || point.date > endDate) continue;
    for (const transaction of point.transactions)
      keys.add(`${transaction.occurrenceDate ?? point.date}:${transaction.scheduleId}`);
  }
  return keys.size;
};

/** Where a line crossing zero changes colour, as a percentage from the top; null when it doesn't. */
export const getZeroCrossingGradientOffset = (
  chartData: ReadonlyArray<ChartDataPoint>,
): number | null => {
  if (chartData.length === 0) return null;
  const balances = chartData.map((point) => point.balance);
  const min = Math.min(...balances);
  const max = Math.max(...balances);
  if (min >= 0 || max <= 0) return null;
  return (max / (max - min)) * 100;
};

export const getLowestChartDataPoint = (
  chartData: ReadonlyArray<ChartDataPoint>,
): ChartDataPoint | undefined =>
  chartData.reduce<ChartDataPoint | undefined>(
    (lowest, point) => (lowest === undefined || point.balance < lowest.balance ? point : lowest),
    undefined,
  );

export interface ForecastChartLine {
  readonly id: string;
  readonly name: string;
  readonly dataKey: string;
  readonly points: Array<ChartDataPoint>;
  readonly endingPoint: ChartDataPoint | undefined;
  readonly lowestPoint: ChartDataPoint | undefined;
}

export const buildForecastSeriesChart = ({
  forecasts,
  series,
  start,
  end,
  granularity,
}: {
  forecasts: ReadonlyArray<{ id: string; forecast: ForecastLike }> | undefined;
  series?: ReadonlyArray<Pick<ForecastSeries, "id" | "name">> | undefined;
  start: string;
  end: string;
  granularity: Granularity;
}) => {
  const lines: Array<ForecastChartLine> = (forecasts ?? []).map(({ id, forecast }, index) => {
    const points = buildBalanceForecastChartData({
      forecastData: forecast,
      start,
      end,
      granularity,
    });
    return {
      id,
      name: series?.find((line) => line.id === id)?.name ?? "",
      dataKey: index === 0 ? "balance" : `series${index}`,
      points,
      endingPoint: points.at(-1),
      lowestPoint: getLowestChartDataPoint(points),
    };
  });
  // Align by date, not position: an empty line stays absent instead of drawing zero.
  type Row = Record<string, string | number> & { date: string };
  const byDate = new Map<string, Row>();
  for (const line of lines)
    for (const point of line.points) {
      const row: Row = byDate.get(point.date) ?? { date: point.date };
      row[line.dataKey] = point.balance;
      byDate.set(point.date, row);
    }
  return {
    lines,
    chartData: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    balances: lines.flatMap((line) => line.points.map((point) => point.balance)),
  };
};

export interface ForecastContributor {
  scheduleId: string;
  scheduleName: string;
  amount: number;
  count: number;
  isTransfer: boolean;
  isAccountless: boolean;
}

export interface ForecastContributors {
  readonly openingBalance: number;
  readonly endingBalance: number;
  readonly recordedNet: number;
  readonly scheduledNet: number;
  readonly inflows: Array<ForecastContributor>;
  readonly outflows: Array<ForecastContributor>;
  readonly internalTransferCount: number;
}

/** What moves the balance over the days shown: recorded activity and each schedule, in cents. */
export const summarizeForecastContributors = (
  dataPoints: ReadonlyArray<ForecastDataPointLike>,
  startDate: string,
  endDate: string,
): ForecastContributors | null => {
  const points = dataPoints.filter((point) => point.date >= startDate && point.date <= endDate);
  // A tracking budget forecast has no recorded provenance.
  if (points.length === 0 || points.some((point) => point.recordedAmount === undefined))
    return null;
  const opening = new Map<string, { date: string; balance: number }>();
  const ending = new Map<string, ForecastDataPointLike>();
  const occurrences = new Map<string, ForecastContributor>();
  let recordedNet = 0;
  for (const point of points) {
    const recorded = point.recordedAmount ?? 0;
    recordedNet += recorded;
    const first = opening.get(point.accountId);
    if (first === undefined || point.date < first.date)
      opening.set(point.accountId, {
        date: point.date,
        balance:
          point.balance -
          recorded -
          point.transactions.reduce((sum, transaction) => sum + transaction.amount, 0),
      });
    const last = ending.get(point.accountId);
    if (last === undefined || point.date > last.date) ending.set(point.accountId, point);
    for (const transaction of point.transactions) {
      // Net transfer legs only after filtering, and count each occurrence once.
      const key = JSON.stringify([
        transaction.scheduleId,
        transaction.occurrenceDate ?? point.date,
      ]);
      const occurrence = occurrences.get(key);
      if (occurrence !== undefined) {
        occurrence.amount += transaction.amount;
        occurrence.isTransfer ||= transaction.isTransfer ?? false;
        occurrence.isAccountless ||= transaction.isAccountless ?? false;
      } else
        occurrences.set(key, {
          scheduleId: transaction.scheduleId,
          scheduleName: transaction.scheduleName,
          amount: transaction.amount,
          count: 1,
          isTransfer: transaction.isTransfer ?? false,
          isAccountless: transaction.isAccountless ?? false,
        });
    }
  }
  const groups = new Map<string, ForecastContributor>();
  let internalTransferCount = 0;
  for (const occurrence of occurrences.values()) {
    if (occurrence.amount === 0) {
      if (occurrence.isTransfer) internalTransferCount++;
      continue;
    }
    // A schedule may change direction after rules run; keep both sides.
    const key = JSON.stringify([occurrence.scheduleId, occurrence.amount > 0]);
    const group = groups.get(key);
    if (group !== undefined) {
      group.amount += occurrence.amount;
      group.count++;
      group.isTransfer ||= occurrence.isTransfer;
      group.isAccountless ||= occurrence.isAccountless;
    } else groups.set(key, { ...occurrence });
  }
  const contributors = [...groups.values()].sort(
    (a, b) =>
      Math.abs(b.amount) - Math.abs(a.amount) ||
      a.scheduleName.localeCompare(b.scheduleName) ||
      a.scheduleId.localeCompare(b.scheduleId),
  );
  return {
    openingBalance: [...opening.values()].reduce((sum, point) => sum + point.balance, 0),
    endingBalance: [...ending.values()].reduce((sum, point) => sum + point.balance, 0),
    recordedNet,
    scheduledNet: contributors.reduce((sum, contributor) => sum + contributor.amount, 0),
    inflows: contributors.filter((contributor) => contributor.amount > 0),
    outflows: contributors.filter((contributor) => contributor.amount < 0),
    internalTransferCount,
  };
};

export interface BalanceForecastInput extends ForecastFilters {
  readonly start?: string | undefined;
  readonly end?: string | undefined;
  readonly mode?: TimeFrameMode | undefined;
  readonly granularity?: Granularity | undefined;
  readonly accounts?: ReadonlyArray<string> | undefined;
  readonly source?: "schedules" | "tracking-budget" | undefined;
  readonly series?: ReadonlyArray<ForecastSeries> | undefined;
  readonly scope?: AccountScope | undefined;
}

/**
 * The widget's report: its time frame resolved (this month and the next eleven by default), one
 * forecast per line (the widget's own accounts and filters when it has no lines), and the chart.
 */
export const balanceForecastReport = (book: Book, input: BalanceForecastInput) => {
  const now = currentMonth();
  const { latest } = transactionBounds(book);
  const { start, end } = resolveTimeFrame(
    input.start ?? now,
    input.end ?? addMonths(now, 11),
    input.mode ?? "static",
    latest === null ? null : intToDay(latest),
  );
  const tracking = input.source === "tracking-budget";
  const granularity: Granularity = tracking ? "Monthly" : (input.granularity ?? "Monthly");
  const from = firstDay(monthOf(start));
  const to = lastDay(monthOf(end));
  const scoped = scopeIds(book, input.scope);
  if (tracking && scoped !== undefined)
    return invalid(
      "The tracking budget's forecast is budget-wide and cannot follow an account scope.",
    );
  const within = (accounts: ReadonlyArray<string> | undefined) =>
    scoped === undefined ? accounts : (accounts ?? scoped).filter((id) => scoped.includes(id));
  const series = tracking ? [] : (input.series ?? []).slice(0, MAX_FORECAST_SERIES);
  const requests =
    series.length === 0
      ? [
          {
            id: "balance",
            name: "",
            accounts: tracking ? undefined : within(input.accounts),
            conditions: tracking ? undefined : input.conditions,
            conditionsOp: tracking ? undefined : input.conditionsOp,
            includeAccountless: !tracking && input.accounts === undefined && scoped === undefined,
          },
        ]
      : series.map((line) => ({
          id: line.id,
          name: line.name,
          accounts: within(line.accounts),
          conditions: line.conditions,
          conditionsOp: line.conditionsOp,
          includeAccountless: line.accounts === undefined && scoped === undefined,
        }));
  const forecasts = requests.map((request) => ({
    id: request.id,
    forecast: forecastBalances(book, {
      from,
      to,
      source: tracking ? "tracking-budget" : "schedules",
      ...(request.accounts === undefined ? {} : { accounts: request.accounts }),
      ...(request.conditions === undefined ? {} : { conditions: request.conditions }),
      ...(request.conditionsOp === undefined ? {} : { conditionsOp: request.conditionsOp }),
      includeAccountless: request.includeAccountless,
    }),
  }));
  const chart = buildForecastSeriesChart({
    forecasts,
    series: requests.map((request, index) => ({
      id: request.id,
      name: request.name.trim() || `Line ${index + 1}`,
    })),
    start,
    end,
    granularity,
  });
  const main = forecasts[0]!.forecast;
  const points = chart.lines[0]?.points ?? [];
  const range = getForecastRange(start, end, granularity);
  return {
    start,
    end,
    granularity,
    source: tracking ? ("tracking-budget" as const) : ("schedules" as const),
    lines: chart.lines.map((line) => ({
      id: line.id,
      name: series.length === 0 ? "" : line.name,
      dataKey: line.dataKey,
      points: line.points,
      endingPoint: line.endingPoint ?? null,
      lowestPoint: line.lowestPoint ?? null,
    })),
    chartData: chart.chartData,
    zeroCrossingOffset: getZeroCrossingGradientOffset(points),
    hasNegativeBalance: chart.balances.some((balance) => balance < 0),
    scheduledOccurrences: countForecastScheduledOccurrences({
      forecastData: main,
      start,
      end,
      granularity,
    }),
    contributors:
      tracking || series.length > 0
        ? null
        : summarizeForecastContributors(main.dataPoints, range.startDate, range.endDate),
    forecastStartDate: main.forecastStartDate,
    forecastEndDate: main.forecastEndDate,
  };
};

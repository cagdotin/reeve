/**
 * Actual's `balanceForecastChartData.test.ts`, `balanceForecastSeries.test.ts` and
 * `shared/forecast-contributors.test.ts`, on the balance forecast report's chart arithmetic.
 */
import { describe, expect, it } from "vitest";
import {
  buildBalanceForecastChartData,
  buildForecastSeriesChart,
  countForecastScheduledOccurrences,
  getForecastRange,
  getLowestChartDataPoint,
  getZeroCrossingGradientOffset,
  summarizeForecastContributors,
  type ForecastDataPointLike as ForecastDataPoint,
  type ForecastLike as ForecastResult,
  type ForecastSeries,
  type ForecastTransactionLike as ForecastTransaction,
} from "../src/reports/balance-forecast.ts";

describe("buildBalanceForecastChartData", () => {
  it("combines balances across accounts for monthly data", () => {
    const chartData = buildBalanceForecastChartData({
      forecastData: {
        dataPoints: [
          {
            date: "2024-03-01",
            balance: 1000,
            accountId: "checking",
            accountName: "Checking",
            transactions: [],
          },
          {
            date: "2024-03-01",
            balance: 500,
            accountId: "savings",
            accountName: "Savings",
            transactions: [],
          },
          {
            date: "2024-04-01",
            balance: 900,
            accountId: "checking",
            accountName: "Checking",
            transactions: [],
          },
          {
            date: "2024-04-01",
            balance: 700,
            accountId: "savings",
            accountName: "Savings",
            transactions: [],
          },
        ],
        lowestBalance: {
          date: "2024-03-01",
          balance: 1500,
          accountId: "",
          accountName: "",
        },
        forecastStartDate: "2024-03-01",
        forecastEndDate: "2024-04-30",
      },
      start: "2024-03",
      end: "2024-04",
      granularity: "Monthly",
    });

    expect(chartData).toEqual([
      { date: "2024-03", balance: 1500 },
      { date: "2024-04", balance: 1600 },
    ]);
  });

  it("carries monthly balances through the full end month for daily data", () => {
    const chartData = buildBalanceForecastChartData({
      forecastData: {
        dataPoints: [
          {
            date: "2024-03-01",
            balance: 1000,
            accountId: "checking",
            accountName: "Checking",
            transactions: [],
          },
          {
            date: "2024-04-01",
            balance: 1200,
            accountId: "checking",
            accountName: "Checking",
            transactions: [],
          },
        ],
        lowestBalance: {
          date: "2024-03-01",
          balance: 1000,
          accountId: "",
          accountName: "",
        },
        forecastStartDate: "2024-03-01",
        forecastEndDate: "2024-04-30",
      },
      start: "2024-03",
      end: "2024-04",
      granularity: "Daily",
    });

    expect(chartData[0]).toEqual({ date: "2024-03-01", balance: 1000 });
    expect(chartData[30]).toEqual({ date: "2024-03-31", balance: 1000 });
    expect(chartData[31]).toEqual({ date: "2024-04-01", balance: 1200 });
    expect(chartData.at(-1)).toEqual({ date: "2024-04-30", balance: 1200 });
    expect(chartData).toHaveLength(61);
  });

  it("preserves exact day-shaped bounds for daily data instead of widening to full months", () => {
    const chartData = buildBalanceForecastChartData({
      forecastData: {
        dataPoints: [
          {
            date: "2024-03-10",
            balance: 1000,
            accountId: "checking",
            accountName: "Checking",
            transactions: [],
          },
          {
            date: "2024-03-20",
            balance: 900,
            accountId: "checking",
            accountName: "Checking",
            transactions: [],
          },
        ],
        lowestBalance: {
          date: "2024-03-20",
          balance: 900,
          accountId: "",
          accountName: "",
        },
        forecastStartDate: "2024-03-10",
        forecastEndDate: "2024-03-20",
      },
      start: "2024-03-10",
      end: "2024-03-20",
      granularity: "Daily",
    });

    expect(chartData[0]).toEqual({ date: "2024-03-10", balance: 1000 });
    expect(chartData.at(-1)).toEqual({ date: "2024-03-20", balance: 900 });
    expect(chartData).toHaveLength(11);
  });

  it("carries the balance forward from points before a day-shaped start", () => {
    const chartData = buildBalanceForecastChartData({
      forecastData: {
        dataPoints: [
          {
            date: "2024-03-01",
            balance: 1000,
            accountId: "checking",
            accountName: "Checking",
            transactions: [],
          },
          {
            date: "2024-03-15",
            balance: 800,
            accountId: "checking",
            accountName: "Checking",
            transactions: [],
          },
        ],
        lowestBalance: {
          date: "2024-03-15",
          balance: 800,
          accountId: "",
          accountName: "",
        },
        forecastStartDate: "2024-03-01",
        forecastEndDate: "2024-03-31",
      },
      start: "2024-03-10",
      end: "2024-03-20",
      granularity: "Daily",
    });

    expect(chartData[0]).toEqual({ date: "2024-03-10", balance: 1000 });
    expect(chartData.at(-1)).toEqual({ date: "2024-03-20", balance: 800 });
    expect(chartData).toHaveLength(11);
  });

  it("uses the latest same-day balance for each account", () => {
    const chartData = buildBalanceForecastChartData({
      forecastData: {
        dataPoints: [
          {
            date: "2024-03-01",
            balance: 1000,
            accountId: "checking",
            accountName: "Checking",
            transactions: [],
          },
          {
            date: "2024-03-01",
            balance: 850,
            accountId: "checking",
            accountName: "Checking",
            transactions: [],
          },
          {
            date: "2024-03-01",
            balance: 500,
            accountId: "savings",
            accountName: "Savings",
            transactions: [],
          },
        ],
        lowestBalance: {
          date: "2024-03-01",
          balance: 1350,
          accountId: "",
          accountName: "",
        },
        forecastStartDate: "2024-03-01",
        forecastEndDate: "2024-03-31",
      },
      start: "2024-03",
      end: "2024-03",
      granularity: "Daily",
    });

    expect(chartData[0]).toEqual({ date: "2024-03-01", balance: 1350 });
    expect(chartData.at(-1)).toEqual({ date: "2024-03-31", balance: 1350 });
  });

  it("uses the latest balance in each month for monthly data", () => {
    const chartData = buildBalanceForecastChartData({
      forecastData: {
        dataPoints: [
          {
            date: "2024-03-01",
            balance: 1000,
            accountId: "checking",
            accountName: "Checking",
            transactions: [],
          },
          {
            date: "2024-03-31",
            balance: 900,
            accountId: "checking",
            accountName: "Checking",
            transactions: [],
          },
          {
            date: "2024-04-01",
            balance: 950,
            accountId: "checking",
            accountName: "Checking",
            transactions: [],
          },
          {
            date: "2024-04-30",
            balance: 1100,
            accountId: "checking",
            accountName: "Checking",
            transactions: [],
          },
        ],
        lowestBalance: {
          date: "2024-03-31",
          balance: 900,
          accountId: "",
          accountName: "",
        },
        forecastStartDate: "2024-03-01",
        forecastEndDate: "2024-04-30",
      },
      start: "2024-03",
      end: "2024-04",
      granularity: "Monthly",
    });

    expect(chartData).toEqual([
      { date: "2024-03", balance: 900 },
      { date: "2024-04", balance: 1100 },
    ]);
  });
});

describe("countForecastScheduledOccurrences", () => {
  it("counts a transfer occurrence once even when rules move one account leg", () => {
    const forecastData = {
      dataPoints: [
        {
          date: "2024-03-20",
          balance: -250,
          accountId: "checking",
          accountName: "Checking",
          transactions: [
            {
              amount: -250,
              payee: "Transfer to savings",
              scheduleId: "schedule-transfer",
              scheduleName: "Transfer to savings",
              occurrenceDate: "2024-03-20",
            },
          ],
        },
        {
          date: "2024-03-21",
          balance: 250,
          accountId: "savings",
          accountName: "Savings",
          transactions: [
            {
              amount: 250,
              payee: "Transfer from checking",
              scheduleId: "schedule-transfer",
              scheduleName: "Transfer to savings",
              occurrenceDate: "2024-03-20",
            },
          ],
        },
        {
          date: "2024-04-20",
          balance: 0,
          accountId: "checking",
          accountName: "Checking",
          transactions: [
            {
              amount: -250,
              payee: "Transfer to savings",
              scheduleId: "schedule-transfer",
              scheduleName: "Transfer to savings",
            },
          ],
        },
      ],
      lowestBalance: {
        date: "2024-03-20",
        balance: 0,
        accountId: "",
        accountName: "",
      },
      forecastStartDate: "2024-03-01",
      forecastEndDate: "2024-04-30",
    };

    const count = countForecastScheduledOccurrences({
      forecastData,
      start: "2024-03",
      end: "2024-04",
      granularity: "Monthly",
    });

    expect(count).toBe(2);
  });

  it("ignores occurrences outside exact day-shaped bounds in daily mode", () => {
    const forecastData = {
      dataPoints: [
        {
          date: "2024-03-05",
          balance: 100,
          accountId: "checking",
          accountName: "Checking",
          transactions: [
            {
              amount: 100,
              payee: "Early",
              scheduleId: "schedule-early",
              scheduleName: "Early",
            },
          ],
        },
        {
          date: "2024-03-15",
          balance: 200,
          accountId: "checking",
          accountName: "Checking",
          transactions: [
            {
              amount: 100,
              payee: "In range",
              scheduleId: "schedule-in-range",
              scheduleName: "In range",
            },
          ],
        },
      ],
      lowestBalance: {
        date: "2024-03-05",
        balance: 100,
        accountId: "",
        accountName: "",
      },
      forecastStartDate: "2024-03-01",
      forecastEndDate: "2024-03-31",
    };

    expect(
      countForecastScheduledOccurrences({
        forecastData,
        start: "2024-03-10",
        end: "2024-03-20",
        granularity: "Daily",
      }),
    ).toBe(1);

    expect(
      countForecastScheduledOccurrences({
        forecastData,
        start: "2024-03-10",
        end: "2024-03-20",
        granularity: "Monthly",
      }),
    ).toBe(2);
  });
});

describe("getZeroCrossingGradientOffset", () => {
  it("returns the zero threshold offset when balances cross zero", () => {
    expect(
      getZeroCrossingGradientOffset([
        { date: "2024-03", balance: 100 },
        { date: "2024-04", balance: -100 },
      ]),
    ).toBe(50);
  });

  it("returns null when balances do not cross zero", () => {
    expect(
      getZeroCrossingGradientOffset([
        { date: "2024-03", balance: 100 },
        { date: "2024-04", balance: 50 },
      ]),
    ).toBeNull();
  });
});

describe("getLowestChartDataPoint", () => {
  it("returns the lowest visible chart point", () => {
    expect(
      getLowestChartDataPoint([
        { date: "2024-03", balance: 100 },
        { date: "2024-04", balance: -50 },
        { date: "2024-05", balance: 25 },
      ]),
    ).toEqual({ date: "2024-04", balance: -50 });
  });

  it("returns undefined for empty chart data", () => {
    expect(getLowestChartDataPoint([])).toBeUndefined();
  });
});

function forecast(points: Array<[string, number, string?]>): ForecastResult {
  return {
    dataPoints: points.map(([date, balance, accountId = "account"]) => ({
      date,
      balance,
      accountId,
      accountName: accountId,
      transactions: [],
    })),
    lowestBalance: {
      date: "2026-10-01",
      balance: 0,
      accountId: "",
      accountName: "",
    },
    forecastStartDate: "2026-10-01",
    forecastEndDate: "2026-11-30",
  };
}

const series: ForecastSeries[] = [
  { id: "checking", name: "Cash", conditions: [], conditionsOp: "and" },
  { id: "card", name: "Card", conditions: [], conditionsOp: "and" },
];

describe("buildForecastSeriesChart", () => {
  it("keeps signed balances independent and carries each line into the visible daily range", () => {
    const result = buildForecastSeriesChart({
      series,
      start: "2026-10-02",
      end: "2026-10-04",
      granularity: "Daily",
      forecasts: [
        {
          id: "checking",
          forecast: forecast([
            ["2026-10-01", 12000],
            ["2026-10-03", 8000],
          ]),
        },
        {
          id: "card",
          forecast: forecast([
            ["2026-10-01", -3000],
            ["2026-10-04", -5000],
          ]),
        },
      ],
    });
    expect(result.chartData).toEqual([
      { date: "2026-10-02", balance: 12000, series1: -3000 },
      { date: "2026-10-03", balance: 8000, series1: -3000 },
      { date: "2026-10-04", balance: 8000, series1: -5000 },
    ]);
    expect(result.lines.map((line) => line.lowestPoint)).toEqual([
      { date: "2026-10-03", balance: 8000 },
      { date: "2026-10-04", balance: -5000 },
    ]);
  });

  it("shows combined account results from the engine without summing overlapping lines", () => {
    const result = buildForecastSeriesChart({
      series,
      start: "2026-10",
      end: "2026-11",
      granularity: "Monthly",
      forecasts: [
        {
          id: "checking",
          forecast: forecast([
            ["2026-10-31", 10000],
            ["2026-11-30", 6000],
          ]),
        },
        {
          id: "card",
          forecast: forecast([
            ["2026-10-31", -4000],
            ["2026-11-30", 0],
          ]),
        },
        {
          id: "both",
          forecast: forecast([
            ["2026-10-31", 10000, "checking"],
            ["2026-10-31", -4000, "card"],
            ["2026-11-30", 6000, "checking"],
            ["2026-11-30", 0, "card"],
          ]),
        },
      ],
    });
    expect(result.chartData).toEqual([
      { date: "2026-10", balance: 10000, series1: -4000, series2: 6000 },
      { date: "2026-11", balance: 6000, series1: 0, series2: 6000 },
    ]);
  });

  it("retains empty lines as no data and identifies names by id, including duplicate names", () => {
    const result = buildForecastSeriesChart({
      series: series.map((line) => ({ ...line, name: "Same name" })),
      start: "2026-10",
      end: "2026-10",
      granularity: "Monthly",
      forecasts: [
        { id: "card", forecast: forecast([]) },
        { id: "checking", forecast: forecast([["2026-10-31", 10000]]) },
      ],
    });
    expect(result.lines.map((line) => [line.id, line.name, line.endingPoint])).toEqual([
      ["card", "Same name", undefined],
      ["checking", "Same name", { date: "2026-10", balance: 10000 }],
    ]);
    expect(result.chartData).toEqual([{ date: "2026-10", series1: 10000 }]);
    expect(result.balances).toEqual([10000]);
  });
});

function scheduled(
  scheduleId: string,
  amount: number,
  extra: Partial<ForecastTransaction> = {},
): ForecastTransaction {
  return {
    scheduleId,
    scheduleName: scheduleId,
    payee: null,
    amount,
    ...extra,
  };
}

function point(
  date: string,
  balance: number,
  transactions: ForecastTransaction[] = [],
  recordedAmount = 0,
  accountId = "checking",
): ForecastDataPoint {
  return {
    date,
    balance,
    accountId,
    accountName: accountId,
    transactions,
    recordedAmount,
  };
}

describe("forecast contributors", () => {
  it("ranks all schedules by their total impact and reconciles first-day activity", () => {
    const summary = summarizeForecastContributors(
      [
        point(
          "2024-03-01",
          130_000,
          [scheduled("salary", 50_000), scheduled("rent", -30_000)],
          10_000,
        ),
        point("2024-03-15", 144_000, [
          scheduled("salary", 50_000),
          scheduled("rent", -30_000),
          ...Array.from({ length: 6 }, (_, index) => scheduled(`bill-${index}`, -1_000)),
        ]),
        point("2024-03-31", 139_000, [], -5_000),
      ],
      "2024-03-01",
      "2024-03-31",
    );

    expect(summary).toMatchObject({
      openingBalance: 100_000,
      endingBalance: 139_000,
      recordedNet: 5_000,
      scheduledNet: 34_000,
    });
    expect(summary?.inflows).toMatchObject([{ scheduleId: "salary", amount: 100_000, count: 2 }]);
    expect(summary?.outflows).toHaveLength(7);
    expect(summary?.outflows[0]).toMatchObject({
      scheduleId: "rent",
      amount: -60_000,
      count: 2,
    });
  });

  it("nets transfer legs before ranking and counts each occurrence only once", () => {
    const points = [
      point("2024-03-01", -10_000, [scheduled("savings", -10_000, { isTransfer: true })]),
      point(
        "2024-03-01",
        10_000,
        [scheduled("savings", 10_000, { isTransfer: true })],
        0,
        "savings",
      ),
      point("2024-03-02", -20_000, [scheduled("savings", -10_000, { isTransfer: true })]),
      point(
        "2024-03-02",
        20_000,
        [scheduled("savings", 10_000, { isTransfer: true })],
        0,
        "savings",
      ),
    ];
    expect(summarizeForecastContributors(points, "2024-03-01", "2024-03-02")).toMatchObject({
      inflows: [],
      outflows: [],
      scheduledNet: 0,
      internalTransferCount: 2,
      endingBalance: 0,
    });
    // An account/payee filter can leave only one leg in the chart.
    expect(
      summarizeForecastContributors(
        points.filter((p) => p.accountId === "savings"),
        "2024-03-01",
        "2024-03-02",
      ),
    ).toMatchObject({
      inflows: [{ scheduleId: "savings", amount: 20_000, count: 2, isTransfer: true }],
      scheduledNet: 20_000,
      endingBalance: 20_000,
    });
  });

  it("nets the original occurrence when rules move transfer legs to different dates", () => {
    const points = [
      point("2024-03-01", -100, [
        scheduled("transfer", -100, {
          isTransfer: true,
          occurrenceDate: "2024-03-01",
        }),
      ]),
      point("2024-03-02", -100),
      point("2024-03-01", 0, [], 0, "savings"),
      point(
        "2024-03-02",
        100,
        [
          scheduled("transfer", 100, {
            isTransfer: true,
            occurrenceDate: "2024-03-01",
          }),
        ],
        0,
        "savings",
      ),
    ];
    expect(summarizeForecastContributors(points, "2024-03-01", "2024-03-02")).toMatchObject({
      inflows: [],
      outflows: [],
      scheduledNet: 0,
      internalTransferCount: 1,
      endingBalance: 0,
    });
    // Only the leg inside the selected date range contributes to its change.
    expect(summarizeForecastContributors(points, "2024-03-02", "2024-03-02")).toMatchObject({
      openingBalance: -100,
      scheduledNet: 100,
      endingBalance: 0,
      inflows: [{ scheduleId: "transfer", count: 1, amount: 100 }],
    });
  });

  it("keeps schedule identities and directions distinct, including accountless occurrences", () => {
    const summary = summarizeForecastContributors(
      [
        point("2024-03-01", 100, [
          scheduled("a", 100, { scheduleName: "Same name" }),
          scheduled("b", -100, { scheduleName: "Same name" }),
          scheduled("a", 100, {
            scheduleName: "Same name",
            isAccountless: true,
          }),
        ]),
        point("2024-03-02", 50, [scheduled("a", -50, { scheduleName: "Same name" })]),
      ],
      "2024-03-01",
      "2024-03-02",
    );
    expect(summary?.inflows).toMatchObject([
      { scheduleId: "a", amount: 200, count: 1, isAccountless: true },
    ]);
    expect(summary?.outflows).toMatchObject([
      { scheduleId: "b", amount: -100 },
      { scheduleId: "a", amount: -50 },
    ]);
    expect(summary?.scheduledNet).toBe(50);
  });

  it("uses exact daily boundaries and carries the balance before the selected start", () => {
    const summary = summarizeForecastContributors(
      [
        point("2024-03-31", 175, [scheduled("bill", -25)]),
        point("2024-03-01", 100, [scheduled("salary", 100)]),
        point("2024-03-20", 200, [], 50),
        point("2024-03-15", 150, [scheduled("salary", 50)]),
      ],
      "2024-03-15",
      "2024-03-20",
    );
    expect(summary).toMatchObject({
      openingBalance: 100,
      recordedNet: 50,
      scheduledNet: 50,
      endingBalance: 200,
      outflows: [],
    });
  });

  it("reconciles a historical range without attributing recorded transactions to schedules", () => {
    expect(
      summarizeForecastContributors(
        [point("2024-01-10", 300, [], -200)],
        "2024-01-01",
        "2024-01-31",
      ),
    ).toMatchObject({
      openingBalance: 500,
      recordedNet: -200,
      scheduledNet: 0,
      endingBalance: 300,
      inflows: [],
      outflows: [],
    });
  });

  it("does not invent provenance for empty or older forecast responses", () => {
    expect(summarizeForecastContributors([], "2024-03-01", "2024-03-31")).toBeNull();
    expect(
      summarizeForecastContributors(
        [
          {
            date: "2024-03-01",
            balance: 100,
            accountId: "a",
            accountName: "A",
            transactions: [],
          },
        ],
        "2024-03-01",
        "2024-03-31",
      ),
    ).toBeNull();
  });
});

describe("forecast range", () => {
  it("widens monthly bounds and preserves daily bounds, including leap days", () => {
    expect(getForecastRange("2024-02-10", "2024-02-20", "Monthly")).toEqual({
      startDate: "2024-02-01",
      endDate: "2024-02-29",
    });
    expect(getForecastRange("2024-02-10", "2024-02-20", "Daily")).toEqual({
      startDate: "2024-02-10",
      endDate: "2024-02-20",
    });
    expect(getForecastRange("2024-02", "2024-02", "Daily")).toEqual({
      startDate: "2024-02-01",
      endDate: "2024-02-29",
    });
  });
});

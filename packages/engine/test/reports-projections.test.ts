/** The balance forecast and Monte Carlo widgets' reports, through their operations, on 2024-03-10. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
let book: string;
let checking: string;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2024, 2, 10, 12));
  s = scratch();
  book = (await s.call("create_book", { name: "Test" })).id;
  checking = (await s.call("create_account", { book, name: "Checking", balance: 100_000 })).id;
});

afterEach(async () => {
  await s.dispose();
  vi.useRealTimers();
});

const schedule = (input: Record<string, unknown>) =>
  s.call("create_schedule", { book, account: checking, amountOp: "is", dateOp: "is", ...input });

describe("balance forecast report", () => {
  it("projects this month and the next eleven by month, with what drives it", async () => {
    const rent = await schedule({
      name: "Rent",
      amount: -40_000,
      date: "2024-03-15",
      frequency: "monthly",
    });
    const salary = await schedule({
      name: "Salary",
      amount: 50_000,
      date: "2024-04-01",
      frequency: "monthly",
    });
    const report = await s.call("balance_forecast_report", { book });
    expect(report).toMatchObject({ start: "2024-03", end: "2025-02", granularity: "Monthly" });
    expect(report.lines).toHaveLength(1);
    const points = report.lines[0].points;
    expect(points[0]).toEqual({ date: "2024-03", balance: 60_000 });
    expect(points[1]).toEqual({ date: "2024-04", balance: 70_000 });
    expect(report.lines[0].endingPoint).toEqual({ date: "2025-02", balance: 170_000 });
    expect(report.lines[0].lowestPoint).toEqual({ date: "2024-03", balance: 60_000 });
    expect(report.chartData[0]).toEqual({ date: "2024-03", balance: 60_000 });
    expect(report.scheduledOccurrences).toBe(23);
    expect(report.zeroCrossingOffset).toBeNull();
    expect(report.contributors).toMatchObject({
      openingBalance: 0,
      recordedNet: 100_000,
      scheduledNet: 70_000,
      endingBalance: 170_000,
      inflows: [{ scheduleId: salary.id, scheduleName: "Salary", amount: 550_000, count: 11 }],
      outflows: [{ scheduleId: rent.id, scheduleName: "Rent", amount: -480_000, count: 12 }],
    });
  });

  it("keeps a day-shaped range exact by day, and the chart crosses zero", async () => {
    await schedule({ amount: -150_000, date: "2024-03-20" });
    const report = await s.call("balance_forecast_report", {
      book,
      start: "2024-03-18",
      end: "2024-03-22",
      granularity: "Daily",
    });
    expect(report.lines[0].points).toEqual([
      { date: "2024-03-18", balance: 100_000 },
      { date: "2024-03-19", balance: 100_000 },
      { date: "2024-03-20", balance: -50_000 },
      { date: "2024-03-21", balance: -50_000 },
      { date: "2024-03-22", balance: -50_000 },
    ]);
    expect(report.hasNegativeBalance).toBe(true);
    expect(report.zeroCrossingOffset).toBeCloseTo((100_000 / 150_000) * 100);
  });

  it("compares lines, each with its own accounts, without adding them together", async () => {
    const savings = (await s.call("create_account", { book, name: "Savings", balance: 20_000 })).id;
    const report = await s.call("balance_forecast_report", {
      book,
      start: "2024-03",
      end: "2024-04",
      series: [
        { id: "a", name: "Cash", accounts: [checking], conditions: [], conditionsOp: "and" },
        { id: "b", name: " ", accounts: [savings], conditions: [], conditionsOp: "and" },
        {
          id: "c",
          name: "Both",
          accounts: [checking, savings],
          conditions: [],
          conditionsOp: "and",
        },
      ],
    });
    expect(report.lines.map((line: any) => [line.id, line.name, line.dataKey])).toEqual([
      ["a", "Cash", "balance"],
      ["b", "Line 2", "series1"],
      ["c", "Both", "series2"],
    ]);
    expect(report.chartData).toEqual([
      { date: "2024-03", balance: 100_000, series1: 20_000, series2: 120_000 },
      { date: "2024-04", balance: 100_000, series1: 20_000, series2: 120_000 },
    ]);
    expect(report.contributors).toBeNull();
  });

  it("forecasts a tracking budget month by month", async () => {
    await s.call("update_book", { book, budgetType: "tracking" });
    const report = await s.call("balance_forecast_report", {
      book,
      source: "tracking-budget",
      start: "2024-03",
      end: "2024-04",
      granularity: "Daily",
    });
    expect(report.granularity).toBe("Monthly");
    expect(report.lines[0].points).toEqual([
      { date: "2024-03", balance: 100_000 },
      { date: "2024-04", balance: 100_000 },
    ]);
    expect(report.contributors).toBeNull();
  });
});

const plan = {
  pots: [{ id: "pot-1", startingBalance: 50_000_000, allocationPreset: "equity-60" }],
  spendingPhases: [{ id: "phase-1", annualWithdrawal: 2_500_000 }],
  currentAge: 60,
  targetAge: 90,
  simulationCount: 1000,
};

describe("monte carlo report", () => {
  it("gives the same result for the same seed and another for another seed", async () => {
    const first = await s.call("monte_carlo_report", { book, ...plan, seed: 7 });
    const again = await s.call("monte_carlo_report", { book, ...plan, seed: 7 });
    const other = await s.call("monte_carlo_report", { book, ...plan, seed: 8 });
    expect(again).toEqual(first);
    expect(other.endingBalances).not.toEqual(first.endingBalances);
    expect(first.simulationCount).toBe(1000);
    expect(first.horizonYears).toBe(30);
    expect(first.endingBalances).toHaveLength(1000);
    expect(first.percentileBands).toHaveLength(31);
    expect(first.successRate).toBeGreaterThan(0);
    expect(first.successRate).toBeLessThanOrEqual(1);
    expect([...first.rankedRuns].sort((a: number, b: number) => a - b)).toEqual(
      Array.from({ length: 1000 }, (_, index) => index),
    );
    const worst = first.rankedRuns[0];
    expect(first.endingBalances[worst]).toBe(Math.min(...first.endingBalances));
  });

  it("fills the plan's defaults and starts a linked pot at its account's balance", async () => {
    const report = await s.call("monte_carlo_report", {
      book,
      pots: [{ id: "pot-1", accountId: checking, startingBalance: 1 }],
      simulationCount: 1000,
    });
    expect(report.config).toMatchObject({
      currentAge: 60,
      targetAge: 90,
      withdrawalStrategy: "proportional",
      returnModel: "normal",
      inflationMean: 0.025,
    });
    expect(report.config.pots[0]).toMatchObject({ id: "pot-1", startingBalance: 100_000 });
    expect(report.percentileBands[0].p50).toBe(100_000);
  });

  it("returns one run's years when asked, reproducing it from the seed", async () => {
    const report = await s.call("monte_carlo_report", { book, ...plan });
    const index = report.rankedRuns[500];
    const detail = await s.call("monte_carlo_report", { book, ...plan, captureRunDetail: index });
    expect(detail.endingBalances).toEqual(report.endingBalances);
    const funded = detail.runDetail.filter((row: any) => !row.afterDepletion);
    expect(funded.at(-1).endBalance).toBe(Math.round(report.endingBalances[index]));
    expect(report.runDetail).toBeUndefined();
  });
});

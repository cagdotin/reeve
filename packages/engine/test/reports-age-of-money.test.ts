/**
 * Actual's `age-of-money-spreadsheet.test.ts` on the engine's age of money functions, and its
 * transfer and off-budget scenarios through `age_of_money_report`. Actual's tests run on
 * 2017-01-01; here that day is passed as `today`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  calculateAgeOfMoney,
  calculateAverageAge,
  calculateGraphData,
  calculateTrend,
  classifyFlows,
  type Flow,
} from "../src/reports/age-of-money.ts";
import { scratch } from "./helpers.ts";

const today = "2017-01-01";

describe("calculateAgeOfMoney", () => {
  it("calculates age correctly with simple FIFO matching", () => {
    const result = calculateAgeOfMoney(
      [{ date: "2024-01-01", amount: 1000 }],
      [{ date: "2024-01-15", amount: -500 }],
    );
    expect(result.ages).toEqual([{ date: "2024-01-15", age: 14 }]);
    expect(result.insufficientData).toBe(false);
  });

  it("uses FIFO order - oldest income first", () => {
    const result = calculateAgeOfMoney(
      [
        { date: "2024-01-01", amount: 500 },
        { date: "2024-01-15", amount: 500 },
      ],
      [{ date: "2024-02-01", amount: -400 }],
    );
    expect(result.ages.map((each) => each.age)).toEqual([31]);
  });

  it("spans multiple income buckets for large expenses, aging from the last", () => {
    const result = calculateAgeOfMoney(
      [
        { date: "2024-01-01", amount: 200 },
        { date: "2024-01-15", amount: 300 },
      ],
      [{ date: "2024-02-01", amount: -400 }],
    );
    expect(result.ages.map((each) => each.age)).toEqual([17]);
  });

  it("handles multiple expenses consuming buckets sequentially", () => {
    const result = calculateAgeOfMoney(
      [{ date: "2024-01-01", amount: 1000 }],
      [
        { date: "2024-01-10", amount: -300 },
        { date: "2024-01-20", amount: -300 },
        { date: "2024-01-30", amount: -300 },
      ],
    );
    expect(result.ages.map((each) => each.age)).toEqual([9, 19, 29]);
    expect(result.insufficientData).toBe(false);
  });

  it("flags insufficient data when expenses exceed income", () => {
    const result = calculateAgeOfMoney(
      [{ date: "2024-01-01", amount: 100 }],
      [{ date: "2024-01-15", amount: -500 }],
    );
    expect(result.insufficientData).toBe(true);
  });

  it("returns no ages without income, or without expenses", () => {
    expect(calculateAgeOfMoney([], [{ date: "2024-01-15", amount: -500 }])).toEqual({
      ages: [],
      insufficientData: true,
    });
    expect(calculateAgeOfMoney([{ date: "2024-01-01", amount: 1000 }], [])).toEqual({
      ages: [],
      insufficientData: false,
    });
  });

  it("handles income and expenses on the same day (age = 0)", () => {
    const result = calculateAgeOfMoney(
      [{ date: "2024-01-15", amount: 1000 }],
      [{ date: "2024-01-15", amount: -500 }],
    );
    expect(result.ages[0]!.age).toBe(0);
  });

  it("sorts transactions by date regardless of input order", () => {
    const result = calculateAgeOfMoney(
      [
        { date: "2024-01-15", amount: 500 },
        { date: "2024-01-01", amount: 500 },
      ],
      [
        { date: "2024-02-15", amount: -200 },
        { date: "2024-02-01", amount: -200 },
      ],
    );
    expect(result.ages).toEqual([
      { date: "2024-02-01", age: 31 },
      { date: "2024-02-15", age: 45 },
    ]);
  });

  it("round-trip: money leaves to off-budget and returns later as younger money", () => {
    const result = calculateAgeOfMoney(
      [
        { date: "2024-01-01", amount: 3000 },
        { date: "2024-03-01", amount: 1000 },
      ],
      [
        { date: "2024-01-10", amount: -1000 },
        { date: "2024-03-15", amount: -2500 },
      ],
    );
    expect(result.ages).toEqual([
      { date: "2024-01-10", age: 9 },
      { date: "2024-03-15", age: 14 },
    ]);
    expect(result.insufficientData).toBe(false);
  });
});

describe("calculateAverageAge", () => {
  const ages = (values: Array<number>) =>
    values.map((age, i) => ({ date: `2024-01-${String(i + 1).padStart(2, "0")}`, age }));

  it("returns null for no ages", () => {
    expect(calculateAverageAge([])).toBeNull();
  });

  it("averages all, or the last N, rounded", () => {
    expect(calculateAverageAge(ages([10, 20, 30]), 10)).toBe(20);
    expect(calculateAverageAge(ages([5, 10, 15, 20, 25]), 3)).toBe(20);
    expect(calculateAverageAge(ages([10, 11]), 10)).toBe(11);
  });

  it("uses a default count of 10", () => {
    expect(calculateAverageAge(ages(Array.from({ length: 15 }, (_, i) => (i + 1) * 10)))).toBe(105);
  });
});

describe("calculateTrend", () => {
  const points = (values: Array<number>) => values.map((ageOfMoney) => ({ ageOfMoney }));

  it("is stable with fewer than two points or a change within two days", () => {
    expect(calculateTrend([])).toBe("stable");
    expect(calculateTrend(points([30]))).toBe("stable");
    expect(calculateTrend(points([30, 31]))).toBe("stable");
  });

  it("goes up or down past the threshold, on the last two points only", () => {
    expect(calculateTrend(points([20, 25]))).toBe("up");
    expect(calculateTrend(points([30, 25]))).toBe("down");
    expect(calculateTrend(points([10, 50, 30, 35]))).toBe("up");
  });
});

describe("classifyFlows", () => {
  it("counts every inflow, refunds too, as income and outflows as expenses", () => {
    const flows: Array<Flow & { id: string }> = [
      { id: "1", date: "2024-01-01", amount: 3000 },
      { id: "2", date: "2024-01-05", amount: -150 },
      { id: "3", date: "2024-01-10", amount: 25 },
      { id: "4", date: "2024-01-15", amount: 500 },
      { id: "5", date: "2024-01-20", amount: -1200 },
    ];
    const { income, expenses } = classifyFlows(flows);
    expect(income.map((flow) => flow.id)).toEqual(["1", "3", "4"]);
    expect(expenses.map((flow) => flow.id)).toEqual(["2", "5"]);
  });

  it("lets a refund add a lot without changing what the oldest income pays", () => {
    const { income, expenses } = classifyFlows([
      { date: "2024-01-01", amount: 1000 },
      { date: "2024-01-05", amount: 50 },
      { date: "2024-01-15", amount: -200 },
    ]);
    expect(calculateAgeOfMoney(income, expenses).ages).toEqual([{ date: "2024-01-15", age: 14 }]);
  });
});

describe("calculateGraphData", () => {
  it("keys daily points by day, so the same day of two years stays apart", () => {
    const data = calculateGraphData(
      [
        { date: "2015-03-15", age: 30 },
        { date: "2016-03-15", age: 45 },
      ],
      "2015-03",
      "2016-03",
      "daily",
      today,
    );
    expect(data.filter((point) => point.date.endsWith("-03-15"))).toEqual([
      { date: "2015-03-15", ageOfMoney: 30 },
      { date: "2016-03-15", ageOfMoney: 38 },
    ]);
    expect(new Set(data.map((point) => point.date)).size).toBe(data.length);
  });

  it("does not generate daily periods past today", () => {
    const data = calculateGraphData(
      [
        { date: "2016-12-15", age: 5 },
        { date: "2016-12-31", age: 10 },
        { date: "2017-01-01", age: 12 },
      ],
      "2016-12",
      "2017-01",
      "daily",
      today,
    );
    expect(data).toHaveLength(18);
    expect(data.at(-1)!.date).toBe("2017-01-01");
  });

  it("does not generate weekly periods past today", () => {
    const data = calculateGraphData(
      [
        { date: "2016-12-15", age: 5 },
        { date: "2017-01-01", age: 12 },
      ],
      "2016-12",
      "2017-02",
      "weekly",
      today,
    );
    expect(data.map((point) => point.date)).toEqual(["2016-12-12", "2016-12-19", "2016-12-26"]);
  });

  it("still includes the current month for monthly granularity", () => {
    const data = calculateGraphData(
      [
        { date: "2016-12-15", age: 8 },
        { date: "2017-01-01", age: 10 },
      ],
      "2016-12",
      "2017-01",
      "monthly",
      today,
    );
    expect(data).toEqual([
      { date: "2016-12", ageOfMoney: 8 },
      { date: "2017-01", ageOfMoney: 9 },
    ]);
  });
});

describe("age_of_money_report", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => {
    s = scratch();
  });
  afterEach(() => s.dispose());

  const setup = async () => {
    const book = (await s.call("create_book", { name: "Age" })).id as string;
    const groups = await s.call("list_categories", { book });
    const category = (name: string) =>
      groups.flatMap((g: any) => g.categories).find((c: any) => c.name === name).id as string;
    const checking = (await s.call("create_account", { book, name: "Checking" })).id as string;
    const savings = (await s.call("create_account", { book, name: "Savings" })).id as string;
    const card = (await s.call("create_account", { book, name: "Visa", type: "liability" }))
      .id as string;
    const brokerage = (await s.call("create_account", { book, name: "Brokerage", onBudget: false }))
      .id as string;
    const tx = (input: Record<string, unknown>) =>
      s.call("create_transaction", { book, account: checking, ...input });
    return {
      book,
      checking,
      savings,
      card,
      brokerage,
      tx,
      food: category("Food"),
      income: category("Income"),
    };
  };

  it("spends the oldest income first and averages the last ten outflows", async () => {
    const { book, tx, food, income } = await setup();
    await tx({ date: "2024-01-01", amount: 1000, category: income });
    await tx({ date: "2024-01-10", amount: -300, category: food });
    await tx({ date: "2024-01-20", amount: -300, category: food });
    await tx({ date: "2024-02-05", amount: -300, category: food });
    const report = await s.call("age_of_money_report", { book, start: "2024-01", end: "2024-03" });
    expect(report).toMatchObject({
      start: "2024-01-01",
      end: "2024-03-31",
      granularity: "monthly",
      // 9, 19 and 35 days.
      currentAge: 21,
      // March carries February's average.
      trend: "stable",
      insufficientData: false,
    });
    expect(report.points).toEqual([
      { date: "2024-01", ageOfMoney: 14 },
      { date: "2024-02", ageOfMoney: 21 },
      { date: "2024-03", ageOfMoney: 21 },
    ]);
    // The history before the range still fills the lots; only later outflows show.
    const later = await s.call("age_of_money_report", { book, start: "2024-02", end: "2024-02" });
    expect(later.points).toEqual([{ date: "2024-02", ageOfMoney: 35 }]);
  });

  it("counts a transfer to an off-budget account as spending, and from one as income", async () => {
    const { book, tx, food, income, brokerage } = await setup();
    await tx({ date: "2024-01-01", amount: 2000, category: income });
    await tx({ date: "2024-01-20", amount: -500, transferAccount: brokerage });
    await tx({ date: "2024-02-01", amount: -300, category: food });
    const spent = await s.call("age_of_money_report", { book, start: "2024-01", end: "2024-02" });
    expect(spent.currentAge).toBe(25);

    await tx({ date: "2024-02-10", amount: 2000, transferAccount: brokerage });
    await tx({ date: "2024-03-10", amount: -2500, category: food });
    const back = await s.call("age_of_money_report", { book, start: "2024-03", end: "2024-03" });
    // 1,200.00 left of January's lot, then 1,300.00 of the money back from the brokerage.
    expect(back.points).toEqual([{ date: "2024-03", ageOfMoney: 29 }]);
    expect(back.insufficientData).toBe(false);
  });

  it("leaves out transfers between budget accounts unless the account filter leaves one out", async () => {
    const { book, tx, income, card, savings, checking } = await setup();
    await tx({ date: "2024-01-01", amount: 1000, category: income });
    await tx({ date: "2024-01-11", amount: -400, transferAccount: card });
    const all = await s.call("age_of_money_report", { book, start: "2024-01", end: "2024-01" });
    expect(all.currentAge).toBeNull();

    // Seen from the checking account alone, the card payment is money leaving.
    const cash = await s.call("age_of_money_report", {
      book,
      start: "2024-01",
      end: "2024-01",
      conditions: [{ field: "account", op: "is", value: checking }],
    });
    expect(cash.currentAge).toBe(10);
    const notCard = await s.call("age_of_money_report", {
      book,
      start: "2024-01",
      end: "2024-01",
      conditions: [{ field: "account", op: "isNot", value: card }],
    });
    expect(notCard.currentAge).toBe(10);

    // Within the filtered accounts a transfer still nets out.
    await tx({ date: "2024-01-21", amount: -100, transferAccount: savings });
    const both = await s.call("age_of_money_report", {
      book,
      start: "2024-01",
      end: "2024-01",
      conditions: [{ field: "account", op: "oneOf", value: [checking, savings] }],
    });
    expect(both.points).toEqual([{ date: "2024-01", ageOfMoney: 10 }]);

    // An account condition without an inverse keeps the default.
    const matches = await s.call("age_of_money_report", {
      book,
      start: "2024-01",
      end: "2024-01",
      conditions: [{ field: "account", op: "matches", value: "Check.*" }],
    });
    expect(matches.currentAge).toBeNull();
  });

  it("counts opening balances as income and flags outflows no income covers", async () => {
    const book = (await s.call("create_book", { name: "Open" })).id as string;
    const checking = await s.call("create_account", {
      book,
      name: "Checking",
      balance: 50000,
      date: "2024-01-01",
    });
    await s.call("create_transaction", {
      book,
      account: checking.id,
      date: "2024-01-31",
      amount: -80000,
    });
    const report = await s.call("age_of_money_report", { book, start: "2024-01", end: "2024-01" });
    expect(report).toMatchObject({ currentAge: 30, insufficientData: true });
  });

  it("reports by week from Monday and by day", async () => {
    const { book, tx, food, income } = await setup();
    await tx({ date: "2024-01-01", amount: 1000, category: income });
    await tx({ date: "2024-01-10", amount: -100, category: food });
    await tx({ date: "2024-01-24", amount: -100, category: food });
    const weekly = await s.call("age_of_money_report", {
      book,
      start: "2024-01",
      end: "2024-01",
      granularity: "weekly",
    });
    expect(weekly.points).toEqual([
      { date: "2024-01-08", ageOfMoney: 9 },
      { date: "2024-01-15", ageOfMoney: 9 },
      { date: "2024-01-22", ageOfMoney: 16 },
      { date: "2024-01-29", ageOfMoney: 16 },
    ]);
    const daily = await s.call("age_of_money_report", {
      book,
      start: "2024-01",
      end: "2024-01",
      granularity: "daily",
    });
    expect(daily.points[0]).toEqual({ date: "2024-01-10", ageOfMoney: 9 });
    expect(daily.points.at(-1)).toEqual({ date: "2024-01-31", ageOfMoney: 16 });
  });
});

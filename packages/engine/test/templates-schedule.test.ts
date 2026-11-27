// Ported from Actual's schedule-template.test.ts. Actual mocks its database and AQL; here a fake
// schedule store answers the same queries, filtering a list of transactions as the database would.
// Today is 2017-01-01 unless a test says otherwise, as Actual pins it.
import { describe, expect, it } from "vitest";
import type { TemplateCategory, TemplateEnv } from "../src/templates/context.ts";
import {
  buildMonthlyOutflow,
  createScheduleList,
  runScheduleForecast,
  solveMonthlyContribution,
  type ScheduledTransaction,
  type ScheduleStore,
  type StoredSchedule,
  type TransactionQuery,
} from "../src/templates/schedule.ts";
import type { ScheduleTemplate } from "../src/templates/types.ts";

const defaultCategory: TemplateCategory = { id: "1", name: "Test Category", isIncome: false };

interface RuleSpec {
  readonly start: string;
  readonly amount: number;
  readonly frequency: "monthly" | "yearly" | "weekly" | "daily";
  readonly interval?: number;
  readonly actions?: ReadonlyArray<unknown>;
}

const scheduleOf = (
  id: string,
  name: string,
  spec: RuleSpec,
  options: { completed?: boolean; nextDate?: string | null } = {},
): StoredSchedule => ({
  id,
  name,
  completed: options.completed ?? false,
  nextDate: options.nextDate ?? null,
  conditions: [
    {
      op: "is",
      field: "date",
      value: {
        start: spec.start,
        interval: spec.interval ?? 1,
        frequency: spec.frequency,
        patterns: [],
        skipWeekend: false,
        weekendSolveMode: "before",
        endMode: "never",
        endOccurrences: 1,
        endDate: "2099-01-01",
      },
    },
    { op: "is", field: "amount", value: spec.amount },
  ],
  actions: spec.actions ?? [],
});

interface MockTransaction {
  readonly amount: number;
  readonly date: string;
  readonly schedule?: string | null;
  readonly category?: string | null;
}

interface Store extends ScheduleStore {
  readonly queries: Array<TransactionQuery>;
}

const storeOf = (
  find: (name: string | undefined) => StoredSchedule | undefined,
  transactions: ReadonlyArray<MockTransaction> = [],
): Store => {
  const queries: Array<TransactionQuery> = [];
  const rows: Array<ScheduledTransaction> = transactions.map((row) => ({
    amount: row.amount,
    date: row.date,
    schedule: row.schedule ?? null,
    category: row.category === undefined ? defaultCategory.id : row.category,
  }));
  return {
    queries,
    active: () => [],
    find: (ref) => find(ref.name),
    transactions: (query) => {
      queries.push(query);
      return rows.filter(
        (row) =>
          (query.category === undefined || row.category === query.category) &&
          (query.schedules === undefined ||
            (row.schedule !== null && query.schedules.includes(row.schedule))) &&
          (!query.unlinked || row.schedule === null) &&
          (query.after === undefined || row.date > query.after) &&
          (query.from === undefined || row.date >= query.from) &&
          (query.before === undefined || row.date < query.before),
      );
    },
  };
};

const single = (
  spec: RuleSpec,
  options: { completed?: boolean; nextDate?: string | null } = {},
  transactions: ReadonlyArray<MockTransaction> = [],
) => storeOf(() => scheduleOf("1", "Schedule", spec, options), transactions);

const byName = (specs: Record<string, RuleSpec>) => {
  const names = Object.keys(specs);
  return storeOf((name) => {
    const index = names.indexOf(name ?? "");
    return index < 0 ? undefined : scheduleOf(String(index + 1), name!, specs[name!]!);
  });
};

const envOf = (
  schedules: ScheduleStore,
  options: { today?: string; isTracking?: boolean } = {},
): TemplateEnv => ({
  isTracking: options.isTracking ?? false,
  hideFraction: false,
  today: options.today ?? "2017-01-01",
  value: () => 0,
  carryover: () => false,
  categories: () => [],
  categoryAverage: () => 0,
  schedules,
});

const template = (name: string, extra: Partial<ScheduleTemplate> = {}): ScheduleTemplate => ({
  type: "schedule",
  name,
  priority: 0,
  directive: "template",
  ...extra,
});

/** The date range of the first query of a kind, as Actual's tests read it off AQL. */
const rangeOf = (store: Store, kind: "posted" | "unlinked" | "linked") => {
  const query = store.queries.find((q) =>
    kind === "unlinked"
      ? q.unlinked
      : kind === "linked"
        ? q.schedules !== undefined && q.category === undefined
        : !q.unlinked && q.schedules === undefined,
  );
  return { $gte: query?.from, $lt: query?.before };
};

const minimumBalance = (start: number, contribution: number, outflow: ReadonlyArray<number>) => {
  let running = start;
  let min = Infinity;
  for (const amount of outflow) {
    running += contribution - amount;
    min = Math.min(min, running);
  }
  return min;
};

describe("createScheduleList", () => {
  it("includes dateConditions on each returned entry", () => {
    const env = envOf(single({ start: "2024-08-01", amount: -10000, frequency: "monthly" }));
    const { t } = createScheduleList(
      [template("Test Schedule")],
      "2024-08-01",
      defaultCategory,
      env,
    );
    expect(t[0]!.dateConditions).toBeDefined();
    expect((t[0]!.dateConditions.value as { frequency: string }).frequency).toBe("monthly");
  });
});

describe("buildMonthlyOutflow", () => {
  it("buckets each monthly schedule occurrence into its own month index", () => {
    const env = envOf(single({ start: "2024-01-15", amount: -10000, frequency: "monthly" }));
    const { t } = createScheduleList([template("Rent")], "2024-01-01", defaultCategory, env);
    const outflow = buildMonthlyOutflow(t, "2024-01-01", defaultCategory, env);
    expect(outflow).toHaveLength(60);
    expect(outflow[0]).toBe(10000);
    expect(outflow[1]).toBe(10000);
    expect(outflow[59]).toBe(10000);
  });

  it("adds an unlinked future-dated transaction only to its own month", () => {
    const env = envOf(
      single({ start: "2024-01-15", amount: -10000, frequency: "monthly" }, {}, [
        { amount: -5000, date: "2024-03-10" },
      ]),
    );
    const { t } = createScheduleList([template("Rent")], "2024-01-01", defaultCategory, env);
    const outflow = buildMonthlyOutflow(t, "2024-01-01", defaultCategory, env);
    expect(outflow[0]).toBe(10000);
    expect(outflow[2]).toBe(15000); // March: 10000 schedule + 5000 unlinked
    expect(outflow[3]).toBe(10000);
  });

  it("buckets a weekly schedule by its per-occurrence amount, not its monthly-aggregated target", () => {
    // 2024-01-01 is a Monday: 5 Mondays in January, 4 in February.
    const env = envOf(single({ start: "2024-01-01", amount: -1000, frequency: "weekly" }));
    const { t } = createScheduleList([template("Weekly Bill")], "2024-01-01", defaultCategory, env);
    expect(t[0]!.target).toBe(5000);
    expect(t[0]!.perOccurrenceAmount).toBe(1000);
    const outflow = buildMonthlyOutflow(t, "2024-01-01", defaultCategory, env);
    expect(outflow[0]).toBe(5000);
    expect(outflow[1]).toBe(4000);
  });
});

describe("buildMonthlyOutflow relative to today", () => {
  const rentTemplate = template("Rent");
  // A monthly $100 rent due on the 25th, with the schedule's stored next date.
  const rent = (nextDate: string | null, transactions: ReadonlyArray<MockTransaction> = []) =>
    single(
      { start: "2024-01-25", amount: -10000, frequency: "monthly" },
      { nextDate },
      transactions,
    );
  const outflowOf = (store: Store, month: string, today: string) => {
    const env = envOf(store, { today });
    const { t } = createScheduleList([rentTemplate], month, defaultCategory, env);
    return buildMonthlyOutflow(t, month, defaultCategory, env);
  };

  it("reads the stored next_date into storedNextDate", () => {
    const { t } = createScheduleList(
      [rentTemplate],
      "2024-11",
      defaultCategory,
      envOf(rent("2024-10-25")),
    );
    expect(t[0]!.storedNextDate).toBe("2024-10-25");
  });

  it("counts only future-dated unlinked transactions when re-running a past month", () => {
    const store = rent("2024-09-25");
    outflowOf(store, "2024-06", "2024-09-15");
    expect(rangeOf(store, "unlinked")).toEqual({ $gte: "2024-09-16", $lt: "2029-06-01" });
  });

  it("still counts unlinked spending already posted in the current month", () => {
    // Sep 15, budgeting September: a $40 purchase on Sep 5 plus the $100 rent due Sep 25.
    const store = rent("2024-09-25", [{ amount: -4000, date: "2024-09-05" }]);
    const result = runScheduleForecast(
      [rentTemplate],
      "2024-09",
      0,
      0,
      defaultCategory,
      envOf(store, { today: "2024-09-15" }),
    );
    expect(rangeOf(store, "posted")).toEqual({ $gte: "2024-09-01", $lt: "2024-09-16" });
    expect(rangeOf(store, "unlinked")).toEqual({ $gte: "2024-09-16", $lt: "2029-09-01" });
    expect(result.toBudget).toBe(14000);
  });

  it("does not double-count a hand-entered, unlinked payment of a bill already due this month", () => {
    const store = rent("2024-09-25", [{ amount: -10000, date: "2024-09-25" }]);
    const result = runScheduleForecast(
      [rentTemplate],
      "2024-09",
      0,
      0,
      defaultCategory,
      envOf(store, { today: "2024-09-26" }),
    );
    expect(result.toBudget).toBe(10000);
  });

  it("does not double-count a linked payment made before its due date this month", () => {
    const store = rent("2024-09-25", [{ amount: -10000, date: "2024-09-20", schedule: "1" }]);
    expect(outflowOf(store, "2024-09", "2024-09-21")[0]).toBe(10000);
  });

  it("attributes a late linked payment to last month's occurrence, not this month's", () => {
    const store = rent("2024-09-25", [{ amount: -10000, date: "2024-09-02", schedule: "1" }]);
    expect(outflowOf(store, "2024-09", "2024-09-15")[0]).toBe(20000);
  });

  it.each([
    ["rent posted unlinked", [-10000], 10000],
    ["rent plus a $40 unlinked extra", [-10000, -4000], 14000],
    ["rent that came in at $105", [-10500], 10500],
    ["rent that came in at $95", [-9500], 10000],
  ])(
    "re-running a past month counts the larger of scheduled and actual spending: %s",
    (_label, amounts, expected) => {
      const store = rent(
        "2024-09-25",
        amounts.map((amount) => ({ amount, date: "2024-06-25" })),
      );
      const outflow = outflowOf(store, "2024-06", "2024-09-15");
      expect(rangeOf(store, "posted")).toEqual({ $gte: "2024-06-01", $lt: "2024-07-01" });
      expect(outflow[0]).toBe(expected);
      expect(outflow[1]).toBe(10000);
    },
  );

  it("starts the unlinked-transaction window at the budget month when budgeting ahead", () => {
    const store = rent("2024-11-25");
    outflowOf(store, "2024-11", "2024-10-20");
    expect(rangeOf(store, "unlinked")).toEqual({ $gte: "2024-11-01", $lt: "2029-11-01" });
  });

  it("counts an unpaid occurrence due before the budget month against month 0", () => {
    const outflow = outflowOf(rent("2024-10-25"), "2024-11", "2024-10-20");
    expect(outflow[0]).toBe(20000);
    expect(outflow[1]).toBe(10000);
  });

  it("settles a pending occurrence with a linked payment made before its due date", () => {
    const store = rent("2024-10-25", [{ amount: -10000, date: "2024-10-20", schedule: "1" }]);
    const outflow = outflowOf(store, "2024-11", "2024-10-21");
    expect(rangeOf(store, "linked")).toEqual({ $gte: "2022-10-01", $lt: "2024-11-01" });
    expect(outflow[0]).toBe(10000);
  });

  it("does not settle a pending occurrence with an unlinked payment", () => {
    const store = rent("2024-10-25", [{ amount: -10000, date: "2024-10-20" }]);
    expect(outflowOf(store, "2024-11", "2024-10-21")[0]).toBe(20000);
  });

  it("does not settle a pending occurrence with a late payment of last month's", () => {
    const store = rent("2024-10-25", [{ amount: -10000, date: "2024-10-03", schedule: "1" }]);
    expect(outflowOf(store, "2024-11", "2024-10-20")[0]).toBe(20000);
  });

  it("adds nothing extra once the prior occurrence has posted", () => {
    expect(outflowOf(rent("2024-11-25"), "2024-11", "2024-10-26")[0]).toBe(10000);
  });

  it("ignores occurrences missed before the real current month", () => {
    expect(outflowOf(rent("2024-06-25"), "2024-11", "2024-10-20")[0]).toBe(20000);
  });

  it("does not settle a pending quarterly occurrence with a late payment of the previous quarter's", () => {
    const store = single(
      { start: "2024-01-28", amount: -30000, frequency: "monthly", interval: 3 },
      { nextDate: "2024-04-28" },
      [{ amount: -30000, date: "2024-03-12", schedule: "1" }],
    );
    expect(outflowOf(store, "2024-07", "2024-04-20")[0]).toBe(60000);
  });

  it("settles a pending occurrence only once when it was paid in parts", () => {
    const store = single(
      { start: "2024-09-28", amount: -10000, frequency: "weekly", interval: 2 },
      { nextDate: "2024-10-12" },
      [
        { amount: -5000, date: "2024-10-09", schedule: "1" },
        { amount: -5000, date: "2024-10-10", schedule: "1" },
      ],
    );
    // Oct 26 pending + Nov 9 + Nov 23
    expect(outflowOf(store, "2024-11", "2024-10-10")[0]).toBe(30000);
  });

  it("budgets November in full when October rent is still unpaid", () => {
    const result = runScheduleForecast(
      [rentTemplate],
      "2024-11",
      10000,
      0,
      defaultCategory,
      envOf(rent("2024-10-25"), { today: "2024-10-20" }),
    );
    expect(result.toBudget).toBe(10000);
  });
});

describe("runScheduleForecast", () => {
  it("contributes the exact monthly amount for a single monthly schedule", () => {
    const env = envOf(single({ start: "2024-01-15", amount: -10000, frequency: "monthly" }));
    expect(
      runScheduleForecast([template("Rent")], "2024-01-01", 0, 0, defaultCategory, env).toBudget,
    ).toBe(10000);
  });

  it("never projects a negative month-end balance across two schedules sharing a category", () => {
    const lines = [template("Monthly"), template("Yearly")];
    const env = envOf(
      byName({
        Monthly: { start: "2024-01-15", amount: -10000, frequency: "monthly" },
        Yearly: { start: "2024-12-15", amount: -60000, frequency: "yearly" },
      }),
    );
    const result = runScheduleForecast(lines, "2024-01-01", 0, 0, defaultCategory, env);
    const { t } = createScheduleList(lines, "2024-01-01", defaultCategory, env);
    const outflow = buildMonthlyOutflow(t, "2024-01-01", defaultCategory, env);
    expect(minimumBalance(0, result.toBudget, outflow)).toBeGreaterThanOrEqual(0);
    // And it is the least such contribution: one cent less goes negative somewhere.
    expect(minimumBalance(0, result.toBudget - 1, outflow)).toBeLessThan(0);
  });

  it("covers a same-month-due schedule in full immediately rather than smoothing it away", () => {
    const env = envOf(single({ start: "2024-01-15", amount: -60000, frequency: "yearly" }));
    expect(
      runScheduleForecast([template("DueNow")], "2024-01-01", 0, 0, defaultCategory, env).toBudget,
    ).toBe(60000);
  });

  it("budgets full-flag schedules on top of, and separate from, the forecast", () => {
    const lines = [template("Full", { full: true }), template("Smooth")];
    const env = envOf(
      byName({
        Full: { start: "2024-12-15", amount: -60000, frequency: "yearly" },
        Smooth: { start: "2024-01-15", amount: -10000, frequency: "monthly" },
      }),
    );
    const result = runScheduleForecast(lines, "2024-01-01", 0, 0, defaultCategory, env);
    expect(result.toBudget).toBe(10000);
    expect(result.perScheduleMonthly.get(lines[1]!)).toBe(10000);
  });

  it("does not fund a full-flag bill due this month twice", () => {
    const lines = [template("Full", { full: true }), template("Smooth")];
    const env = envOf(
      byName({
        Full: { start: "2024-01-20", amount: -60000, frequency: "yearly" },
        Smooth: { start: "2024-01-15", amount: -10000, frequency: "monthly" },
      }),
    );
    expect(runScheduleForecast(lines, "2024-01-01", 0, 0, defaultCategory, env).toBudget).toBe(
      70000,
    );
  });

  it("splits perScheduleMonthly by monthly-equivalent contribution, not raw target, for a monthly + yearly mix", () => {
    const lines = [template("Monthly"), template("Yearly")];
    const env = envOf(
      byName({
        Monthly: { start: "2024-01-15", amount: -10000, frequency: "monthly" },
        Yearly: { start: "2024-12-15", amount: -60000, frequency: "yearly" },
      }),
    );
    const result = runScheduleForecast(lines, "2024-01-01", 0, 0, defaultCategory, env);
    const monthlyShare = result.perScheduleMonthly.get(lines[0]!)!;
    const yearlyShare = result.perScheduleMonthly.get(lines[1]!)!;
    expect(monthlyShare / yearlyShare).toBeCloseTo(2, 1);
    expect(monthlyShare + yearlyShare).toBeGreaterThanOrEqual(result.toBudget - 1);
    expect(monthlyShare + yearlyShare).toBeLessThanOrEqual(result.toBudget + 1);
  });

  it("never produces a non-finite perScheduleMonthly share when smooth schedules in one category offset to a zero net weight", () => {
    const lines = [template("Expense"), template("Refund")];
    const env = envOf(
      byName({
        Expense: { start: "2024-01-15", amount: -10000, frequency: "monthly" },
        Refund: { start: "2024-01-15", amount: 120000, frequency: "yearly" },
      }),
    );
    const result = runScheduleForecast(lines, "2024-01-01", 0, 0, defaultCategory, env);
    expect(result.perScheduleMonthly.size).toBe(2);
    for (const share of result.perScheduleMonthly.values())
      expect(Number.isFinite(share)).toBe(true);
  });

  it("never underfunds two annual schedules with different due dates, sharing a category (regression: actualbudget/actual#6513)", () => {
    const lines = [template("Bill A"), template("Bill B")];
    const env = envOf(
      byName({
        "Bill A": { start: "2025-02-15", amount: -10000, frequency: "yearly" },
        "Bill B": { start: "2025-03-15", amount: -9000, frequency: "yearly" },
      }),
    );
    const result = runScheduleForecast(lines, "2025-01-01", 8000, 0, defaultCategory, env);
    const { t } = createScheduleList(lines, "2025-01-01", defaultCategory, env);
    const outflow = buildMonthlyOutflow(t, "2025-01-01", defaultCategory, env);
    expect(minimumBalance(8000, result.toBudget, outflow)).toBeGreaterThanOrEqual(0);
  });
});

describe("runScheduleForecast budgeting rules", () => {
  const bill = template("Bill");
  const forecast = (
    spec: RuleSpec,
    month: string,
    balance: number,
    options: { completed?: boolean; isTracking?: boolean; line?: ScheduleTemplate } = {},
  ) =>
    runScheduleForecast(
      [options.line ?? bill],
      month,
      balance,
      0,
      defaultCategory,
      envOf(single(spec, { completed: options.completed ?? false }), {
        isTracking: options.isTracking ?? false,
      }),
    ).toBudget;

  it("applies a percent adjustment to the schedule amount", () => {
    expect(
      forecast({ start: "2024-08-15", amount: -10000, frequency: "monthly" }, "2024-08-01", 0, {
        line: template("Bill", { adjustment: 10, adjustmentType: "percent" }),
      }),
    ).toBe(11000);
  });

  it("applies a fixed adjustment to the schedule amount", () => {
    expect(
      forecast({ start: "2024-08-15", amount: -10000, frequency: "monthly" }, "2024-08-01", 0, {
        line: template("Bill", { adjustment: 5, adjustmentType: "fixed" }),
      }),
    ).toBe(10500);
  });

  it("budgets nothing for a completed schedule with no payments", () => {
    expect(
      forecast({ start: "2024-08-15", amount: -10000, frequency: "monthly" }, "2024-08-01", 0, {
        completed: true,
      }),
    ).toBe(0);
  });

  it("keeps meeting the deadline for a schedule repeating every 360 days", () => {
    expect(
      forecast(
        { start: "2026-05-15", amount: -50000, frequency: "daily", interval: 360 },
        "2026-02-01",
        10000,
      ),
    ).toBe(10000);
  });

  it("budgets nothing while the category holds more than its bills need", () => {
    expect(
      forecast({ start: "2024-03-15", amount: -120000, frequency: "yearly" }, "2024-01-01", 500000),
    ).toBe(0);
  });

  it("never takes money back out of the category", () => {
    expect(
      forecast(
        { start: "2024-03-15", amount: -120000, frequency: "yearly" },
        "2024-01-01",
        10000000,
      ),
    ).toBe(0);
  });

  describe("in a tracking budget", () => {
    it("budgets nothing ahead for a bill due in a later month", () => {
      expect(
        forecast({ start: "2024-12-15", amount: -12000, frequency: "yearly" }, "2024-01-01", 0, {
          isTracking: true,
        }),
      ).toBe(0);
    });

    it("budgets a bill in full in the month it is due", () => {
      expect(
        forecast({ start: "2024-12-15", amount: -12000, frequency: "yearly" }, "2024-12-01", 0, {
          isTracking: true,
        }),
      ).toBe(12000);
    });
  });
});

describe("runScheduleForecast with a month-shaped month", () => {
  it("folds a weekly schedule and an unlinked transaction into the forecast", () => {
    const lines = [template("Weekly Bill")];
    const env = envOf(
      single({ start: "2024-01-01", amount: -1000, frequency: "weekly" }, {}, [
        { amount: -500, date: "2024-01-20" },
      ]),
    );
    const result = runScheduleForecast(lines, "2024-01", 0, 0, defaultCategory, env);
    const { t } = createScheduleList(lines, "2024-01", defaultCategory, env);
    const outflow = buildMonthlyOutflow(t, "2024-01", defaultCategory, env);
    // 5 Mondays in January 2024 x $10 + the $5 unlinked transaction.
    expect(outflow[0]).toBe(5000 + 500);
    expect(minimumBalance(0, result.toBudget, outflow)).toBeGreaterThanOrEqual(0);
  });
});

describe("solveMonthlyContribution", () => {
  it("finds the minimal whole-cent contribution for a single one-time bill", () => {
    const outflow = Array.from({ length: 60 }, (_, i) => (i === 30 ? 60000 : 0));
    const candidate = solveMonthlyContribution(0, outflow, 0);
    expect(candidate * 31).toBeGreaterThanOrEqual(60000);
    expect((candidate - 1) * 31).toBeLessThan(60000);
  });

  it("picks the month with the larger cumulative threshold, not the one with the larger raw balance", () => {
    const outflow = Array.from({ length: 60 }, () => 0);
    outflow[0] = 100;
    outflow[59] = 8940 - 100;
    const candidate = solveMonthlyContribution(0, outflow, 0);
    expect(candidate).toBe(149);
    expect(minimumBalance(0, candidate, outflow)).toBeGreaterThanOrEqual(0);
  });

  // $1,200 due each March and $600 each September, starting in January.
  const yearlyBillsOutflow = (startMonth: number) =>
    Array.from({ length: 60 }, (_, i) => {
      const monthOfYear = (startMonth + i) % 12;
      if (monthOfYear === 2) return 120000;
      if (monthOfYear === 8) return 60000;
      return 0;
    });

  it("budgets the steady rate once a category holds exactly what its bills need", () => {
    expect(solveMonthlyContribution(75000, yearlyBillsOutflow(0), 15000)).toBe(15000);
  });

  it("budgets nothing while the category holds more than its bills need", () => {
    expect(solveMonthlyContribution(500000, yearlyBillsOutflow(0), 15000)).toBe(0);
  });

  it("covers only what a small surplus does not", () => {
    expect(solveMonthlyContribution(80000, yearlyBillsOutflow(0), 15000)).toBe(10000);
  });

  it("never asks for less than nothing", () => {
    expect(solveMonthlyContribution(10000000, yearlyBillsOutflow(0), 15000)).toBe(0);
  });

  it("uses up a surplus, then settles at the steady rate without going negative", () => {
    let balance = 500000;
    const contributions: Array<number> = [];
    for (let month = 0; month < 72; month++) {
      const outflow = yearlyBillsOutflow(month);
      const contribution = solveMonthlyContribution(balance, outflow, 15000);
      contributions.push(contribution);
      balance += contribution - outflow[0]!;
      expect(balance).toBeGreaterThanOrEqual(0);
    }
    const firstPaid = contributions.findIndex((amount) => amount > 0);
    expect(firstPaid).toBeGreaterThan(24);
    expect(contributions.slice(0, firstPaid).every((amount) => amount === 0)).toBe(true);
    expect(contributions.slice(firstPaid + 1).every((amount) => amount === 15000)).toBe(true);
  });

  it("catches up faster than the steady rate when the category is short", () => {
    expect(solveMonthlyContribution(0, yearlyBillsOutflow(0), 15000)).toBe(40000);
  });

  it("spreads the catch-up evenly up to the first bill when bills start a few months out", () => {
    const outflowFrom = (month: number) =>
      Array.from({ length: 60 }, (_, i) => (month + i >= 2 ? 19000 : 0));
    let balance = 0;
    const contributions: Array<number> = [];
    for (let month = 0; month < 6; month++) {
      const outflow = outflowFrom(month);
      const contribution = solveMonthlyContribution(balance, outflow, 19000);
      contributions.push(contribution);
      balance += contribution - outflow[0]!;
      expect(balance).toBeGreaterThanOrEqual(0);
    }
    expect(contributions).toEqual([6334, 6333, 6333, 19000, 19000, 19000]);
  });
});

describe("runScheduleForecast on reviewer budgets", () => {
  it("saves up evenly for monthly bills that start a few months out", () => {
    const env = envOf(
      byName({
        "Bill A": { start: "2026-10-22", amount: -10000, frequency: "monthly" },
        "Bill B": { start: "2026-10-22", amount: -9000, frequency: "monthly" },
      }),
    );
    expect(
      runScheduleForecast(
        [template("Bill A"), template("Bill B")],
        "2026-08",
        0,
        0,
        defaultCategory,
        env,
      ).toBudget,
    ).toBe(6334);
  });

  it("gives the catch-up to the schedules that are behind, not a monthly bill that is on pace", () => {
    const lines = [template("Monthly"), template("Yearly 1"), template("Yearly 2")];
    const env = envOf(
      byName({
        Monthly: { start: "2026-10-01", amount: -100000, frequency: "monthly" },
        "Yearly 1": { start: "2027-02-01", amount: -500000, frequency: "yearly" },
        "Yearly 2": { start: "2027-04-01", amount: -500000, frequency: "yearly" },
      }),
    );
    const result = runScheduleForecast(lines, "2026-10", 0, 0, defaultCategory, env);
    expect(result.toBudget).toBe(242858);
    expect(result.perScheduleMonthly.get(lines[0]!)).toBe(100000);
    expect(result.perScheduleMonthly.get(lines[1]!)).toBe(71429);
    expect(result.perScheduleMonthly.get(lines[2]!)).toBe(71429);
  });
});

describe("runScheduleForecast with split rules", () => {
  it("should only budget the splits explicitly assigned to the category", () => {
    const env = envOf(
      single({
        start: "2024-08-01",
        amount: -10000,
        frequency: "monthly",
        actions: [
          {
            op: "set-split-amount",
            value: -3000,
            options: { method: "fixed-amount", splitIndex: 1 },
          },
          { op: "set", field: "category", value: defaultCategory.id, options: { splitIndex: 1 } },
          { op: "set-split-amount", value: null, options: { method: "remainder", splitIndex: 2 } },
          { op: "set", field: "payee", value: "other-payee", options: { splitIndex: 2 } },
        ],
      }),
    );
    expect(
      runScheduleForecast([template("Test Schedule")], "2024-08-01", 0, 0, defaultCategory, env)
        .toBudget,
    ).toBe(3000);
  });

  it("reads reeve's own split action shape", () => {
    const env = envOf(
      single({
        start: "2024-08-01",
        amount: -10000,
        frequency: "monthly",
        actions: [
          { op: "set-split-amount", splitIndex: 1, method: "fixed-percent", value: 25 },
          { op: "set", field: "category", value: defaultCategory.id, splitIndex: 1 },
          { op: "set-split-amount", splitIndex: 2, method: "remainder" },
        ],
      }),
    );
    expect(
      runScheduleForecast([template("Test Schedule")], "2024-08-01", 0, 0, defaultCategory, env)
        .toBudget,
    ).toBe(2500);
  });
});

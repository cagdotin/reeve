// Ported from Actual's validateAutomation.test.ts (budget/goals), plus the editor's kinds and the
// plain-language sentences.
import { describe, expect, it } from "vitest";
import {
  conflictsOf,
  defaultTarget,
  describeLeftover,
  describeTarget,
  kindOf,
  TARGET_KINDS,
  targetProblems,
  validateCategoryRules,
  validatePercentageAllocation,
  validateSchedulePriorities,
  validateTarget,
  type PercentageTarget,
  type Target,
  type ValidationContext,
} from "../src/targets.ts";

const percent = (of: string, value: number, previous = false): PercentageTarget => ({
  type: "percentage",
  percent: value,
  previous,
  of,
  priority: 1,
});

describe("validatePercentageAllocation", () => {
  it("returns null when no percentage templates are present", () => {
    expect(validatePercentageAllocation([])).toBeNull();
  });

  it("flags a single source over 100%", () => {
    expect(validatePercentageAllocation([percent("Salary", 60), percent("Salary", 50)])).toEqual({
      kind: "percent-over-100",
      total: 110,
    });
  });

  it("does not sum across distinct income sources", () => {
    expect(
      validatePercentageAllocation([
        percent("Income-HSA", 100, true),
        percent("Interest-HSA", 100),
      ]),
    ).toBeNull();
  });

  it("treats this-month and last-month income as different sources", () => {
    expect(
      validatePercentageAllocation([percent("Salary", 100, false), percent("Salary", 100, true)]),
    ).toBeNull();
  });

  it("ignores templates with a missing source", () => {
    expect(validatePercentageAllocation([{ ...percent("Salary", 100), of: "" }])).toBeNull();
  });

  it("matches sources case-insensitively", () => {
    expect(validatePercentageAllocation([percent("Salary", 60), percent("salary", 50)])).toEqual({
      kind: "percent-over-100",
      total: 110,
    });
  });
});

const average = (by?: number, unit?: "percent" | "fixed"): Target => ({
  type: "average",
  months: 3,
  priority: 1,
  adjustment: by === undefined || unit === undefined ? null : { by, unit },
});

const scheduleTarget = (name: string, by?: number, unit?: "percent" | "fixed"): Target => ({
  type: "schedule",
  schedule: name,
  full: false,
  priority: 1,
  adjustment: by === undefined || unit === undefined ? null : { by, unit },
});

const context = (overrides: Partial<ValidationContext> = {}): ValidationContext => ({
  schedules: [],
  month: "2026-01",
  ...overrides,
});

describe("validateAutomation adjustment range", () => {
  it("accepts an average with no adjustment", () => {
    expect(validateTarget(average(), context())).toBeNull();
  });

  it("accepts a percentage adjustment within range", () => {
    expect(validateTarget(average(10, "percent"), context())).toBeNull();
    // 1000% increase is the inclusive upper bound
    expect(validateTarget(average(1000, "percent"), context())).toBeNull();
  });

  it("flags a percentage increase above 1000%", () => {
    expect(validateTarget(average(1001, "percent"), context())).toEqual({
      kind: "adjustment-out-of-range",
    });
  });

  it("flags a percentage decrease of 100% or more", () => {
    expect(validateTarget(average(-100, "percent"), context())).toEqual({
      kind: "adjustment-out-of-range",
    });
  });

  it("does not range-check fixed adjustments", () => {
    expect(validateTarget(average(999999, "fixed"), context())).toBeNull();
  });

  it("flags an out-of-range adjustment on a schedule template", () => {
    expect(
      validateTarget(
        scheduleTarget("Rent", 2000, "percent"),
        context({ schedules: [{ name: "Rent", completed: false }] }),
      ),
    ).toEqual({ kind: "adjustment-out-of-range" });
  });

  it("reports a missing schedule before checking the adjustment", () => {
    expect(validateTarget(scheduleTarget("Rent", 2000, "percent"), context())).toEqual({
      kind: "schedule-not-found",
      name: "Rent",
    });
  });
});

describe("validateAutomation schedules", () => {
  it("asks for a schedule when none is picked", () => {
    expect(validateTarget(scheduleTarget(""), context())).toEqual({
      kind: "schedule-not-found",
      name: "",
    });
  });

  it("does not cover a completed schedule", () => {
    expect(
      validateTarget(
        scheduleTarget("Gym"),
        context({ schedules: [{ name: "Gym", completed: true }] }),
      ),
    ).toEqual({ kind: "schedule-not-found", name: "Gym" });
  });

  it("accepts an active schedule", () => {
    expect(
      validateTarget(
        scheduleTarget("Gym"),
        context({ schedules: [{ name: "Gym", completed: false }] }),
      ),
    ).toBeNull();
  });
});

describe("validateAutomation percentages", () => {
  const sources = new Set(["all income", "available funds", "salary", "income-id"]);

  it("needs a source", () => {
    expect(validateTarget(percent("", 10), context())).toEqual({ kind: "percentage-no-source" });
  });

  it("keeps the percent above 0 and at most 100", () => {
    expect(validateTarget(percent("all income", 0), context())).toEqual({
      kind: "percentage-out-of-range",
      percent: 0,
    });
    expect(validateTarget(percent("all income", 101), context())).toEqual({
      kind: "percentage-out-of-range",
      percent: 101,
    });
    expect(validateTarget(percent("all income", 100), context())).toBeNull();
  });

  it("checks the source when sources are known, by id or name in any case", () => {
    const known = context({ incomeSources: sources });
    expect(validateTarget(percent("Salary", 10), known)).toBeNull();
    expect(validateTarget(percent("income-id", 10), known)).toBeNull();
    expect(validateTarget(percent("Bonus", 10), known)).toEqual({
      kind: "percentage-source-not-found",
      source: "Bonus",
    });
  });

  it("skips the source check without sources", () => {
    expect(validateTarget(percent("Bonus", 10), context())).toBeNull();
  });
});

describe("validateAutomation by-date targets", () => {
  const by = (overrides: Partial<Extract<Target, { type: "by" }>> = {}): Target => ({
    type: "by",
    amount: 120_000,
    month: "2026-12",
    repeat: null,
    spendFrom: null,
    priority: 1,
    ...overrides,
  });

  it("needs a valid month", () => {
    expect(validateTarget(by({ month: "" }), context())).toEqual({ kind: "by-no-month" });
    expect(validateTarget(by({ month: "2026-13" }), context())).toEqual({ kind: "by-no-month" });
  });

  it("flags a one-off target in the past", () => {
    expect(validateTarget(by({ month: "2025-12" }), context())).toEqual({
      kind: "by-target-past",
      month: "2025-12",
    });
  });

  it("accepts the current month", () => {
    expect(validateTarget(by({ month: "2026-01" }), context())).toBeNull();
  });

  it("accepts a past anchor when the target repeats", () => {
    expect(
      validateTarget(by({ month: "2025-03", repeat: { unit: "year", every: 1 } }), context()),
    ).toBeNull();
    expect(
      validateTarget(by({ month: "2025-03", repeat: { unit: "month", every: 6 } }), context()),
    ).toBeNull();
  });

  it("needs a valid spend-from month", () => {
    expect(validateTarget(by({ spendFrom: "soon" }), context())).toEqual({
      kind: "spend-no-from",
    });
  });

  it("flags spending that starts after the target", () => {
    expect(validateTarget(by({ month: "2026-06", spendFrom: "2026-07" }), context())).toEqual({
      kind: "spend-from-after-target",
    });
    expect(validateTarget(by({ month: "2026-06", spendFrom: "2026-06" }), context())).toBeNull();
  });
});

describe("validateSchedulePriorities", () => {
  const scheduleAt = (name: string, priority: number): Target => ({
    ...(scheduleTarget(name) as Extract<Target, { type: "schedule" }>),
    priority,
  });
  const byAt = (priority: number, spendFrom: string | null = null): Target => ({
    type: "by",
    amount: 10_000,
    month: "2026-12",
    repeat: null,
    spendFrom,
    priority,
  });

  it("returns null when there are no schedule or by templates", () => {
    expect(validateSchedulePriorities([])).toBeNull();
  });

  it("returns null for a single schedule", () => {
    expect(validateSchedulePriorities([scheduleAt("Rent", 1)])).toBeNull();
  });

  it("returns null when all schedules share a priority", () => {
    expect(validateSchedulePriorities([scheduleAt("Rent", 2), scheduleAt("Gym", 2)])).toBeNull();
  });

  it("flags schedules with mismatched priorities", () => {
    expect(validateSchedulePriorities([scheduleAt("Rent", 1), scheduleAt("Gym", 2)])).toEqual({
      kind: "schedule-priority-mismatch",
    });
  });

  it("flags a schedule and a by-date with mismatched priorities", () => {
    expect(validateSchedulePriorities([scheduleAt("Rent", 1), byAt(2)])).toEqual({
      kind: "schedule-priority-mismatch",
    });
  });

  it("leaves out a by-date that spends early, as the engine does", () => {
    expect(validateSchedulePriorities([scheduleAt("Rent", 1), byAt(2, "2026-06")])).toBeNull();
  });

  it("ignores priorities of other automation types", () => {
    expect(validateSchedulePriorities([scheduleAt("Rent", 1), percent("Salary", 10)])).toBeNull();
  });
});

describe("the engine's one-per-category rules", () => {
  const cap = { amount: 10_000, period: "monthly", start: null, hold: false } as const;

  it("allows one cap", () => {
    expect(
      validateCategoryRules([{ type: "simple", priority: 0, monthly: 5_000, cap }]),
    ).toBeNull();
  });

  it("flags a second cap", () => {
    expect(
      validateCategoryRules([
        { type: "simple", priority: 0, monthly: 5_000, cap },
        { type: "remainder", weight: 1, cap },
      ]),
    ).toEqual({ kind: "more-than-one-cap" });
  });

  it("flags a second goal", () => {
    expect(
      conflictsOf([
        { type: "goal", amount: 1 },
        { type: "goal", amount: 2 },
      ]),
    ).toEqual([{ kind: "more-than-one-goal" }]);
  });

  it("reports problems as plain messages, numbered by target", () => {
    expect(
      targetProblems([percent("all income", 0), { type: "goal", amount: 0 }], context()),
    ).toEqual([
      "Target 1: The percent must be more than 0 and at most 100.",
      "Target 2: Enter an amount above zero.",
    ]);
  });

  it("asks a weekly cap for its first day", () => {
    expect(
      validateTarget(
        { type: "simple", priority: 0, monthly: null, cap: { ...cap, period: "weekly" } },
        context(),
      ),
    ).toEqual({ kind: "weekly-cap-no-start" });
  });
});

describe("the editor's kinds", () => {
  it("offers a valid default target for every kind, which shows as that kind", () => {
    const valid = context({ schedules: [{ name: "Rent", completed: false }] });
    for (const kind of TARGET_KINDS) {
      const fresh = defaultTarget(kind, "2026-01");
      const target = fresh.type === "schedule" ? { ...fresh, schedule: "Rent" } : fresh;
      expect(kindOf(target)).toBe(kind);
      expect(validateTarget(target, valid)).toBeNull();
    }
  });

  it("tells a top-up from a fixed amount", () => {
    const cap = { amount: 30_000, period: "monthly", start: null, hold: false } as const;
    expect(kindOf({ type: "simple", priority: 0, monthly: null, cap })).toBe("top-up");
    expect(kindOf({ type: "simple", priority: 0, monthly: 100, cap })).toBe("fixed");
    expect(
      kindOf({
        type: "periodic",
        priority: 0,
        amount: 100,
        period: "week",
        every: 1,
        starting: "2026-01-05",
        cap: null,
      }),
    ).toBe("fixed");
    expect(kindOf({ type: "copy", priority: 0, monthsAgo: 12 })).toBe("history");
  });
});

describe("sentences", () => {
  const sentence = {
    money: (cents: number) => (cents / 100).toFixed(2),
    categoryName: (id: string) => ({ salary: "Salary", savings: "Savings" })[id],
  };

  it("says each kind in plain words", () => {
    const cases: Array<[Target, string]> = [
      [{ type: "simple", priority: 0, monthly: 5_000, cap: null }, "Budget 50.00 each month"],
      [
        {
          type: "simple",
          priority: 0,
          monthly: null,
          cap: { amount: 30_000, period: "monthly", start: null, hold: false },
        },
        "Top up to 300.00 each month",
      ],
      [
        {
          type: "periodic",
          priority: 0,
          amount: 2_500,
          period: "week",
          every: 1,
          starting: "2026-01-05",
          cap: null,
        },
        "Budget 25.00 every week, from Jan 5, 2026",
      ],
      [
        {
          type: "by",
          priority: 0,
          amount: 90_000,
          month: "2027-02",
          repeat: null,
          spendFrom: null,
        },
        "Save 900.00 by February 2027",
      ],
      [
        {
          type: "by",
          priority: 0,
          amount: 120_000,
          month: "2026-12",
          repeat: { unit: "year", every: 1 },
          spendFrom: "2026-06",
        },
        "Save 1200.00 by December 2026, then again every year, spending from June 2026",
      ],
      [percent("salary", 10, true), "Budget 10% of last month's Salary"],
      [percent("all income", 15), "Budget 15% of all income"],
      [scheduleTarget("Rent", 5, "percent"), 'Save up for the bill "Rent", plus 5%'],
      [average(-1_000, "fixed"), "Budget the average spent over the last 3 months, minus 10.00"],
      [{ type: "copy", priority: 0, monthsAgo: 12 }, "Budget the same as 12 months ago"],
      [
        { type: "remainder", weight: 2, cap: null },
        "Budget a share (weight 2) of whatever is left",
      ],
      [{ type: "goal", amount: 700_000 }, "Reach a balance of 7000.00"],
    ];
    for (const [target, expected] of cases) expect(describeTarget(target, sentence)).toBe(expected);
  });

  it("says where leftovers go", () => {
    expect(describeLeftover({ kind: "give-back" }, sentence)).toBe(
      "At month end, give leftover money back to To Budget",
    );
    expect(describeLeftover({ kind: "send", to: "savings" }, sentence)).toBe(
      "At month end, send leftover money to Savings",
    );
    expect(describeLeftover({ kind: "pool-cover", pool: "Bills" }, sentence)).toBe(
      'At month end, cover overspending from the pool "Bills"',
    );
  });
});

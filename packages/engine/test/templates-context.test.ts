// Ported from Actual's category-template-context.test.ts. Actual mocks its budget sheet; here a
// fake TemplateEnv answers the same cells.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CategoryTemplateContext,
  distributeRemainder,
  type TemplateCategory,
  type TemplateEnv,
} from "../src/templates/context.ts";
import { amountToInteger, months } from "../src/templates/months.ts";
import {
  runScheduleForecast,
  type ScheduledTransaction,
  type ScheduleStore,
  type StoredSchedule,
} from "../src/templates/schedule.ts";
import type { ByTemplate, Template } from "../src/templates/types.ts";

const storeOf = (
  schedules: ReadonlyArray<StoredSchedule> = [],
  transactions: ReadonlyArray<ScheduledTransaction> = [],
): ScheduleStore => ({
  active: () => schedules.map(({ id, name }) => ({ id, name })),
  find: (ref) =>
    schedules.find((schedule) =>
      ref.scheduleId ? schedule.id === ref.scheduleId : schedule.name?.trim() === ref.name,
    ),
  transactions: (query) =>
    transactions.filter(
      (row) =>
        (query.category === undefined || row.category === query.category) &&
        (query.schedules === undefined ||
          (row.schedule !== null && query.schedules.includes(row.schedule))) &&
        (!query.unlinked || row.schedule === null) &&
        (query.after === undefined || row.date > query.after) &&
        (query.from === undefined || row.date >= query.from) &&
        (query.before === undefined || row.date < query.before),
    ),
});

interface Fake extends TemplateEnv {
  readonly reads: Array<[string, string]>;
  readonly averages: Array<[string, number, string]>;
}

const fakeEnv = (
  options: {
    values?: Record<string, number> | ((month: string, key: string) => number);
    hideFraction?: boolean;
    isTracking?: boolean;
    categories?: ReadonlyArray<TemplateCategory>;
    average?: number;
    schedules?: ScheduleStore;
    today?: string;
  } = {},
): Fake => {
  const reads: Array<[string, string]> = [];
  const averages: Array<[string, number, string]> = [];
  const { values = {} } = options;
  return {
    reads,
    averages,
    isTracking: options.isTracking ?? false,
    hideFraction: options.hideFraction ?? false,
    today: options.today ?? "2017-01-01",
    value: (month, key) => {
      reads.push([month, key]);
      return typeof values === "function"
        ? values(month, key)
        : (values[`${month}:${key}`] ?? values[key] ?? 0);
    },
    carryover: () => false,
    categories: () => options.categories ?? [],
    categoryAverage: (month, maxMonths, category) => {
      averages.push([month, maxMonths, category]);
      return options.average ?? 0;
    },
    schedules: options.schedules ?? storeOf(),
  };
};

const category: TemplateCategory = { id: "test", name: "Test Category", isIncome: false };

const make = (
  templates: ReadonlyArray<Template>,
  month = "2024-01",
  fromLastMonth = 0,
  budgeted = 0,
  env: TemplateEnv = fakeEnv(),
  cat: TemplateCategory = category,
) => new CategoryTemplateContext(templates, cat, month, fromLastMonth, budgeted, env);

describe("CategoryTemplateContext", () => {
  describe("runSimple", () => {
    it("should return monthly amount when provided", () => {
      const template: Template = {
        type: "simple",
        monthly: 100,
        directive: "template",
        priority: 1,
      };
      expect(CategoryTemplateContext.runSimple(template, make([]))).toBe(amountToInteger(100));
    });

    it("should return limit when monthly is not provided", () => {
      const template: Template = {
        type: "simple",
        limit: { amount: 500, hold: false, period: "monthly" },
        directive: "template",
        priority: 1,
      };
      expect(CategoryTemplateContext.runSimple(template, make([template]))).toBe(
        amountToInteger(500),
      );
    });

    it("should handle weekly limit", () => {
      const template: Template = {
        type: "simple",
        limit: { amount: 100, hold: false, period: "weekly", start: "2024-01-01" },
        directive: "template",
        priority: 1,
      };
      expect(make([template]).runTemplatesForPriority(1, 100000, 100000)).toBe(50000); // 5 Mondays * 100
    });

    it("should handle daily limit", () => {
      const template: Template = {
        type: "simple",
        limit: { amount: 10, hold: false, period: "daily" },
        directive: "template",
        priority: 1,
      };
      expect(make([template]).runTemplatesForPriority(1, 100000, 100000)).toBe(31000); // 31 days * 10
    });
  });

  describe("runRefill", () => {
    const refill: Template = { type: "refill", directive: "template", priority: 1 };

    it("should refill up to the monthly limit", () => {
      const limit: Template = {
        type: "limit",
        amount: 150,
        hold: false,
        period: "monthly",
        directive: "template",
        priority: null,
      };
      expect(make([limit, refill], "2024-01", 9000).runTemplatesForPriority(1, 10000, 10000)).toBe(
        6000,
      ); // 150 - 90
    });

    it("should handle weekly limit refill", () => {
      const limit: Template = {
        type: "limit",
        amount: 100,
        hold: false,
        period: "weekly",
        start: "2024-01-01",
        directive: "template",
        priority: null,
      };
      expect(make([limit, refill]).runTemplatesForPriority(1, 100000, 100000)).toBe(50000);
    });

    it("should handle daily limit refill", () => {
      const limit: Template = {
        type: "limit",
        amount: 10,
        hold: false,
        period: "daily",
        directive: "template",
        priority: null,
      };
      expect(make([limit, refill]).runTemplatesForPriority(1, 100000, 100000)).toBe(31000);
    });
  });

  describe("runCopy", () => {
    it("should copy budget from previous month", () => {
      const env = fakeEnv({ values: { "2023-12:budget-test": 100 } });
      expect(
        CategoryTemplateContext.runCopy(
          { type: "copy", lookBack: 1, directive: "template", priority: 1 },
          make([], "2024-01", 0, 0, env),
        ),
      ).toBe(100);
    });

    it("should copy budget from multiple months back", () => {
      const env = fakeEnv({ values: { "2023-10:budget-test": 200 } });
      expect(
        CategoryTemplateContext.runCopy(
          { type: "copy", lookBack: 3, directive: "template", priority: 1 },
          make([], "2024-01", 0, 0, env),
        ),
      ).toBe(200);
    });

    it("should handle zero budget amount", () => {
      expect(
        CategoryTemplateContext.runCopy(
          { type: "copy", lookBack: 1, directive: "template", priority: 1 },
          make([]),
        ),
      ).toBe(0);
    });
  });

  describe("runPeriodic", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it.each(["2023-12-01", "2024-01-01"])(
      "rejects a stalled date shift in either loop (starting %s)",
      (starting) => {
        const shift = vi.spyOn(months, "addDays").mockReturnValue(starting);
        expect(() =>
          CategoryTemplateContext.runPeriodic(
            {
              type: "periodic",
              amount: 100,
              period: { period: "day", amount: 1 },
              starting,
              directive: "template",
              priority: 0,
            },
            make([]),
          ),
        ).toThrow("Infinite loop detected in repeating template, check the repeat interval");
        expect(shift).toHaveBeenCalledOnce();
      },
    );

    const periodic = (
      period: "day" | "week" | "month" | "year",
      amount: number,
      starting: string,
    ) =>
      CategoryTemplateContext.runPeriodic(
        {
          type: "periodic",
          amount: 100,
          period: { period, amount },
          starting,
          directive: "template",
          priority: 1,
        },
        make([]),
      );

    // 5 Mondays in January 2024
    it("should calculate weekly amount for single week", () => {
      expect(periodic("week", 1, "2024-01-01")).toBe(amountToInteger(500));
    });
    it("should calculate weekly amount for multiple weeks", () => {
      expect(periodic("week", 2, "2024-01-01")).toBe(amountToInteger(300));
    });
    it("should handle weeks spanning multiple months", () => {
      expect(periodic("week", 7, "2023-12-04")).toBe(amountToInteger(100));
    });
    it("should handle periodic days", () => {
      expect(periodic("day", 10, "2024-01-01")).toBe(amountToInteger(400)); // 1st, 11th, 21st, 31st
    });
    it("should handle periodic years", () => {
      expect(periodic("year", 1, "2023-01-01")).toBe(amountToInteger(100));
    });
    it("should handle periodic months", () => {
      expect(periodic("month", 2, "2023-11-01")).toBe(amountToInteger(100));
    });
  });

  describe("runSpend", () => {
    it("should calculate monthly amount needed to reach target", () => {
      const env = fakeEnv({
        values: {
          "2023-11:sum-amount-test": -10000, // spent in Nov
          "2023-11:leftover-test": 20000, // leftover in Nov
          "2023-12:budget-test": 10000, // budgeted in Dec
        },
      });
      expect(
        CategoryTemplateContext.runSpend(
          {
            type: "spend",
            amount: 1000,
            from: "2023-11",
            month: "2024-01",
            directive: "template",
            priority: 1,
          },
          make([], "2024-01", 0, 0, env),
        ),
      ).toBe(60000);
    });

    it("should handle repeating spend template", () => {
      expect(
        CategoryTemplateContext.runSpend(
          {
            type: "spend",
            amount: 1000,
            from: "2023-11",
            month: "2023-12",
            repeat: 3,
            directive: "template",
            priority: 1,
          },
          make([]),
        ),
      ).toBe(33333);
    });

    it("should return zero for past target date", () => {
      expect(
        CategoryTemplateContext.runSpend(
          {
            type: "spend",
            amount: 1000,
            from: "2023-12",
            month: "2023-12",
            directive: "template",
            priority: 1,
          },
          make([]),
        ),
      ).toBe(0);
    });
  });

  describe("runPercentage", () => {
    const percentage = (
      percent: number,
      source: string,
      previous: boolean,
      available: number,
      env: TemplateEnv,
    ) =>
      CategoryTemplateContext.runPercentage(
        {
          type: "percentage",
          percent,
          category: source,
          previous,
          directive: "template",
          priority: 1,
        },
        available,
        make([], "2024-01", 0, 0, env),
      );

    it("should calculate percentage of all income", () => {
      expect(percentage(10, "all income", false, 0, fakeEnv({ values: () => 10000 }))).toBe(1000);
    });

    it("should calculate percentage of available funds", () => {
      expect(percentage(20, "available funds", false, 500, fakeEnv())).toBe(100);
    });

    it("should calculate percentage of specific income category", () => {
      const env = fakeEnv({
        values: () => 2000,
        categories: [{ id: "income1", name: "Salary", isIncome: true }],
      });
      expect(percentage(15, "Salary", false, 0, env)).toBe(300);
      expect(env.reads).toContainEqual(["2024-01", "sum-amount-income1"]);
    });

    it("should calculate percentage of previous month income", () => {
      const env = fakeEnv({ values: () => 10000 });
      expect(percentage(10, "all income", true, 0, env)).toBe(1000);
      expect(env.reads).toContainEqual(["2023-12", "total-income"]);
    });
  });

  describe("runAverage", () => {
    const average = (
      value: number,
      adjustment?: { adjustment: number; adjustmentType: "percent" | "fixed" },
      month = "2024-01",
    ) => {
      const env = fakeEnv({ average: value });
      const result = CategoryTemplateContext.runAverage(
        { type: "average", numMonths: 3, directive: "template", priority: 1, ...adjustment },
        make([], month, 0, 0, env),
      );
      return { result, env };
    };

    it("should calculate average of 3 months", () => {
      const { result, env } = average(-200);
      expect(result).toBe(200);
      expect(env.averages).toEqual([["2024-01", 3, "test"]]);
    });
    it("should handle zero amounts", () => {
      expect(average(-100).result).toBe(100);
    });
    it("should handle mixed positive and negative amounts", () => {
      expect(average(-(200 / 3)).result).toBe(67);
    });
    it("should use the shared average helper with the template range", () => {
      const { result, env } = average(-150);
      expect(result).toBe(150);
      expect(env.averages).toEqual([["2024-01", 3, "test"]]);
    });
    it("should handle positive percent adjustments", () => {
      expect(average(-100, { adjustment: 10, adjustmentType: "percent" }).result).toBe(110);
    });
    it("should handle negative percent adjustments", () => {
      expect(average(-100, { adjustment: -10, adjustmentType: "percent" }).result).toBe(90);
    });
    it("should handle zero percent adjustments", () => {
      expect(average(-100, { adjustment: 0, adjustmentType: "percent" }).result).toBe(100);
    });
    it("should skip the current month and future months", () => {
      const { result, env } = average(-200, undefined, "2024-03");
      expect(result).toBe(200);
      expect(env.averages).toEqual([["2024-03", 3, "test"]]);
    });
    it("should handle zero amount adjustments", () => {
      expect(average(-100, { adjustment: 0, adjustmentType: "fixed" }).result).toBe(100);
    });
    it("should handle positive amount adjustments", () => {
      expect(average(-10000, { adjustment: 11, adjustmentType: "fixed" }).result).toBe(11100);
    });
    it("should handle negative amount adjustments", () => {
      expect(average(-10000, { adjustment: -1, adjustmentType: "fixed" }).result).toBe(9900);
    });
  });

  describe("runBy", () => {
    const targets: Array<Template> = [
      { type: "by", amount: 1000, month: "2024-03", directive: "template", priority: 1 },
      { type: "by", amount: 2000, month: "2024-06", directive: "template", priority: 1 },
    ];

    it("should calculate monthly amount needed for multiple targets", () => {
      expect(CategoryTemplateContext.runBy(make(targets)).toBudget).toBe(66667);
    });

    it("should handle repeating targets", () => {
      const repeating: Array<Template> = [
        {
          type: "by",
          amount: 1000,
          month: "2023-03",
          repeat: 12,
          directive: "template",
          priority: 1,
        },
        {
          type: "by",
          amount: 2000,
          month: "2023-06",
          repeat: 12,
          directive: "template",
          priority: 1,
        },
      ];
      expect(CategoryTemplateContext.runBy(make(repeating)).toBudget).toBe(83333);
    });

    it("should handle existing balance", () => {
      expect(CategoryTemplateContext.runBy(make(targets, "2024-01", 500)).toBudget).toBe(66500);
    });
  });

  describe("template priorities", () => {
    it("should handle multiple templates with priorities and insufficient funds", () => {
      const instance = make([
        { type: "simple", monthly: 100, directive: "template", priority: 1 },
        { type: "simple", monthly: 200, directive: "template", priority: 1 },
      ]);
      expect(instance.runTemplatesForPriority(1, 150, 150)).toBe(150);
    });
  });

  describe("category limits", () => {
    it("should not budget over monthly limit", () => {
      const instance = make(
        [
          {
            type: "simple",
            monthly: 100,
            limit: { amount: 150, hold: false, period: "monthly" },
            directive: "template",
            priority: 1,
          },
        ],
        "2024-01",
        9000,
      );
      expect(instance.runTemplatesForPriority(1, 10000, 10000)).toBe(6000);
    });

    it("should handle hold flag when limit is reached", () => {
      const instance = make(
        [
          {
            type: "simple",
            monthly: 100,
            limit: { amount: 200, hold: true, period: "monthly" },
            directive: "template",
            priority: 1,
          },
        ],
        "2024-01",
        300,
      );
      expect(instance.getLimitExcess()).toBe(0);
    });

    it("should remove funds if over limit", () => {
      const instance = make(
        [
          {
            type: "simple",
            monthly: 100,
            limit: { amount: 200, hold: false, period: "monthly" },
            directive: "template",
            priority: 1,
          },
        ],
        "2024-01",
        30000,
      );
      expect(instance.getLimitExcess()).toBe(10000);
    });
  });

  describe("remainder templates", () => {
    const remainder = (weight: number): Template => ({
      type: "remainder",
      weight,
      directive: "template",
      priority: null,
    });

    it("should distribute available funds based on weight", () => {
      expect(make([remainder(2)]).runRemainder(100, 50)).toBe(100);
    });
    it("remainder should handle last cent", () => {
      expect(make([remainder(1)]).runRemainder(101, 100)).toBe(101);
    });
    it("remainder loop terminates when per-context share rounds to zero", () => {
      const contexts = Array.from({ length: 5 }, () => make([remainder(1)]));
      expect(distributeRemainder(contexts, 2)).toBe(2);
    });
    it("remainder wont over budget", () => {
      expect(make([remainder(1)]).runRemainder(99, 100)).toBe(99);
    });
  });

  describe("schedule templates", () => {
    const gate: TemplateCategory = { id: "gate-cat", name: "Gate Category", isIncome: false };
    const templates: Array<Template> = [
      { type: "schedule", name: "Internet", directive: "template", priority: 1 },
      { type: "schedule", name: "Insurance", directive: "template", priority: 1 },
    ];
    const yearly = (id: string, name: string, start: string, amount: number): StoredSchedule => ({
      id,
      name,
      completed: false,
      nextDate: null,
      conditions: [
        {
          op: "is",
          field: "date",
          value: {
            start,
            interval: 1,
            frequency: "yearly",
            patterns: [],
            skipWeekend: false,
            weekendSolveMode: "before",
            endMode: "never",
            endOccurrences: 1,
            endDate: "2099-01-01",
          },
        },
        { op: "is", field: "amount", value: amount },
      ],
      actions: [],
    });
    const schedules = storeOf([
      yearly("s1", "Internet", "2024-03-15", -10000),
      yearly("s2", "Insurance", "2024-12-15", -60000),
    ]);

    it("budgets the forecast contribution for an empty category", () => {
      const env = fakeEnv({ schedules });
      const instance = CategoryTemplateContext.init(templates, gate, "2024-01", 0, env);
      const result = instance.runTemplatesForPriority(1, 100000, 100000);
      const expected = runScheduleForecast(templates, "2024-01", 0, 0, gate, env);
      expect(expected.toBudget).toBeGreaterThan(0);
      expect(result).toBe(expected.toBudget);
    });

    it("budgets nothing when last month left more than the bills need", () => {
      // $100 due each March and $600 each December: $5,000 left over covers years of both.
      const env = fakeEnv({ schedules, values: () => 500000 });
      const instance = CategoryTemplateContext.init(templates, gate, "2024-01", 0, env);
      expect(instance.runTemplatesForPriority(1, 100000, 100000)).toBe(0);
    });
  });

  describe("full process", () => {
    it("should handle priority limits through the entire process", () => {
      const instance = CategoryTemplateContext.init(
        [
          { type: "simple", monthly: 100, directive: "template", priority: 1 },
          { type: "simple", monthly: 200, directive: "template", priority: 2 },
          { type: "remainder", weight: 1, directive: "template", priority: null },
        ],
        category,
        "2024-01",
        0,
        fakeEnv(),
      );
      const priority1 = instance.runTemplatesForPriority(1, 15000, 15000);
      const priority2 = instance.runTemplatesForPriority(2, 15000 - priority1, 15000);
      const values = instance.getValues();
      expect(priority1).toBe(10000);
      expect(priority2).toBe(5000);
      expect(values.budgeted).toBe(15000);
      expect(values.goal).toBe(30000);
      expect(values.longGoal).toBe(null);
    });

    it("should handle category limits through the entire process", () => {
      const instance = CategoryTemplateContext.init(
        [
          { type: "simple", monthly: 100, directive: "template", priority: 1 },
          { type: "simple", monthly: 200, directive: "template", priority: 1 },
          {
            type: "simple",
            limit: { amount: 150, hold: false, period: "monthly" },
            directive: "template",
            priority: 1,
          },
        ],
        category,
        "2024-01",
        0,
        fakeEnv(),
      );
      const result = instance.runTemplatesForPriority(1, 100000, 100000);
      const values = instance.getValues();
      expect(result).toBe(15000);
      expect(values.budgeted).toBe(15000);
      expect(values.goal).toBe(15000);
      expect(values.longGoal).toBe(null);
    });

    it("should handle remainder template at the end of the process", () => {
      const instance = CategoryTemplateContext.init(
        [
          { type: "simple", monthly: 100, directive: "template", priority: 1 },
          { type: "simple", monthly: 200, directive: "template", priority: 1 },
          { type: "remainder", weight: 1, directive: "template", priority: null },
        ],
        category,
        "2024-01",
        0,
        fakeEnv(),
      );
      const weight = instance.getRemainderWeight();
      const result = instance.runTemplatesForPriority(1, 100000, 100000);
      const perWeight = (100000 - result) / weight;
      const remainderResult = instance.runRemainder(perWeight, perWeight);
      const values = instance.getValues();
      expect(result).toBe(30000);
      expect(remainderResult).toBe(70000);
      expect(values.budgeted).toBe(100000);
      expect(values.goal).toBe(30000);
      expect(values.longGoal).toBe(null);
    });

    it("should handle goal template through the entire process", () => {
      const instance = CategoryTemplateContext.init(
        [
          { type: "simple", monthly: 100, directive: "template", priority: 1 },
          { type: "simple", monthly: 200, directive: "template", priority: 1 },
          { type: "goal", amount: 1000, directive: "goal" },
        ],
        category,
        "2024-01",
        0,
        fakeEnv(),
      );
      const result = instance.runTemplatesForPriority(1, 100000, 100000);
      const values = instance.getValues();
      expect(result).toBe(30000);
      expect(values.budgeted).toBe(30000);
      expect(values.goal).toBe(100000);
      expect(values.longGoal).toBe(true);
      expect(instance.isGoalOnly()).toBe(false);
    });

    it("should handle goal-only template through the entire process", () => {
      const instance = CategoryTemplateContext.init(
        [{ type: "goal", amount: 1000, directive: "goal" }],
        category,
        "2024-01",
        10000,
        fakeEnv({ values: { "leftover-test": 10000 } }),
      );
      expect(instance.isGoalOnly()).toBe(true);
      const values = instance.getValues();
      expect(values.budgeted).toBe(10000);
      expect(values.goal).toBe(100000);
      expect(values.longGoal).toBe(true);
    });

    it("should handle hide fraction", () => {
      const instance = CategoryTemplateContext.init(
        [
          { type: "simple", monthly: 100.89, directive: "template", priority: 1 },
          { type: "goal", amount: 1000, directive: "goal" },
        ],
        category,
        "2024-01",
        0,
        fakeEnv({ hideFraction: true }),
      );
      const result = instance.runTemplatesForPriority(1, 100000, 100000);
      const values = instance.getValues();
      expect(result).toBe(10100);
      expect(values.budgeted).toBe(10100);
      expect(values.goal).toBe(100000);
      expect(values.longGoal).toBe(true);
      expect(instance.isGoalOnly()).toBe(false);
    });
  });

  describe("per-template attribution", () => {
    const attribution: TemplateCategory = { id: "attribution-cat", name: "A", isIncome: false };
    const run = (templates: ReadonlyArray<Template>) => {
      const instance = make(templates, "2024-01", 0, 0, fakeEnv(), attribution);
      instance.runTemplatesForPriority(1, 1_000_000, 1_000_000);
      return instance.getValues();
    };
    const monthly = (amount: number): Template => ({
      type: "periodic",
      amount,
      period: { period: "month", amount: 1 },
      starting: "2024-01-01",
      directive: "template",
      priority: 1,
    });

    it("sums per-template contributions to the engine total for sibling periodic templates", () => {
      const templates = [monthly(100), monthly(50)];
      const values = run(templates);
      const contributions = templates.map((t) => values.perTemplateContribution.get(t) ?? 0);
      expect(contributions).toEqual([10000, 5000]);
      expect(contributions.reduce((a, b) => a + b, 0)).toBe(values.budgeted);
    });

    it("weights `by` siblings by their effective per-month need from runBy, not raw target", () => {
      const templates: Array<Template> = [
        {
          type: "by",
          amount: 1200,
          month: "2025-01",
          annual: false,
          directive: "template",
          priority: 1,
        },
        {
          type: "by",
          amount: 100,
          month: "2024-02",
          annual: false,
          directive: "template",
          priority: 1,
        },
      ];
      const values = run(templates);
      const longHorizon = values.perTemplateContribution.get(templates[0]!) ?? 0;
      const urgent = values.perTemplateContribution.get(templates[1]!) ?? 0;
      expect(longHorizon + urgent).toBe(values.budgeted);
      const rawShareUrgent = Math.round((values.budgeted * 100) / (100 + 1200));
      expect(urgent).toBeGreaterThan(rawShareUrgent * 4);
    });

    it("scales per-template contributions when a balance cap clamps the total", () => {
      const templates: Array<Template> = [
        monthly(100),
        monthly(50),
        {
          type: "limit",
          amount: 120,
          hold: false,
          period: "monthly",
          directive: "template",
          priority: null,
        },
      ];
      const values = run(templates);
      const sum = templates.reduce(
        (acc, t) => acc + (values.perTemplateContribution.get(t) ?? 0),
        0,
      );
      expect(sum).toBe(values.budgeted);
      expect(values.budgeted).toBe(12000);
      for (const t of templates)
        expect(values.perTemplateContribution.get(t) ?? 0).toBeGreaterThanOrEqual(0);
    });

    it("attributes remainder rules per template by weight", () => {
      const templates: Array<Template> = [
        { type: "remainder", weight: 3, directive: "template", priority: null },
        { type: "remainder", weight: 1, directive: "template", priority: null },
      ];
      const instance = make(templates, "2024-01", 0, 0, fakeEnv(), attribution);
      instance.runRemainder(100, 25);
      const values = instance.getValues();
      expect(values.perTemplateContribution.get(templates[0]!)).toBe(75);
      expect(values.perTemplateContribution.get(templates[1]!)).toBe(25);
    });

    it("runBy returns a per-template need map keyed by template reference", () => {
      const templates: Array<ByTemplate> = [
        {
          type: "by",
          amount: 1200,
          month: "2024-12",
          annual: false,
          directive: "template",
          priority: 1,
        },
        {
          type: "by",
          amount: 600,
          month: "2024-12",
          annual: false,
          directive: "template",
          priority: 1,
        },
      ];
      const result = CategoryTemplateContext.runBy(make(templates));
      expect(result.perTemplateNeed.get(templates[0]!)).toBe(120000);
      expect(result.perTemplateNeed.get(templates[1]!)).toBe(60000);
    });
  });

  describe("validation (init checks)", () => {
    const validation: TemplateCategory = { id: "val-cat", name: "V", isIncome: false };
    const init = (templates: ReadonlyArray<Template>, month = "2024-01", env = fakeEnv()) =>
      CategoryTemplateContext.init(templates, validation, month, 0, env);
    const rent = storeOf([
      { id: "s1", name: "Rent", completed: false, nextDate: null, conditions: [], actions: [] },
    ]);

    it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
      "rejects an invalid saved repeat interval (%s)",
      (interval) => {
        expect(() =>
          init([
            {
              type: "periodic",
              amount: 100,
              period: { period: "day", amount: interval },
              starting: "2023-12-01",
              directive: "template",
              priority: 0,
            },
          ]),
        ).toThrow("Template repeat interval must be a whole number greater than 0");
      },
    );

    it("throws when a schedule template references a non-existent schedule", () => {
      expect(() =>
        init(
          [{ type: "schedule", name: "Internet", directive: "template", priority: 1 }],
          "2024-01",
          fakeEnv({ schedules: rent }),
        ),
      ).toThrow(/Schedule Internet does not exist/);
    });

    it("throws when schedule and by templates have mismatched priorities", () => {
      expect(() =>
        init(
          [
            { type: "schedule", name: "Rent", directive: "template", priority: 1 },
            {
              type: "by",
              amount: 1200,
              month: "2024-12",
              annual: false,
              directive: "template",
              priority: 2,
            },
          ],
          "2024-01",
          fakeEnv({ schedules: rent }),
        ),
      ).toThrow(/Schedule and By templates must be the same priority level/);
    });

    it("throws when a non-recurring `by` target month is in the past", () => {
      expect(() =>
        init(
          [
            {
              type: "by",
              amount: 1200,
              month: "2023-12",
              annual: false,
              directive: "template",
              priority: 1,
            },
          ],
          "2024-06",
        ),
      ).toThrow(/Target month has passed, remove or update the target month/);
    });

    it("accepts a past `by` target when annual or repeat is set (engine rolls it forward)", () => {
      expect(
        init(
          [
            {
              type: "by",
              amount: 1200,
              month: "2023-12",
              annual: true,
              directive: "template",
              priority: 1,
            },
          ],
          "2024-06",
        ),
      ).toBeDefined();
    });

    const salary = [{ id: "inc-1", name: "Salary", isIncome: true }];

    it("throws when a percentage template references an unknown income category", () => {
      expect(() =>
        init(
          [
            {
              type: "percentage",
              percent: 10,
              previous: false,
              category: "Bonus",
              directive: "template",
              priority: 1,
            },
          ],
          "2024-01",
          fakeEnv({ categories: salary }),
        ),
      ).toThrow(/is not found in available income categories/i);
    });

    it("rolls a past `by` target forward by its annual period", () => {
      const ctx = init(
        [
          {
            type: "by",
            amount: 1200,
            month: "2023-12",
            annual: true,
            directive: "template",
            priority: 1,
          },
        ],
        "2024-06",
      );
      expect(ctx.runTemplatesForPriority(1, 1_000_000, 1_000_000)).toBeGreaterThan(0);
    });

    it("accepts a percentage template that uses an income category id", () => {
      expect(
        init(
          [
            {
              type: "percentage",
              percent: 10,
              previous: false,
              category: "inc-1",
              directive: "template",
              priority: 1,
            },
          ],
          "2024-01",
          fakeEnv({ categories: salary }),
        ),
      ).toBeDefined();
    });

    it("accepts the special `all income` and `available funds` source aliases", () => {
      expect(
        init([
          {
            type: "percentage",
            percent: 10,
            previous: false,
            category: "all income",
            directive: "template",
            priority: 1,
          },
          {
            type: "percentage",
            percent: 5,
            previous: false,
            category: "available funds",
            directive: "template",
            priority: 1,
          },
        ]),
      ).toBeDefined();
    });

    const limit = (amount: number, period: string, start?: string): Template =>
      ({
        type: "limit",
        amount,
        hold: false,
        period,
        ...(start ? { start } : {}),
        directive: "template",
        priority: null,
      }) as Template;

    it("throws when more than one limit template is defined", () => {
      expect(() => make([limit(100, "monthly"), limit(200, "monthly")])).toThrow(
        /Only one .up to. allowed per category/,
      );
    });

    it("throws when a weekly limit has no start date", () => {
      expect(() => make([limit(50, "weekly")])).toThrow(/Weekly limit requires a start date/);
    });

    it("throws when a limit period is not daily/weekly/monthly", () => {
      expect(() => make([limit(50, "fortnightly")])).toThrow(/Invalid limit period/);
    });

    it("throws when more than one spend template is defined", () => {
      expect(() =>
        make([
          {
            type: "spend",
            amount: 100,
            from: "2024-01",
            month: "2024-12",
            directive: "template",
            priority: 1,
          },
          {
            type: "spend",
            amount: 200,
            from: "2024-01",
            month: "2024-12",
            directive: "template",
            priority: 1,
          },
        ]),
      ).toThrow(/Only one spend template is allowed per category/);
    });

    it("throws when more than one #goal directive is defined", () => {
      expect(() =>
        make([
          { type: "goal", amount: 1000, directive: "goal" },
          { type: "goal", amount: 2000, directive: "goal" },
        ]),
      ).toThrow(/Only one #goal is allowed per category/);
    });

    it("throws when a periodic template uses an unknown period unit", () => {
      const ctx = init([
        {
          type: "periodic",
          amount: 100,
          period: { period: "fortnight" as "day", amount: 1 },
          starting: "2024-01-01",
          directive: "template",
          priority: 1,
        },
      ]);
      expect(() => ctx.runTemplatesForPriority(1, 1_000_000, 1_000_000)).toThrow(
        /Unrecognized periodic period/,
      );
    });
  });

  describe("further engine coverage", () => {
    const engine: TemplateCategory = { id: "engine-cat", name: "Engine Category", isIncome: false };
    const income: TemplateCategory = { id: "income-cat", name: "Income", isIncome: true };
    const at = (
      templates: ReadonlyArray<Template>,
      month: string,
      fromLastMonth = 0,
      options: { hideFraction?: boolean; cat?: TemplateCategory } = {},
    ) =>
      make(
        templates,
        month,
        fromLastMonth,
        0,
        fakeEnv({ hideFraction: options.hideFraction ?? false }),
        options.cat ?? engine,
      );
    const monthly = (amount: number, priority: number): Template => ({
      type: "periodic",
      amount,
      period: { period: "month", amount: 1 },
      starting: "2024-01-01",
      directive: "template",
      priority,
    });
    const capped = (monthlyAmount: number, limit: object) =>
      ({
        type: "simple",
        monthly: monthlyAmount,
        limit,
        directive: "template",
        priority: 1,
      }) as Template;

    it("clamps remainder allocation when the per-category cap is reached", () => {
      const instance = at(
        [
          {
            type: "limit",
            amount: 100,
            hold: false,
            period: "monthly",
            directive: "template",
            priority: null,
          },
          { type: "remainder", weight: 1, directive: "template", priority: null },
        ],
        "2024-01",
        3000,
      );
      expect(instance.runRemainder(10000, 8000)).toBe(7000);
    });

    it("drops sub-dollar amounts from remainder when hideDecimal is set", () => {
      const instance = at(
        [{ type: "remainder", weight: 1, directive: "template", priority: null }],
        "2024-01",
        0,
        { hideFraction: true },
      );
      expect(instance.runRemainder(20000, 12345)).toBe(12300);
    });

    it("negates the budget for income categories at non-zero priority", () => {
      const instance = at([monthly(100, 1)], "2024-01", 0, { cat: income });
      expect(instance.runTemplatesForPriority(1, 1_000_000, 1_000_000)).toBe(-10000);
    });

    it("reports limit excess when carried-over balance exceeds a weekly cap", () => {
      const instance = at(
        [
          {
            type: "limit",
            amount: 50,
            hold: false,
            period: "weekly",
            start: "2024-01-01",
            directive: "template",
            priority: null,
          },
        ],
        "2024-01",
        30000,
      );
      expect(instance.getLimitExcess()).toBe(5000);
    });

    it("runAll iterates priorities in order and budgets the high-priority template first", () => {
      const instance = at([monthly(100, 1), monthly(50, 2)], "2024-01");
      expect(instance.runAll(1_000_000)).toBe(15000);
      expect(instance.getValues().budgeted).toBe(15000);
    });

    it("partial-month coverage when a weekly limit starts mid-month", () => {
      const instance = at(
        [capped(200, { amount: 50, hold: false, period: "weekly", start: "2024-01-15" })],
        "2024-01",
      );
      expect(instance.runTemplatesForPriority(1, 1_000_000, 1_000_000)).toBe(15000);
    });

    it("does not double-count weeks for a weekly limit starting before the month", () => {
      const instance = at(
        [capped(1000, { amount: 100, hold: false, period: "weekly", start: "2023-12-25" })],
        "2024-01",
      );
      expect(instance.runTemplatesForPriority(1, 1_000_000, 1_000_000)).toBe(50000);
    });

    it("returns zero excess when hold is set on a weekly limit, even with carryover above the cap", () => {
      const instance = at(
        [
          {
            type: "limit",
            amount: 50,
            hold: true,
            period: "weekly",
            start: "2024-01-01",
            directive: "template",
            priority: null,
          },
        ],
        "2024-01",
        30000,
      );
      expect(instance.getLimitExcess()).toBe(0);
    });

    it("uses the actual day count for a daily limit in February (28 days)", () => {
      const instance = at([capped(10000, { amount: 10, hold: false, period: "daily" })], "2023-02");
      expect(instance.runTemplatesForPriority(1, 1_000_000, 1_000_000)).toBe(28000);
    });

    it("uses the actual day count for a daily limit in February of a leap year (29 days)", () => {
      const instance = at([capped(10000, { amount: 10, hold: false, period: "daily" })], "2024-02");
      expect(instance.runTemplatesForPriority(1, 1_000_000, 1_000_000)).toBe(29000);
    });
  });
});

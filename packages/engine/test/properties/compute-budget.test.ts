import { computeBudget, type BudgetInputs, type MonthResult } from "@reeve/contract/rules";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { runsOr, SEED } from "./budget.ts";

const settings = { numRuns: runsOr(300), seed: SEED, includeErrorInReport: true };

const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"];
const EXPENSES = ["rent", "food", "fun"];
const INCOMES = ["salary", "gifts"];
const ALL = [...EXPENSES, ...INCOMES];

const money = fc.integer({ min: -100_000, max: 100_000 });
const perCategory = <A>(value: fc.Arbitrary<A>) =>
  fc
    .tuple(...ALL.map(() => value))
    .map((values) => new Map(ALL.map((id, at) => [id, values[at]!])));
const perMonth = <A>(value: fc.Arbitrary<A>) => fc.tuple(...MONTHS.map(() => value));

interface Plan {
  readonly budgeted: ReadonlyArray<Map<string, number>>;
  readonly activity: ReadonlyArray<Map<string, number>>;
  readonly carryover: ReadonlyArray<Map<string, boolean>>;
  readonly otherIncome: ReadonlyArray<number>;
  readonly hold: ReadonlyArray<number>;
}

const plan: fc.Arbitrary<Plan> = fc.record({
  budgeted: perMonth(perCategory(money)),
  activity: perMonth(perCategory(money)),
  carryover: perMonth(perCategory(fc.boolean())),
  otherIncome: perMonth(money),
  hold: perMonth(fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 100_000 }))),
});

const month = fc.nat({ max: MONTHS.length - 1 });
const expense = fc.constantFrom(...EXPENSES);
const positive = fc.integer({ min: 1, max: 100_000 });

const inputsOf = (type: BudgetInputs["type"], drawn: Plan): BudgetInputs => {
  const at = (name: string) => MONTHS.indexOf(name);
  return {
    type,
    months: MONTHS,
    groups: [
      {
        id: "spending",
        isIncome: false,
        categories: EXPENSES.map((id) => ({ id, isIncome: false })),
      },
      { id: "earning", isIncome: true, categories: INCOMES.map((id) => ({ id, isIncome: true })) },
    ],
    activity: (name, id) => drawn.activity[at(name)]!.get(id)!,
    otherIncome: (name) => drawn.otherIncome[at(name)]!,
    budgeted: (name, id) => drawn.budgeted[at(name)]!.get(id)!,
    carryover: (name, id) => drawn.carryover[at(name)]!.get(id)!,
    hold: (name) => drawn.hold[at(name)]!,
  };
};

const budget = (type: BudgetInputs["type"], drawn: Plan) => computeBudget(inputsOf(type, drawn));

/** A plan with one category's figure in one month changed, the rest as they were. */
const withCell = <A>(
  table: ReadonlyArray<Map<string, A>>,
  at: number,
  id: string,
  change: (value: A) => A,
) =>
  table.map((row, index) => {
    if (index !== at) return row;
    const next = new Map(row);
    next.set(id, change(row.get(id)!));
    return next;
  });

const summaryOf = (result: MonthResult) => {
  if (result.summary.type !== "envelope") throw new Error("Not an envelope month");
  return result.summary;
};

const rowOf = (result: MonthResult, id: string) =>
  result.categories.find((category) => category.id === id)!;

const allOnly = (drawn: Plan, value: boolean) => ({
  ...drawn,
  carryover: drawn.carryover.map((row) => new Map([...row.keys()].map((id) => [id, value]))),
});

const sum = (values: ReadonlyArray<number>) => values.reduce((total, each) => total + each, 0);

const sumThrough = (table: ReadonlyArray<Map<string, number>>, at: number, ids: Array<string>) =>
  sum(table.slice(0, at + 1).flatMap((row) => ids.map((id) => row.get(id)!)));

describe("the envelope budget", () => {
  it("every cent has a place: what came in and went out is To Budget, held or in an envelope", () =>
    fc.assert(
      fc.property(plan, (drawn) => {
        budget("envelope", drawn).forEach((result, at) => {
          const summary = summaryOf(result);
          const moved =
            sumThrough(drawn.activity, at, ALL) + sum(drawn.otherIncome.slice(0, at + 1));
          expect([result.month, summary.toBudget + summary.hold + summary.totalBalance]).toEqual([
            result.month,
            moved,
          ]);
        });
      }),
      settings,
    ));

  it("assigning x more moves To Budget by -x and the envelope by +x, that month", () =>
    fc.assert(
      fc.property(plan, month, expense, money, (drawn, at, id, x) => {
        const before = budget("envelope", drawn);
        const after = budget("envelope", {
          ...drawn,
          budgeted: withCell(drawn.budgeted, at, id, (value) => value + x),
        });
        expect(summaryOf(after[at]!).toBudget).toBe(summaryOf(before[at]!).toBudget - x);
        expect(rowOf(after[at]!, id).balance).toBe(rowOf(before[at]!, id).balance + x);
        expect(after.slice(0, at), "months before it").toEqual(before.slice(0, at));
        for (const other of ALL.filter((each) => each !== id))
          expect(rowOf(after[at]!, other)).toEqual(rowOf(before[at]!, other));
      }),
      settings,
    ));

  it("moving money between envelopes keeps To Budget and the total in that month", () =>
    fc.assert(
      fc.property(plan, month, positive, (drawn, at, x) => {
        const before = budget("envelope", drawn);
        const after = budget("envelope", {
          ...drawn,
          budgeted: withCell(
            withCell(drawn.budgeted, at, "rent", (value) => value - x),
            at,
            "food",
            (value) => value + x,
          ),
        });
        const [was, now] = [summaryOf(before[at]!), summaryOf(after[at]!)];
        expect(now.toBudget).toBe(was.toBudget);
        expect(now.totalBalance).toBe(was.totalBalance);
        expect(rowOf(after[at]!, "rent").balance).toBe(rowOf(before[at]!, "rent").balance - x);
        expect(rowOf(after[at]!, "food").balance).toBe(rowOf(before[at]!, "food").balance + x);
      }),
      settings,
    ));

  it("with everything rolling over, money moved between envelopes stays moved for good", () =>
    fc.assert(
      fc.property(plan, month, positive, (drawn, at, x) => {
        const rolling = allOnly(drawn, true);
        const before = budget("envelope", rolling);
        const after = budget("envelope", {
          ...rolling,
          budgeted: withCell(
            withCell(rolling.budgeted, at, "rent", (value) => value - x),
            at,
            "food",
            (value) => value + x,
          ),
        });
        for (let later = at; later < MONTHS.length; later++) {
          const [was, now] = [before[later]!, after[later]!];
          expect(summaryOf(now).toBudget).toBe(summaryOf(was).toBudget);
          expect(rowOf(now, "rent").balance).toBe(rowOf(was, "rent").balance - x);
          expect(rowOf(now, "food").balance).toBe(rowOf(was, "food").balance + x);
        }
      }),
      settings,
    ));

  it("spending x more comes out of the envelope, not out of this month's To Budget", () =>
    fc.assert(
      fc.property(plan, month, expense, money, (drawn, at, id, x) => {
        const before = budget("envelope", drawn);
        const after = budget("envelope", {
          ...drawn,
          activity: withCell(drawn.activity, at, id, (value) => value - x),
        });
        expect(summaryOf(after[at]!).toBudget).toBe(summaryOf(before[at]!).toBudget);
        expect(rowOf(after[at]!, id).balance).toBe(rowOf(before[at]!, id).balance - x);
      }),
      settings,
    ));

  it("the balance of a rolling category carries whole, a positive one even without rollover", () =>
    fc.assert(
      fc.property(plan, (drawn) => {
        const results = budget("envelope", drawn);
        results.slice(1).forEach((result, previousAt) => {
          const at = previousAt + 1;
          for (const id of EXPENSES) {
            const left = rowOf(results[previousAt]!, id).balance;
            const carried = drawn.carryover[previousAt]!.get(id)! || left > 0 ? left : 0;
            expect(rowOf(result, id).balance, `${id} in ${result.month}`).toBe(
              drawn.budgeted[at]!.get(id)! + drawn.activity[at]!.get(id)! + carried,
            );
          }
        });
      }),
      settings,
    ));

  it("rollover on an overspent category moves the debt from next To Budget to its envelope", () =>
    fc.assert(
      fc.property(plan, fc.nat({ max: MONTHS.length - 2 }), expense, (drawn, at, id) => {
        const off = {
          ...drawn,
          carryover: withCell(drawn.carryover, at, id, () => false),
        };
        const on = { ...drawn, carryover: withCell(drawn.carryover, at, id, () => true) };
        const [without, withIt] = [budget("envelope", off), budget("envelope", on)];
        const left = rowOf(without[at]!, id).balance;
        const debt = Math.min(0, left);
        expect(summaryOf(withIt[at + 1]!).toBudget).toBe(
          summaryOf(without[at + 1]!).toBudget - debt,
        );
        expect(rowOf(withIt[at + 1]!, id).balance).toBe(rowOf(without[at + 1]!, id).balance + debt);
      }),
      settings,
    ));

  it("x more income raises To Budget by x from that month on", () =>
    fc.assert(
      fc.property(plan, month, money, (drawn, at, x) => {
        const before = budget("envelope", drawn);
        const after = budget("envelope", {
          ...drawn,
          otherIncome: drawn.otherIncome.map((value, index) => (index === at ? value + x : value)),
        });
        for (let later = at; later < MONTHS.length; later++)
          expect(summaryOf(after[later]!).toBudget).toBe(summaryOf(before[later]!).toBudget + x);
      }),
      settings,
    ));

  it("a hold takes money from this month's To Budget and gives it back next month", () =>
    fc.assert(
      fc.property(plan, fc.nat({ max: MONTHS.length - 2 }), positive, (drawn, at, x) => {
        const withoutHold = {
          ...drawn,
          hold: drawn.hold.map((value, index) => (index === at ? 0 : value)),
        };
        const held = {
          ...drawn,
          hold: drawn.hold.map((value, index) => (index === at ? x : value)),
        };
        const [before, after] = [budget("envelope", withoutHold), budget("envelope", held)];
        const auto = summaryOf(before[at]!).hold;
        expect(summaryOf(after[at]!).hold).toBe(x);
        expect(summaryOf(after[at]!).toBudget).toBe(summaryOf(before[at]!).toBudget + auto - x);
        expect(summaryOf(after[at + 1]!).toBudget).toBe(summaryOf(before[at + 1]!).toBudget);
      }),
      settings,
    ));

  it("income rolled over is held until next month", () =>
    fc.assert(
      fc.property(
        plan,
        fc.nat({ max: MONTHS.length - 2 }),
        fc.constantFrom(...INCOMES),
        (drawn, at, id) => {
          const free = {
            ...drawn,
            hold: drawn.hold.map(() => 0),
            carryover: withCell(drawn.carryover, at, id, () => false),
          };
          const kept = { ...free, carryover: withCell(free.carryover, at, id, () => true) };
          const [before, after] = [budget("envelope", free), budget("envelope", kept)];
          const income = drawn.activity[at]!.get(id)!;
          expect(summaryOf(after[at]!).toBudget).toBe(summaryOf(before[at]!).toBudget - income);
          expect(summaryOf(after[at + 1]!).toBudget).toBe(summaryOf(before[at + 1]!).toBudget);
        },
      ),
      settings,
    ));

  it("a group is the sum of its categories", () =>
    fc.assert(
      fc.property(
        plan,
        fc.constantFrom("envelope" as const, "tracking" as const),
        (drawn, type) => {
          for (const result of budget(type, drawn)) {
            const of = (ids: Array<string>, field: "budgeted" | "spent" | "balance") =>
              sum(ids.map((id) => rowOf(result, id)[field]));
            for (const [group, ids] of [
              ["spending", EXPENSES],
              ["earning", INCOMES],
            ] as const) {
              const row = result.groups.find((each) => each.id === group)!;
              expect(row.budgeted).toBe(of([...ids], "budgeted"));
              expect(row.spent).toBe(of([...ids], "spent"));
              expect(row.balance).toBe(of([...ids], "balance"));
            }
          }
        },
      ),
      settings,
    ));
});

const trackingOf = (result: MonthResult) => {
  if (result.summary.type !== "tracking") throw new Error("Not a tracking month");
  return result.summary;
};

describe("the tracking budget", () => {
  it("saved is income plus spending, budgeted saved is budgeted income minus expenses", () =>
    fc.assert(
      fc.property(plan, (drawn) => {
        budget("tracking", drawn).forEach((result, at) => {
          const summary = trackingOf(result);
          const of = (table: ReadonlyArray<Map<string, number>>, ids: Array<string>) =>
            sum(ids.map((id) => table[at]!.get(id)!));
          const income = of(drawn.activity, INCOMES) + drawn.otherIncome[at]!;
          expect(summary.income).toBe(income);
          expect(summary.spent).toBe(of(drawn.activity, EXPENSES));
          expect(summary.saved).toBe(income + of(drawn.activity, EXPENSES));
          expect(summary.budgetedIncome).toBe(of(drawn.budgeted, INCOMES));
          expect(summary.budgetedExpenses).toBe(of(drawn.budgeted, EXPENSES));
          expect(summary.budgetedSaved).toBe(
            of(drawn.budgeted, INCOMES) - of(drawn.budgeted, EXPENSES),
          );
        });
      }),
      settings,
    ));

  it("without rollover a month stands alone: no month's figures reach another", () =>
    fc.assert(
      fc.property(plan, plan, month, (drawn, other, at) => {
        const still = allOnly(drawn, false);
        const mixed: Plan = {
          budgeted: other.budgeted.map((row, index) => (index === at ? drawn.budgeted[at]! : row)),
          activity: other.activity.map((row, index) => (index === at ? drawn.activity[at]! : row)),
          otherIncome: other.otherIncome.map((value, index) =>
            index === at ? drawn.otherIncome[at]! : value,
          ),
          carryover: still.carryover,
          hold: other.hold,
        };
        expect(budget("tracking", mixed)[at]).toEqual(budget("tracking", still)[at]);
      }),
      settings,
    ));

  it("with rollover every month, a balance is all that was given and spent so far", () =>
    fc.assert(
      fc.property(plan, (drawn) => {
        const rolling = allOnly(drawn, true);
        budget("tracking", rolling).forEach((result, at) => {
          for (const id of EXPENSES)
            expect(rowOf(result, id).balance).toBe(
              sumThrough(rolling.budgeted, at, [id]) + sumThrough(rolling.activity, at, [id]),
            );
          for (const id of INCOMES)
            expect(rowOf(result, id).balance).toBe(
              sumThrough(rolling.budgeted, at, [id]) - sumThrough(rolling.activity, at, [id]),
            );
        });
      }),
      settings,
    ));

  it("assigning x more moves the category's balance, and the next only when it rolls over", () =>
    fc.assert(
      fc.property(
        plan,
        fc.nat({ max: MONTHS.length - 2 }),
        fc.constantFrom(...ALL),
        money,
        (drawn, at, id, x) => {
          const before = budget("tracking", drawn);
          const after = budget("tracking", {
            ...drawn,
            budgeted: withCell(drawn.budgeted, at, id, (value) => value + x),
          });
          expect(rowOf(after[at]!, id).balance).toBe(rowOf(before[at]!, id).balance + x);
          const rolls = drawn.carryover[at]!.get(id)!;
          expect(rowOf(after[at + 1]!, id).balance).toBe(
            rowOf(before[at + 1]!, id).balance + (rolls ? x : 0),
          );
          expect(trackingOf(after[at]!).saved, "what really happened").toBe(
            trackingOf(before[at]!).saved,
          );
        },
      ),
      settings,
    ));

  it("a hold means nothing in a tracking budget", () =>
    fc.assert(
      fc.property(plan, (drawn) => {
        const noHold = { ...drawn, hold: drawn.hold.map(() => 0) };
        expect(budget("tracking", drawn)).toEqual(budget("tracking", noHold));
      }),
      settings,
    ));
});

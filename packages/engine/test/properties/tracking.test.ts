import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runsOr, SEED } from "./budget.ts";
import { freezeClock, openWorld, thawClock, THIS_MONTH } from "./world.ts";

const NEVER = 3_600_000;
const settings = { numRuns: runsOr(15), seed: SEED, includeErrorInReport: true };

const entry = fc.record({
  day: fc.constantFrom("2026-05-10", "2026-06-02", "2026-06-20"),
  amount: fc.integer({ min: -100_000, max: 100_000 }).filter((each) => each !== 0),
  kind: fc.constantFrom(
    "category",
    "income",
    "uncategorized",
    "withinBudget",
    "offBudget",
    "offBudgetCategory",
    "intoBudget",
    "offBudgetOnly",
  ),
  category: fc.nat({ max: 99 }),
});

const assigned = fc.record({
  month: fc.constantFrom("2026-05", THIS_MONTH),
  category: fc.nat({ max: 99 }),
  amount: fc.integer({ min: -100_000, max: 100_000 }),
});

beforeAll(freezeClock);
afterAll(thawClock);

describe("a tracking book", () => {
  it(
    "saved in a month is what the budget accounts gained, leaving out Uncategorized",
    { timeout: NEVER },
    () =>
      fc.assert(
        fc.asyncProperty(
          fc.array(entry, { maxLength: 12 }),
          fc.array(assigned, { maxLength: 6 }),
          fc.integer({ min: 0, max: 100_000 }),
          async (entries, budgets, opening) => {
            const world = await openWorld();
            try {
              await world.call("update_book", { budgetType: "tracking" });
              const make = async (name: string, onBudget: boolean, balance = 0) =>
                (
                  await world.call("create_account", {
                    name,
                    onBudget,
                    balance,
                    date: "2026-05-01",
                  })
                ).id as string;
              const checking = await make("Checking", true, opening);
              const card = await make("Card", true);
              const savings = await make("Savings", false, 5000);
              const brokerage = await make("Brokerage", false);
              const groups = await world.call<Array<any>>("list_categories");
              const inGroups = (income: boolean) =>
                groups
                  .filter((group) => group.isIncome === income)
                  .flatMap((group) => group.categories.map((each: any) => each.id as string));
              const [expenses, incomes] = [inGroups(false), inGroups(true)];
              const of = (items: ReadonlyArray<string>, at: number) => items[at % items.length]!;
              for (const each of entries) {
                const base = { date: each.day, account: checking, amount: each.amount };
                const lines = {
                  category: { category: of(expenses, each.category) },
                  income: { category: of(incomes, each.category) },
                  uncategorized: {},
                  withinBudget: { transferAccount: card },
                  offBudget: { transferAccount: savings },
                  offBudgetCategory: {
                    transferAccount: savings,
                    category: of(expenses, each.category),
                  },
                  intoBudget: { account: savings, transferAccount: checking },
                  offBudgetOnly: { account: savings, transferAccount: brokerage },
                }[each.kind];
                await world.call("create_transaction", { ...base, ...lines });
              }
              for (const each of budgets)
                await world.call("set_budget", {
                  month: each.month,
                  category: of([...expenses, ...incomes], each.category),
                  amount: each.amount,
                });
              for (const month of ["2026-05", THIS_MONTH]) {
                const budget = await world.call("get_budget", { month });
                const [{ gained }] = world.all<{ gained: number | null }>(
                  `SELECT sum(p.amount) AS gained
                   FROM postings p JOIN transactions t ON t.id = p.transaction_id
                   JOIN accounts a ON a.id = p.account_id
                   WHERE a.on_budget = 1 AND a.type IN ('asset', 'liability')
                     AND t.date / 100 = ${Number(month.replace("-", ""))}`,
                ) as [{ gained: number | null }];
                const [{ uncategorized }] = world.all<{ uncategorized: number | null }>(
                  `SELECT sum(-p.amount) AS uncategorized
                   FROM postings p JOIN transactions t ON t.id = p.transaction_id
                   JOIN accounts a ON a.id = p.account_id
                   WHERE a.system = 'uncategorized'
                     AND t.date / 100 = ${Number(month.replace("-", ""))}`,
                ) as [{ uncategorized: number | null }];
                const { summary } = budget.months[0];
                expect(summary.type).toBe("tracking");
                expect([month, summary.saved + (uncategorized ?? 0)]).toEqual([month, gained ?? 0]);
              }
            } finally {
              await world.close();
            }
          },
        ),
        settings,
      ),
  );
});

import type { BudgetMonth, BudgetView } from "@reeve/contract";
import { describe, expect, it } from "vitest";
import { categoryPaces, monthInsight } from "./home";

const view = {
  groups: [
    {
      isIncome: false,
      categories: [
        { id: "food", name: "Food" },
        { id: "fun", name: "Fun" },
      ],
    },
    { isIncome: true, categories: [{ id: "pay", name: "Pay" }] },
  ],
} as unknown as BudgetView;

const month = (
  categories: ReadonlyArray<{ id: string; budgeted: number; spent: number; balance: number }>,
  summary: Record<string, unknown>,
) => ({ categories, summary: { type: "envelope", ...summary } }) as unknown as BudgetMonth;

const words = (sentence: ReadonlyArray<{ text?: string; money?: number }>) =>
  sentence.map((part) => part.text ?? `<${part.money}>`).join("");

const insight = (at: BudgetMonth) => monthInsight({ view, month: at, day: 4, daysInMonth: 30 });

describe("monthInsight", () => {
  it("names the worst overspent category and how far over it is", () => {
    const result = insight(
      month(
        [
          { id: "food", budgeted: 100, spent: -150, balance: -50 },
          { id: "fun", budgeted: 100, spent: -300, balance: -200 },
        ],
        { toBudget: 0, totalBudgeted: -200, totalSpent: -450 },
      ),
    );
    expect(result.verdict).toBe("over budget");
    expect(words(result.sentence)).toBe(
      "2 categories are overspent, led by Fun at <200> over. All of your money has a job.",
    );
  });

  it("says what share is spent and how many days are left when under budget", () => {
    const result = insight(
      month([{ id: "food", budgeted: 400, spent: -100, balance: 300 }], {
        toBudget: 50,
        totalBudgeted: -400,
        totalSpent: -100,
      }),
    );
    expect(result.verdict).toBe("under budget");
    expect(words(result.sentence)).toBe(
      "You have spent <100> of the <400> budgeted, 25%, with 26 days to go. <50> is still waiting to be budgeted.",
    );
  });

  it("does not call an empty month under budget", () => {
    const result = insight(month([], { toBudget: 900, totalBudgeted: 0, totalSpent: 0 }));
    expect(result.verdict).toBe("not budgeted yet");
  });
});

describe("categoryPaces", () => {
  it("leaves out income and idle categories, fullest budget first", () => {
    const paces = categoryPaces(
      view,
      month(
        [
          { id: "pay", budgeted: 0, spent: 500, balance: 0 },
          { id: "fun", budgeted: 0, spent: 0, balance: 0 },
          { id: "food", budgeted: 200, spent: -50, balance: 150 },
        ],
        {},
      ),
    );
    expect(paces).toEqual([
      { id: "food", name: "Food", spent: 50, budgeted: 200, percent: 25, over: false },
    ]);
  });
});

import type { BudgetMonth, BudgetView } from "@reeve/contract";

export type Tone = "positive" | "negative" | "neutral";

/** A run of the insight sentence: words, or an amount the page formats in the book's money. */
export type Part =
  | { readonly text: string; readonly tone?: Tone }
  | { readonly money: number; readonly tone?: Tone };

export interface Insight {
  /** Finishes "This month you are…". */
  readonly verdict: string;
  readonly tone: Tone;
  readonly sentence: ReadonlyArray<Part>;
}

export interface CategoryPace {
  readonly id: string;
  readonly name: string;
  readonly spent: number;
  readonly budgeted: number;
  /** Spent as a whole percentage of budgeted; null when nothing is budgeted. */
  readonly percent: number | null;
  readonly over: boolean;
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

const expenseIds = (view: BudgetView) =>
  new Map(
    view.groups
      .filter((group) => !group.isIncome)
      .flatMap((group) => group.categories)
      .map((category) => [category.id, category.name]),
  );

/** Each expense category with money this month, the fullest budgets first. */
export const categoryPaces = (
  view: BudgetView,
  month: BudgetMonth,
): ReadonlyArray<CategoryPace> => {
  const names = expenseIds(view);
  return month.categories
    .filter(
      (category) => names.has(category.id) && (category.budgeted !== 0 || category.spent !== 0),
    )
    .map((category) => {
      const spent = -category.spent;
      return {
        id: category.id,
        name: names.get(category.id)!,
        spent,
        budgeted: category.budgeted,
        percent: category.budgeted > 0 ? Math.round((spent / category.budgeted) * 100) : null,
        over: category.balance < 0,
      };
    })
    .toSorted((a, b) => b.budgeted - a.budgeted || b.spent - a.spent);
};

/** Today's place in its month, as `monthInsight` takes it. */
export const monthProgress = () => {
  const now = new Date();
  return {
    day: now.getDate(),
    daysInMonth: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
  };
};

const daysLeft = (day: number, daysInMonth: number) => daysInMonth - day;

/**
 * The sentence that opens Home, from the month's own figures. `day` is today's day of the month. It
 * reads no model and guesses nothing: each clause is one figure of the budget.
 */
export const monthInsight = ({
  view,
  month,
  day,
  daysInMonth,
}: {
  view: BudgetView;
  month: BudgetMonth;
  day: number;
  daysInMonth: number;
}): Insight => {
  const paces = categoryPaces(view, month);
  const overspent = paces
    .filter((pace) => pace.over)
    .toSorted((a, b) => a.budgeted - a.spent - (b.budgeted - b.spent));
  const left = daysLeft(day, daysInMonth);
  const leftWords = `${plural(left, "day")} to go`;
  const summary = month.summary;

  if (summary.type === "tracking") {
    const under = summary.spent >= summary.budgetedExpenses;
    return {
      verdict: under ? "under budget" : "over budget",
      tone: under ? "positive" : "negative",
      sentence: [
        { text: "You have spent " },
        { money: -summary.spent },
        { text: " of the " },
        { money: -summary.budgetedExpenses },
        { text: ` you planned, with ${leftWords}. So far you have saved ` },
        { money: summary.saved, tone: summary.saved < 0 ? "negative" : "positive" },
        { text: "." },
      ],
    };
  }

  const toBudget: ReadonlyArray<Part> =
    summary.toBudget > 0
      ? [
          { money: summary.toBudget, tone: "positive" },
          { text: " is still waiting to be budgeted." },
        ]
      : summary.toBudget < 0
        ? [
            { text: "You have budgeted " },
            { money: -summary.toBudget, tone: "negative" },
            { text: " more than you have." },
          ]
        : [{ text: "All of your money has a job." }];

  if (overspent.length > 0) {
    const worst = overspent[0]!;
    return {
      verdict: "over budget",
      tone: "negative",
      sentence: [
        {
          text: `${plural(overspent.length, "category", "categories")} ${overspent.length === 1 ? "is" : "are"} overspent, led by ${worst.name} at `,
        },
        { money: worst.spent - worst.budgeted, tone: "negative" },
        { text: " over. " },
        ...toBudget,
      ],
    };
  }

  const budgeted = -summary.totalBudgeted;
  if (budgeted === 0)
    return {
      verdict: "not budgeted yet",
      tone: "neutral",
      sentence: [{ text: "Nothing is budgeted this month. " }, ...toBudget],
    };

  const spent = -summary.totalSpent;
  return {
    verdict: "under budget",
    tone: "positive",
    sentence: [
      { text: "You have spent " },
      { money: spent },
      { text: ` of the ` },
      { money: budgeted },
      { text: ` budgeted, ${Math.round((spent / budgeted) * 100)}%, with ${leftWords}. ` },
      ...toBudget,
    ],
  };
};

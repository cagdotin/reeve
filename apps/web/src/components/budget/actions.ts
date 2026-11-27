/** Actual's budget actions, for a whole month or one category. */
export const BUDGET_ACTIONS = [
  ["copy-last", "Copy last month's budget"],
  ["set-zero", "Set budgets to zero"],
  ["average-3", "Set to 3 month average"],
  ["average-6", "Set to 6 month average"],
  ["average-12", "Set to yearly average"],
  ["set-to-spent", "Set budgets to what was spent"],
  ["copy-until-year-end", "Copy to the rest of the year"],
] as const;

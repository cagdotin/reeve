import { Schema } from "effect";
import { Amount, BudgetView, FigureRecords, Id, Month } from "../domain.ts";
import { BookField, cli, inBook, type Operation } from "../operation.ts";

const MonthField = Month.annotate({ description: "Month, YYYY-MM" });
const CategoryField = Schema.String.annotate({ description: "Category id" });
const FromOrToBudget = Schema.String.annotate({ description: 'Category id, or "to-budget"' });

const done = Schema.Struct({ month: Month });

export const budget = {
  get_budget: {
    description:
      "Read the budget of one or more months: for each category what is budgeted, spent and its balance, group totals, and the month's summary (envelope: income, To Budget, hold, overspending; tracking: budgeted and real income, spending, savings).",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      month: Schema.optionalKey(MonthField).annotate({
        description: "First month; this month by default",
      }),
      count: Schema.optionalKey(Schema.Int).annotate({
        description: "How many months, 1 to 12; 1 by default",
      }),
    }),
    success: BudgetView,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/budget" },
    cli: {
      command: ["budget", "show"],
      description: "Show a month's budget",
      examples: [{ command: "reeve budget show --month 2026-11", description: "November" }],
    },
  },
  budget_transactions: {
    description:
      "The transactions behind a budget figure for one month: a category's spent (or received) total in get_budget, its subcategories included, or a group's. Give category or group. Each register row shows from its budget account's side, with what it counts toward the figure, which for a split is only its lines in scope. Their counted amounts sum to the figure.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      category: Schema.optionalKey(Id).annotate({
        description: "Category id; its subcategories count too",
        ...cli({ alias: "c" }),
      }),
      group: Schema.optionalKey(Id).annotate({ description: "Category group id" }),
      month: MonthField,
    }),
    success: FigureRecords,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/budget/transactions" },
    cli: {
      command: ["budget", "transactions"],
      description: "List the transactions behind a category's or group's spending in a month",
    },
  },
  set_budget: {
    description:
      "Set what a month assigns to a category. An income category takes an amount only in a tracking budget.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book: BookField,
      month: MonthField,
      category: CategoryField,
      amount: Amount,
    }),
    success: done,
    error: inBook(),
    http: { method: "PUT", path: "/books/:book/budget/:month/categories/:category" },
    cli: {
      command: ["budget", "set"],
      description: "Assign money to a category",
      examples: [
        {
          command: "reeve budget set --month 2026-11 --category <id> --amount 40000",
          description: "400.00",
        },
      ],
    },
  },
  set_carryover: {
    description:
      "Turn rolling over overspending on or off for a category from a month on: its negative balance then carries into next month instead of coming out of To Budget. On an income category in an envelope budget, its income is held for next month.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book: BookField,
      month: MonthField,
      category: CategoryField,
      carryover: Schema.Boolean,
    }),
    success: done,
    error: inBook(),
    http: { method: "PUT", path: "/books/:book/budget/:month/carryover/:category" },
  },
  move_budget: {
    description:
      "Move budgeted money in a month from one category to another, or between a category and To Budget, noting it on the month.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      month: MonthField,
      from: FromOrToBudget,
      to: FromOrToBudget,
      amount: Amount,
    }),
    success: done,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/budget/:month/move" },
    cli: { command: ["budget", "move"], description: "Move money between categories" },
  },
  cover_overspending: {
    description:
      "Cover a category's negative balance from another category's balance or from To Budget; all of it unless amount says how much.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      month: MonthField,
      category: CategoryField.annotate({ description: "The overspent category" }),
      from: FromOrToBudget,
      amount: Schema.optionalKey(Amount),
    }),
    success: done,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/budget/:month/cover-overspending" },
  },
  cover_overbudgeted: {
    description:
      "Cover a negative To Budget by taking from a category's balance; all of it unless amount says.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      month: MonthField,
      category: CategoryField,
      amount: Schema.optionalKey(Amount),
    }),
    success: done,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/budget/:month/cover-overbudgeted" },
  },
  hold_for_next_month: {
    description: "Hold money of To Budget for next month; at most what To Budget has.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({ book: BookField, month: MonthField, amount: Amount }),
    success: done,
    error: inBook(),
    http: { method: "PUT", path: "/books/:book/budget/:month/hold" },
    cli: { command: ["budget", "hold"], description: "Hold money for next month" },
  },
  reset_hold: {
    description: "Release the money held for next month back to To Budget.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({ book: BookField, month: MonthField }),
    success: done,
    error: inBook(),
    http: { method: "DELETE", path: "/books/:book/budget/:month/hold" },
  },
  apply_budget_action: {
    description:
      "Apply a budget action to a month, or to one category when category is given: copy-last (last month's budget), set-zero, average-3/average-6/average-12 (average spending of the months before), copy-until-year-end (this month's budget to the rest of the year), set-to-spent (what was spent).",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      month: MonthField,
      action: Schema.Literals([
        "copy-last",
        "set-zero",
        "average-3",
        "average-6",
        "average-12",
        "copy-until-year-end",
        "set-to-spent",
      ]),
      category: Schema.optionalKey(CategoryField),
    }),
    success: done,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/budget/:month/actions" },
    cli: { command: ["budget", "apply"], description: "Copy, zero or average a month's budget" },
  },
} satisfies Record<string, Operation>;

import { Schema } from "effect";
import { Account, Amount, Day, Id, LedgerAccount, Month } from "../domain.ts";
import {
  AccountScopeFields,
  BookField,
  IdField,
  cli,
  inBook,
  type Operation,
} from "../operation.ts";

const AccountId = IdField("Account id");

/**
 * Money over a stretch of time, as the account sees it. `in` and `out` count only category lines:
 * what came from or went to outside the book. The rest of what moved the balance is `transfers`
 * (to and from accounts outside the scope) and `opening` (opening balances), so that
 * `in - out + transfers + opening` is always the balance's change.
 */
const ActivityTotals = {
  in: Schema.Int,
  out: Schema.Int,
  transfers: Schema.Int,
  opening: Schema.Int,
  /** Register rows. */
  count: Schema.Int,
};

/** A ranked category, payee or account, with the same number for the period before. */
const ActivityRank = Schema.Struct({
  id: Id,
  name: Schema.String,
  /** Net spending, refunds taken off. */
  amount: Schema.Int,
  previous: Schema.Int,
  /** Register rows in the period. */
  count: Schema.Int,
});

export const AccountActivity = Schema.Struct({
  /** The system category "Uncategorized", which ranks among the others; null until first used. */
  uncategorizedId: Schema.NullOr(Id),
  /** The first month with a transaction in scope. */
  earliest: Schema.NullOr(Month),
  /**
   * The chart's months, oldest first. No gaps up to a year ahead; later months appear only if they
   * have rows. `balance` is null for the uncategorized queue.
   */
  months: Schema.Array(
    Schema.Struct({ month: Month, balance: Schema.NullOr(Schema.Int), ...ActivityTotals }),
  ),
  /** The months the totals and rankings cover: the chosen month, or the range. */
  period: Schema.Struct({
    from: Schema.NullOr(Month),
    to: Schema.NullOr(Month),
    ...ActivityTotals,
    /** As many months just before it; null when the scope does not reach that far back. */
    previous: Schema.NullOr(Schema.Struct(ActivityTotals)),
  }),
  /** Where the money went: the largest net spenders of the period. Transfers are not spending. */
  categories: Schema.Array(ActivityRank),
  payees: Schema.Array(ActivityRank),
  /** For the uncategorized queue: what waits in each account. Empty otherwise. */
  accounts: Schema.Array(ActivityRank),
  /** Month-end balances from this month on with the schedules' coming transactions added. */
  projection: Schema.Array(
    Schema.Struct({ month: Month, balance: Schema.Int, scheduled: Schema.Int }),
  ),
  attention: Schema.Struct({
    /** Rows on budget accounts with no category, as the uncategorized view lists them. */
    uncategorized: Schema.Int,
    /** Rows neither cleared nor reconciled, dated more than 30 days ago. */
    oldUncleared: Schema.Int,
    /** Rows cleared but not yet reconciled. */
    toReconcile: Schema.Int,
    /** The latest day with a reconciled row, which is not when the reconciling happened. */
    lastReconciled: Schema.NullOr(Day),
    /** Schedules whose date has passed with nothing recorded. */
    missedSchedules: Schema.Int,
  }),
});
export type AccountActivity = typeof AccountActivity.Type;

export const accounts = {
  list_accounts: {
    description:
      "List the asset and liability accounts (checking, savings, credit cards, loans) in their order, with balances. Closed accounts only when closed is true.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      closed: Schema.optionalKey(Schema.Boolean).annotate({
        description: "Include closed accounts",
      }),
    }),
    success: Schema.Array(Account),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/accounts" },
    cli: { command: ["accounts", "list"], description: "List accounts and balances" },
  },
  account_activity: {
    description:
      "How an account or a set of accounts got to its balance: month-end balances, money in and out by month (category lines only, so transfers are not spending), the top categories and payees of a period against the period before, the schedules' projected balances, and what needs tidying (uncategorized, old uncleared, last reconciled day, missed schedules). All accounts when no scope is given.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      ...AccountScopeFields,
      uncategorized: Schema.optionalKey(Schema.Boolean).annotate({
        description: "Only the transactions of budget accounts that have no category",
      }),
      months: Schema.optionalKey(Schema.Int).annotate({
        description: "How many months up to this one to cover; all of them by default",
      }),
      month: Schema.optionalKey(Month).annotate({
        description: "Narrow the totals and rankings to this month; the months stay as they are",
      }),
    }),
    success: AccountActivity,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/accounts/activity" },
    cli: {
      command: ["accounts", "activity"],
      description: "Show how an account got to its balance",
    },
  },
  list_ledger_accounts: {
    description:
      "List every account of the double-entry ledger: assets, liabilities, equity, and the income and expense accounts that are the budget's categories.",
    readonly: true,
    input: Schema.Struct({ book: BookField }),
    success: Schema.Array(LedgerAccount),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/ledger-accounts" },
  },
  create_account: {
    description:
      "Create an account. A starting balance becomes an opening-balance transaction on its date; on a budget account it goes to To Budget.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      name: Schema.NonEmptyString.annotate(cli({ positional: true })),
      type: Schema.optionalKey(Schema.Literals(["asset", "liability"])).annotate({
        description: "asset (default) or liability, as a credit card or loan",
      }),
      onBudget: Schema.optionalKey(Schema.Boolean).annotate({
        description: "Whether the budget covers it; true by default",
      }),
      balance: Schema.optionalKey(Amount).annotate({ description: "Starting balance in cents" }),
      date: Schema.optionalKey(Day).annotate({
        description: "Day of the starting balance; today by default",
      }),
    }),
    success: Account,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/accounts" },
    cli: {
      command: ["accounts", "create"],
      description: "Create an account",
      examples: [
        {
          command: 'reeve accounts create "Checking" --balance 150000',
          description: "1,500.00 to start",
        },
        { command: 'reeve accounts create "Visa" --type liability', description: "A credit card" },
      ],
    },
  },
  update_account: {
    description: "Rename an account or move it on or off budget.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book: BookField,
      id: AccountId,
      name: Schema.optionalKey(Schema.NonEmptyString),
      onBudget: Schema.optionalKey(Schema.Boolean),
    }),
    success: Account,
    error: inBook(),
    http: { method: "PATCH", path: "/books/:book/accounts/:id" },
    cli: {
      command: ["accounts", "update"],
      description: "Rename an account or change its budget status",
    },
  },
  move_account: {
    description: "Place an account before another one in the list, or last when before is null.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book: BookField,
      id: AccountId,
      before: Schema.NullOr(Schema.String),
    }),
    success: Schema.Array(Account),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/accounts/:id/move" },
  },
  close_account: {
    description:
      "Close an account. A remaining balance is moved first: to transferAccount as a transfer, or, for an on-budget account closing into the budget, to category. An account without transactions is deleted instead.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      id: AccountId,
      transferAccount: Schema.optionalKey(Schema.String),
      category: Schema.optionalKey(Schema.String),
    }),
    success: Schema.Struct({ id: Schema.String, deleted: Schema.Boolean }),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/accounts/:id/close" },
    cli: { command: ["accounts", "close"], description: "Close an account" },
  },
  reopen_account: {
    description: "Reopen a closed account.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({ book: BookField, id: AccountId }),
    success: Account,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/accounts/:id/reopen" },
    cli: { command: ["accounts", "reopen"], description: "Reopen a closed account" },
  },
  reconcile_account: {
    description:
      "Reconcile an account with a bank statement: when its cleared balance differs from balance, a cleared adjustment transaction makes up the difference (when adjust is true); then every cleared posting is locked as reconciled.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      id: AccountId,
      balance: Amount.annotate({ description: "The statement's balance in cents" }),
      adjust: Schema.optionalKey(Schema.Boolean).annotate({
        description:
          "Add an adjustment transaction for a difference; without it a difference is refused",
      }),
      date: Schema.optionalKey(Day),
    }),
    success: Schema.Struct({
      reconciled: Schema.Int,
      adjustment: Schema.NullOr(Amount),
    }),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/accounts/:id/reconcile" },
    cli: { command: ["accounts", "reconcile"], description: "Reconcile with a statement balance" },
  },
} satisfies Record<string, Operation>;

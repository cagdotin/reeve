/** Schedules: recurring and one-off transactions, upcoming and auto-posted. */
import { Schema } from "effect";
import { Amount, Day, Id, Transaction } from "../domain.ts";
import {
  AccountScopeFields,
  BookField,
  IdField,
  cli,
  inBook,
  type Operation,
} from "../operation.ts";
import { filterFields } from "./reports.ts";

// ---------------------------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------------------------

const Frequency = Schema.Literals(["daily", "weekly", "monthly", "yearly"]);

const Pattern = Schema.Struct({
  type: Schema.Literals(["day", "SU", "MO", "TU", "WE", "TH", "FR", "SA"]),
  value: Schema.Int,
});

export const Recurrence = Schema.Struct({
  start: Day,
  frequency: Frequency,
  interval: Schema.Int,
  /** Days of the month (`{ type: "day", value: 15 }`, -1 the last) or weekdays (`{ type: "FR", value: -1 }`). */
  patterns: Schema.optionalKey(Schema.Array(Pattern)),
  skipWeekend: Schema.optionalKey(Schema.Boolean),
  weekendSolveMode: Schema.optionalKey(Schema.Literals(["before", "after"])),
  endMode: Schema.optionalKey(Schema.Literals(["never", "after_n_occurrences", "on_date"])),
  endOccurrences: Schema.optionalKey(Schema.Int),
  endDate: Schema.optionalKey(Day),
});
export type Recurrence = typeof Recurrence.Type;

export const ScheduleAmount = Schema.Union([
  Schema.Struct({ op: Schema.Literals(["is", "isapprox"]), value: Amount }),
  Schema.Struct({
    op: Schema.Literal("isbetween"),
    value: Schema.Struct({ num1: Amount, num2: Amount }),
  }),
]);
export type ScheduleAmount = typeof ScheduleAmount.Type;

export const ScheduleStatus = Schema.Literals([
  "missed",
  "due",
  "upcoming",
  "scheduled",
  "paid",
  "completed",
]);
export type ScheduleStatus = typeof ScheduleStatus.Type;

export const Schedule = Schema.Struct({
  id: Id,
  name: Schema.NullOr(Schema.String),
  ruleId: Id,
  nextDate: Schema.NullOr(Day),
  completed: Schema.Boolean,
  postsTransaction: Schema.Boolean,
  payeeId: Schema.NullOr(Id),
  payee: Schema.NullOr(Schema.String),
  accountId: Schema.NullOr(Id),
  account: Schema.NullOr(Schema.String),
  amount: Schema.NullOr(ScheduleAmount),
  date: Schema.Union([Day, Recurrence]),
  /** `isapprox` matches transactions two days either side of an occurrence. */
  dateOp: Schema.Literals(["is", "isapprox"]),
  categoryId: Schema.NullOr(Id),
  notes: Schema.NullOr(Schema.String),
  /** "Every month on the 15th", or the day of a one-off schedule. */
  description: Schema.String,
  /** missed, due, upcoming, scheduled, paid or completed, as of today. */
  status: ScheduleStatus,
});
export type Schedule = typeof Schedule.Type;

/** A schedule's coming transaction as an account's register previews it. */
export const ScheduledTransaction = Schema.Struct({
  /** `preview/<schedule>/<day>`. */
  id: Schema.String,
  scheduleId: Id,
  scheduleName: Schema.NullOr(Schema.String),
  date: Day,
  accountId: Schema.NullOr(Id),
  payeeId: Schema.NullOr(Id),
  payee: Schema.NullOr(Schema.String),
  categoryId: Schema.NullOr(Id),
  notes: Schema.NullOr(Schema.String),
  /** As the account sees it; the middle of an isbetween range. */
  amount: Amount,
  status: ScheduleStatus,
  /** Shown as upcoming rather than due or missed: a later occurrence, or one after a paid one. */
  forceUpcoming: Schema.Boolean,
});
export type ScheduledTransaction = typeof ScheduledTransaction.Type;

/** A recurring transaction found in the history, ready to become a schedule. */
export const DiscoveredSchedule = Schema.Struct({
  accountId: Id,
  account: Schema.String,
  payeeId: Schema.NullOr(Id),
  payee: Schema.NullOr(Schema.String),
  amount: Amount,
  amountOp: Schema.Literals(["is", "isapprox"]),
  date: Recurrence,
  dateOp: Schema.Literals(["is", "isapprox"]),
  description: Schema.String,
});
export type DiscoveredSchedule = typeof DiscoveredSchedule.Type;

export const ForecastTransaction = Schema.Struct({
  amount: Amount,
  payee: Schema.NullOr(Schema.String),
  scheduleId: Id,
  scheduleName: Schema.String,
  occurrenceDate: Day,
  isTransfer: Schema.Boolean,
  isAccountless: Schema.Boolean,
});

export const ForecastPoint = Schema.Struct({
  date: Day,
  balance: Amount,
  /** `__unassigned_schedule__` for schedules without an account, `tracking-budget` for that source. */
  accountId: Schema.String,
  accountName: Schema.String,
  /** The schedules' projected transactions of the day. */
  transactions: Schema.Array(ForecastTransaction),
  /** Recorded activity of the day; absent for a tracking budget forecast. */
  recordedAmount: Schema.optionalKey(Amount),
});

export const Forecast = Schema.Struct({
  dataPoints: Schema.Array(ForecastPoint),
  lowestBalance: Schema.Struct({
    date: Day,
    balance: Amount,
    accountId: Schema.String,
    accountName: Schema.String,
  }),
  forecastStartDate: Day,
  forecastEndDate: Day,
});
export type Forecast = typeof Forecast.Type;

/** A transaction that looks like a schedule's, as its account sees it. */
const ScheduleCharge = Schema.Struct({
  id: Id,
  date: Day,
  amount: Amount,
  /** Linked to the schedule, or else matched by its payee, account and an occurrence's day. */
  linked: Schema.Boolean,
});

export const ScheduleActivity = Schema.Struct({
  ...Schedule.fields,
  /** What one occurrence counts for; the middle of a range. */
  expected: Amount,
  /** Normalized to a month, a yearly bill being one twelfth; 0 for a one-off or one that has ended. */
  monthly: Amount,
  categoryName: Schema.NullOr(Schema.String),
  /** Open occurrences from the next date through the window, earliest first: passed ones are missed. */
  occurrences: Schema.Array(Day),
  /** The latest charges, oldest first. */
  charges: Schema.Array(ScheduleCharge),
  linkedTransactions: Schema.Int.annotate({ description: "All linked transactions, all time" }),
  /** Charges have settled away from what it expects. */
  drift: Schema.NullOr(Schema.Struct({ actual: Amount, since: Day })),
  /** Its latest dates passed with no charge. */
  quiet: Schema.NullOr(Schema.Struct({ dates: Schema.Int, lastCharge: Schema.NullOr(Day) })),
  /** The last day of a recurrence that has an end. */
  endsOn: Schema.NullOr(Day),
});
export type ScheduleActivity = typeof ScheduleActivity.Type;

export const ScheduleOverview = Schema.Struct({
  today: Day,
  /** The last day `occurrences` reach. */
  until: Day,
  schedules: Schema.Array(ScheduleActivity),
  /** Schedules still running with no account: they cannot post, so a scope leaves them out. */
  noAccount: Schema.Int,
  /** What the next twelve months hold, this month first. */
  months: Schema.Array(Schema.Struct({ month: Schema.String, out: Amount, in: Amount })),
});
export type ScheduleOverview = typeof ScheduleOverview.Type;

const ScheduleId = IdField("Schedule id");

const UpcomingLength = Schema.optionalKey(Schema.String).annotate({
  description:
    "How far ahead counts as upcoming: a number of days (1, 7, 14), oneMonth, currentMonth, or N-day, N-week, N-month, N-year; 7 by default",
});

/** The fields that make a schedule's date: a day, or a recurrence starting on it. */
const DateFields = {
  dateOp: Schema.optionalKey(Schema.Literals(["is", "isapprox"])).annotate({
    description: "isapprox (default) also matches transactions two days either side",
  }),
  frequency: Schema.optionalKey(Schema.NullOr(Frequency)).annotate({
    description: "Makes it recur from date: daily, weekly, monthly or yearly",
    ...cli({ clear: "Make it a one-off schedule" }),
  }),
  interval: Schema.optionalKey(Schema.Int).annotate({
    description: "Every N periods; 1 by default",
  }),
  patterns: Schema.optionalKey(Schema.Array(Pattern)).annotate({
    description:
      'Monthly: days of the month ({ type: "day", value: 15 }, -1 the last) or weekdays ({ type: "FR", value: -1 })',
  }),
  skipWeekend: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Move an occurrence off the weekend",
  }),
  weekendSolveMode: Schema.optionalKey(Schema.Literals(["before", "after"])).annotate({
    description: "To the Friday before or the Monday after; after by default",
  }),
  endMode: Schema.optionalKey(Schema.Literals(["never", "after_n_occurrences", "on_date"])),
  endOccurrences: Schema.optionalKey(Schema.Int),
  endDate: Schema.optionalKey(Day),
};

const ScheduleFields = {
  name: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
    description: "A unique name",
  }),
  payee: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
    description: "Payee name; a new name creates the payee",
  }),
  account: Schema.optionalKey(Schema.NullOr(Id)).annotate({
    description: "The asset or liability account it happens in",
  }),
  amountOp: Schema.optionalKey(Schema.Literals(["is", "isapprox", "isbetween"])).annotate({
    description:
      "isapprox (default) matches 7.5% either side; isbetween matches amount to amountTo",
  }),
  amountTo: Schema.optionalKey(Amount).annotate({
    description: "The other end of an isbetween range",
  }),
  postsTransaction: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Add the transaction by itself on its day",
  }),
  category: Schema.optionalKey(Schema.NullOr(Id)).annotate({
    description: "Category id the transaction gets",
  }),
  notes: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
    description: "Notes the transaction gets",
  }),
  ...DateFields,
};

export const schedules = {
  list_schedules: {
    description:
      "List schedules with their next date and status as of today: missed, due, upcoming, scheduled, paid (a transaction is linked to the next occurrence) or completed.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      completed: Schema.optionalKey(Schema.Boolean).annotate({
        description: "Only completed (true) or only active (false) schedules",
      }),
      upcomingLength: UpcomingLength,
    }),
    success: Schema.Array(Schedule),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/schedules" },
    cli: { command: ["schedules", "list"], aliases: ["ls"], description: "List schedules" },
  },
  schedule_activity: {
    description:
      "Every schedule with its coming occurrences, recent charges (linked, or matched by payee, account and day), what it costs a month, settled differences from what it expects, dates passed with no charge and when it ends; and what the next twelve months hold. With a scope, only the schedules that post to it: one account, or the open accounts on or off budget. A schedule with no account belongs to no scope; noAccount counts them.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      ...AccountScopeFields,
      days: Schema.optionalKey(Schema.Int).annotate({
        description: "How many days of coming occurrences to list; 90 by default",
      }),
      upcomingLength: UpcomingLength,
    }),
    success: ScheduleOverview,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/schedule-activity" },
    cli: { command: ["schedules", "activity"], description: "Show what schedules do and cost" },
  },
  get_schedule: {
    description: "Read one schedule.",
    readonly: true,
    input: Schema.Struct({ book: BookField, id: ScheduleId, upcomingLength: UpcomingLength }),
    success: Schedule,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/schedules/:id" },
    cli: { command: ["schedules", "show"], description: "Show a schedule" },
  },
  create_schedule: {
    description:
      "Create a schedule: a payee, account and amount on a day or a recurrence. It is stored as a rule that links matching transactions to it. With postsTransaction its transactions are added on their day.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      ...ScheduleFields,
      amount: Amount.annotate({ description: "Signed as the account sees it" }),
      date: Day.annotate({ description: "The day, or the first day of a recurrence" }),
    }),
    success: Schedule,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/schedules" },
    cli: {
      command: ["schedules", "create"],
      description: "Create a schedule",
      examples: [
        {
          command:
            "reeve schedules create --name Rent --payee Landlord --account <id> --amount -120000 --amount-op is --date 2026-11-01 --frequency monthly",
          description: "Rent on the 1st of every month",
        },
      ],
    },
  },
  update_schedule: {
    description:
      "Change a schedule. Date fields change its date or recurrence (frequency null makes it one-off); the next date is computed again when the date or account changes, or with resetNextDate.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      id: ScheduleId,
      ...ScheduleFields,
      amount: Schema.optionalKey(Amount),
      date: Schema.optionalKey(Day),
      completed: Schema.optionalKey(Schema.Boolean),
      resetNextDate: Schema.optionalKey(Schema.Boolean).annotate({
        description: "Compute the next date again from today",
      }),
    }),
    success: Schedule,
    error: inBook(),
    http: { method: "PATCH", path: "/books/:book/schedules/:id" },
    cli: { command: ["schedules", "update"], description: "Change a schedule" },
  },
  delete_schedule: {
    description: "Delete a schedule and its rule. Its transactions stay.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({ book: BookField, id: ScheduleId }),
    success: Schema.Struct({ deleted: Id }),
    error: inBook(),
    http: { method: "DELETE", path: "/books/:book/schedules/:id" },
    cli: { command: ["schedules", "delete"], description: "Delete a schedule" },
  },
  skip_schedule_date: {
    description: "Skip a schedule's next date: move it to the occurrence after.",
    readonly: false,
    input: Schema.Struct({ book: BookField, id: ScheduleId }),
    success: Schedule,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/schedules/:id/skip" },
    cli: { command: ["schedules", "skip"], description: "Skip the next date of a schedule" },
  },
  post_schedule_transaction: {
    description:
      "Add a schedule's transaction now, on its next date (or today with today), linked to the schedule, then move a recurring schedule to its next occurrence.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      id: ScheduleId,
      today: Schema.optionalKey(Schema.Boolean).annotate({
        description: "Date it today instead of on the next date",
      }),
    }),
    success: Transaction,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/schedules/:id/post" },
    cli: { command: ["schedules", "post"], description: "Post a schedule's transaction now" },
  },
  complete_schedule: {
    description: "Mark a schedule completed: it stops matching and posting.",
    readonly: false,
    input: Schema.Struct({ book: BookField, id: ScheduleId }),
    success: Schedule,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/schedules/:id/complete" },
    cli: { command: ["schedules", "complete"], description: "Mark a schedule completed" },
  },
  restore_schedule: {
    description: "Restore a completed schedule, its next date computed again from today.",
    readonly: false,
    input: Schema.Struct({ book: BookField, id: ScheduleId }),
    success: Schedule,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/schedules/:id/restore" },
    cli: { command: ["schedules", "restore"], description: "Restore a completed schedule" },
  },
  list_schedule_dates: {
    description:
      "The days a schedule falls on, after weekend moves, from from (today by default) to to, at most count (10 by default when to is left out).",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      id: ScheduleId,
      from: Schema.optionalKey(Day),
      to: Schema.optionalKey(Day),
      count: Schema.optionalKey(Schema.Int),
    }),
    success: Schema.Array(Day),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/schedules/:id/dates" },
    cli: { command: ["schedules", "dates"], description: "List the coming days of a schedule" },
  },
  preview_recurrence: {
    description:
      "The next days a recurrence falls on from today, as the schedule editor previews them, with its description.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      start: Day,
      frequency: Frequency,
      interval: DateFields.interval,
      patterns: DateFields.patterns,
      skipWeekend: DateFields.skipWeekend,
      weekendSolveMode: DateFields.weekendSolveMode,
      endMode: DateFields.endMode,
      endOccurrences: DateFields.endOccurrences,
      endDate: DateFields.endDate,
      count: Schema.optionalKey(Schema.Int).annotate({ description: "5 by default" }),
    }),
    success: Schema.Struct({ description: Schema.String, dates: Schema.Array(Day) }),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/schedules/preview-recurrence" },
    cli: { command: ["schedules", "preview"], description: "Preview the days of a recurrence" },
  },
  list_scheduled_transactions: {
    description:
      "The schedules' coming transactions to show in a register: each due, missed, paid or upcoming schedule's next date and its further occurrences within the upcoming length, newest first.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      account: Schema.optionalKey(Schema.String).annotate({
        description: "Only this account's",
        ...cli({ alias: "a" }),
      }),
      upcomingLength: UpcomingLength,
    }),
    success: Schema.Array(ScheduledTransaction),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/scheduled-transactions" },
    cli: {
      command: ["schedules", "upcoming"],
      description: "List the schedules' coming transactions",
    },
  },
  find_schedules: {
    description:
      "Find recurring transactions in the history of each open account (weekly, every two weeks, monthly on a day, the last day, or the 1st/3rd or 2nd/4th weekday) that could become schedules. A scope looks only at its open accounts. Creates nothing.",
    readonly: true,
    input: Schema.Struct({ book: BookField, ...AccountScopeFields }),
    success: Schema.Array(DiscoveredSchedule),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/discovered-schedules" },
    cli: { command: ["schedules", "find"], description: "Find recurring transactions" },
  },
  run_schedules: {
    description:
      "Bring schedules up to date as of today: post the due and missed transactions of schedules that post them, move paid recurring schedules to their next date, and complete paid one-off schedules that have passed.",
    readonly: false,
    input: Schema.Struct({ book: BookField, upcomingLength: UpcomingLength }),
    success: Schema.Struct({
      posted: Schema.Array(Id).annotate({ description: "The transactions added" }),
      advanced: Schema.Array(Id).annotate({ description: "The schedules moved to a later date" }),
      completed: Schema.Array(Id),
    }),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/schedules/run" },
    cli: { command: ["schedules", "run"], description: "Post due schedules and advance paid ones" },
  },
  forecast_balances: {
    description:
      "Forecast account balances day by day: recorded transactions, then the schedules' coming transactions not yet recorded; with conditions, the running total of the matching ones. With source tracking-budget, the budget accounts' balance month by month from a tracking budget's budgeted income and expenses.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      accounts: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
        description: "Account ids; every account by default",
      }),
      from: Schema.optionalKey(Day).annotate({ description: "Today by default" }),
      to: Schema.optionalKey(Day).annotate({ description: "A year from today by default" }),
      includeAccountless: Schema.optionalKey(Schema.Boolean).annotate({
        description: "Count schedules without an account, as an account of their own",
      }),
      source: Schema.optionalKey(Schema.Literals(["schedules", "tracking-budget"])),
      ...filterFields,
    }),
    success: Forecast,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/forecast" },
    cli: { command: ["schedules", "forecast"], description: "Forecast account balances" },
  },
} satisfies Record<string, Operation>;

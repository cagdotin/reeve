/**
 * The book's tables (docs/rules/model.md). One SQLite file is one book. Money is an integer number of
 * minor units (cents); a day is the integer YYYYMMDD and a month the integer YYYYMM, so ranges and
 * month grouping are plain integer comparisons.
 *
 * The ledger is double-entry: a transaction has two or more postings whose amounts sum to zero.
 * A positive amount is a debit. Categories are accounts of type `expense` or `income`.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  type AnySQLiteColumn,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const id = () => text("id").primaryKey();
const flag = (name: string) => integer(name, { mode: "boolean" }).notNull().default(false);

/** Key-value settings of the book: its name, currency, budget type, number and date formats. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** Groups of categories, as the budget shows them. */
export const categoryGroups = sqliteTable("category_groups", {
  id: id(),
  name: text("name").notNull(),
  isIncome: flag("is_income"),
  hidden: flag("hidden"),
  sortOrder: integer("sort_order").notNull().default(0),
  /** What the group is for, so people and agents file transactions alike. */
  description: text("description"),
});

/**
 * Every account of the ledger. `asset` and `liability` accounts are what people call accounts
 * (checking, a credit card); `expense` and `income` accounts are the budget's categories;
 * `equity` holds opening balances. `system` marks the accounts the book makes itself.
 */
export const accounts = sqliteTable(
  "accounts",
  {
    id: id(),
    name: text("name").notNull(),
    type: text("type", { enum: ["asset", "liability", "equity", "income", "expense"] }).notNull(),
    /** An asset or liability whose money the budget covers. */
    onBudget: flag("on_budget"),
    closed: flag("closed"),
    hidden: flag("hidden"),
    groupId: text("group_id").references(() => categoryGroups.id),
    /** The category this one nests under, in the same group; null at the top of its group. */
    parentId: text("parent_id").references((): AnySQLiteColumn => accounts.id),
    sortOrder: integer("sort_order").notNull().default(0),
    system: text("system", { enum: ["opening", "uncategorized"] }),
    /** What a category is for, so people and agents file transactions alike. */
    description: text("description"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("accounts_type").on(table.type),
    uniqueIndex("accounts_system").on(table.system),
    check(
      "accounts_on_budget_kind",
      sql`${table.onBudget} = 0 OR ${table.type} IN ('asset', 'liability')`,
    ),
  ],
);

export const payees = sqliteTable("payees", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  favorite: flag("favorite"),
  /** Whether picking a category for this payee teaches a rule, as Actual's "learn categories". */
  learnCategories: integer("learn_categories", { mode: "boolean" }).notNull().default(true),
});

/** Two payees a person said are not one, so they are not suggested for a merge again. */
export const payeesApart = sqliteTable(
  "payees_apart",
  {
    payeeId: text("payee_id")
      .notNull()
      .references(() => payees.id, { onDelete: "cascade" }),
    otherId: text("other_id")
      .notNull()
      .references(() => payees.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.payeeId, table.otherId] })],
);

/** An account number a person said is worth no rule, so it is not suggested again. */
export const dismissedAccountSuggestions = sqliteTable("dismissed_account_suggestions", {
  accountNumber: text("account_number").primaryKey(),
});

export const transactions = sqliteTable(
  "transactions",
  {
    id: id(),
    date: integer("date").notNull(),
    payeeId: text("payee_id").references(() => payees.id),
    notes: text("notes"),
    scheduleId: text("schedule_id"),
    /** The payee as a bank named it, kept for rules and duplicate matching. */
    importedPayee: text("imported_payee"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("transactions_date").on(table.date),
    index("transactions_payee").on(table.payeeId),
    index("transactions_schedule").on(table.scheduleId),
  ],
);

export const postings = sqliteTable(
  "postings",
  {
    id: id(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    amount: integer("amount").notNull(),
    memo: text("memo"),
    /**
     * The category a transfer to or from an off-budget account counts against in the budget, as
     * Actual lets such a transfer have one. Set only on the off-budget account's posting.
     */
    categoryId: text("category_id").references(() => accounts.id),
    cleared: flag("cleared"),
    reconciled: flag("reconciled"),
    sortOrder: integer("sort_order").notNull().default(0),
    /** The bank's id for this line (OFX FITID, a feed's reference): a bank names one posting. */
    importedId: text("imported_id"),
  },
  (table) => [
    index("postings_transaction").on(table.transactionId),
    index("postings_account").on(table.accountId),
    uniqueIndex("postings_imported_id")
      .on(table.accountId, table.importedId)
      .where(sql`${table.importedId} IS NOT NULL`),
  ],
);

/** What the bank sent for one line, every field as it arrived (docs/rules/bank.md). */
export interface KeptLine {
  readonly source: "bank";
  readonly bank: { readonly name: string; readonly country: string };
  readonly currency: string | null;
  readonly line: Readonly<Record<string, unknown>>;
}

/**
 * Every bank line an account has taken, kept outside undo: a line seen here with no live posting
 * was deleted or undone, and a linked account leaves it out (docs/rules/bank.md).
 */
export const seenImports = sqliteTable(
  "seen_imports",
  {
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    importedId: text("imported_id").notNull(),
    date: integer("date").notNull(),
    amount: integer("amount").notNull(),
    payee: text("payee"),
    firstSeenAt: integer("first_seen_at").notNull(),
    line: text("line", { mode: "json" }).$type<KeptLine>(),
  },
  (table) => [primaryKey({ columns: [table.accountId, table.importedId] })],
);

/**
 * What a month assigns to a category, per budget type, so switching between envelope and tracking
 * keeps both. `carryover` is Actual's "rollover overspending" for that month.
 */
export const budgets = sqliteTable(
  "budgets",
  {
    budgetType: text("budget_type", { enum: ["envelope", "tracking"] }).notNull(),
    month: integer("month").notNull(),
    categoryId: text("category_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull().default(0),
    carryover: flag("carryover"),
    goal: integer("goal"),
    longGoal: integer("long_goal"),
  },
  (table) => [primaryKey({ columns: [table.budgetType, table.month, table.categoryId] })],
);

/** A month's own values: the money held for next month (Actual's buffered). */
export const budgetMonths = sqliteTable(
  "budget_months",
  {
    budgetType: text("budget_type", { enum: ["envelope", "tracking"] }).notNull(),
    month: integer("month").notNull(),
    hold: integer("hold").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.budgetType, table.month] })],
);

/** Notes of anything with an id: an account, a category, a group, a budget month (`budget-YYYY-MM`). */
export const notes = sqliteTable("notes", {
  id: id(),
  note: text("note").notNull(),
});

/**
 * Rules change transactions as they are created or imported. `conditions` and `actions` are JSON,
 * shaped as the contract's `RuleCondition` and `RuleAction`.
 */
export const rules = sqliteTable("rules", {
  id: id(),
  stage: text("stage", { enum: ["pre", "default", "post"] })
    .notNull()
    .default("default"),
  conditionsOp: text("conditions_op", { enum: ["and", "or"] })
    .notNull()
    .default("and"),
  conditions: text("conditions", { mode: "json" }).notNull(),
  actions: text("actions", { mode: "json" }).notNull(),
  createdAt: integer("created_at").notNull(),
});

/** A schedule is a rule that matches its transactions, plus when they come. */
export const schedules = sqliteTable("schedules", {
  id: id(),
  name: text("name"),
  ruleId: text("rule_id")
    .notNull()
    .references(() => rules.id),
  nextDate: integer("next_date"),
  completed: flag("completed"),
  /** Whether the transaction is added by itself on its day, rather than shown as upcoming. */
  postsTransaction: flag("posts_transaction"),
  createdAt: integer("created_at").notNull(),
});

export const tags = sqliteTable("tags", {
  id: id(),
  tag: text("tag").notNull().unique(),
  color: text("color"),
  description: text("description"),
  hidden: flag("hidden"),
});

export const dashboardPages = sqliteTable(
  "dashboard_pages",
  {
    id: id(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    host: text("host", { enum: ["transactions", "payees"] }),
  },
  (table) => [
    uniqueIndex("dashboard_pages_host")
      .on(table.host)
      .where(sql`${table.host} IS NOT NULL`),
  ],
);

export const widgets = sqliteTable(
  "widgets",
  {
    id: id(),
    pageId: text("page_id")
      .notNull()
      .references(() => dashboardPages.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    x: integer("x").notNull(),
    y: integer("y").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    meta: text("meta"),
    reportId: text("report_id").references(() => customReports.id, { onDelete: "restrict" }),
    config: text("config", { mode: "json" }),
  },
  (table) => [index("widgets_report").on(table.reportId)],
);

export const customReports = sqliteTable("custom_reports", {
  id: id(),
  name: text("name").notNull(),
  definition: text("definition", { mode: "json" }).notNull(),
  legacyDefinition: text("legacy_definition"),
  createdAt: integer("created_at").notNull(),
});

/**
 * Undo history: each write operation is a group, and each row of the group is the SQL that
 * reverses one change, recorded by triggers (docs/rules/boundaries.md).
 */
export const undoLog = sqliteTable(
  "undo_log",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    groupId: integer("group_id").notNull(),
    stack: text("stack", { enum: ["undo", "redo"] }).notNull(),
    statement: text("statement").notNull(),
  },
  (table) => [index("undo_log_group").on(table.groupId)],
);

/** The one row that says which undo group the triggers record into, if any. */
export const undoState = sqliteTable("undo_state", {
  id: integer("id").primaryKey(),
  groupId: integer("group_id").notNull().default(0),
  stack: text("stack", { enum: ["undo", "redo"] })
    .notNull()
    .default("undo"),
  active: flag("active"),
});

import { Schema, SchemaAST, SchemaTransformation } from "effect";
import { BUDGET_TYPES, isCalendarDay } from "./rules.ts";

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

/** A calendar day, `YYYY-MM-DD`. */
export const Day = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value: string) => isCalendarDay(value), {
      message: "Use a date such as 2026-11-01",
    }),
  ),
);
export type Day = typeof Day.Type;

/** A month, `YYYY-MM`. */
export const Month = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])$/, { message: "Use a month such as 2026-11" }),
  ),
);
export type Month = typeof Month.Type;

/** An amount of money in minor units (cents): 1234 is 12.34. */
export const Amount = Schema.Int.annotate({
  description: "Money in minor units (cents), e.g. 1234 for 12.34; negative for money going out",
});
export type Amount = typeof Amount.Type;

export const Id = Schema.String;

export const BudgetType = Schema.Literals(BUDGET_TYPES);
export type BudgetType = typeof BudgetType.Type;

export const AccountType = Schema.Literals(["asset", "liability", "equity", "income", "expense"]);
export type AccountType = typeof AccountType.Type;

// ---------------------------------------------------------------------------------------------
// Books
// ---------------------------------------------------------------------------------------------

export const NumberFormat = Schema.Literals([
  "comma-dot",
  "dot-comma",
  "space-comma",
  "apostrophe-dot",
  "comma-dot-in",
]);
export type NumberFormat = typeof NumberFormat.Type;

export const DateFormat = Schema.Literals([
  "MM/dd/yyyy",
  "dd/MM/yyyy",
  "yyyy-MM-dd",
  "MM.dd.yyyy",
  "dd.MM.yyyy",
]);
export type DateFormat = typeof DateFormat.Type;

/** A book's preferences, stored in its `settings` table. */
export const BookSettings = Schema.Struct({
  name: Schema.String,
  /** ISO 4217 code, e.g. USD; display only. */
  currency: Schema.String,
  budgetType: BudgetType,
  numberFormat: NumberFormat,
  dateFormat: DateFormat,
  /** 0 is Sunday. */
  firstDayOfWeek: Schema.Int,
  hideFraction: Schema.Boolean,
  /** How many levels categories may nest inside a group; 1 keeps them flat. */
  categoryDepth: Schema.Int,
  /** Whether a receipt applies itself to its transaction once a write leaves it ready (docs/rules/purchases.md). */
  autoApplyReceipts: Schema.Boolean,
  /** The running server fetches linked accounts by itself, up to 4 times a day. */
  bankAutoSync: Schema.Boolean,
  defaultDashboardId: Schema.optionalKey(Id),
});
export type BookSettings = typeof BookSettings.Type;

export const Book = Schema.Struct({
  id: Id,
  file: Schema.String,
  settings: BookSettings,
});
export type Book = typeof Book.Type;

export const BookInfo = Schema.Struct({ id: Id, name: Schema.String, file: Schema.String });
export type BookInfo = typeof BookInfo.Type;

// ---------------------------------------------------------------------------------------------
// Accounts and categories
// ---------------------------------------------------------------------------------------------

/** An asset or liability account: checking, savings, a credit card, a loan, an investment. */
export const Account = Schema.Struct({
  id: Id,
  name: Schema.String,
  type: Schema.Literals(["asset", "liability"]),
  onBudget: Schema.Boolean,
  closed: Schema.Boolean,
  sortOrder: Schema.Int,
  /** Sum of every posting. */
  balance: Amount,
  /** Sum of the cleared postings. */
  cleared: Amount,
  /** Sum of the postings not cleared. */
  uncleared: Amount,
  notes: Schema.NullOr(Schema.String),
});
export type Account = typeof Account.Type;

export const Category = Schema.Struct({
  id: Id,
  name: Schema.String,
  groupId: Id,
  /** The category it nests under, in the same group; null at the top of the group. */
  parentId: Schema.NullOr(Id),
  isIncome: Schema.Boolean,
  hidden: Schema.Boolean,
  sortOrder: Schema.Int,
  notes: Schema.NullOr(Schema.String),
  /** What the category is for, so people and agents file transactions alike. */
  description: Schema.NullOr(Schema.String),
});
export type Category = typeof Category.Type;

export const CategoryGroup = Schema.Struct({
  id: Id,
  name: Schema.String,
  isIncome: Schema.Boolean,
  hidden: Schema.Boolean,
  sortOrder: Schema.Int,
  notes: Schema.NullOr(Schema.String),
  /** What the group is for, so people and agents file transactions alike. */
  description: Schema.NullOr(Schema.String),
  /** In tree order: each category followed by its subcategories, siblings by sortOrder. */
  categories: Schema.Array(Category),
});
export type CategoryGroup = typeof CategoryGroup.Type;

/** Any account of the ledger, categories and equity included, for the double-entry views. */
export const LedgerAccount = Schema.Struct({
  id: Id,
  name: Schema.String,
  type: AccountType,
  onBudget: Schema.Boolean,
  closed: Schema.Boolean,
  system: Schema.NullOr(Schema.Literals(["opening", "uncategorized"])),
  groupId: Schema.NullOr(Id),
});
export type LedgerAccount = typeof LedgerAccount.Type;

export const Payee = Schema.Struct({
  id: Id,
  name: Schema.String,
  /** Who it is, for a name that does not say. */
  description: Schema.NullOr(Schema.String),
  favorite: Schema.Boolean,
  learnCategories: Schema.Boolean,
  /** How many transactions name it. */
  transactionCount: Schema.Int,
});
export type Payee = typeof Payee.Type;

export const PayeeActivity = Schema.Struct({
  ...Payee.fields,
  /** Transactions on or after the range's start. */
  rangeTransactions: Schema.Int,
  /** Net spending on expense categories in the range, in minor units. */
  rangeSpent: Schema.Int,
  lastTransaction: Schema.NullOr(Day),
  /** Every category its transactions use, the most used first. */
  categories: Schema.Array(
    Schema.Struct({ id: Id, name: Schema.String, transactions: Schema.Int }),
  ),
  /** How many rules name it, in a condition or an action. */
  ruleCount: Schema.Int,
  /** Whether a schedule's rule names it. */
  scheduled: Schema.Boolean,
  /** Whether two or more plain "payee is it, set category" rules set the same category. */
  duplicateRules: Schema.Boolean,
  /** Whether most of its latest transactions use another category than its plain rules set. */
  ruleDisagrees: Schema.Boolean,
  /** Whether its first transaction is in the range; never over all time. */
  newInRange: Schema.Boolean,
});
export type PayeeActivity = typeof PayeeActivity.Type;

const PayeeTotals = Schema.Struct({
  /** Payees with a transaction in the period. */
  payees: Schema.Int,
  /** Those whose first transaction is in the period. */
  newPayees: Schema.Int,
  transactions: Schema.Int,
  /** Net spending on expense categories, in minor units. */
  spent: Schema.Int,
});

export const PayeeOverview = Schema.Struct({
  payees: Schema.Array(PayeeActivity),
  /** Every payee in the book, in the range or not. */
  total: Schema.Int,
  /** The book's first transaction that names a payee. */
  earliest: Schema.NullOr(Day),
  /** The range's totals, and those of as many days before it; null over all time. */
  summary: Schema.Struct({ ...PayeeTotals.fields, previous: Schema.NullOr(PayeeTotals) }),
  /** The last twelve months' totals, oldest first, whatever the range. */
  months: Schema.Array(Schema.Struct({ month: Schema.String, ...PayeeTotals.fields })),
  /** The largest changes in spending since the period before; none over all time. */
  movers: Schema.Array(
    Schema.Struct({ id: Id, name: Schema.String, spent: Schema.Int, previousSpent: Schema.Int }),
  ),
  /** Amounts that settled on a new value, the latest first, whatever the range. */
  priceChanges: Schema.Array(
    Schema.Struct({
      id: Id,
      name: Schema.String,
      from: Schema.Int,
      to: Schema.Int,
      date: Day,
    }),
  ),
  /** Regular payees silent for far longer than usual, the most recently silent first. */
  quiet: Schema.Array(
    Schema.Struct({
      id: Id,
      name: Schema.String,
      lastTransaction: Day,
      silentDays: Schema.Int,
      usualGap: Schema.Number,
    }),
  ),
  /** What to look at, counted over the whole book, whatever the range. */
  attention: Schema.Struct({
    unused: Schema.Int,
    repeatWithoutRule: Schema.Int,
    duplicateRules: Schema.Int,
    ruleDisagrees: Schema.Int,
  }),
});
export type PayeeOverview = typeof PayeeOverview.Type;

// ---------------------------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------------------------

export const Posting = Schema.Struct({
  id: Id,
  accountId: Id,
  amount: Amount,
  memo: Schema.NullOr(Schema.String),
  /** On an off-budget account's posting in a transfer from the budget: the category it counts in. */
  categoryId: Schema.NullOr(Id),
  cleared: Schema.Boolean,
  reconciled: Schema.Boolean,
  /** The bank's id for this line, when it came from a bank. */
  importedId: Schema.NullOr(Schema.String),
});
export type Posting = typeof Posting.Type;

export const Transaction = Schema.Struct({
  id: Id,
  date: Day,
  payeeId: Schema.NullOr(Id),
  payee: Schema.NullOr(Schema.String),
  notes: Schema.NullOr(Schema.String),
  scheduleId: Schema.NullOr(Id),
  importedPayee: Schema.NullOr(Schema.String),
  postings: Schema.Array(Posting),
});
export type Transaction = typeof Transaction.Type;

/** A posting as the full double-entry input gives it. */
export const PostingInput = Schema.Struct({
  account: Id.annotate({ description: "Account or category id" }),
  amount: Amount.annotate({ description: "Positive is a debit, negative a credit" }),
  memo: Schema.optionalKey(Schema.NullOr(Schema.String)),
  category: Schema.optionalKey(Schema.NullOr(Id)).annotate({
    description:
      "On an off-budget account's posting in a transfer from a budget account: the category it counts against",
  }),
  cleared: Schema.optionalKey(Schema.Boolean),
});
export type PostingInput = typeof PostingInput.Type;

/** One line of a split, as the register enters it: a category or a transfer to an account. */
export const SplitInput = Schema.Struct({
  category: Schema.optionalKey(Schema.NullOr(Id)),
  transferAccount: Schema.optionalKey(Schema.NullOr(Id)),
  /** Signed as the account sees it: negative when money goes out of the account. */
  amount: Amount,
  memo: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type SplitInput = typeof SplitInput.Type;

/**
 * A transaction as a register enters it: money into or out of one account, against a category, a
 * transfer account, or splits of both. The engine turns it into balanced postings.
 */
export const EntryFields = {
  date: Day,
  account: Id.annotate({ description: "The asset or liability account it happens in" }),
  amount: Amount.annotate({
    description: "Signed as the account sees it: negative for a payment, positive for a deposit",
  }),
  payee: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
    description: "Payee name; a new name creates the payee",
  }),
  category: Schema.optionalKey(Schema.NullOr(Id)).annotate({
    description: "Category id; leave out for uncategorized",
  }),
  transferAccount: Schema.optionalKey(Schema.NullOr(Id)).annotate({
    description: "Another asset or liability account, making it a transfer",
  }),
  splits: Schema.optionalKey(Schema.Array(SplitInput)).annotate({
    description: "Split lines; their amounts sum to amount",
  }),
  notes: Schema.optionalKey(Schema.NullOr(Schema.String)),
  cleared: Schema.optionalKey(Schema.Boolean),
};

/** What a register row shows on the other side of the account's posting. */
export const Counterpart = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("category"), id: Id, name: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("transfer"), id: Id, name: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("split"), count: Schema.Int }),
  Schema.Struct({ kind: Schema.Literal("uncategorized") }),
  Schema.Struct({ kind: Schema.Literal("other"), id: Id, name: Schema.String }),
]);
export type Counterpart = typeof Counterpart.Type;

export const SplitLine = Schema.Struct({
  postingId: Id,
  accountId: Id,
  name: Schema.String,
  kind: Schema.Literals(["category", "transfer", "uncategorized", "other"]),
  /** As the register's account sees it: the negated posting. */
  amount: Amount,
  memo: Schema.NullOr(Schema.String),
});
export type SplitLine = typeof SplitLine.Type;

/** One row of an account's register: its posting in a transaction, with the other side. */
export const RegisterRow = Schema.Struct({
  transactionId: Id,
  postingId: Id,
  accountId: Id,
  accountName: Schema.String,
  date: Day,
  payeeId: Schema.NullOr(Id),
  payee: Schema.NullOr(Schema.String),
  notes: Schema.NullOr(Schema.String),
  amount: Amount,
  cleared: Schema.Boolean,
  reconciled: Schema.Boolean,
  scheduleId: Schema.NullOr(Id),
  counterpart: Counterpart,
  splits: Schema.Array(SplitLine),
  /** The account's balance after this row, when the rows come in date order unfiltered. */
  balance: Schema.NullOr(Amount),
});
export type RegisterRow = typeof RegisterRow.Type;

export const RegisterPage = Schema.Struct({
  rows: Schema.Array(RegisterRow),
  total: Schema.Int,
});
export type RegisterPage = typeof RegisterPage.Type;

/** The register rows behind one figure, such as a budget cell or a report's, with what each counts toward it. */
export const FigureRecords = Schema.Struct({
  /** The figure: the sum of the rows' counted amounts. */
  total: Amount,
  rows: Schema.Array(
    Schema.Struct({
      /** What this row adds to the figure: the row's own amount, or its lines in the category for a split. */
      counted: Amount,
      row: RegisterRow,
    }),
  ),
});
export type FigureRecords = typeof FigureRecords.Type;

// ---------------------------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------------------------

export const BudgetCategoryMonth = Schema.Struct({
  id: Id,
  budgeted: Amount,
  /** Activity in the month: negative for spending, positive for income. */
  spent: Amount,
  /** Envelope: what is left, carried into next month. Tracking: budgeted plus spent. */
  balance: Amount,
  carryover: Schema.Boolean,
  goal: Schema.NullOr(Amount),
  longGoal: Schema.NullOr(Amount),
  /** The category's figures plus all its subcategories'; equal to its own for a leaf. Display only. */
  total: Schema.Struct({ budgeted: Amount, spent: Amount, balance: Amount }),
});
export type BudgetCategoryMonth = typeof BudgetCategoryMonth.Type;

export const BudgetGroupMonth = Schema.Struct({
  id: Id,
  budgeted: Amount,
  spent: Amount,
  balance: Amount,
});
export type BudgetGroupMonth = typeof BudgetGroupMonth.Type;

export const EnvelopeSummary = Schema.Struct({
  type: Schema.Literal("envelope"),
  income: Amount,
  fromLastMonth: Amount,
  /** Overspending of last month in categories without rollover, taken from this month. */
  lastMonthOverspent: Amount,
  /** Negative: what this month assigns. */
  totalBudgeted: Amount,
  /** Held for next month. */
  hold: Amount,
  toBudget: Amount,
  totalSpent: Amount,
  totalBalance: Amount,
});
export type EnvelopeSummary = typeof EnvelopeSummary.Type;

export const TrackingSummary = Schema.Struct({
  type: Schema.Literal("tracking"),
  budgetedIncome: Amount,
  income: Amount,
  budgetedExpenses: Amount,
  spent: Amount,
  /** Budgeted income minus budgeted expenses. */
  budgetedSaved: Amount,
  /** Income minus spending. */
  saved: Amount,
});
export type TrackingSummary = typeof TrackingSummary.Type;

export const BudgetMonth = Schema.Struct({
  month: Month,
  categories: Schema.Array(BudgetCategoryMonth),
  groups: Schema.Array(BudgetGroupMonth),
  summary: Schema.Union([EnvelopeSummary, TrackingSummary]),
  note: Schema.NullOr(Schema.String),
});
export type BudgetMonth = typeof BudgetMonth.Type;

export const BudgetView = Schema.Struct({
  budgetType: BudgetType,
  /** The months that can be budgeted, first to last. */
  range: Schema.Struct({ start: Month, end: Month }),
  groups: Schema.Array(CategoryGroup),
  months: Schema.Array(BudgetMonth),
  /** Uncategorized transactions on budget accounts, which the budget cannot count. */
  uncategorized: Schema.Struct({ count: Schema.Int, amount: Amount }),
});
export type BudgetView = typeof BudgetView.Type;

// ---------------------------------------------------------------------------------------------
// Changes and errors
// ---------------------------------------------------------------------------------------------

/** Sent on the change feed after every write to a book. */
export const BookChange = Schema.Struct({ book: Id });
export type BookChange = typeof BookChange.Type;

export class BookNotFound extends Schema.TaggedError<BookNotFound>()(
  "BookNotFound",
  { book: Schema.String },
  { httpApiStatus: 404 },
) {
  override get message(): string {
    return `No book ${this.book}`;
  }
}

export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  { entity: Schema.String, id: Schema.String },
  { httpApiStatus: 404 },
) {
  override get message(): string {
    return `No ${this.entity} with id ${this.id}`;
  }
}

export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()(
  "InvalidRequest",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

export class StorageError extends Schema.TaggedError<StorageError>()(
  "StorageError",
  { message: Schema.String, cause: Schema.Defect() },
  { httpApiStatus: 500 },
) {}

/** The bank provider refused or could not be reached. Holds no response body or header. */
export class BankError extends Schema.TaggedError<BankError>()(
  "BankError",
  {
    message: Schema.String,
    /** The provider's error code, or the HTTP status when it gave none. */
    code: Schema.NullOr(Schema.String),
  },
  { httpApiStatus: 502 },
) {}

/**
 * `<home>/server.json`, which a running server writes so the CLI and stdio MCP find it
 * (docs/rules/boundaries.md). A hint: a client probes `url` before it trusts it.
 */
export const ServerInfo = Schema.Struct({
  url: Schema.String,
  pid: Schema.Int,
  version: Schema.String,
});
export type ServerInfo = typeof ServerInfo.Type;

/** The server `server.json` names answers, but from another version of reeve than the client's. */
export class ServerMismatch extends Schema.TaggedError<ServerMismatch>()("ServerMismatch", {
  url: Schema.String,
  version: Schema.String,
  expected: Schema.String,
}) {
  override get message(): string {
    return `The reeve server at ${this.url} is version ${this.version}, and this reeve is ${this.expected}. Restart the server from this version, or stop it.`;
  }
}

/** The server `server.json` names is running but cannot be used: it hangs or answers nonsense. */
export class ServerUnavailable extends Schema.TaggedError<ServerUnavailable>()(
  "ServerUnavailable",
  { url: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return `The reeve server at ${this.url} ${this.reason}`;
  }
}

interface TaggedErrorClass extends Schema.Top {
  readonly fields: Schema.Struct.Fields;
  new (fields: never): { readonly message: string };
}

/** A tagged error on the wire: its encoded fields and its message. */
export type WireError<E extends Schema.Top> = Schema.Codec<
  E["Type"],
  E["Encoded"] & { readonly message: string }
>;

const wireErrors = new WeakMap<Schema.Top, Schema.Top>();

/**
 * A tagged error as clients receive it: its tag, every field and its message, which a getter
 * computes and a plain encode would drop (docs/rules/boundaries.md). It keeps the error's HTTP status.
 */
export const wireError = <E extends Schema.Top>(error: E): WireError<E> => {
  const known = wireErrors.get(error);
  if (known !== undefined) return known as WireError<E>;
  const { fields } = error as unknown as TaggedErrorClass;
  const encoded = Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [key, Schema.toEncoded(field)]),
  );
  const ownMessage = "message" in fields;
  const codec = Schema.Struct({ ...encoded, message: Schema.String })
    .pipe(
      Schema.decodeTo(
        Schema.toCodecJson(error),
        SchemaTransformation.transform<object, { readonly message: string }>({
          decode: ({ message, ...rest }) => (ownMessage ? { ...rest, message } : rest),
          encode: (rest) => {
            const { _tag, ...values } = rest as { readonly _tag: string };
            const instance = new (error as unknown as TaggedErrorClass)(values as never);
            return { ...rest, message: instance.message };
          },
        }) as never,
      ),
    )
    .annotate({ httpApiStatus: SchemaAST.resolve(error.ast)?.["httpApiStatus"] as number });
  wireErrors.set(error, codec);
  return codec as unknown as WireError<E>;
};

/** The tagged errors of an error schema, through nested unions, each as `wireError` gives it. */
export const wireErrorsOf = (error: Schema.Top): Array<Schema.Top> =>
  "members" in error
    ? (error.members as ReadonlyArray<Schema.Top>).flatMap(wireErrorsOf)
    : [wireError(error)];

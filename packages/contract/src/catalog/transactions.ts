import { Schema } from "effect";
import {
  Amount,
  Day,
  EntryFields,
  PostingInput,
  RegisterPage,
  SplitInput,
  Transaction,
} from "../domain.ts";
import { BookField, IdField, cli, inBook, type Operation } from "../operation.ts";

const TransactionId = IdField("Transaction id");

const Ids = (description: string, alias?: string) =>
  Schema.optionalKey(Schema.Array(Schema.String)).annotate({
    description,
    ...(alias === undefined ? {} : cli({ alias })),
  });

/** The filters the register and its CSV export share; each list matches any of its values. */
export const RegisterFilterFields = {
  accounts: Ids("Only these account ids"),
  categories: Ids("Only transactions with one of these category ids", "c"),
  payees: Ids("Only these payee ids"),
  status: Schema.optionalKey(
    Schema.Array(Schema.Literals(["uncleared", "cleared", "reconciled"])),
  ).annotate({ description: "Only postings in one of these states" }),
  from: Schema.optionalKey(Day).annotate({ description: "First day included" }),
  to: Schema.optionalKey(Day).annotate({ description: "Last day included" }),
  query: Schema.optionalKey(Schema.String).annotate({
    description: "Text to find in payee, notes, memos, category or account",
    ...cli({ alias: "q" }),
  }),
};

export const transactions = {
  list_transactions: {
    description:
      "List transactions as register rows, newest first. With account, one row per posting in that account and a running balance; without it, every transaction from the point of view of its asset or liability side. Filters combine.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      account: Schema.optionalKey(Schema.String).annotate({
        description: "Account id",
        ...cli({ alias: "a" }),
      }),
      ...RegisterFilterFields,
      uncategorized: Schema.optionalKey(Schema.Boolean).annotate({
        description: "Only budget transactions without a category",
      }),
      onBudget: Schema.optionalKey(Schema.Boolean).annotate({
        description: "Only budget accounts (true) or off-budget ones (false)",
      }),
      limit: Schema.optionalKey(Schema.Int).annotate({
        description: "At most this many rows; 200 by default",
      }),
      offset: Schema.optionalKey(Schema.Int),
    }),
    success: RegisterPage,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/transactions" },
    cli: {
      command: ["transactions", "list"],
      aliases: ["ls"],
      description: "List transactions",
      examples: [
        {
          command: "reeve transactions list --account <id> --from 2026-10-01",
          description: "October onward",
        },
      ],
    },
  },
  get_transaction: {
    description: "Read one transaction with all its postings.",
    readonly: true,
    input: Schema.Struct({ book: BookField, id: TransactionId }),
    success: Transaction,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/transactions/:id" },
    cli: { command: ["transactions", "show"], description: "Show a transaction and its postings" },
  },
  create_transaction: {
    description:
      "Add a transaction the way a register enters it: an amount into or out of an account against a category, a transfer account, or split lines. Rules run on it first. The engine writes it as balanced postings.",
    readonly: false,
    input: Schema.Struct({ book: BookField, ...EntryFields }),
    success: Transaction,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/transactions" },
    cli: {
      command: ["transactions", "add"],
      description: "Add a transaction",
      examples: [
        {
          command:
            "reeve transactions add --date 2026-10-31 --account <id> --amount -4250 --payee Grocer --category <id>",
          description: "Spend 42.50",
        },
      ],
    },
  },
  create_journal_entry: {
    description:
      "Add a transaction as double-entry postings on any accounts, categories included. Postings must sum to zero.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      date: Day,
      payee: Schema.optionalKey(Schema.NullOr(Schema.String)),
      notes: Schema.optionalKey(Schema.NullOr(Schema.String)),
      postings: Schema.Array(PostingInput),
    }),
    success: Transaction,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/journal" },
  },
  update_transaction: {
    description:
      "Change a transaction. Register fields (amount, category, transferAccount, splits, cleared) are as account sees it, which is required with them; date, payee and notes apply to the whole transaction; postings replaces every posting. A reconciled posting's amount and account cannot change.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      id: TransactionId,
      account: Schema.optionalKey(Schema.String).annotate({
        description: "The account whose register is edited",
      }),
      date: Schema.optionalKey(Day),
      payee: EntryFields.payee,
      notes: EntryFields.notes,
      amount: Schema.optionalKey(Amount),
      category: EntryFields.category,
      transferAccount: EntryFields.transferAccount,
      splits: Schema.optionalKey(Schema.Array(SplitInput)),
      cleared: Schema.optionalKey(Schema.Boolean),
      postings: Schema.optionalKey(Schema.Array(PostingInput)),
    }),
    success: Transaction,
    error: inBook(),
    http: { method: "PATCH", path: "/books/:book/transactions/:id" },
    cli: { command: ["transactions", "update"], description: "Change a transaction" },
  },
  update_transactions: {
    description:
      "Change several transactions at once, as a register's bulk edit: each field given is set on every one, the register fields as account sees them.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      ids: Schema.Array(Schema.String),
      account: Schema.optionalKey(Schema.String),
      accountOf: Schema.optionalKey(
        Schema.Array(Schema.Struct({ id: Schema.String, account: Schema.String })),
      ).annotate({
        description:
          "The account each id is seen from, for a selection across accounts; account covers the rest",
      }),
      date: Schema.optionalKey(Day),
      payee: EntryFields.payee,
      notes: EntryFields.notes,
      category: EntryFields.category,
      cleared: Schema.optionalKey(Schema.Boolean),
    }),
    success: Schema.Array(Transaction),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/transactions/bulk-update" },
  },
  delete_transactions: {
    description:
      "Delete transactions; a reconciled one changes a balance already agreed, so ask the person, then pass confirmReconciled. A transaction a bank line made leaves the account off the bank's balance by its amount, and the line stays out of later fetches: for a copy of one entered by hand, merge_transactions is usually meant, and restore_dismissed_imports brings a deleted line back.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({
      book: BookField,
      ids: Schema.Array(Schema.String),
      confirmReconciled: Schema.optionalKey(Schema.Boolean).annotate({
        description: "The person agreed to delete reconciled transactions",
      }),
    }),
    success: Schema.Struct({ deleted: Schema.Array(Schema.String) }),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/transactions/delete" },
    cli: {
      command: ["transactions", "delete"],
      description: "Delete transactions; a reconciled one needs the person's agreement first",
    },
  },
  duplicate_transactions: {
    description: "Copy transactions, uncleared, on the same days.",
    readonly: false,
    input: Schema.Struct({ book: BookField, ids: Schema.Array(Schema.String) }),
    success: Schema.Array(Transaction),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/transactions/duplicate" },
  },
  merge_transactions: {
    description:
      "Merge two transactions that are one, as an imported copy of one entered by hand; they must share an account and amount, and it is refused when it would lose a reconciled posting. keep keeps its postings and takes the other's missing payee, notes and imported fields, and its category, split or transfer when keep has none; the other is deleted.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({ book: BookField, keep: Schema.String, drop: Schema.String }),
    success: Transaction,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/transactions/merge" },
  },
  make_transfer: {
    description:
      "Make one transfer of two transactions that are two sides of one movement, as two banks' imports of a top-up: they must be in different accounts, their amounts must cancel, and neither may be a split or a transfer. from stays and to is deleted; a category stays only when the transfer crosses the budget.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({ book: BookField, from: Schema.String, to: Schema.String }),
    success: Transaction,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/transactions/make-transfer" },
  },
} satisfies Record<string, Operation>;

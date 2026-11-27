/** Importing bank files (CSV, OFX, QFX, QIF, CAMT) and exporting transactions and books. */
import { Schema } from "effect";
import { Amount, Book, Day, Id, InvalidRequest, StorageError } from "../domain.ts";
import { BookField, cli, inBook, type Operation } from "../operation.ts";
import { RegisterFilterFields } from "./transactions.ts";

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

/** The kinds of bank file Actual reads: CSV (and TSV), OFX (and QFX), QIF and CAMT.053 XML. */
export const ImportFileType = Schema.Literals(["csv", "ofx", "qif", "camt"]);
export type ImportFileType = typeof ImportFileType.Type;

/** The orders a CSV or QIF date may come in, as Actual's import dialog names them. */
export const ImportDateFormat = Schema.Literals([
  "yyyy mm dd",
  "yy mm dd",
  "mm dd yyyy",
  "mm dd yy",
  "dd mm yyyy",
  "dd mm yy",
]);
export type ImportDateFormat = typeof ImportDateFormat.Type;

/** Which CSV column fills each transaction field: a header name, or a column index without one. */
export const ImportMapping = Schema.Struct({
  date: Schema.NullOr(Schema.String),
  payee: Schema.NullOr(Schema.String),
  notes: Schema.NullOr(Schema.String),
  amount: Schema.NullOr(Schema.String),
  inflow: Schema.NullOr(Schema.String),
  outflow: Schema.NullOr(Schema.String),
  inOut: Schema.NullOr(Schema.String),
  category: Schema.NullOr(Schema.String),
});
export type ImportMapping = typeof ImportMapping.Type;

/** A transaction to import into an account, as a parsed file row gives it. */
export const ImportRow = Schema.Struct({
  date: Day,
  amount: Amount.annotate({ description: "Signed as the account sees it, in minor units" }),
  payee: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
    description: "Payee name as the file gives it; title-cased on import unless told otherwise",
  }),
  importedPayee: Schema.optionalKey(Schema.NullOr(Schema.String)),
  notes: Schema.optionalKey(Schema.NullOr(Schema.String)),
  category: Schema.optionalKey(Schema.NullOr(Id)).annotate({ description: "Category id" }),
  importedId: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
    description: "The bank's id of the transaction (OFX FITID), matched first",
  }),
  cleared: Schema.optionalKey(Schema.Boolean),
  skip: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "Neither add nor update it, though it still takes its match so the others match as previewed",
  }),
  forceAdd: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Add it even when it matches an existing transaction",
  }),
});
export type ImportRow = typeof ImportRow.Type;

/**
 * What importing a row does: `new` adds a transaction, `update` merges it into the matching
 * existing one, `duplicate` matches one that has nothing to take from it (or is reconciled), and
 * `skipped` leaves it out (asked to, or a rule deleted it). A linked account's fetch also gives
 * `dismissed`, a line once deleted or undone, and `conflict`, an id back with another amount.
 */
export const ImportStatus = Schema.Literals([
  "new",
  "update",
  "duplicate",
  "skipped",
  "dismissed",
  "conflict",
]);
export type ImportStatus = typeof ImportStatus.Type;

export const ImportPreviewRow = Schema.Struct({
  ...ImportRow.fields,
  /** The row's position in the file, after skipped lines and the header. */
  index: Schema.Int,
  payee: Schema.NullOr(Schema.String),
  importedPayee: Schema.NullOr(Schema.String),
  notes: Schema.NullOr(Schema.String),
  category: Schema.NullOr(Id),
  /** The category the file names, whether or not a category of the book has that name. */
  categoryName: Schema.NullOr(Schema.String),
  importedId: Schema.NullOr(Schema.String),
  cleared: Schema.Boolean,
  /** Null when no account was given to compare with. */
  status: Schema.NullOr(ImportStatus),
  /** The existing transaction it matches. */
  match: Schema.NullOr(Id),
});
export type ImportPreviewRow = typeof ImportPreviewRow.Type;

export const ImportRowError = Schema.Struct({ index: Schema.Int, message: Schema.String });

export const ImportPreview = Schema.Struct({
  fileType: ImportFileType,
  /** The CSV columns to map fields from; empty for the other file types. */
  columns: Schema.Array(Schema.String),
  /** The CSV mapping used, given or detected; null for the other file types. */
  mapping: Schema.NullOr(ImportMapping),
  /** The date order used for CSV and QIF, given or detected. */
  dateFormat: Schema.NullOr(ImportDateFormat),
  rows: Schema.Array(ImportPreviewRow),
  /** Rows left out because their date could not be read. */
  errors: Schema.Array(ImportRowError),
});
export type ImportPreview = typeof ImportPreview.Type;

export const ImportOutcome = Schema.Struct({
  index: Schema.Int,
  status: ImportStatus,
  /** The added or matched transaction; null for a new row in a dry run. */
  transactionId: Schema.NullOr(Id),
});

export const ImportResult = Schema.Struct({
  added: Schema.Array(Id),
  updated: Schema.Array(Id),
  /** Existing transactions a row matched and left as they were. */
  skipped: Schema.Array(Id),
  rows: Schema.Array(ImportOutcome),
  dryRun: Schema.Boolean,
});
export type ImportResult = typeof ImportResult.Type;

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

const optionalText = (description: string) =>
  Schema.optionalKey(Schema.String).annotate({ description });
const optionalFlag = (description: string) =>
  Schema.optionalKey(Schema.Boolean).annotate({ description });

/** A bank file and the options of Actual's import dialog. */
const FileFields = {
  path: Schema.optionalKey(Schema.String).annotate({
    description: "A file on this computer to read; or give content",
    ...cli({ positional: true }),
  }),
  content: optionalText("The file's text, instead of a path"),
  fileName: optionalText("The file's name, to tell its type by extension when content is given"),
  fileType: Schema.optionalKey(ImportFileType).annotate({
    description: "csv, ofx (also QFX), qif or camt; by default from the file's extension",
  }),
  encoding: optionalText(
    "The CSV file's encoding when read from path, e.g. windows-1252; by default UTF-8 or UTF-16 by its byte order mark",
  ),
  delimiter: optionalText("CSV delimiter; a comma, or a tab for .tsv"),
  hasHeaderRow: optionalFlag("Whether the CSV's first line names the columns (default true)"),
  skipStartLines: Schema.optionalKey(Schema.Int).annotate({
    description: "CSV lines to skip at the start",
  }),
  skipEndLines: Schema.optionalKey(Schema.Int).annotate({
    description: "CSV lines to skip at the end",
  }),
  dateField: optionalText("CSV column of the date"),
  payeeField: optionalText("CSV column of the payee"),
  notesField: optionalText("CSV column of the notes"),
  amountField: optionalText("CSV column of the amount"),
  inflowField: optionalText("CSV column of inflows, with outflowField instead of amountField"),
  outflowField: optionalText("CSV column of outflows, with inflowField instead of amountField"),
  categoryField: optionalText("CSV column of the category name"),
  inOutField: optionalText("CSV column that says whether the amount is an inflow or an outflow"),
  outValue: optionalText(
    "The inOutField value that means an outflow; giving it turns the in/out column on",
  ),
  dateFormat: Schema.optionalKey(ImportDateFormat).annotate({
    description: "The order of CSV and QIF dates; detected from the first row by default",
  }),
  flipAmount: optionalFlag("Flip the sign of every amount"),
  multiplier: Schema.optionalKey(Schema.Number).annotate({
    description: "Multiply every amount, e.g. 0.01 when the file gives cents",
  }),
  importNotes: optionalFlag("Keep the notes (memo) of the file (default true)"),
  fallbackMissingPayeeToMemo: optionalFlag(
    "OFX: use the memo as payee when a transaction has none (default true)",
  ),
  swapPayeeAndMemo: optionalFlag("OFX, QIF, CAMT: swap the payee and the memo"),
  startDate: Schema.optionalKey(Day).annotate({ description: "Leave out rows before this day" }),
  cleared: optionalFlag("Mark imported transactions cleared (default true)"),
  derivePayees: optionalFlag(
    "Derive each payee from the file's payee text as bank sync does, without the days, times, amounts, card masks and long numbers that differ per purchase, and keep the text in the notes when they are empty (default true). False takes the payee as the file writes it, as Actual does",
  ),
};

export const imports = {
  preview_import: {
    description:
      "Read a bank file (CSV, OFX/QFX, QIF or CAMT.053) as Actual's import dialog does, with its options, and return its rows as transactions to import, newest first. With account, each row says whether it is new or matches an existing transaction (a duplicate, or one it would update). For a CSV, columns lists what fields can be mapped from and mapping the mapping used.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      account: Schema.optionalKey(Id).annotate({
        description: "Account to compare with, to mark duplicates",
        ...cli({ alias: "a" }),
      }),
      ...FileFields,
    }),
    success: ImportPreview,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/imports/preview" },
    cli: {
      command: ["import", "preview"],
      description: "Show what a bank file would import",
      examples: [
        {
          command: "reeve import preview ~/Downloads/bank.csv --account <id>",
          description: "Rows of a CSV, with duplicates marked",
        },
      ],
    },
  },
  import_transactions: {
    description:
      "Import transactions into an account from rows (preview_import's rows without their index, categoryName, status and match) or from a bank file with the same options. Rules run on each. With reconcile (the default) a row matches an existing transaction by importedId, else by amount within 7 days, preferring the same payee; a match is updated (cleared, imported id and payee, missing payee, category and notes) instead of duplicated. dryRun reports what would happen without writing.",
    readonly: false,
    input: Schema.Struct({
      book: BookField,
      account: Id.annotate({ description: "The account to import into", ...cli({ alias: "a" }) }),
      rows: Schema.optionalKey(Schema.Array(ImportRow)).annotate({
        description: "Transactions to import, instead of a file",
      }),
      ...FileFields,
      reconcile: optionalFlag(
        "Match existing transactions instead of adding every row (default true)",
      ),
      titleCasePayees: optionalFlag(
        "Title-case payee names when reconciling, as Actual does (default true)",
      ),
      dryRun: optionalFlag("Report what would happen without changing the book"),
    }),
    success: ImportResult,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/imports" },
    cli: {
      command: ["import", "run"],
      description: "Import a bank file into an account",
      examples: [
        {
          command: "reeve import run ~/Downloads/bank.ofx --account <id>",
          description: "Import an OFX file, merging duplicates",
        },
      ],
    },
  },
  export_transactions: {
    description:
      "Export transactions as CSV text, as Actual's account export: Account, Date, Payee, Notes, Category_Group, Category, Amount, Split_Amount, Cleared, newest first, a split as its total and one line per part. Filters as list_transactions.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      account: Schema.optionalKey(Id).annotate({
        description: "Account id",
        ...cli({ alias: "a" }),
      }),
      ...RegisterFilterFields,
    }),
    success: Schema.String,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/export/transactions.csv" },
    cli: { command: ["export", "csv"], description: "Export transactions as CSV" },
  },
  export_book: {
    description:
      "Write a consistent copy of the whole book (its SQLite file) to a path on this computer, as a backup that restore_book reads. Receipt photos, if any, are copied into the folder <path>.receipts beside it, which restore_book reads too.",
    readonly: true,
    input: Schema.Struct({
      book: BookField,
      path: Schema.String.annotate({
        description: "Where to write the backup",
        ...cli({ positional: true }),
      }),
      overwrite: optionalFlag("Replace a file already at path"),
    }),
    success: Schema.Struct({
      path: Schema.String,
      bytes: Schema.Int,
      /** The folder the receipt photos went to; null when the book has none. */
      photos: Schema.NullOr(Schema.String),
    }),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/export/backup" },
    cli: { command: ["export", "book"], description: "Back up the book to a file" },
  },
  restore_book: {
    description:
      "Restore a backup that export_book wrote as a new book, with the backup's name unless name is given, and the receipt photos in the folder <path>.receipts beside it if there is one.",
    readonly: false,
    input: Schema.Struct({
      path: Schema.String.annotate({
        description: "The backup file",
        ...cli({ positional: true }),
      }),
      name: Schema.optionalKey(Schema.NonEmptyString).annotate({
        description: "Name of the new book",
      }),
    }),
    success: Book,
    error: Schema.Union([InvalidRequest, StorageError]),
    http: { method: "POST", path: "/books/restore" },
    cli: { command: ["books", "restore"], description: "Restore a backup as a new book" },
  },
} satisfies Record<string, Operation>;

import { Schema } from "effect";
import {
  Book,
  BookInfo,
  BookSettings,
  BudgetType,
  DateFormat,
  InvalidRequest,
  NumberFormat,
  StorageError,
} from "../domain.ts";
import { BookField, cli, inBook, type Operation } from "../operation.ts";

export const books = {
  list_books: {
    description:
      "List the books on this computer. Each book is one SQLite file with its own accounts and budget.",
    readonly: true,
    input: Schema.Struct({}),
    success: Schema.Array(BookInfo),
    error: StorageError,
    http: { method: "GET", path: "/books" },
    cli: { command: ["books", "list"], description: "List books" },
  },
  create_book: {
    description:
      "Create a book with the default categories of Actual Budget, and make it the default book when it is the first one.",
    readonly: false,
    input: Schema.Struct({
      name: Schema.NonEmptyString.annotate({
        description: "Book name",
        ...cli({ positional: true }),
      }),
      currency: Schema.optionalKey(Schema.String).annotate({
        description: "ISO currency code, USD by default",
      }),
      budgetType: Schema.optionalKey(BudgetType).annotate({
        description: "envelope (default) or tracking",
      }),
      empty: Schema.optionalKey(Schema.Boolean).annotate({
        description: "Start without the default categories",
      }),
    }),
    success: Book,
    error: Schema.Union([InvalidRequest, StorageError]),
    http: { method: "POST", path: "/books" },
    cli: {
      command: ["books", "create"],
      description: "Create a book",
      examples: [
        { command: 'reeve books create "Household"', description: "A new envelope budget" },
      ],
    },
  },
  get_book: {
    description: "Read a book's settings: name, currency, budget type and formats.",
    readonly: true,
    input: Schema.Struct({ book: BookField }),
    success: Book,
    error: inBook(),
    http: { method: "GET", path: "/books/:book" },
    cli: { command: ["books", "show"], description: "Show the book's settings" },
  },
  update_book: {
    description:
      "Change a book's settings; fields left out stay. Switching budgetType keeps what each type budgeted.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book: BookField,
      name: Schema.optionalKey(Schema.NonEmptyString),
      currency: Schema.optionalKey(Schema.String),
      budgetType: Schema.optionalKey(BudgetType),
      numberFormat: Schema.optionalKey(NumberFormat),
      dateFormat: Schema.optionalKey(DateFormat),
      firstDayOfWeek: Schema.optionalKey(Schema.Int),
      hideFraction: Schema.optionalKey(Schema.Boolean),
      categoryDepth: Schema.optionalKey(
        Schema.Int.annotate({
          description: "Most levels categories may nest inside a group, at least 1 (flat)",
        }),
      ),
      autoApplyReceipts: Schema.optionalKey(
        Schema.Boolean.annotate({
          description:
            "Apply a receipt to its transaction whenever a write leaves it balanced, categorized and paid by exactly one transaction (default off)",
        }),
      ),
      bankAutoSync: Schema.optionalKey(
        Schema.Boolean.annotate({
          description:
            "Have the running server fetch linked accounts by itself, up to 4 times a day (default off)",
        }),
      ),
    }),
    success: BookSettings,
    error: inBook(),
    http: { method: "PATCH", path: "/books/:book" },
    cli: { command: ["books", "update"], description: "Change the book's settings" },
  },
  set_default_book: {
    description: "Make a book the one the CLI and MCP use when no book is named.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      id: Schema.String.annotate({ description: "Book id", ...cli({ positional: true }) }),
    }),
    success: BookInfo,
    error: inBook(),
    http: { method: "PUT", path: "/default-book/:id" },
    cli: { command: ["books", "use"], description: "Make a book the default" },
  },
  delete_book: {
    description: "Delete a book and its file. It cannot be undone.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({
      id: Schema.String.annotate({ description: "Book id", ...cli({ positional: true }) }),
    }),
    success: Schema.Struct({ deleted: Schema.String }),
    error: inBook(),
    http: { method: "DELETE", path: "/books/:id" },
    cli: { command: ["books", "delete"], description: "Delete a book" },
  },
  undo: {
    description: "Undo the latest change to the book; false when there is nothing to undo.",
    readonly: false,
    input: Schema.Struct({ book: BookField }),
    success: Schema.Struct({ done: Schema.Boolean }),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/undo" },
    cli: { command: ["undo"], description: "Undo the latest change" },
  },
  redo: {
    description: "Redo the change undo reversed last; false when there is nothing to redo.",
    readonly: false,
    input: Schema.Struct({ book: BookField }),
    success: Schema.Struct({ done: Schema.Boolean }),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/redo" },
    cli: { command: ["redo"], description: "Redo what undo reversed" },
  },
  set_note: {
    description:
      "Set the note of an account, a category, a category group or a budget month (id `budget-YYYY-MM`); null or empty removes it.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book: BookField,
      id: Schema.String.annotate({
        description: "What the note belongs to",
        ...cli({ positional: true }),
      }),
      note: Schema.NullOr(Schema.String),
    }),
    success: Schema.Struct({ id: Schema.String, note: Schema.NullOr(Schema.String) }),
    error: inBook(),
    http: { method: "PUT", path: "/books/:book/notes/:id" },
  },
} satisfies Record<string, Operation>;

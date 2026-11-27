import { Effect, Schema, type SchemaAST } from "effect";
import { BookNotFound, InvalidRequest, NotFound, StorageError } from "./domain.ts";

/** How a field of an operation's input appears on the command line, beyond its name and type. */
export const CliField = Schema.Struct({
  /** An argument taken by position, in field order, instead of a `--flag`. */
  positional: Schema.optionalKey(Schema.Boolean),
  /** A one-letter short form: `p` for `-p`. */
  alias: Schema.optionalKey(Schema.String),
  /** The help of `--no-<name>`, which sets a nullable field to null. */
  clear: Schema.optionalKey(Schema.String),
  /** No flag at all: a secret on a command line lands in the shell's history. */
  omit: Schema.optionalKey(Schema.Boolean),
});
export type CliField = typeof CliField.Type;

export const CLI_ANNOTATION = "reeve/cli";

/** Annotations for a field: `title: Schema.NonEmptyString.annotate(cli({ positional: true }))`. */
export const cli = (field: CliField) => ({ [CLI_ANNOTATION]: field });

/** Which accounts an overview covers, as the register's scope: all of them when both are left out. */
export const AccountScopeFields = {
  account: Schema.optionalKey(Schema.String).annotate({
    description: "Only this account",
    ...cli({ alias: "a" }),
  }),
  onBudget: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Only budget accounts (true) or only off-budget ones (false)",
  }),
};

/** The success of an operation that answers with a file's bytes rather than a value. */
export const FileSuccess = { _tag: "File" } as const;
export type FileSuccess = typeof FileSuccess;

export interface Http {
  readonly method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Relative to `/api`. Each `:name` segment is the input field `name`; the rest is the body or query. */
  readonly path: `/${string}`;
}

export interface CliCommand {
  /** The words that run it: `["accounts", "create"]` is `reeve accounts create`. */
  readonly command: readonly [string, ...Array<string>];
  readonly description: string;
  readonly aliases?: ReadonlyArray<string>;
  readonly examples?: ReadonlyArray<{ readonly command: string; readonly description: string }>;
}

export interface Operation {
  readonly description: string;
  readonly readonly: boolean;
  readonly destructive?: boolean;
  /** Whether repeating a call with the same input changes nothing more. */
  readonly idempotent?: boolean;
  /**
   * The handler reaches the network, so the runner opens no transaction around it. It runs its own
   * writes, before and after the call, with the `Books` service.
   */
  readonly network?: true;
  /** One flat struct. A `book` field makes the operation run in one book. */
  readonly input: Schema.Struct<Schema.Struct.Fields>;
  readonly success: Schema.Top | FileSuccess;
  readonly error: Schema.Top;
  readonly http: Http;
  /** Without it the operation has no command of its own: the app or MCP runs it. */
  readonly cli?: CliCommand;
}

export const BookField = Schema.optionalKey(Schema.String).annotate({
  description:
    "Book id, as list_books gives it; omit it (or ~ in an HTTP path) for the default book.",
});

/** A positional id field: `Id("Account id")`. */
export const IdField = (description: string) =>
  Schema.String.annotate({ description, ...cli({ positional: true }) });

/** The errors of an operation in a book: finding the book and reading it can fail too. */
export const inBook = <const Errors extends ReadonlyArray<Schema.Top>>(...errors: Errors) =>
  Schema.Union([BookNotFound, StorageError, InvalidRequest, NotFound, ...errors]);

/**
 * How every surface reads an operation's input: every problem at once, and a key the input does
 * not know, at any depth, is an error rather than dropped (docs/rules/boundaries.md).
 */
export const INPUT_PARSE_OPTIONS = {
  errors: "all",
  onExcessProperty: "error",
} as const satisfies SchemaAST.ParseOptions;

const inputChecks = new WeakMap<
  Operation,
  (input: unknown, options: SchemaAST.ParseOptions) => Effect.Effect<unknown, Schema.SchemaError>
>();

/**
 * Checks a decoded input against its operation's schema, as the runner does whatever surface it
 * came from; fails with an `InvalidRequest` that names each problem, an unknown key among them.
 */
export const checkInput = (
  operation: Operation,
  input: unknown,
): Effect.Effect<Record<string, unknown>, InvalidRequest> => {
  let check = inputChecks.get(operation);
  if (check === undefined) {
    check = Schema.decodeUnknownEffect(
      Schema.toType(operation.input) as unknown as Schema.Codec<unknown, unknown>,
    );
    inputChecks.set(operation, check);
  }
  return check(input, INPUT_PARSE_OPTIONS).pipe(
    Effect.map((value) => value as Record<string, unknown>),
    Effect.mapError((error) => new InvalidRequest({ message: error.message })),
  );
};

/** Whether an operation runs in one book, which every surface picks in its own way. */
export const inOneBook = (operation: Operation): boolean => "book" in operation.input.fields;

/** The input fields an HTTP path names, in order: `["book", "id"]`. */
export const pathParams = (http: Http): Array<string> =>
  http.path
    .split("/")
    .filter((segment) => segment.startsWith(":"))
    .map((segment) => segment.slice(1));

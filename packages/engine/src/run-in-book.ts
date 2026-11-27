import { BankError, BookNotFound, InvalidRequest, NotFound, StorageError } from "@reeve/contract";
import { Effect } from "effect";
import type { Book } from "./book.ts";
import type { Books } from "./books.ts";
import { inTransaction } from "./db/open.ts";

export type DomainError = InvalidRequest | NotFound | BookNotFound | BankError | StorageError;

/** What a domain function threw, as the operation's failure: its own errors, or a storage error. */
export const failure = (error: unknown): DomainError =>
  error instanceof InvalidRequest ||
  error instanceof NotFound ||
  error instanceof BookNotFound ||
  error instanceof BankError
    ? error
    : new StorageError({
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      });

/** Runs a book operation's handler: reads directly, writes in one transaction and one undo step. */
export const runInBook = <A>(
  books: Books["Service"],
  book: Book,
  readonly: boolean,
  run: () => A,
): Effect.Effect<A, DomainError> =>
  Effect.try({
    try: () => (readonly ? run() : inTransaction(book.client, run)),
    catch: failure,
  }).pipe(Effect.tap(() => (readonly ? Effect.void : books.changed(book.id))));

/** A write that is no step of undo and leaves what can be redone alone, as a link's status. */
export const runQuietly = <A>(
  books: Books["Service"],
  book: Book,
  run: () => A,
): Effect.Effect<A, DomainError> =>
  Effect.try({
    try: () => inTransaction(book.client, run, { record: false }),
    catch: failure,
  }).pipe(Effect.tap(() => books.changed(book.id)));

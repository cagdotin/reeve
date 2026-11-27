import type { Catalog, FileSuccess, OperationName } from "@reeve/contract/catalog";
import type { Effect, Schema } from "effect";
import type { Book } from "./book.ts";
import type { Books } from "./books.ts";

export type OperationInput<K extends OperationName> = Catalog[K]["input"]["Type"];

export type OperationSuccess<K extends OperationName> = Catalog[K]["success"] extends FileSuccess
  ? Uint8Array
  : Catalog[K]["success"] extends Schema.Top
    ? Catalog[K]["success"]["Type"]
    : never;

export type OperationError<K extends OperationName> = Catalog[K]["error"]["Type"];

type BookInput<K extends OperationName> = Omit<OperationInput<K>, "book">;

/**
 * The engine function behind a catalog entry. One that runs in a book gets it opened and runs as
 * one SQLite transaction (one undo step when it writes), unless it reaches the network: that one
 * must hold no transaction across the call. The others get the `Books` service.
 */
export type Handler<K extends OperationName> = "book" extends keyof OperationInput<K>
  ? Catalog[K] extends { readonly network: true }
    ? (
        book: Book,
        input: BookInput<K>,
        books: Books["Service"],
      ) => Effect.Effect<OperationSuccess<K>, OperationError<K>>
    : (book: Book, input: BookInput<K>) => OperationSuccess<K>
  : (
      books: Books["Service"],
      input: OperationInput<K>,
    ) => Effect.Effect<OperationSuccess<K>, OperationError<K>>;

/** The handlers of one domain's operations: `satisfies DomainHandlers<typeof rules>`. */
export type DomainHandlers<Ops> = { readonly [K in keyof Ops & OperationName]: Handler<K> };

import {
  BookNotFound,
  InvalidRequest,
  StorageError,
  type Book as BookValue,
  type BookChange,
  type BookInfo,
  type BudgetType,
} from "@reeve/contract";
import { Context, Duration, Effect, Layer, PubSub, Schedule, Stream } from "effect";
import { existsSync, mkdirSync } from "node:fs";
import { readSettings, writeSettings, type Book } from "./book.ts";
import { inTransaction, openDatabase } from "./db/open.ts";
import {
  bookFile,
  bookIds,
  booksDir,
  readHomeConfig,
  removeBookFiles,
  writeHomeConfig,
} from "./home.ts";
import { createDefaultCategories } from "./ledger/categories.ts";
import { initializeDashboards } from "./reports/initialize.ts";
import { advanceSchedules } from "./schedules/schedules.ts";

const slugify = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "book";

export interface NewBook {
  readonly name: string;
  readonly currency?: string;
  readonly budgetType?: BudgetType;
  readonly empty?: boolean;
}

/** The books in the reeve home and an open handle for each. */
export class Books extends Context.Service<
  Books,
  {
    readonly home: string;
    readonly list: Effect.Effect<ReadonlyArray<BookInfo>, StorageError>;
    readonly create: (input: NewBook) => Effect.Effect<BookValue, InvalidRequest | StorageError>;
    /** A book by id; the default book when undefined, creating "My Budget" when there is none. */
    readonly open: (id: string | undefined) => Effect.Effect<Book, BookNotFound | StorageError>;
    readonly describe: (book: Book) => BookValue;
    readonly setDefault: (id: string) => Effect.Effect<BookInfo, BookNotFound | StorageError>;
    readonly remove: (id: string) => Effect.Effect<void, BookNotFound | StorageError>;
    /** Tells every listener a book changed. */
    readonly changed: (id: string) => Effect.Effect<void>;
    readonly changes: Stream.Stream<BookChange>;
  }
>()("@reeve/engine/Books") {
  static readonly layer = (options: { readonly home: string }) =>
    Layer.effect(
      Books,
      Effect.gen(function* () {
        const { home } = options;
        const pubsub = yield* PubSub.unbounded<BookChange>();
        const open = new Map<string, Book>();
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            for (const book of open.values()) book.client.close();
            open.clear();
          }),
        );

        const storage = (message: string) => (cause: unknown) =>
          new StorageError({ message, cause });

        /**
         * Posts the schedules that came due and moves paid ones on, as Actual does when a budget
         * opens and while it stays open. True when that changed the book.
         */
        const advance = (book: Book): boolean => {
          const result = inTransaction(book.client, () => advanceSchedules(book));
          return result.posted.length + result.advanced.length + result.completed.length > 0;
        };

        const handle = (id: string): Book => {
          const known = open.get(id);
          if (known !== undefined) return known;
          const file = bookFile(home, id);
          const existed = existsSync(file);
          const { db, client } = openDatabase(file);
          const book = { id, file, db, client };
          try {
            initializeDashboards(book);
          } catch (error) {
            client.close();
            throw error;
          }
          open.set(id, book);
          // A schedule that cannot post must not keep the book from opening; the hourly run and
          // run_schedules report it again.
          if (existed)
            try {
              advance(book);
            } catch (error) {
              console.error(`reeve: could not run the schedules of ${id}:`, error);
            }
          return book;
        };

        yield* Effect.forkScoped(
          Effect.suspend(() =>
            Effect.forEach([...open.values()], (book) =>
              Effect.sync(() => advance(book)).pipe(
                Effect.flatMap((changed) =>
                  changed ? PubSub.publish(pubsub, { book: book.id }) : Effect.void,
                ),
                Effect.ignore,
              ),
            ),
          ).pipe(
            Effect.repeat(Schedule.spaced(Duration.hours(1))),
            Effect.delay(Duration.hours(1)),
          ),
        );

        const describe = (book: Book): BookValue => ({
          id: book.id,
          file: book.file,
          settings: readSettings(book.db),
        });

        const info = (book: Book): BookInfo => ({
          id: book.id,
          name: readSettings(book.db).name,
          file: book.file,
        });

        const createSync = (input: NewBook): BookValue => {
          const name = input.name.trim();
          if (name === "") throw new InvalidRequest({ message: "A book needs a name" });
          mkdirSync(booksDir(home), { recursive: true });
          const taken = new Set(bookIds(home));
          const base = slugify(name);
          let id = base;
          for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
          const book = handle(id);
          inTransaction(
            book.client,
            () => {
              writeSettings(book.db, {
                name,
                currency: input.currency ?? "USD",
                budgetType: input.budgetType ?? "envelope",
              });
              if (input.empty !== true) createDefaultCategories(book);
            },
            { record: false },
          );
          if (readHomeConfig(home).defaultBook === undefined)
            writeHomeConfig(home, { defaultBook: id });
          return describe(book);
        };

        const tryStorage = <A>(message: string, run: () => A) =>
          Effect.try({
            try: run,
            catch: (error) =>
              error instanceof InvalidRequest || error instanceof BookNotFound
                ? error
                : storage(message)(error),
          });

        const resolve = (
          id: string | undefined,
        ): Effect.Effect<string, BookNotFound | StorageError> =>
          Effect.gen(function* () {
            if (id !== undefined) {
              if (!existsSync(bookFile(home, id))) return yield* new BookNotFound({ book: id });
              return id;
            }
            const configured = readHomeConfig(home).defaultBook;
            if (configured !== undefined && existsSync(bookFile(home, configured)))
              return configured;
            const first = bookIds(home)[0];
            if (first !== undefined) return first;
            return (yield* tryStorage("Could not create the first book", () =>
              createSync({ name: "My Budget" }),
            ) as Effect.Effect<BookValue, StorageError>).id;
          });

        return Books.of({
          home,
          list: tryStorage("Could not list the books", () =>
            bookIds(home).map((id) => info(handle(id))),
          ) as Effect.Effect<ReadonlyArray<BookInfo>, StorageError>,
          create: (input) =>
            tryStorage("Could not create the book", () => createSync(input)) as Effect.Effect<
              BookValue,
              InvalidRequest | StorageError
            >,
          open: (id) =>
            Effect.flatMap(resolve(id), (resolved) =>
              tryStorage(`Could not open the book ${resolved}`, () => handle(resolved)),
            ) as Effect.Effect<Book, BookNotFound | StorageError>,
          describe,
          setDefault: (id) =>
            Effect.flatMap(resolve(id), (resolved) =>
              tryStorage("Could not set the default book", () => {
                writeHomeConfig(home, { ...readHomeConfig(home), defaultBook: resolved });
                return info(handle(resolved));
              }),
            ) as Effect.Effect<BookInfo, BookNotFound | StorageError>,
          remove: (id) =>
            Effect.flatMap(resolve(id), (resolved) =>
              tryStorage("Could not delete the book", () => {
                open.get(resolved)?.client.close();
                open.delete(resolved);
                removeBookFiles(home, resolved);
                const config = readHomeConfig(home);
                if (config.defaultBook === resolved) writeHomeConfig(home, {});
              }),
            ) as Effect.Effect<void, BookNotFound | StorageError>,
          changed: (id) => Effect.asVoid(PubSub.publish(pubsub, { book: id })),
          changes: Stream.fromPubSub(pubsub),
        });
      }),
    );
}

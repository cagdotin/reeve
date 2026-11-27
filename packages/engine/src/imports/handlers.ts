import { InvalidRequest, StorageError } from "@reeve/contract";
import type { imports } from "@reeve/contract/catalog";
import { Effect } from "effect";
import { invalid } from "../book.ts";
import type { DomainHandlers } from "../handler.ts";
import {
  exportBook,
  exportTransactionsCsv,
  openBackup,
  restoreInto,
  restorePhotos,
} from "./export.ts";
import { hasFile, prepareFile } from "./prepare.ts";
import { importRows, type RowToImport } from "./reconcile.ts";

const storage = (message: string) => (error: unknown) =>
  error instanceof InvalidRequest ? error : new StorageError({ message, cause: error });

/** Importing bank files (CSV, OFX, QFX, QIF, CAMT) and exporting transactions and books. */
export const importHandlers = {
  preview_import: (book, input) => {
    const prepared = prepareFile(book, input);
    const outcomes =
      input.account === undefined
        ? undefined
        : new Map(
            importRows(book, input.account, prepared.rows, {
              reconcile: true,
              dryRun: true,
              titleCase: true,
            }).rows.map((outcome) => [outcome.index, outcome]),
          );
    return {
      ...prepared,
      rows: prepared.rows.map((row) => {
        const outcome = outcomes?.get(row.index);
        return {
          ...row,
          status: outcome?.status ?? null,
          match: outcome !== undefined && outcome.status !== "new" ? outcome.transactionId : null,
        };
      }),
    };
  },
  import_transactions: (book, input) => {
    let rows: ReadonlyArray<RowToImport>;
    if (input.rows !== undefined) {
      if (hasFile(input)) invalid("Give rows or a file, not both");
      rows = input.rows.map((row, index) => ({ ...row, index }));
    } else {
      const prepared = prepareFile(book, input);
      const [error] = prepared.errors;
      if (error !== undefined) invalid(error.message);
      rows = prepared.rows;
    }
    return importRows(book, input.account, rows, {
      reconcile: input.reconcile ?? true,
      dryRun: input.dryRun ?? false,
      titleCase: input.titleCasePayees ?? true,
    });
  },
  export_transactions: (book, input) => exportTransactionsCsv(book, input),
  export_book: (book, input) => exportBook(book, input),
  restore_book: (books, input) =>
    Effect.gen(function* () {
      const backup = yield* Effect.try({
        try: () => openBackup(input.path),
        catch: storage("Could not read the backup"),
      });
      return yield* Effect.gen(function* () {
        const created = yield* books.create({
          name: input.name ?? backup.settings.name,
          empty: true,
        });
        const book = yield* Effect.mapError(
          books.open(created.id),
          (error) => new StorageError({ message: `Could not open ${created.id}`, cause: error }),
        );
        yield* Effect.try({
          try: () => {
            restoreInto(book, backup.file, input.name);
            restorePhotos(book, input.path);
          },
          catch: storage("Could not restore the backup"),
        }).pipe(Effect.tapError(() => Effect.ignore(books.remove(book.id))));
        yield* books.changed(book.id);
        return books.describe(book);
      }).pipe(Effect.ensuring(Effect.sync(backup.cleanup)));
    }),
} satisfies DomainHandlers<typeof imports>;

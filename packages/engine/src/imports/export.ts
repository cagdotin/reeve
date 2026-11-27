/** Exporting transactions as CSV (Actual's `exportQueryToCSV`) and books as SQLite backups. */
import { stringify as csvStringify } from "csv-stringify/sync";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-sqlite";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { invalid, readSettings, writeSettings, type Book } from "../book.ts";
import { openDatabase } from "../db/open.ts";
import { homeOfBook, receiptsDir } from "../home.ts";
import { restoreLegacyPhotos } from "../receipts/compatibility.ts";
import * as t from "../db/schema.ts";
import { listRegister, type RegisterQuery } from "../ledger/register.ts";

// A cell a spreadsheet would run as a formula gets a quote first.
const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;

const toCsv = (rows: ReadonlyArray<Record<string, unknown>>) =>
  csvStringify(rows as Array<Record<string, unknown>>, {
    header: true,
    cast: { string: (value: string) => (FORMULA_TRIGGERS.test(value) ? `'${value}` : value) },
  });

export const integerToAmount = (amount: number): number => amount / 100;

export const exportTransactionsCsv = (book: Book, query: Omit<RegisterQuery, "limit">): string => {
  const groups = new Map(
    book.db
      .select({ id: t.accounts.id, group: t.categoryGroups.name })
      .from(t.accounts)
      .innerJoin(t.categoryGroups, eq(t.categoryGroups.id, t.accounts.groupId))
      .all()
      .map((row) => [row.id, row.group]),
  );
  const { rows } = listRegister(book, { ...query, limit: Number.MAX_SAFE_INTEGER });
  const status = (row: { readonly cleared: boolean; readonly reconciled: boolean }) =>
    row.reconciled ? "Reconciled" : row.cleared ? "Cleared" : "Not cleared";
  return toCsv(
    rows.flatMap((row) => {
      const category =
        row.counterpart.kind === "category"
          ? row.counterpart
          : row.splits.length === 1 && row.splits[0]!.kind === "category"
            ? { id: row.splits[0]!.accountId, name: row.splits[0]!.name }
            : null;
      if (row.counterpart.kind !== "split")
        return [
          {
            Account: row.accountName,
            Date: row.date,
            Payee: row.payee ?? "",
            Notes: row.notes ?? "",
            Category_Group: category === null ? "" : (groups.get(category.id) ?? ""),
            Category: category?.name ?? "",
            Amount: integerToAmount(row.amount),
            Split_Amount: 0,
            Cleared: status(row),
          },
        ];
      const count = row.splits.length;
      return [
        {
          Account: row.accountName,
          Date: row.date,
          Payee: row.payee ?? "",
          Notes: `(SPLIT INTO ${count}) ${row.notes ?? ""}`,
          Category_Group: "",
          Category: "",
          Amount: 0,
          Split_Amount: integerToAmount(row.amount),
          Cleared: status(row),
        },
        ...row.splits.map((line, index) => ({
          Account: row.accountName,
          Date: row.date,
          Payee: row.payee ?? "",
          Notes: `(SPLIT ${index + 1} OF ${count}) ${line.memo ?? ""}`,
          Category_Group: line.kind === "category" ? (groups.get(line.accountId) ?? "") : "",
          Category: line.kind === "category" ? line.name : "",
          Amount: integerToAmount(line.amount),
          Split_Amount: 0,
          Cleared: status(row),
        })),
      ];
    }),
  );
};

/** The folder of receipt photos that goes with a backup file: `<backup>.receipts`. */
export const backupPhotosDir = (path: string) => `${resolve(path)}.receipts`;

/** Copies a folder of receipt photos, leaving out deleted ones waiting in `.trash`. */
const copyPhotos = (from: string, to: string) =>
  cpSync(from, to, { recursive: true, filter: (source) => basename(source) !== ".trash" });

const hasPhotos = (folder: string) =>
  existsSync(folder) && readdirSync(folder).some((name) => name !== ".trash");

/**
 * Writes a consistent copy of the book's SQLite file with `VACUUM INTO`, and its receipt photos,
 * if it has any, into the folder `<path>.receipts` beside it.
 */
export const exportBook = (
  book: Book,
  input: { readonly path: string; readonly overwrite?: boolean },
) => {
  const path = resolve(input.path);
  const photos = backupPhotosDir(path);
  if (existsSync(path) || existsSync(photos)) {
    if (input.overwrite !== true) invalid(`${existsSync(path) ? path : photos} already exists`);
    rmSync(path, { force: true });
    rmSync(photos, { recursive: true, force: true });
  }
  if (!existsSync(dirname(path))) invalid(`The folder ${dirname(path)} does not exist`);
  restoreLegacyPhotos(book);
  book.client.prepare("VACUUM INTO ?").run(path);
  const source = receiptsDir(homeOfBook(book.file), book.id);
  const withPhotos = hasPhotos(source);
  if (withPhotos) copyPhotos(source, photos);
  return { path, bytes: statSync(path).size, photos: withPhotos ? photos : null };
};

/** Brings the photos exported beside a backup into a restored book. */
export const restorePhotos = (book: Book, backupPath: string) => {
  const photos = backupPhotosDir(backupPath);
  if (hasPhotos(photos)) copyPhotos(photos, receiptsDir(homeOfBook(book.file), book.id));
};

/**
 * Tables a backup brings into a book; the undo history and migration bookkeeping stay, and so do
 * bank links, or a restored copy would sync the same bank account as a second book.
 */
const SKIPPED_TABLES = new Set([
  "__migrations",
  "undo_log",
  "undo_state",
  "bank_connections",
  "bank_links",
]);

/**
 * Opens a backup as a book would be opened (migrated to the current schema) from a temporary
 * copy, so the backup file itself is never changed. Gives its settings and a cleanup.
 */
export const openBackup = (path: string) => {
  const file = resolve(path);
  if (!existsSync(file)) invalid(`${file} does not exist`);
  const folder = mkdtempSync(join(tmpdir(), "reeve-restore-"));
  const copy = join(folder, "backup.sqlite");
  copyFileSync(file, copy);
  const cleanup = () => rmSync(folder, { recursive: true, force: true });
  try {
    const database = openDatabase(copy);
    const settings = readSettings(drizzle({ client: database.client }));
    // Fold the WAL back into the file before it is attached elsewhere.
    database.client.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;");
    database.close();
    return { file: copy, settings, cleanup };
  } catch (error) {
    cleanup();
    return invalid(
      `${file} is not a reeve backup: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

const quoteId = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Replaces every table of an (empty, new) book with the backup's, as one transaction. */
export const restoreInto = (book: Book, backupFile: string, name: string | undefined) => {
  const { client } = book;
  client.prepare("ATTACH DATABASE ? AS backup").run(backupFile);
  try {
    const tables = (
      client
        .prepare(
          "SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .all() as Array<{ name: string }>
    )
      .map((row) => row.name)
      .filter((table) => !SKIPPED_TABLES.has(table));
    client.exec("BEGIN IMMEDIATE");
    try {
      client.exec("PRAGMA defer_foreign_keys = ON");
      for (const table of tables) {
        const columns = (
          client.prepare(`PRAGMA main.table_info(${quoteId(table)})`).all() as Array<{
            name: string;
          }>
        )
          .map((column) => quoteId(column.name))
          .join(", ");
        client.exec(`DELETE FROM main.${quoteId(table)}`);
        client.exec(
          `INSERT INTO main.${quoteId(table)} (${columns}) SELECT ${columns} FROM backup.${quoteId(table)}`,
        );
      }
      if (name !== undefined) writeSettings(book.db, { name });
      client.exec("COMMIT");
    } catch (error) {
      client.exec("ROLLBACK");
      throw error;
    }
  } finally {
    client.exec("DETACH DATABASE backup");
  }
};

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { vi } from "vitest";
import { scratch } from "../helpers.ts";

/** The instant every property run lives in, so a seed replays a failure exactly. */
export const NOW = new Date("2026-06-15T12:00:00Z");
export const THIS_MONTH = "2026-06";

/** Fakes only Date: Effect's scheduler needs the real timers. */
export const freezeClock = () => vi.useFakeTimers({ toFake: ["Date"], now: NOW });
export const thawClock = () => vi.useRealTimers();

const UNDO_BOOKKEEPING = ["undo_log", "undo_state"];

/** Tables undo must not touch (docs/rules/bank.md): what undo took back must still count as seen. */
export const BEYOND_UNDO = ["seen_imports", "bank_connections", "bank_links"];

const REFUSALS = new Set(["InvalidRequest", "NotFound", "BookNotFound"]);

/** A refusal is a normal outcome of an operation; anything else, StorageError included, is a defect. */
export const isRefusal = (error: unknown) => {
  const tag = (error as { _tag?: string })._tag;
  return tag !== undefined && REFUSALS.has(tag);
};

/** Every table of a book as rows in rowid order, one JSON string per table. */
export type Dump = Readonly<Record<string, string>>;

export type World = Awaited<ReturnType<typeof openWorld>>;

/** A scratch home with one book, numbered ids and a read-only connection for the checks. */
export const openWorld = async () => {
  let nextId = 0;
  const ids = vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
    nextId += 1;
    return `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`;
  });
  const home = scratch();
  const { file, id: bookId } = await home.call<{ file: string; id: string }>("get_book");
  const client = new DatabaseSync(file, { readOnly: true });
  const tables = (
    client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>
  ).map((row) => row.name);
  const rowsOf = (table: string) =>
    JSON.stringify(
      client.prepare(`SELECT rowid AS _rowid, * FROM "${table}" ORDER BY rowid`).all(),
    );
  const all = <A = any>(sql: string, ...values: Array<string | number>) =>
    client.prepare(sql).all(...values) as Array<A>;

  return {
    call: home.call,
    all,
    /** The whole database but undo's own bookkeeping, which undoing has to change. */
    dump: (): Dump =>
      Object.fromEntries(
        tables
          .filter((table) => !UNDO_BOOKKEEPING.includes(table))
          .map((table) => [table, rowsOf(table)]),
      ),
    /** Undo's own bookkeeping, which with `dump` makes the whole database. */
    bookkeeping: (): Dump =>
      Object.fromEntries(UNDO_BOOKKEEPING.map((table) => [table, rowsOf(table)])),
    /** The whole database, bookkeeping included. */
    fullDump: (): Dump => Object.fromEntries(tables.map((table) => [table, rowsOf(table)])),
    /** The newest undo step, which a recorded write replaces with a higher one. */
    latestUndoStep: () =>
      all<{ id: number | null }>(
        "SELECT max(group_id) AS id FROM undo_log WHERE stack = 'undo'",
      )[0]!.id,
    /**
     * Whether an operation succeeds on a copy of this book without its rules. A schedule lives on its
     * rule, so those stay. The copy is the one place a check writes around an operation, and this
     * book never sees it.
     */
    succeedsWithoutRules: async (op: string, input: Record<string, unknown>) => {
      const other = scratch();
      try {
        mkdirSync(join(other.home, "books"));
        const copy = join(other.home, "books", `${bookId}.sqlite`);
        client.exec(`VACUUM INTO '${copy}'`);
        const editor = new DatabaseSync(copy);
        editor.exec("DELETE FROM rules WHERE id NOT IN (SELECT rule_id FROM schedules)");
        editor.close();
        await other.call(op, { ...input, book: bookId });
        return true;
      } catch (error) {
        if (isRefusal(error)) return false;
        throw error;
      } finally {
        await other.dispose();
      }
    },
    close: async () => {
      client.close();
      await home.dispose();
      ids.mockRestore();
    },
  };
};

const onlyIn = (rows: Array<string>, other: Array<string>) => {
  const seen = new Set(other);
  return rows.filter((row) => !seen.has(row));
};

/** What differs between two dumps, by table and row; null when they are the same. */
export const dumpDifference = (a: Dump, b: Dump): string | null => {
  const rows = (dump: Dump, table: string) =>
    (JSON.parse(dump[table] ?? "[]") as Array<unknown>).map((row) => JSON.stringify(row));
  const differences = Object.keys({ ...a, ...b })
    .filter((table) => a[table] !== b[table])
    .map((table) => {
      const [left, right] = [rows(a, table), rows(b, table)];
      return [
        `${table}:`,
        ...onlyIn(left, right).map((row) => `  - ${row}`),
        ...onlyIn(right, left).map((row) => `  + ${row}`),
      ].join("\n");
    });
  return differences.length === 0 ? null : differences.join("\n");
};

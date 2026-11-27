import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { DatabaseSync } from "node:sqlite";
import { migrations } from "./migrations.gen.ts";

export type Db = NodeSQLiteDatabase;

export interface Database {
  readonly db: Db;
  readonly client: DatabaseSync;
  readonly close: () => void;
}

/** Tables whose changes undo reverses: everything but the bookkeeping. */
const UNDONE_TABLES = [
  "settings",
  "category_groups",
  "accounts",
  "payees",
  "payees_apart",
  "dismissed_account_suggestions",
  "transactions",
  "postings",
  "budgets",
  "budget_months",
  "notes",
  "rules",
  "schedules",
  "tags",
  "dashboard_pages",
  "widgets",
  "custom_reports",
  "item_categories",
  "products",
  "product_aliases",
  "receipts",
  "receipt_lines",
  "receipt_adjustments",
  "receipt_payments",
  "receipt_photos",
];

/** How many write operations undo remembers. */
export const UNDO_DEPTH = 100;

const migrate = (client: DatabaseSync) => {
  client.exec(
    "CREATE TABLE IF NOT EXISTS __migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );
  const applied = new Set(
    (client.prepare("SELECT name FROM __migrations").all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );
  for (const migration of migrations) {
    if (applied.has(migration.name)) continue;
    client.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of migration.sql.split("--> statement-breakpoint")) {
        if (statement.trim() !== "") client.exec(statement);
      }
      client
        .prepare("INSERT INTO __migrations (name, applied_at) VALUES (?, ?)")
        .run(migration.name, Date.now());
      client.exec("COMMIT");
    } catch (error) {
      client.exec("ROLLBACK");
      throw error;
    }
  }
};

const quoteId = (name: string) => `"${name.replaceAll('"', '""')}"`;

/**
 * Triggers that record, for every change while `undo_state.active`, the SQL that reverses it, as
 * the SQLite documentation's undo/redo technique (docs/rules/boundaries.md). They are made again at each open
 * from the tables' columns, so a migration never leaves one stale.
 */
const installUndoTriggers = (client: DatabaseSync) => {
  client.exec(
    "INSERT OR IGNORE INTO undo_state (id, group_id, stack, active) VALUES (1, 0, 'undo', 0)",
  );
  for (const table of UNDONE_TABLES) {
    const columns = (
      client.prepare(`PRAGMA table_info(${quoteId(table)})`).all() as Array<{ name: string }>
    ).map((column) => column.name);
    const record = (statement: string) =>
      `INSERT INTO undo_log (group_id, stack, statement) SELECT group_id, stack, ${statement} FROM undo_state WHERE id = 1;`;
    const when = "WHEN (SELECT active FROM undo_state WHERE id = 1)";
    const t = quoteId(table);
    const assignments = columns
      .map(
        (column) =>
          `'${quoteId(column).replaceAll("'", "''")} = ' || quote(old.${quoteId(column)})`,
      )
      .join(" || ', ' || ");
    const names = ["rowid", ...columns.map(quoteId)].join(", ").replaceAll("'", "''");
    const values = ["old.rowid", ...columns.map((column) => `quote(old.${quoteId(column)})`)].join(
      " || ', ' || ",
    );
    client.exec(`
      DROP TRIGGER IF EXISTS undo_${table}_insert;
      DROP TRIGGER IF EXISTS undo_${table}_update;
      DROP TRIGGER IF EXISTS undo_${table}_delete;
      CREATE TRIGGER undo_${table}_insert AFTER INSERT ON ${t} ${when} BEGIN
        ${record(`'DELETE FROM ${t.replaceAll("'", "''")} WHERE rowid = ' || new.rowid`)}
      END;
      CREATE TRIGGER undo_${table}_update AFTER UPDATE ON ${t} ${when} BEGIN
        ${record(`'UPDATE ${t.replaceAll("'", "''")} SET ' || ${assignments} || ' WHERE rowid = ' || old.rowid`)}
      END;
      CREATE TRIGGER undo_${table}_delete BEFORE DELETE ON ${t} ${when} BEGIN
        ${record(`'INSERT INTO ${t.replaceAll("'", "''")} (${names}) VALUES (' || ${values} || ')'`)}
      END;
    `);
  }
};

/** Opens (creating when needed) a book's SQLite file, migrated to the current schema. */
export const openDatabase = (file: string): Database => {
  const client = new DatabaseSync(file, { timeout: 10_000 });
  client.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;");
  migrate(client);
  installUndoTriggers(client);
  const db = drizzle({ client });
  return { db, client, close: () => client.close() };
};

/**
 * Runs `write` in one immediate transaction recorded as one undo step, unless `record` is false.
 * A new step forgets what could be redone.
 */
export const inTransaction = <A>(
  client: DatabaseSync,
  write: () => A,
  options: { readonly record?: boolean; readonly stack?: "undo" | "redo" } = {},
): A => {
  const record = options.record ?? true;
  client.exec("BEGIN IMMEDIATE");
  try {
    if (record) {
      const stack = options.stack ?? "undo";
      client
        .prepare(
          "UPDATE undo_state SET group_id = (SELECT coalesce(max(group_id), 0) + 1 FROM undo_log), stack = ?, active = 1 WHERE id = 1",
        )
        .run(stack);
    }
    const result = write();
    if (record) {
      client.exec("UPDATE undo_state SET active = 0 WHERE id = 1");
      // A write that changed nothing undoable is no new step, so what can be redone stays.
      if (options.stack === undefined)
        client.exec(
          `DELETE FROM undo_log WHERE stack = 'redo'
             AND EXISTS (SELECT 1 FROM undo_log, undo_state
               WHERE undo_log.stack = 'undo' AND undo_log.group_id = undo_state.group_id)`,
        );
      client
        .prepare(
          `DELETE FROM undo_log WHERE stack = 'undo' AND group_id NOT IN
            (SELECT DISTINCT group_id FROM undo_log WHERE stack = 'undo' ORDER BY group_id DESC LIMIT ?)`,
        )
        .run(UNDO_DEPTH);
    }
    client.exec("COMMIT");
    return result;
  } catch (error) {
    client.exec("ROLLBACK");
    throw error;
  }
};

/**
 * Reverses the latest step of `from` (undo or redo), recording its reversal on the other stack.
 * False when there is nothing to reverse.
 */
export const reverseLatest = (client: DatabaseSync, from: "undo" | "redo"): boolean => {
  const latest = client
    .prepare("SELECT max(group_id) AS id FROM undo_log WHERE stack = ?")
    .get(from) as { id: number | null };
  if (latest.id === null) return false;
  const statements = client
    .prepare("SELECT seq, statement FROM undo_log WHERE group_id = ? ORDER BY seq DESC")
    .all(latest.id) as Array<{ seq: number; statement: string }>;
  inTransaction(
    client,
    () => {
      client.prepare("DELETE FROM undo_log WHERE group_id = ?").run(latest.id);
      // Foreign keys are checked at the end, as reversed statements come in reverse order.
      client.exec("PRAGMA defer_foreign_keys = ON");
      for (const { statement } of statements) client.exec(statement);
    },
    { stack: from === "undo" ? "redo" : "undo" },
  );
  return true;
};

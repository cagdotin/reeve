import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inTransaction, openDatabase, reverseLatest } from "../src/db/open.ts";
import { migrations } from "../src/db/migrations.gen.ts";

const MOVED = migrations.findIndex((each) => each.sql.includes("DROP COLUMN `imported_id`"));

let folder: string;
let file: string;

/** A book as the version before the move left it, undo trigger included. */
const oldBook = (seed: string) => {
  const client = new DatabaseSync(file);
  for (const migration of migrations.slice(0, MOVED))
    for (const statement of migration.sql.split("--> statement-breakpoint"))
      if (statement.trim() !== "") client.exec(statement);
  client.exec(`
    CREATE TABLE __migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
    INSERT OR IGNORE INTO undo_state (id, group_id, stack, active) VALUES (1, 1, 'undo', 0);
    CREATE TRIGGER undo_transactions_update AFTER UPDATE ON transactions BEGIN
      SELECT old.imported_id;
    END;
    INSERT INTO accounts (id, name, type, on_budget, created_at) VALUES
      ('giro', 'Giro', 'asset', 1, 0), ('main', 'Main', 'asset', 1, 0),
      ('food', 'Food', 'expense', 0, 0);
    INSERT INTO undo_log (group_id, stack, statement)
      VALUES (1, 'undo', 'UPDATE transactions SET imported_id = NULL');
    ${seed}
  `);
  const insert = client.prepare("INSERT INTO __migrations (name, applied_at) VALUES (?, 0)");
  for (const migration of migrations.slice(0, MOVED)) insert.run(migration.name);
  client.close();
};

const tx = (
  id: string,
  importedId: string | null,
  ...postings: Array<[string, number, number]>
) => `
  INSERT INTO transactions (id, date, imported_id, created_at) VALUES ('${id}', 20260101, ${importedId === null ? "NULL" : `'${importedId}'`}, 5);
  ${postings.map(([account, amount, cleared], index) => `INSERT INTO postings (id, transaction_id, account_id, amount, cleared, sort_order) VALUES ('${id}-${index}', '${id}', '${account}', ${amount}, ${cleared}, ${index});`).join("\n")}
`;

const importedIds = (client: DatabaseSync) =>
  Object.fromEntries(
    (
      client.prepare("SELECT id, imported_id FROM postings ORDER BY id").all() as Array<{
        id: string;
        imported_id: string | null;
      }>
    ).map((row) => [row.id, row.imported_id]),
  );

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "reeve-migration-"));
  file = join(folder, "book.sqlite");
});

afterEach(() => rmSync(folder, { recursive: true, force: true }));

describe("moving imported ids onto postings", () => {
  it("gives an id to the account's posting, not the category's", () => {
    oldBook(
      tx("a", "A", ["giro", -100, 1], ["food", 100, 0]) +
        tx("b", null, ["giro", -5, 1], ["food", 5, 0]),
    );
    const { client, close } = openDatabase(file);
    expect(importedIds(client)).toEqual({ "a-0": "A", "a-1": null, "b-0": null, "b-1": null });
    close();
  });

  it("gives a transfer's id to the leg the import cleared", () => {
    oldBook(tx("a", "A", ["giro", -100, 1], ["main", 100, 0]));
    const { client, close } = openDatabase(file);
    expect(importedIds(client)).toEqual({ "a-0": "A", "a-1": null });
    close();
  });

  it("gives a transfer's id to both legs when the marks cannot tell", () => {
    oldBook(tx("a", "A", ["giro", -100, 1], ["main", 100, 1]));
    const { client, close } = openDatabase(file);
    expect(importedIds(client)).toEqual({ "a-0": "A", "a-1": "A" });
    close();
  });

  it("keeps a repeated id on its first posting, so the new unique index can exist", () => {
    oldBook(
      tx("a", "A", ["giro", -100, 1], ["food", 100, 0]) +
        tx("b", "A", ["giro", -100, 1], ["food", 100, 0]),
    );
    const { client, close } = openDatabase(file);
    expect(importedIds(client)).toEqual({ "a-0": "A", "a-1": null, "b-0": null, "b-1": null });
    close();
  });

  it("counts every id as seen, with what it was", () => {
    oldBook(tx("a", "A", ["giro", -100, 1], ["food", 100, 0]));
    const { client, close } = openDatabase(file);
    expect(
      client
        .prepare("SELECT account_id, imported_id, date, amount, first_seen_at FROM seen_imports")
        .all(),
    ).toEqual([
      { account_id: "giro", imported_id: "A", date: 20260101, amount: -100, first_seen_at: 5 },
    ]);
    close();
  });

  it("drops the undo history that names the old column, and undo works from there", () => {
    oldBook(tx("a", "A", ["giro", -100, 1], ["food", 100, 0]));
    const { client, close } = openDatabase(file);
    expect(reverseLatest(client, "undo")).toBe(false);
    inTransaction(client, () =>
      client.prepare("UPDATE transactions SET notes = 'changed' WHERE id = 'a'").run(),
    );
    expect(reverseLatest(client, "undo")).toBe(true);
    expect(client.prepare("SELECT notes FROM transactions WHERE id = 'a'").get()).toEqual({
      notes: null,
    });
    close();
  });
});

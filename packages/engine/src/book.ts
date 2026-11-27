import {
  BookSettings,
  InvalidRequest,
  NotFound,
  type BookSettings as Settings,
} from "@reeve/contract";
import { eq } from "drizzle-orm";
import type { DatabaseSync } from "node:sqlite";
import { Schema } from "effect";
import type { Db } from "./db/open.ts";
import * as t from "./db/schema.ts";

/** An open book: its database and where it lives. Every domain function takes one. */
export interface Book {
  readonly id: string;
  readonly file: string;
  readonly db: Db;
  readonly client: DatabaseSync;
}

export const newId = (): string => crypto.randomUUID();

/** Domain code throws these; the operation runner turns them into the operation's failure. */
export const invalid = (message: string): never => {
  throw new InvalidRequest({ message });
};

export const notFound = (entity: string, id: string): never => {
  throw new NotFound({ entity, id });
};

export const DEFAULT_SETTINGS: Settings = {
  name: "My Budget",
  currency: "USD",
  budgetType: "envelope",
  numberFormat: "comma-dot",
  dateFormat: "MM/dd/yyyy",
  firstDayOfWeek: 0,
  hideFraction: false,
  categoryDepth: 3,
  autoApplyReceipts: false,
  bankAutoSync: false,
};

const decodeSettings = Schema.decodeUnknownSync(BookSettings);

export const readSettings = (db: Db): Settings => {
  const rows = db.select().from(t.settings).all();
  const stored = Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value) as unknown]));
  return decodeSettings({ ...DEFAULT_SETTINGS, ...stored });
};

export const writeSettings = (db: Db, change: Partial<Settings>) => {
  for (const [key, value] of Object.entries(change)) {
    if (value === undefined) continue;
    db.insert(t.settings)
      .values({ key, value: JSON.stringify(value) })
      .onConflictDoUpdate({ target: t.settings.key, set: { value: JSON.stringify(value) } })
      .run();
  }
};

export const notesOf = (db: Db): Map<string, string> =>
  new Map(
    db
      .select()
      .from(t.notes)
      .all()
      .map((row) => [row.id, row.note]),
  );

/** A note belongs to an account, a category, a category group or a budget month. */
export const refuseNoteOnNothing = (db: Db, id: string) => {
  if (/^budget-\d{4}-\d{2}$/.test(id)) return;
  const account = db.select().from(t.accounts).where(eq(t.accounts.id, id)).get();
  const group = db.select().from(t.categoryGroups).where(eq(t.categoryGroups.id, id)).get();
  if (account === undefined && group === undefined) notFound("account, category or group", id);
};

export const setNote = (db: Db, id: string, note: string | null) => {
  if (note === null || note.trim() === "") {
    db.delete(t.notes).where(eq(t.notes.id, id)).run();
    return null;
  }
  db.insert(t.notes)
    .values({ id, note })
    .onConflictDoUpdate({ target: t.notes.id, set: { note } })
    .run();
  return note;
};

/** The book's own equity or expense account for opening balances or uncategorized money. */
export const systemAccount = (db: Db, system: "opening" | "uncategorized"): string => {
  const found = db
    .select({ id: t.accounts.id })
    .from(t.accounts)
    .where(eq(t.accounts.system, system))
    .get();
  if (found !== undefined) return found.id;
  const id = newId();
  db.insert(t.accounts)
    .values({
      id,
      name: system === "opening" ? "Opening Balances" : "Uncategorized",
      type: system === "opening" ? "equity" : "expense",
      system,
      hidden: true,
      createdAt: Date.now(),
    })
    .run();
  return id;
};

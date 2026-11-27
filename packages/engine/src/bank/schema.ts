import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { accounts } from "../db/schema.ts";

/**
 * One consent at one bank (docs/rules/bank.md). Nothing here is a secret: every provider call needs the
 * key in `<home>/bank/`. Left out of undo and of restore: a restored copy must not sync as well.
 */
export const bankConnections = sqliteTable("bank_connections", {
  id: text("id").primaryKey(),
  provider: text("provider", { enum: ["enable_banking"] }).notNull(),
  aspspName: text("aspsp_name").notNull(),
  aspspCountry: text("aspsp_country").notNull(),
  status: text("status", { enum: ["pending", "active", "expired"] }).notNull(),
  /** The nonce a pending link's redirect must bring back. */
  state: text("state"),
  sessionId: text("session_id"),
  /** When the consent ends, in milliseconds. */
  validUntil: integer("valid_until"),
  /** The accounts the consent covers, as JSON of `BankAccountOffer`. */
  accounts: text("accounts").notNull().default("[]"),
  createdAt: integer("created_at").notNull(),
});

/** A ledger account fed by a bank account. */
export const bankLinks = sqliteTable(
  "bank_links",
  {
    accountId: text("account_id")
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => bankConnections.id),
    /** The provider's account id, which changes with each consent. */
    providerAccountId: text("provider_account_id").notNull(),
    /** Stays the same across consents, so a new consent finds the links of the old one. */
    identificationHash: text("identification_hash"),
    currency: text("currency"),
    /** Rows booked before this day stay out. */
    historyStart: integer("history_start").notNull(),
    fetchDay: integer("fetch_day"),
    fetchCount: integer("fetch_count").notNull().default(0),
    /** A fetch that began and has not reported back, so a second process does not start one. */
    syncStartedAt: integer("sync_started_at"),
    /** The bank refused for now; no fetch before this time, in milliseconds. */
    retryAfter: integer("retry_after"),
    status: text("status", {
      enum: ["new", "ok", "reauth_required", "rate_limited", "attention", "failed"],
    })
      .notNull()
      .default("new"),
    statusMessage: text("status_message"),
    lastSyncedAt: integer("last_synced_at"),
    bankBalance: integer("bank_balance"),
    bankBalanceType: text("bank_balance_type"),
    bankBalanceAt: integer("bank_balance_at"),
  },
  (table) => [index("bank_links_connection").on(table.connectionId)],
);

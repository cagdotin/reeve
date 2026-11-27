import type {
  BankAccountOffer,
  BankConnection,
  BankLink,
  BankStatus,
} from "@reeve/contract/catalog";
import { intToDay } from "@reeve/contract/rules";
import { and, eq, sql } from "drizzle-orm";
import { notFound, type Book } from "../book.ts";
import * as t from "../db/schema.ts";
import { homeOfBook } from "../home.ts";
import { readCredentials } from "./credentials.ts";
import { isBookedBalance } from "./rows.ts";
import { bankConnections, bankLinks } from "./schema.ts";

export type ConnectionRow = typeof bankConnections.$inferSelect;
export type LinkRow = typeof bankLinks.$inferSelect;

const iso = (time: number | null) => (time === null ? null : new Date(time).toISOString());

export const offersOf = (row: ConnectionRow): ReadonlyArray<BankAccountOffer> =>
  JSON.parse(row.accounts) as ReadonlyArray<BankAccountOffer>;

const connectionValue = (row: ConnectionRow): BankConnection => ({
  id: row.id,
  bank: row.aspspName,
  country: row.aspspCountry,
  status: row.status,
  validUntil: iso(row.validUntil),
  accounts: offersOf(row),
});

export const connectionRow = (book: Book, id: string): ConnectionRow =>
  book.db.select().from(bankConnections).where(eq(bankConnections.id, id)).get() ??
  notFound("bank connection", id);

export const linkRow = (book: Book, account: string): LinkRow =>
  book.db.select().from(bankLinks).where(eq(bankLinks.accountId, account)).get() ??
  notFound("bank link for account", account);

const clearedBalance = (book: Book, account: string): number =>
  book.db
    .select({ total: sql<number>`coalesce(sum(${t.postings.amount}), 0)` })
    .from(t.postings)
    .where(and(eq(t.postings.accountId, account), eq(t.postings.cleared, true)))
    .get()?.total ?? 0;

export const fetchesToday = (link: LinkRow, day: number) =>
  link.fetchDay === day ? link.fetchCount : 0;

export const todayNumber = (now: Date = new Date()) =>
  Number(now.toISOString().slice(0, 10).replaceAll("-", ""));

export const linkValue = (book: Book, link: LinkRow): BankLink => {
  const connection = connectionRow(book, link.connectionId);
  const account =
    book.db.select().from(t.accounts).where(eq(t.accounts.id, link.accountId)).get() ??
    notFound("account", link.accountId);
  return {
    account: link.accountId,
    accountName: account.name,
    connection: link.connectionId,
    bank: connection.aspspName,
    providerAccount: link.providerAccountId,
    historyStart: intToDay(link.historyStart),
    status: link.status,
    statusMessage: link.statusMessage,
    lastSyncedAt: iso(link.lastSyncedAt),
    retryAfter: iso(link.retryAfter),
    fetchesToday: fetchesToday(link, todayNumber()),
    bankBalance: link.bankBalance,
    bankBalanceType: link.bankBalanceType,
    bankBalanceBooked: isBookedBalance(link.bankBalanceType),
    cleared: clearedBalance(book, link.accountId),
  };
};

/** A consent past its end counts as expired whether or not a fetch has found out yet. */
const settled = (row: ConnectionRow, now: number): ConnectionRow =>
  row.status === "active" && row.validUntil !== null && row.validUntil <= now
    ? { ...row, status: "expired" }
    : row;

export const bankStatus = (book: Book): BankStatus => {
  const credentials = readCredentials(homeOfBook(book.file));
  const now = Date.now();
  return {
    configured: credentials !== null,
    applicationId: credentials?.applicationId ?? null,
    redirectUrl: credentials?.redirectUrl ?? null,
    connections: book.db
      .select()
      .from(bankConnections)
      .all()
      .map((row) => connectionValue(settled(row, now))),
    links: book.db
      .select()
      .from(bankLinks)
      .all()
      .map((link) => linkValue(book, link)),
  };
};

export const connectionResult = connectionValue;

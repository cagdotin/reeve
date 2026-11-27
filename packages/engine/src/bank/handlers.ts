import { BankError, InvalidRequest } from "@reeve/contract";
import type { bank } from "@reeve/contract/catalog";
import { addDays, dayToInt, intToDay, today } from "@reeve/contract/rules";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { invalid, newId, type Book } from "../book.ts";
import * as t from "../db/schema.ts";
import type { DomainHandlers } from "../handler.ts";
import { homeOfBook } from "../home.ts";
import { createAccount } from "../ledger/accounts.ts";
import { failure, runInBook, runQuietly } from "../run-in-book.ts";
import { bankClient } from "./client.ts";
import {
  checkKey,
  readCredentials,
  removeCredentials,
  saveCredentials,
  type BankCredentials,
} from "./credentials.ts";
import {
  bankStatus,
  connectionResult,
  connectionRow,
  linkRow,
  linkValue,
  offersOf,
  type ConnectionRow,
} from "./links.ts";
import { bankConnections, bankLinks } from "./schema.ts";
import {
  acceptAccountSuggestion,
  dismissAccountSuggestion,
  suggestAccountRules,
} from "./suggestions.ts";
import { restoreLines, syncAccounts } from "./sync.ts";

const NO_KEY = new BankError({
  message: "No Enable Banking key is set up on this computer: run set_bank_credentials first",
  code: null,
});

const credentialsOf = (home: string): Effect.Effect<BankCredentials, BankError> => {
  const credentials = readCredentials(home);
  return credentials === null ? Effect.fail(NO_KEY) : Effect.succeed(credentials);
};

const FALLBACK_CONSENT_DAYS = 90;
const DAY_MS = 86_400_000;
/** What the provider needs in a day a consent runs up to; a bank's maximum is not to be exceeded. */
const CONSENT_MARGIN_MS = 60_000;

/** The redirect address's code and state; a bare code when it is no address. */
const parseRedirect = (text: string): { code: string | null; state: string | null } => {
  const trimmed = text.trim();
  try {
    const url = new URL(trimmed);
    const error = url.searchParams.get("error");
    if (error !== null) {
      const description = url.searchParams.get("error_description");
      throw new InvalidRequest({
        message: `The bank did not give consent: ${description ?? error}`,
      });
    }
    return { code: url.searchParams.get("code"), state: url.searchParams.get("state") };
  } catch (error) {
    if (error instanceof InvalidRequest) throw error;
    return { code: trimmed === "" ? null : trimmed, state: null };
  }
};

const pendingConnection = (book: Book, state: string | null): ConnectionRow => {
  const rows = book.db
    .select()
    .from(bankConnections)
    .where(eq(bankConnections.status, "pending"))
    .orderBy(desc(bankConnections.createdAt))
    .all();
  const found = state === null ? rows[0] : rows.find((row) => row.state === state);
  return found ?? invalid("No bank consent is waiting for this address: start one again");
};

/** A new consent gives new account ids; the hash finds the links of the old one. */
const carryLinks = (book: Book, connection: ConnectionRow, offers: ReturnType<typeof offersOf>) => {
  for (const link of book.db.select().from(bankLinks).all()) {
    const offer = offers.find(
      (each) =>
        link.identificationHash !== null && each.identificationHash === link.identificationHash,
    );
    if (offer === undefined) continue;
    book.db
      .update(bankLinks)
      .set({
        connectionId: connection.id,
        providerAccountId: offer.id,
        status: "ok",
        statusMessage: null,
        retryAfter: null,
      })
      .where(eq(bankLinks.accountId, link.accountId))
      .run();
  }
  const inUse = new Set(
    book.db
      .select({ id: bankLinks.connectionId })
      .from(bankLinks)
      .all()
      .map((row) => row.id),
  );
  for (const other of book.db.select().from(bankConnections).all())
    if (
      other.id !== connection.id &&
      !inUse.has(other.id) &&
      other.aspspName === connection.aspspName &&
      other.aspspCountry === connection.aspspCountry
    )
      book.db.delete(bankConnections).where(eq(bankConnections.id, other.id)).run();
};

/**
 * The day after the account's latest transaction up to today, so rows from files are not taken
 * twice; one dated ahead, as a scheduled bill, says nothing about what the bank has given.
 */
const defaultHistoryStart = (book: Book, account: string | null): number => {
  const latest =
    account === null
      ? undefined
      : book.db
          .select({ date: t.transactions.date })
          .from(t.postings)
          .innerJoin(t.transactions, eq(t.transactions.id, t.postings.transactionId))
          .where(
            and(eq(t.postings.accountId, account), lte(t.transactions.date, dayToInt(today()))),
          )
          .orderBy(desc(t.transactions.date))
          .limit(1)
          .get();
  return dayToInt(latest === undefined ? addDays(today(), -89) : addDays(intToDay(latest.date), 1));
};

const dismissed = (book: Book, account: string) =>
  book.db
    .select({
      importedId: t.seenImports.importedId,
      date: t.seenImports.date,
      amount: t.seenImports.amount,
      payee: t.seenImports.payee,
    })
    .from(t.seenImports)
    .where(
      and(
        eq(t.seenImports.accountId, account),
        sql`NOT EXISTS (SELECT 1 FROM ${t.postings} WHERE ${t.postings.accountId} = ${t.seenImports.accountId} AND ${t.postings.importedId} = ${t.seenImports.importedId})`,
      ),
    )
    .orderBy(desc(t.seenImports.date))
    .all()
    .map((row) => ({ ...row, date: intToDay(row.date) }));

const asFailure = <A>(run: () => A) => Effect.try({ try: run, catch: failure });

export const bankHandlers = {
  set_bank_credentials: (books, input) =>
    Effect.gen(function* () {
      const applicationId = input.applicationId.trim();
      const redirectUrl = input.redirectUrl.trim();
      const key = yield* asFailure(() => {
        if (redirectUrl === "" || !redirectUrl.startsWith("https://"))
          invalid("The redirect address must start with https://, as the provider requires");
        if (applicationId === "") invalid("Give the application id");
        if ((input.keyPath === undefined) === (input.key === undefined))
          invalid("Give keyPath or key");
        const text = input.key ?? readFileSync(input.keyPath!, "utf8");
        checkKey(text);
        return text;
      });
      const credentials = { applicationId, redirectUrl, key };
      yield* bankClient(credentials).check;
      yield* asFailure(() => saveCredentials(books.home, credentials));
      return { applicationId, redirectUrl };
    }),

  remove_bank_credentials: (books) => asFailure(() => ({ removed: removeCredentials(books.home) })),

  list_banks: (books, input) =>
    Effect.flatMap(credentialsOf(books.home), (credentials) =>
      bankClient(credentials).banks(input.country),
    ),

  bank_status: (book) => bankStatus(book),

  begin_bank_link: (book, input, books) =>
    Effect.gen(function* () {
      const credentials = yield* credentialsOf(homeOfBook(book.file));
      const client = bankClient(credentials);
      const country = input.country.toUpperCase();
      const known = yield* client.banks(country);
      const bank = known.find((each) => each.name === input.bank);
      if (bank === undefined)
        return yield* Effect.fail(
          new InvalidRequest({
            message: `The provider has no bank named ${input.bank} in ${country}: list_banks names them`,
          }),
        );
      const days = bank.maximumConsentDays ?? FALLBACK_CONSENT_DAYS;
      const state = newId();
      const { url } = yield* client.begin({
        bank: bank.name,
        country,
        state,
        validUntil: new Date(Date.now() + days * DAY_MS - CONSENT_MARGIN_MS),
      });
      const connection = newId();
      yield* runQuietly(books, book, () => {
        book.db.delete(bankConnections).where(eq(bankConnections.status, "pending")).run();
        book.db
          .insert(bankConnections)
          .values({
            id: connection,
            provider: "enable_banking",
            aspspName: bank.name,
            aspspCountry: country,
            status: "pending",
            state,
            createdAt: Date.now(),
          })
          .run();
      });
      return { connection, url };
    }),

  complete_bank_link: (book, input, books) =>
    Effect.gen(function* () {
      const credentials = yield* credentialsOf(homeOfBook(book.file));
      const { code, connection } = yield* runInBook(books, book, true, () => {
        const redirect = parseRedirect(input.redirectUrl);
        if (redirect.code === null) invalid("That address has no code from the bank");
        return { code: redirect.code!, connection: pendingConnection(book, redirect.state) };
      });
      const session = yield* bankClient(credentials).openSession(code);
      if (session.accounts.length === 0)
        return yield* Effect.fail(
          new BankError({
            message:
              "The consent covers no accounts. A restricted application only reaches accounts linked in the Enable Banking control panel, so link them there first.",
            code: null,
          }),
        );
      return yield* runQuietly(books, book, () => {
        const accounts = JSON.stringify(session.accounts);
        book.db
          .update(bankConnections)
          .set({
            status: "active",
            state: null,
            sessionId: session.sessionId,
            validUntil: session.validUntil,
            accounts,
          })
          .where(eq(bankConnections.id, connection.id))
          .run();
        const row = connectionRow(book, connection.id);
        carryLinks(book, row, session.accounts);
        return connectionResult(row);
      });
    }),

  remove_bank_connection: (book, input, books) =>
    Effect.gen(function* () {
      const row = yield* runInBook(books, book, true, () => connectionRow(book, input.id));
      const credentials = readCredentials(homeOfBook(book.file));
      if (credentials !== null && row.sessionId !== null)
        // The consent ends here either way; a session the provider has dropped is no failure.
        yield* Effect.ignore(bankClient(credentials).closeSession(row.sessionId));
      yield* runQuietly(books, book, () => {
        book.db.delete(bankLinks).where(eq(bankLinks.connectionId, input.id)).run();
        book.db.delete(bankConnections).where(eq(bankConnections.id, input.id)).run();
      });
      return { removed: true };
    }),

  link_bank_account: (book, input) => {
    const connection = connectionRow(book, input.connection);
    const offer = offersOf(connection).find((each) => each.id === input.providerAccount);
    if (offer === undefined) return invalid("That consent does not cover that account");
    if ((input.account === undefined) === (input.name === undefined))
      return invalid("Give account to link or name to create one");
    const feeding = book.db
      .select()
      .from(bankLinks)
      .where(eq(bankLinks.providerAccountId, offer.id))
      .all()
      .find((link) => link.accountId !== input.account);
    if (feeding !== undefined)
      return invalid("That bank account already feeds another account: unlink it first");
    const account =
      input.account ??
      createAccount(book, {
        name: input.name!,
        ...(input.onBudget === undefined ? {} : { onBudget: input.onBudget }),
      }).id;
    const row = book.db.select().from(t.accounts).where(eq(t.accounts.id, account)).get();
    if (row === undefined || (row.type !== "asset" && row.type !== "liability"))
      return invalid("Only an asset or liability account can be linked");
    const historyStart =
      input.historyStart === undefined
        ? defaultHistoryStart(book, account)
        : dayToInt(input.historyStart);
    book.db
      .insert(bankLinks)
      .values({
        accountId: account,
        connectionId: connection.id,
        providerAccountId: offer.id,
        identificationHash: offer.identificationHash,
        currency: offer.currency,
        historyStart,
      })
      .onConflictDoUpdate({
        target: bankLinks.accountId,
        set: {
          connectionId: connection.id,
          providerAccountId: offer.id,
          identificationHash: offer.identificationHash,
          currency: offer.currency,
          historyStart,
          status: "new",
          statusMessage: null,
          lastSyncedAt: null,
        },
      })
      .run();
    return linkValue(book, linkRow(book, account));
  },

  unlink_bank_account: (book, input) => {
    linkRow(book, input.account);
    book.db.delete(bankLinks).where(eq(bankLinks.accountId, input.account)).run();
    return { removed: true };
  },

  sync_bank_accounts: (book, input, books) => syncAccounts(book, books, input),

  list_dismissed_imports: (book, input) => dismissed(book, input.account),

  suggest_account_rules: (book) => ({ suggestions: suggestAccountRules(book) }),
  accept_account_suggestion: (book, input) => acceptAccountSuggestion(book, input.accountNumber),
  dismiss_account_suggestion: (book, input) => dismissAccountSuggestion(book, input.accountNumber),

  restore_dismissed_imports: (book, input) => {
    if (input.importedIds.length === 0) return { restored: 0 };
    const gone = dismissed(book, input.account).map((row) => row.importedId);
    const restorable = input.importedIds.filter((id) => gone.includes(id));
    if (restorable.length > 0) restoreLines(book, input.account, restorable);
    return { restored: restorable.length };
  },
} satisfies DomainHandlers<typeof bank>;

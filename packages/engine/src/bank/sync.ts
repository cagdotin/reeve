/**
 * One fetch of a linked account: claim it, reach the bank with no transaction open, then apply
 * what came in one write. A crash anywhere leaves nothing to clean up, because the next fetch asks
 * for the same window and matching on ids finds what is already there.
 */
import type { BankError } from "@reeve/contract";
import type { BankLinkStatus, BankSyncResult } from "@reeve/contract/catalog";
import { addDays, dayToInt, intToDay, today } from "@reeve/contract/rules";
import { and, eq, inArray, isNull, notInArray, sum } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { systemAccount, type Book } from "../book.ts";
import type { Books } from "../books.ts";
import * as t from "../db/schema.ts";
import { homeOfBook } from "../home.ts";
import { importRows, type RowToImport } from "../imports/reconcile.ts";
import type { ImportResult } from "../imports/types.ts";
import { insertTransaction } from "../ledger/transactions.ts";
import { runInBook, runQuietly, type DomainError } from "../run-in-book.ts";
import {
  bankClient,
  ProviderTransaction,
  type FetchedLine,
  type ProviderBalance,
} from "./client.ts";
import { readCredentials } from "./credentials.ts";
import type { BankOfLine } from "../imports/payee-text.ts";
import { connectionRow, fetchesToday, linkRow, todayNumber, type LinkRow } from "./links.ts";
import {
  counterpartyAccount,
  isBookedBalance,
  lineDay,
  lineIds,
  mapLine,
  pickBalance,
  type LineContext,
} from "./rows.ts";
import { bankConnections, bankLinks } from "./schema.ts";

/** What banks allow when no person is present (RTS Art. 36). */
export const FETCHES_PER_DAY = 4;
/** Banks give about 90 days once the first hour after a consent has passed. */
const WINDOW_DAYS = 89;
/**
 * What Enable Banking advises after `ASPSP_RATE_LIMIT_EXCEEDED`; the scheduler rests this long after
 * any failure too, or an outage would use up the day's fetches. A person may fetch sooner.
 */
const RETRY_WAIT_MS = 6 * 60 * 60 * 1000;
/** A claim older than this was left by a crash. */
const CLAIM_MS = 2 * 60 * 1000;

const REAUTH_CODES = new Set([
  "EXPIRED_SESSION",
  "CLOSED_SESSION",
  "REVOKED_SESSION",
  "SESSION_DOES_NOT_EXIST",
  "WRONG_SESSION_STATUS",
  "401",
]);

const statusOfError = (error: BankError): BankLinkStatus =>
  error.code === "ASPSP_RATE_LIMIT_EXCEEDED" || error.code === "429"
    ? "rate_limited"
    : error.code !== null && REAUTH_CODES.has(error.code)
      ? "reauth_required"
      : "failed";

const untouched = (
  link: Pick<LinkRow, "accountId" | "bankBalance">,
  status: BankLinkStatus,
  message: string | null,
): BankSyncResult => ({
  account: link.accountId,
  status,
  message,
  added: 0,
  updated: 0,
  unchanged: 0,
  dismissed: 0,
  conflicts: 0,
  bankBalance: link.bankBalance,
});

const setLink = (book: Book, account: string, change: Partial<LinkRow>) =>
  book.db.update(bankLinks).set(change).where(eq(bankLinks.accountId, account)).run();

type Claim =
  | { readonly kind: "refused"; readonly result: BankSyncResult }
  | {
      readonly kind: "go";
      readonly link: LinkRow;
      readonly bank: BankOfLine;
      readonly first: boolean;
    };

const refuse = (book: Book, link: LinkRow, status: BankLinkStatus, message: string): Claim => {
  setLink(book, link.accountId, { status, statusMessage: message });
  return { kind: "refused", result: untouched(link, status, message) };
};

/** Decides whether this fetch may run, and counts it, so no restart or agent exceeds the budget. */
const claim = (book: Book, account: string, force: boolean, now: number): Claim => {
  const link = linkRow(book, account);
  const connection = connectionRow(book, link.connectionId);
  if (
    connection.status !== "active" ||
    (connection.validUntil !== null && connection.validUntil <= now)
  ) {
    book.db
      .update(bankConnections)
      .set({ status: "expired" })
      .where(eq(bankConnections.id, connection.id))
      .run();
    return refuse(book, link, "reauth_required", `The consent at ${connection.aspspName} ended`);
  }
  if (link.syncStartedAt !== null && now - link.syncStartedAt < CLAIM_MS)
    return { kind: "refused", result: untouched(link, link.status, "A fetch is already running") };
  if (!force && link.status === "rate_limited" && link.retryAfter !== null && link.retryAfter > now)
    return {
      kind: "refused",
      result: untouched(
        link,
        "rate_limited",
        `The bank asked to wait until ${new Date(link.retryAfter).toISOString()}`,
      ),
    };
  const day = todayNumber(new Date(now));
  const used = fetchesToday(link, day);
  if (!force && used >= FETCHES_PER_DAY)
    return {
      kind: "refused",
      result: untouched(
        link,
        "rate_limited",
        `${used} fetches today already, the most banks allow`,
      ),
    };
  setLink(book, account, { syncStartedAt: now, fetchDay: day, fetchCount: used + 1 });
  return {
    kind: "go",
    link,
    bank: { name: connection.aspspName, country: connection.aspspCountry },
    first: link.lastSyncedAt === null,
  };
};

const noPosting = (book: Book, account: string) =>
  book.db
    .select({ id: t.postings.id })
    .from(t.postings)
    .where(eq(t.postings.accountId, account))
    .limit(1)
    .get() === undefined;

const countOf = (rows: ReadonlyArray<{ readonly status: string }>, status: string) =>
  rows.filter((row) => row.status === status).length;

type BankRow = RowToImport & { readonly importedId: string; readonly kept: t.KeptLine };

/** Whatever the lines hold, one account's fetch has this to apply. */
const planLines = (
  lines: ReadonlyArray<FetchedLine>,
  context: LineContext & { readonly start: number },
) => {
  const readable = lines.flatMap(({ decoded, raw }) => {
    const mapped = mapLine(decoded, context);
    return mapped.kind === "row" ? [{ decoded, raw, row: mapped.row }] : [];
  });
  // A line that cannot be imported takes no number, or the rest would renumber once it is gone.
  const ids = lineIds(readable.map(({ decoded }) => decoded));
  const rows: Array<BankRow> = readable
    .map(({ row, raw }, index) => ({
      ...row,
      importedId: ids[index]!,
      counterpartyAccount: counterpartyAccount(raw),
      kept: {
        source: "bank" as const,
        bank: { name: context.bank.name, country: context.bank.country },
        currency: context.currency,
        line: raw,
      },
    }))
    // A bank can send rows from before the day asked for.
    .filter((row) => lineDay(row) >= context.start)
    .map((row, index) => ({ ...row, index }));
  return { rows, refused: lines.length - readable.length };
};

/**
 * Writes each line beside its id once, so a line taken before lines were kept gets its own now.
 * A conflict's id already names another line, which stays.
 */
const keepLines = (
  book: Book,
  account: string,
  rows: ReadonlyArray<BankRow>,
  result: ImportResult,
) => {
  for (const outcome of result.rows) {
    if (outcome.status === "conflict") continue;
    const row = rows[outcome.index]!;
    book.db
      .update(t.seenImports)
      .set({ line: row.kept })
      .where(
        and(
          eq(t.seenImports.accountId, account),
          eq(t.seenImports.importedId, row.importedId),
          isNull(t.seenImports.line),
        ),
      )
      .run();
  }
};

/**
 * Brings dismissed lines back into the account from the lines kept beside them. One kept without
 * its line is let back for the next fetch instead.
 */
export const restoreLines = (book: Book, account: string, importedIds: ReadonlyArray<string>) => {
  const seen = and(
    eq(t.seenImports.accountId, account),
    inArray(t.seenImports.importedId, importedIds),
  );
  const rows = book.db
    .select({ importedId: t.seenImports.importedId, kept: t.seenImports.line })
    .from(t.seenImports)
    .where(seen)
    .all()
    .flatMap(({ importedId, kept }) => {
      if (kept === null) return [];
      const decoded = Schema.decodeUnknownOption(ProviderTransaction)(kept.line);
      if (decoded._tag === "None") return [];
      const mapped = mapLine(decoded.value, { bank: kept.bank, currency: kept.currency });
      return mapped.kind === "row"
        ? [{ ...mapped.row, importedId, counterpartyAccount: counterpartyAccount(kept.line) }]
        : [];
    })
    .map((row, index) => ({ ...row, index }));
  book.db
    .delete(t.seenImports)
    .where(
      and(
        seen,
        notInArray(
          t.seenImports.importedId,
          rows.map((row) => row.importedId),
        ),
      ),
    )
    .run();
  // A linked import leaves out a line it has seen, and these are seen.
  importRows(book, account, rows, { reconcile: true, titleCase: true, dryRun: false });
};

const syncOne = (
  book: Book,
  books: Books["Service"],
  account: string,
  force: boolean,
): Effect.Effect<BankSyncResult, DomainError> =>
  Effect.gen(function* () {
    const now = Date.now();
    const claimed = yield* runQuietly(books, book, () => claim(book, account, force, now));
    if (claimed.kind === "refused") return claimed.result;
    const { link, bank, first } = claimed;

    const credentials = readCredentials(homeOfBook(book.file));
    if (credentials === null) {
      const message = "No Enable Banking key is set up on this computer";
      yield* runQuietly(books, book, () =>
        setLink(book, account, {
          syncStartedAt: null,
          status: "failed",
          statusMessage: message,
          retryAfter: Date.now() + RETRY_WAIT_MS,
        }),
      );
      return untouched(link, "failed", message);
    }
    const client = bankClient(credentials);
    const latest = today();
    const window = dayToInt(addDays(latest, -WINDOW_DAYS));
    const from = first ? link.historyStart : Math.max(link.historyStart, window);

    const fetched = yield* Effect.result(
      Effect.all({
        lines: client.transactions({
          account: link.providerAccountId,
          from: intToDay(from),
          to: latest,
          longest: first,
        }),
        // A bank without balances still has transactions to give.
        balances: client
          .balances(link.providerAccountId)
          .pipe(Effect.orElseSucceed((): ReadonlyArray<ProviderBalance> => [])),
      }),
    );
    if (fetched._tag === "Failure") {
      const error = fetched.failure;
      const status = statusOfError(error);
      yield* runQuietly(books, book, () => {
        setLink(book, account, {
          syncStartedAt: null,
          status,
          statusMessage: error.message,
          retryAfter: Date.now() + RETRY_WAIT_MS,
        });
        if (status === "reauth_required")
          book.db
            .update(bankConnections)
            .set({ status: "expired" })
            .where(eq(bankConnections.id, link.connectionId))
            .run();
      });
      return untouched(link, status, error.message);
    }

    const applying = Effect.gen(function* () {
      const { lines, balances } = fetched.success;
      const { rows, refused } = planLines(lines, {
        bank,
        currency: link.currency,
        start: link.historyStart,
      });
      const balance = pickBalance(balances, link.currency);
      const options = { reconcile: true, titleCase: true, linked: true };
      const preview = yield* runInBook(books, book, true, () =>
        importRows(book, account, rows, { ...options, dryRun: true }),
      );
      const previewOf = (status: string) => countOf(preview.rows, status);
      const startingFrom =
        first && balance !== null && isBookedBalance(balance.type) ? balance : null;
      const writes = previewOf("new") + previewOf("update") > 0 || startingFrom !== null;

      const finish = (result: { readonly rows: ReadonlyArray<{ readonly status: string }> }) => {
        const conflicts = countOf(result.rows, "conflict") + refused;
        const status: BankLinkStatus = conflicts > 0 ? "attention" : "ok";
        const message =
          conflicts > 0
            ? `${conflicts} line${conflicts === 1 ? "" : "s"} from the bank could not be taken: an id came back with another amount, or the line was unreadable or in another currency`
            : null;
        setLink(book, account, {
          syncStartedAt: null,
          retryAfter: null,
          status,
          statusMessage: message,
          lastSyncedAt: Date.now(),
          ...(balance === null
            ? {}
            : {
                bankBalance: balance.amount,
                bankBalanceType: balance.type,
                bankBalanceAt: Date.now(),
              }),
        });
        return { status, message, conflicts };
      };

      const applied = yield* writes
        ? runInBook(books, book, false, () => {
            const empty = noPosting(book, account);
            const result = importRows(book, account, rows, { ...options, dryRun: false });
            keepLines(book, account, rows, result);
            if (empty && startingFrom !== null)
              addStartingBalance(book, account, rows, startingFrom.amount);
            return { result, ...finish(result) };
          })
        : runQuietly(books, book, () => {
            keepLines(book, account, rows, preview);
            return { result: preview, ...finish(preview) };
          });

      const { result, status, message, conflicts } = applied;
      return {
        account,
        status,
        message,
        added: countOf(result.rows, "new"),
        updated: countOf(result.rows, "update"),
        unchanged: countOf(result.rows, "duplicate"),
        dismissed: countOf(result.rows, "dismissed"),
        conflicts,
        bankBalance: balance?.amount ?? link.bankBalance,
      };
    });
    const outcome = yield* Effect.result(applying);
    if (outcome._tag === "Success") return outcome.success;
    const message = `The lines could not be saved: ${outcome.failure.message}`;
    yield* runQuietly(books, book, () =>
      setLink(book, account, {
        syncStartedAt: null,
        status: "failed",
        statusMessage: message,
        retryAfter: Date.now() + RETRY_WAIT_MS,
      }),
    );
    return untouched(link, "failed", message);
  });

/** What the account held before what landed, so its balance comes out as the bank's. */
const addStartingBalance = (
  book: Book,
  account: string,
  rows: ReadonlyArray<RowToImport>,
  bankBalance: number,
) => {
  const held = book.db
    .select({ total: sum(t.postings.amount) })
    .from(t.postings)
    .where(eq(t.postings.accountId, account))
    .get();
  const amount = bankBalance - Number(held?.total ?? 0);
  if (amount === 0) return;
  const oldest = rows.reduce((day, row) => (row.date < day ? row.date : day), today());
  insertTransaction(book.db, {
    date: addDays(oldest, -1),
    payee: "Starting Balance",
    notes: null,
    postings: [
      { account, amount, cleared: true },
      { account: systemAccount(book.db, "opening"), amount: -amount, cleared: true },
    ],
  });
};

export const syncAccounts = (
  book: Book,
  books: Books["Service"],
  input: { readonly account?: string; readonly force?: boolean },
) =>
  Effect.gen(function* () {
    const accounts =
      input.account === undefined
        ? yield* runInBook(books, book, true, () =>
            book.db
              .select({ id: bankLinks.accountId })
              .from(bankLinks)
              .all()
              .map((row) => row.id),
          )
        : [input.account];
    return yield* Effect.forEach(accounts, (account) =>
      syncOne(book, books, account, input.force ?? false),
    );
  });

/**
 * Importing transactions into an account with Actual's reconciliation (`reconcileTransactions` in
 * `accounts/sync.ts`): a row matches an existing transaction by its imported id, else by amount
 * within 7 days, the same payee first; a match is updated instead of duplicated. A bank's id lives
 * on the posting, so each leg of a transfer keeps its own (docs/rules/bank.md).
 */
import type { ImportResult, ImportStatus } from "./types.ts";
import { addDays, dayToInt } from "@reeve/contract/rules";
import { and, eq, sql } from "drizzle-orm";
import { invalid, notFound, type Book } from "../book.ts";
import type { Db } from "../db/open.ts";
import * as t from "../db/schema.ts";
import { payeeIdFor } from "../ledger/payees.ts";
import {
  addEntry,
  draftFrom,
  mergeTransactions,
  updateTransaction,
  type EntryDraft,
} from "../ledger/transactions.ts";
import { runRules, type EntryContext } from "../rules/run.ts";
import { titleCase } from "./title.ts";

export interface RowToImport {
  readonly index: number;
  readonly date: string;
  readonly amount: number;
  readonly payee?: string | null;
  readonly importedPayee?: string | null;
  readonly notes?: string | null;
  readonly category?: string | null;
  readonly importedId?: string | null;
  /** The other party's account number, from a bank line. */
  readonly counterpartyAccount?: string | null;
  readonly cleared?: boolean;
  readonly skip?: boolean;
  readonly forceAdd?: boolean;
}

export interface ImportOptions {
  /** Match existing transactions (Actual's reconcile); off, every row is added. */
  readonly reconcile: boolean;
  readonly dryRun: boolean;
  /** Title-case payee names, as Actual does when it reconciles. */
  readonly titleCase: boolean;
  /** Only fuzzy-match a transaction without an imported id when the row has one. */
  readonly strictIdChecking?: boolean;
  /**
   * A linked account's fetch: a line deleted or undone stays out, and an id that comes back with
   * another amount is the bank's doing and changes nothing.
   */
  readonly linked?: boolean;
}

/** An existing transaction in the account a row may match. */
interface Candidate {
  readonly id: string;
  readonly postingId: string;
  readonly amount: number;
  readonly date: number;
  readonly importedId: string | null;
  readonly importedPayee: string | null;
  readonly payeeId: string | null;
  readonly notes: string | null;
  readonly cleared: boolean;
  readonly reconciled: boolean;
}

const FUZZY_DAYS = 7;

const candidateColumns = {
  id: t.transactions.id,
  postingId: t.postings.id,
  amount: t.postings.amount,
  date: t.transactions.date,
  importedId: t.postings.importedId,
  importedPayee: t.transactions.importedPayee,
  payeeId: t.transactions.payeeId,
  notes: t.transactions.notes,
  cleared: t.postings.cleared,
  reconciled: t.postings.reconciled,
};

const inAccount = (db: Db, account: string) =>
  db
    .select(candidateColumns)
    .from(t.transactions)
    .innerJoin(
      t.postings,
      and(eq(t.postings.transactionId, t.transactions.id), eq(t.postings.accountId, account)),
    );

const toUtcDay = (day: number) =>
  Date.UTC(Math.floor(day / 10000), (Math.floor(day / 100) % 100) - 1, day % 100);

const daysApart = (date: string, candidate: { readonly date: number }) =>
  Math.abs(toUtcDay(dayToInt(date)) - toUtcDay(candidate.date));

/**
 * Orders fuzzy-match candidates by distance from the row's day, nearest first; on a tie, one
 * without an imported id of its own first, so a match does not take over another import's link.
 */
export const compareFuzzyMatchCandidates = (
  date: string,
  a: { readonly date: number; readonly importedId: string | null },
  b: { readonly date: number; readonly importedId: string | null },
): number => {
  return (
    daysApart(date, a) - daysApart(date, b) ||
    Number(a.importedId !== null) - Number(b.importedId !== null)
  );
};

const existingPayeeId = (db: Db, name: string | null): string | null => {
  const trimmed = name?.trim() ?? "";
  if (trimmed === "") return null;
  return (
    db
      .select({ id: t.payees.id })
      .from(t.payees)
      .where(sql`lower(${t.payees.name}) = lower(${trimmed})`)
      .get()?.id ?? null
  );
};

const normalizedPayee = (name: string | null | undefined, title: boolean): string | null => {
  const trimmed = name?.trim() ?? "";
  if (trimmed === "") return null;
  return title ? titleCase(trimmed) : trimmed;
};

const draftOf = (account: string, row: RowToImport, title: boolean): EntryDraft => {
  const payee = normalizedPayee(row.payee, title);
  const importedPayee = (row.importedPayee || payee)?.trim() || null;
  return {
    date: row.date,
    account,
    amount: row.amount,
    payee,
    category: row.category ?? null,
    transferAccount: null,
    splits: null,
    notes: row.notes || null,
    cleared: row.cleared ?? true,
    importedPayee,
    importedId: row.importedId || null,
    scheduleId: null,
  };
};

const lineContext = (row: RowToImport): EntryContext => ({
  counterpartyAccount: row.counterpartyAccount ?? null,
});

interface Step {
  readonly row: RowToImport;
  readonly draft: EntryDraft;
  /** The draft after the rules ran; null when a rule deleted it. */
  readonly ruled: EntryDraft | null;
  match: Candidate | null;
  readonly fuzzy: ReadonlyArray<Candidate>;
  /** Why the row stays out whatever else matches. */
  readonly refused: "dismissed" | "conflict" | "repeat" | null;
}

const wasSeen = (db: Db, account: string, importedId: string) =>
  db
    .select({ id: t.seenImports.importedId })
    .from(t.seenImports)
    .where(and(eq(t.seenImports.accountId, account), eq(t.seenImports.importedId, importedId)))
    .get() !== undefined;

/** The rows matched to existing transactions, in Actual's three passes. */
const matchRows = (
  db: Db,
  account: string,
  steps: ReadonlyArray<Omit<Step, "match" | "fuzzy" | "refused">>,
  strict: boolean,
  linked: boolean,
): Array<Step> => {
  const matched = new Set<string>();
  const inBatch = new Map<string, EntryDraft>();
  const matchedSteps = steps.map((step): Step => {
    const { ruled } = step;
    const none = { match: null, fuzzy: [], refused: null };
    if (ruled === null) return { ...step, ...none };
    if (ruled.importedId !== null) {
      const first = inBatch.get(ruled.importedId);
      if (first?.amount === ruled.amount && first.date === ruled.date)
        return { ...step, ...none, refused: "repeat" };
      if (first === undefined) inBatch.set(ruled.importedId, ruled);
      const match =
        inAccount(db, account).where(eq(t.postings.importedId, ruled.importedId)).get() ?? null;
      if (match !== null) {
        if (linked && match.amount !== ruled.amount)
          return { ...step, ...none, refused: "conflict" };
        matched.add(match.id);
        return { ...step, match, fuzzy: [], refused: null };
      }
      if (linked && wasSeen(db, account, ruled.importedId))
        return { ...step, ...none, refused: "dismissed" };
    }
    const from = dayToInt(addDays(ruled.date, -FUZZY_DAYS));
    const to = dayToInt(addDays(ruled.date, FUZZY_DAYS));
    const fuzzy = inAccount(db, account)
      .where(
        and(
          sql`${t.transactions.date} BETWEEN ${from} AND ${to}`,
          eq(t.postings.amount, ruled.amount),
          // When both have an imported id and they differ, they are different transactions.
          strict && ruled.importedId !== null ? sql`${t.postings.importedId} IS NULL` : undefined,
        ),
      )
      .all()
      .sort((a, b) => compareFuzzyMatchCandidates(ruled.date, a, b));
    return { ...step, match: null, fuzzy, refused: null };
  });
  // The closest pair across the file first, not the file's order: a row a day off must not take
  // the transaction another row is exactly, or importing a file again would add that other row.
  // Among equally close pairs, the same notes first, so two rows alike but for them keep their own.
  const claimClosest = (fits: (step: Step, row: Candidate) => boolean) => {
    const pairs = matchedSteps.flatMap((step) =>
      step.match !== null || step.ruled === null
        ? []
        : step.fuzzy.filter((row) => fits(step, row)).map((row) => ({ step, row })),
    );
    const notesDiffer = ({ step, row }: (typeof pairs)[number]) =>
      Number((step.ruled!.notes || null) !== (row.notes || null));
    pairs.sort(
      (a, b) =>
        daysApart(a.step.ruled!.date, a.row) - daysApart(b.step.ruled!.date, b.row) ||
        notesDiffer(a) - notesDiffer(b),
    );
    for (const { step, row } of pairs) {
      if (step.match !== null || matched.has(row.id)) continue;
      matched.add(row.id);
      step.match = row;
    }
  };
  // Same payee first, so a looser match never takes what a closer one would.
  const payeeIds = new Map(
    matchedSteps.map((step) => [step, existingPayeeId(db, step.ruled?.payee ?? null)]),
  );
  claimClosest((step, row) => row.payeeId === payeeIds.get(step));
  claimClosest(() => true);
  return matchedSteps;
};

/** Merges a row into the transaction it matched; false when there is nothing to change. */
const mergeInto = (
  book: Book,
  account: string,
  existing: Candidate,
  ruled: EntryDraft,
  write: boolean,
): boolean => {
  const { db } = book;
  const current = draftFrom(db, existing.id, account);
  const uncategorized =
    current.category === null && current.transferAccount === null && current.splits === null;
  // An account holds a bank's id once: a bank that repeats one on two lines names only the first.
  const idTaken =
    ruled.importedId !== null &&
    ruled.importedId !== undefined &&
    db
      .select({ id: t.postings.id })
      .from(t.postings)
      .where(and(eq(t.postings.accountId, account), eq(t.postings.importedId, ruled.importedId)))
      .all()
      .some((posting) => posting.id !== existing.postingId);
  const importedId = (!idTaken && ruled.importedId) || existing.importedId;
  // A transfer's two banks name it differently; the first name stays.
  const importedPayee =
    current.transferAccount !== null && existing.importedPayee !== null
      ? existing.importedPayee
      : ruled.importedPayee || null;
  const notes = existing.notes || ruled.notes || null;
  const cleared = existing.cleared || ruled.cleared;
  const takesPayee = existing.payeeId === null && ruled.payee !== null;
  const category = uncategorized && ruled.category !== null ? ruled.category : null;
  const transferAccount = uncategorized ? ruled.transferAccount : null;
  const changed =
    importedId !== existing.importedId ||
    importedPayee !== existing.importedPayee ||
    notes !== existing.notes ||
    cleared !== existing.cleared ||
    takesPayee ||
    category !== null ||
    transferAccount !== null;
  if (!changed || !write) return changed;
  db.update(t.transactions)
    .set({
      importedPayee,
      notes,
      ...(takesPayee && { payeeId: payeeIdFor(db, ruled.payee) }),
    })
    .where(eq(t.transactions.id, existing.id))
    .run();
  db.update(t.postings)
    .set({ importedId, cleared })
    .where(eq(t.postings.id, existing.postingId))
    .run();
  if (transferAccount !== null) {
    updateTransaction(book, { id: existing.id, account, transferAccount, cleared });
    joinOtherLeg(book, existing.id, { ...ruled, transferAccount });
  } else if (category !== null)
    updateTransaction(book, { id: existing.id, account, category, cleared });
  return true;
};

/**
 * A rule made this row a transfer, and the other bank's row may already be in as a plain
 * transaction. The two are one movement, so that copy goes into the transfer, in whichever order
 * the banks were fetched. The copy's id, once merged away.
 */
export const joinOtherLeg = (book: Book, id: string, ruled: EntryDraft): string | null => {
  if (ruled.transferAccount === null) return null;
  const { db } = book;
  const from = dayToInt(addDays(ruled.date, -FUZZY_DAYS));
  const to = dayToInt(addDays(ruled.date, FUZZY_DAYS));
  const other = inAccount(db, ruled.transferAccount)
    .where(
      and(
        sql`${t.transactions.date} BETWEEN ${from} AND ${to}`,
        eq(t.postings.amount, -ruled.amount),
      ),
    )
    .all()
    .filter((candidate) => candidate.id !== id)
    .sort((a, b) => compareFuzzyMatchCandidates(ruled.date, a, b))
    .find((candidate) => {
      const draft = draftFrom(db, candidate.id, ruled.transferAccount!);
      return draft.category === null && draft.transferAccount === null && draft.splits === null;
    });
  if (other === undefined) return null;
  mergeTransactions(book, { keep: id, drop: other.id });
  return other.id;
};

/** Keeps a line from coming back, once it is in the account. */
const rememberLine = (db: Db, account: string, ruled: EntryDraft) => {
  if (ruled.importedId === null) return;
  db.insert(t.seenImports)
    .values({
      accountId: account,
      importedId: ruled.importedId,
      date: dayToInt(ruled.date),
      amount: ruled.amount,
      payee: ruled.payee,
      firstSeenAt: Date.now(),
    })
    .onConflictDoNothing()
    .run();
};

const checkAccount = (db: Db, id: string) => {
  const row =
    db.select().from(t.accounts).where(eq(t.accounts.id, id)).get() ?? notFound("account", id);
  if (row.type !== "asset" && row.type !== "liability")
    invalid(`${row.name} is not an asset or liability account`);
};

/** Imports rows into an account through `addEntry`, so the rules run on each. */
export const importRows = (
  book: Book,
  account: string,
  rows: ReadonlyArray<RowToImport>,
  options: ImportOptions,
): ImportResult => {
  const { db } = book;
  checkAccount(db, account);
  const write = !options.dryRun;
  const added: Array<string> = [];
  const updated: Array<string> = [];
  const skipped: Array<string> = [];
  const outcomes: Array<{ index: number; status: ImportStatus; transactionId: string | null }> = [];
  const add = (row: RowToImport, draft: EntryDraft, ruled: EntryDraft | null) => {
    if (!write) {
      outcomes.push({ index: row.index, status: "new", transactionId: null });
      return;
    }
    // An account holds a bank's id once, so a row added beside its twin goes in without it.
    const taken =
      draft.importedId !== null &&
      inAccount(db, account).where(eq(t.postings.importedId, draft.importedId)).get() !== undefined;
    const id = addEntry(db, taken ? { ...draft, importedId: null } : draft, {
      context: lineContext(row),
    });
    if (id === null) outcomes.push({ index: row.index, status: "skipped", transactionId: null });
    else {
      added.push(id);
      outcomes.push({ index: row.index, status: "new", transactionId: id });
      if (ruled !== null) {
        rememberLine(db, account, ruled);
        joinOtherLeg(book, id, ruled);
      }
    }
  };

  if (!options.reconcile) {
    // Actual's addTransactions: no matching, and payee names as given.
    for (const row of rows) {
      if (row.skip === true)
        outcomes.push({ index: row.index, status: "skipped", transactionId: null });
      else {
        const draft = draftOf(account, row, false);
        add(row, draft, draft);
      }
    }
    return { added, updated, skipped, rows: outcomes, dryRun: options.dryRun };
  }

  const steps = matchRows(
    db,
    account,
    rows.map((row) => {
      const draft = draftOf(account, row, options.titleCase);
      return { row, draft, ruled: runRules(db, draft, lineContext(row)) };
    }),
    options.strictIdChecking ?? true,
    options.linked ?? false,
  );
  for (const { row, draft, ruled, match, refused } of steps) {
    if (row.skip === true || ruled === null) {
      outcomes.push({ index: row.index, status: "skipped", transactionId: match?.id ?? null });
      continue;
    }
    if (refused !== null && row.forceAdd !== true) {
      outcomes.push({
        index: row.index,
        status: refused === "repeat" ? "duplicate" : refused,
        transactionId: null,
      });
      continue;
    }
    if (match !== null && row.forceAdd !== true) {
      // A reconciled transaction is locked.
      const changed = !match.reconciled && mergeInto(book, account, match, ruled, write);
      if (write) rememberLine(db, account, ruled);
      (changed ? updated : skipped).push(match.id);
      outcomes.push({
        index: row.index,
        status: changed ? "update" : "duplicate",
        transactionId: match.id,
      });
      continue;
    }
    add(row, draft, ruled);
  }
  return { added, updated, skipped, rows: outcomes, dryRun: options.dryRun };
};

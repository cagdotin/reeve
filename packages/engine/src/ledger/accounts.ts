import type { Account, LedgerAccount } from "@reeve/contract";
import { today } from "@reeve/contract/rules";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { invalid, newId, notFound, notesOf, systemAccount, type Book } from "../book.ts";
import type { Db } from "../db/open.ts";
import * as t from "../db/schema.ts";
import { dropFromRules, namedInRule } from "./rule-references.ts";
import { insertTransaction } from "./transactions.ts";

const BALANCE_ACCOUNTS = ["asset", "liability"] as const;

interface Totals {
  readonly balance: number;
  readonly cleared: number;
}

const totalsByAccount = (db: Db): Map<string, Totals> =>
  new Map(
    db
      .select({
        id: t.postings.accountId,
        balance: sql<number>`coalesce(sum(${t.postings.amount}), 0)`,
        cleared: sql<number>`coalesce(sum(case when ${t.postings.cleared} then ${t.postings.amount} else 0 end), 0)`,
      })
      .from(t.postings)
      .groupBy(t.postings.accountId)
      .all()
      .map((row) => [row.id, { balance: row.balance, cleared: row.cleared }]),
  );

type AccountRow = typeof t.accounts.$inferSelect;

const toAccount = (
  row: AccountRow,
  totals: Map<string, Totals>,
  notes: Map<string, string>,
): Account => {
  const total = totals.get(row.id) ?? { balance: 0, cleared: 0 };
  return {
    id: row.id,
    name: row.name,
    type: row.type as Account["type"],
    onBudget: row.onBudget,
    closed: row.closed,
    sortOrder: row.sortOrder,
    balance: total.balance,
    cleared: total.cleared,
    uncleared: total.balance - total.cleared,
    notes: notes.get(row.id) ?? null,
  };
};

export const listAccounts = (
  book: Book,
  options: { readonly closed?: boolean } = {},
): Array<Account> => {
  const rows = book.db
    .select()
    .from(t.accounts)
    .where(inArray(t.accounts.type, [...BALANCE_ACCOUNTS]))
    .orderBy(asc(t.accounts.closed), asc(t.accounts.onBudget), asc(t.accounts.sortOrder))
    .all()
    .filter((row) => options.closed === true || !row.closed)
    // On-budget accounts first, as Actual's sidebar.
    .toSorted((a, b) => Number(b.onBudget) - Number(a.onBudget) || a.sortOrder - b.sortOrder);
  const totals = totalsByAccount(book.db);
  const notes = notesOf(book.db);
  return rows.map((row) => toAccount(row, totals, notes));
};

export const accountRow = (db: Db, id: string): AccountRow =>
  db.select().from(t.accounts).where(eq(t.accounts.id, id)).get() ?? notFound("account", id);

/** An asset or liability account, as the register and transfers need. */
export const balanceAccount = (db: Db, id: string): AccountRow => {
  const row = accountRow(db, id);
  if (row.type !== "asset" && row.type !== "liability")
    invalid(`${row.name} is not an asset or liability account`);
  return row;
};

export const getAccount = (book: Book, id: string): Account =>
  toAccount(balanceAccount(book.db, id), totalsByAccount(book.db), notesOf(book.db));

export const listLedgerAccounts = (book: Book): Array<LedgerAccount> =>
  book.db
    .select()
    .from(t.accounts)
    .orderBy(asc(t.accounts.type), asc(t.accounts.sortOrder))
    .all()
    .map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      onBudget: row.onBudget,
      closed: row.closed,
      system: row.system,
      groupId: row.groupId,
    }));

const nextSortOrder = (db: Db) =>
  (db
    .select({ max: sql<number | null>`max(${t.accounts.sortOrder})` })
    .from(t.accounts)
    .where(inArray(t.accounts.type, [...BALANCE_ACCOUNTS]))
    .get()?.max ?? 0) + 1;

export const createAccount = (
  book: Book,
  input: {
    readonly name: string;
    readonly type?: "asset" | "liability";
    readonly onBudget?: boolean;
    readonly balance?: number;
    readonly date?: string;
  },
): Account => {
  const id = newId();
  book.db
    .insert(t.accounts)
    .values({
      id,
      name: input.name.trim(),
      type: input.type ?? "asset",
      onBudget: input.onBudget ?? true,
      sortOrder: nextSortOrder(book.db),
      createdAt: Date.now(),
    })
    .run();
  if (input.balance !== undefined && input.balance !== 0) {
    insertTransaction(book.db, {
      date: input.date ?? today(),
      payee: "Starting Balance",
      notes: null,
      postings: [
        { account: id, amount: input.balance, cleared: true },
        { account: systemAccount(book.db, "opening"), amount: -input.balance, cleared: true },
      ],
    });
  }
  return getAccount(book, id);
};

export const updateAccount = (
  book: Book,
  input: { readonly id: string; readonly name?: string; readonly onBudget?: boolean },
): Account => {
  balanceAccount(book.db, input.id);
  const change: Partial<AccountRow> = {};
  if (input.name !== undefined) change.name = input.name.trim();
  if (input.onBudget !== undefined) change.onBudget = input.onBudget;
  if (Object.keys(change).length > 0)
    book.db.update(t.accounts).set(change).where(eq(t.accounts.id, input.id)).run();
  return getAccount(book, input.id);
};

/** Renumbers `ids` in order, placing `id` before `before` (last when null). */
export const reorder = (
  ids: ReadonlyArray<string>,
  id: string,
  before: string | null | undefined,
) => {
  const rest = ids.filter((each) => each !== id);
  const at = before === null || before === undefined ? -1 : rest.indexOf(before);
  if (at === -1) rest.push(id);
  else rest.splice(at, 0, id);
  return rest;
};

export const moveAccount = (
  book: Book,
  input: { readonly id: string; readonly before: string | null },
) => {
  balanceAccount(book.db, input.id);
  const ids = listAccounts(book, { closed: true }).map((account) => account.id);
  reorder(ids, input.id, input.before).forEach((id, index) =>
    book.db
      .update(t.accounts)
      .set({ sortOrder: index + 1 })
      .where(eq(t.accounts.id, id))
      .run(),
  );
  return listAccounts(book);
};

const hasPostings = (db: Db, accountId: string) =>
  db
    .select({ id: t.postings.id })
    .from(t.postings)
    .where(eq(t.postings.accountId, accountId))
    .get() !== undefined;

/** A schedule lives on its rule and needs its account, so that account stays, closed. */
const namedBySchedule = (db: Db, accountId: string) =>
  db
    .select({ rule: t.rules })
    .from(t.schedules)
    .innerJoin(t.rules, eq(t.rules.id, t.schedules.ruleId))
    .all()
    .some(({ rule }) => namedInRule(rule, "account").has(accountId));

export const closeAccount = (
  book: Book,
  input: { readonly id: string; readonly transferAccount?: string; readonly category?: string },
) => {
  const row = balanceAccount(book.db, input.id);
  if (!hasPostings(book.db, input.id) && !namedBySchedule(book.db, input.id)) {
    dropFromRules(book.db, "account", new Set([input.id]));
    book.db.delete(t.notes).where(eq(t.notes.id, input.id)).run();
    book.db.delete(t.accounts).where(eq(t.accounts.id, input.id)).run();
    return { id: input.id, deleted: true };
  }
  const { balance } = getAccount(book, input.id);
  if (balance !== 0) {
    const target =
      input.transferAccount !== undefined
        ? balanceAccount(book.db, input.transferAccount).id
        : input.category !== undefined
          ? accountRow(book.db, input.category).id
          : invalid(
              `${row.name} still holds a balance: name transferAccount or category to move it to`,
            );
    if (target === input.id) invalid("An account cannot close into itself");
    insertTransaction(book.db, {
      date: today(),
      payee: null,
      notes: `Closing ${row.name}`,
      postings: [
        { account: input.id, amount: -balance, cleared: true },
        { account: target, amount: balance, cleared: true },
      ],
    });
  }
  book.db.update(t.accounts).set({ closed: true }).where(eq(t.accounts.id, input.id)).run();
  return { id: input.id, deleted: false };
};

export const reopenAccount = (book: Book, id: string): Account => {
  balanceAccount(book.db, id);
  book.db.update(t.accounts).set({ closed: false }).where(eq(t.accounts.id, id)).run();
  return getAccount(book, id);
};

export const reconcileAccount = (
  book: Book,
  input: {
    readonly id: string;
    readonly balance: number;
    readonly adjust?: boolean;
    readonly date?: string;
  },
) => {
  const account = getAccount(book, input.id);
  const difference = input.balance - account.cleared;
  if (difference !== 0 && input.adjust !== true)
    invalid(
      `The cleared balance is ${account.cleared}, ${difference} away from the statement; clear the missing transactions, or pass adjust to add an adjustment`,
    );
  if (difference !== 0) {
    insertTransaction(book.db, {
      date: input.date ?? today(),
      payee: "Reconciliation balance adjustment",
      notes: null,
      postings: [
        { account: input.id, amount: difference, cleared: true },
        { account: systemAccount(book.db, "uncategorized"), amount: -difference },
      ],
    });
  }
  const result = book.db
    .update(t.postings)
    .set({ reconciled: true })
    .where(
      and(
        eq(t.postings.accountId, input.id),
        eq(t.postings.cleared, true),
        eq(t.postings.reconciled, false),
      ),
    )
    .run();
  return { reconciled: Number(result.changes), adjustment: difference === 0 ? null : difference };
};

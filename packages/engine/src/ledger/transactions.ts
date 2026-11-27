import type { PostingInput, SplitInput, Transaction } from "@reeve/contract";
import { dayToInt, intToDay, isBalanced } from "@reeve/contract/rules";
import { InvalidRequest } from "@reeve/contract";
import { and, asc, eq, inArray } from "drizzle-orm";
import { invalid, newId, notFound, systemAccount, type Book } from "../book.ts";
import type { Db } from "../db/open.ts";
import * as t from "../db/schema.ts";
import { learnCategories } from "../rules/learn.ts";
import { runRules, type EntryContext } from "../rules/run.ts";
import { payeeIdFor } from "./payees.ts";

type AccountRow = typeof t.accounts.$inferSelect;
type PostingRow = typeof t.postings.$inferSelect;

/** A transaction as a register enters it, before it becomes postings. Rules work on this shape. */
export interface EntryDraft {
  readonly date: string;
  readonly account: string;
  readonly amount: number;
  readonly payee: string | null;
  readonly category: string | null;
  readonly transferAccount: string | null;
  readonly splits: ReadonlyArray<SplitInput> | null;
  readonly notes: string | null;
  readonly cleared: boolean;
  readonly importedPayee: string | null;
  readonly importedId: string | null;
  readonly scheduleId: string | null;
}

export interface NewTransaction {
  readonly date: string;
  readonly payee: string | null;
  readonly notes: string | null;
  readonly postings: ReadonlyArray<
    PostingInput & { readonly reconciled?: boolean; readonly importedId?: string | null }
  >;
  readonly scheduleId?: string | null;
  readonly importedPayee?: string | null;
}

const account = (db: Db, id: string): AccountRow =>
  db.select().from(t.accounts).where(eq(t.accounts.id, id)).get() ?? notFound("account", id);

const isBalanceAccount = (row: AccountRow) => row.type === "asset" || row.type === "liability";

const isCategory = (row: AccountRow) =>
  (row.type === "expense" || row.type === "income") && row.system === null;

/** What every transaction's postings must be, however they were entered. */
const checkPostings = (db: Db, postings: ReadonlyArray<PostingInput>) => {
  if (postings.length < 2) invalid("A transaction needs at least two postings");
  if (!isBalanced(postings.map((posting) => posting.amount)))
    invalid("The postings of a transaction must sum to zero");
  const rows = postings.map((posting) => account(db, posting.account));
  const touchesBudget = rows.some((row) => isBalanceAccount(row) && row.onBudget);
  postings.forEach((posting, index) => {
    const row = rows[index]!;
    if (posting.category !== undefined && posting.category !== null) {
      const category = account(db, posting.category);
      if (!isCategory(category)) invalid(`${category.name} is not a category`);
      if (!isBalanceAccount(row) || row.onBudget)
        invalid("Only an off-budget account's posting can name a category");
      if (!touchesBudget) invalid("A category counts only on a transfer from a budget account");
    }
  });
};

/** Writes a transaction and its postings as given; they must balance. Returns its id. */
export const insertTransaction = (db: Db, input: NewTransaction, id: string = newId()): string => {
  checkPostings(db, input.postings);
  db.insert(t.transactions)
    .values({
      id,
      date: dayToInt(input.date),
      payeeId: payeeIdFor(db, input.payee),
      notes: input.notes,
      scheduleId: input.scheduleId ?? null,
      importedPayee: input.importedPayee ?? null,
      createdAt: Date.now(),
    })
    .run();
  input.postings.forEach((posting, index) =>
    db
      .insert(t.postings)
      .values({
        id: newId(),
        transactionId: id,
        accountId: posting.account,
        amount: posting.amount,
        memo: posting.memo ?? null,
        categoryId: posting.category ?? null,
        cleared: posting.cleared ?? false,
        reconciled: posting.reconciled ?? false,
        sortOrder: index,
        importedId: posting.importedId ?? null,
      })
      .run(),
  );
  return id;
};

/**
 * The posting a register line makes on the other side of the account: to a category, to a
 * transfer account, or to Uncategorized. A category on a transfer between the budget and an
 * off-budget account is the budget category of the off-budget side.
 */
const counterPosting = (
  db: Db,
  from: AccountRow,
  line: {
    readonly category?: string | null | undefined;
    readonly transferAccount?: string | null | undefined;
    readonly amount: number;
    readonly memo?: string | null | undefined;
  },
  held: ReadonlySet<string>,
): PostingInput => {
  const amount = -line.amount;
  const memo = line.memo === undefined ? {} : { memo: line.memo };
  if (line.transferAccount !== undefined && line.transferAccount !== null) {
    const to = account(db, line.transferAccount);
    if (!isBalanceAccount(to)) invalid(`${to.name} is not an account to transfer to`);
    if (to.id === from.id) invalid("An account cannot transfer to itself");
    const crossesBudget = from.onBudget !== to.onBudget;
    const category = crossesBudget ? (line.category ?? null) : null;
    if (category !== null) {
      // The category goes on whichever side is off budget.
      return to.onBudget
        ? invalid("Name the category from the budget account's side")
        : { account: to.id, amount, ...memo, category };
    }
    return { account: to.id, amount, ...memo };
  }
  if (line.category !== undefined && line.category !== null) {
    const category = account(db, line.category);
    if (!isCategory(category) && !held.has(category.id))
      invalid(`${category.name} is not a category`);
    return { account: category.id, amount, ...memo };
  }
  return { account: systemAccount(db, "uncategorized"), amount, ...memo };
};

/**
 * The postings a register entry makes: the account's own, then one per line on the other side.
 * `held` names the system accounts a line may stay on, which no one can pick as a category.
 */
export const entryPostings = (
  db: Db,
  draft: EntryDraft,
  held: ReadonlySet<string> = new Set(),
): Array<PostingInput> => {
  const own = account(db, draft.account);
  if (!isBalanceAccount(own)) invalid(`${own.name} is not an asset or liability account`);
  const lines =
    draft.splits !== null && draft.splits.length > 0
      ? draft.splits
      : [
          {
            category: draft.category,
            transferAccount: draft.transferAccount,
            amount: draft.amount,
          },
        ];
  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  if (total !== draft.amount)
    invalid(`The split lines sum to ${total}, not the transaction's ${draft.amount}`);
  return [
    { account: own.id, amount: draft.amount, cleared: draft.cleared },
    ...lines.map((line) => counterPosting(db, own, line, held)),
  ];
};

export const getTransaction = (db: Db, id: string): Transaction => {
  const row =
    db
      .select({ tx: t.transactions, payee: t.payees.name })
      .from(t.transactions)
      .leftJoin(t.payees, eq(t.payees.id, t.transactions.payeeId))
      .where(eq(t.transactions.id, id))
      .get() ?? notFound("transaction", id);
  const postings = db
    .select()
    .from(t.postings)
    .where(eq(t.postings.transactionId, id))
    .orderBy(asc(t.postings.sortOrder))
    .all();
  return {
    id: row.tx.id,
    date: intToDay(row.tx.date),
    payeeId: row.tx.payeeId,
    payee: row.payee,
    notes: row.tx.notes,
    scheduleId: row.tx.scheduleId,
    importedPayee: row.tx.importedPayee,
    postings: postings.map((posting) => ({
      id: posting.id,
      accountId: posting.accountId,
      amount: posting.amount,
      memo: posting.memo,
      categoryId: posting.categoryId,
      cleared: posting.cleared,
      reconciled: posting.reconciled,
      importedId: posting.importedId,
    })),
  };
};

const nullable = <A>(value: A | null | undefined): A | null => value ?? null;

/**
 * Rules know nothing of each other or of the entry they meet, so what they make of its money may not
 * be writable: an amount that does not fit its splits, an account it transfers to, or, on the
 * `existing` transaction it may be, a reconciled posting. That money stays as entered, and the rest
 * of what they did stands; a rule never refuses a person's entry.
 */
export const moneyLeftUndone = (
  db: Db,
  entry: EntryDraft,
  ruled: EntryDraft,
  existing?: string,
): EntryDraft => {
  try {
    if (existing === undefined) entryPostings(db, ruled);
    else
      continuedPostings(
        postingsOf(db, existing),
        entryPostings(db, ruled, heldAccounts(db, existing)),
      );
    return ruled;
  } catch (error) {
    if (!(error instanceof InvalidRequest)) throw error;
    const { account, amount, category, transferAccount, splits } = entry;
    return { ...ruled, account, amount, category, transferAccount, splits };
  }
};

/**
 * Adds a register entry after the rules ran on it. Null when a rule deleted it. With `keepCategory`
 * a category the entry names stays, as a rule only fills what a person left empty in Actual.
 */
export const addEntry = (
  db: Db,
  entry: EntryDraft,
  {
    keepCategory = false,
    context,
  }: { readonly keepCategory?: boolean; readonly context?: EntryContext } = {},
): string | null => {
  const result = runRules(db, entry, context);
  if (result === null) return null;
  const ruled = moneyLeftUndone(
    db,
    entry,
    keepCategory && entry.category !== null
      ? {
          ...result,
          category: entry.category,
          transferAccount: entry.transferAccount,
          splits: entry.splits,
        }
      : result,
  );
  const [own, ...lines] = entryPostings(db, ruled);
  return insertTransaction(db, {
    date: ruled.date,
    payee: ruled.payee,
    notes: ruled.notes,
    postings: [{ ...own!, importedId: ruled.importedId }, ...lines],
    scheduleId: ruled.scheduleId,
    importedPayee: ruled.importedPayee,
  });
};

export const createTransaction = (
  book: Book,
  input: {
    readonly date: string;
    readonly account: string;
    readonly amount: number;
    readonly payee?: string | null;
    readonly category?: string | null;
    readonly transferAccount?: string | null;
    readonly splits?: ReadonlyArray<SplitInput>;
    readonly notes?: string | null;
    readonly cleared?: boolean;
  },
): Transaction => {
  const id = addEntry(
    book.db,
    {
      date: input.date,
      account: input.account,
      amount: input.amount,
      payee: nullable(input.payee),
      category: nullable(input.category),
      transferAccount: nullable(input.transferAccount),
      splits: nullable(input.splits),
      notes: nullable(input.notes),
      cleared: input.cleared ?? false,
      importedPayee: null,
      importedId: null,
      scheduleId: null,
    },
    { keepCategory: true },
  );
  if (id === null) return invalid("A rule deleted the transaction");
  learnCategories(book.db, [id]);
  return getTransaction(book.db, id);
};

export const createJournalEntry = (
  book: Book,
  input: {
    readonly date: string;
    readonly payee?: string | null;
    readonly notes?: string | null;
    readonly postings: ReadonlyArray<PostingInput>;
  },
): Transaction =>
  getTransaction(
    book.db,
    insertTransaction(book.db, {
      date: input.date,
      payee: nullable(input.payee),
      notes: nullable(input.notes),
      postings: input.postings,
    }),
  );

const postingsOf = (db: Db, id: string): Array<PostingRow> =>
  db
    .select()
    .from(t.postings)
    .where(eq(t.postings.transactionId, id))
    .orderBy(asc(t.postings.sortOrder))
    .all();

/**
 * The posting each new one continues, by position: the same account and amount first, then the
 * same account. A reconciled posting has to go on unchanged.
 */
const continuedPostings = (
  old: ReadonlyArray<PostingRow>,
  postings: ReadonlyArray<PostingInput>,
): Array<PostingRow | undefined> => {
  const free = old.toSorted((a, b) => Number(b.reconciled) - Number(a.reconciled));
  const take = (matches: (row: PostingRow) => boolean) => {
    const index = free.findIndex(matches);
    return index === -1 ? undefined : free.splice(index, 1)[0];
  };
  const same = postings.map((posting) =>
    take((row) => row.accountId === posting.account && row.amount === posting.amount),
  );
  if (free.some((row) => row.reconciled))
    invalid("The posting is reconciled: its amount and account cannot change");
  return postings.map(
    (posting, index) => same[index] ?? take((row) => row.accountId === posting.account),
  );
};

/** A transaction's postings rewritten; each keeps the id and marks of the posting it continues. */
const replacePostings = (db: Db, id: string, postings: ReadonlyArray<PostingInput>) => {
  checkPostings(db, postings);
  const continued = continuedPostings(postingsOf(db, id), postings);
  db.delete(t.postings).where(eq(t.postings.transactionId, id)).run();
  postings.forEach((posting, index) => {
    const before = continued[index];
    db.insert(t.postings)
      .values({
        id: before?.id ?? newId(),
        transactionId: id,
        accountId: posting.account,
        amount: posting.amount,
        memo: posting.memo === undefined ? (before?.memo ?? null) : posting.memo,
        categoryId: posting.category ?? null,
        cleared: posting.cleared ?? before?.cleared ?? false,
        reconciled: before?.reconciled ?? false,
        sortOrder: index,
        importedId: before?.importedId ?? null,
      })
      .run();
  });
};

/** The system accounts a transaction already posts on, as Opening Balances for a starting balance. */
export const heldAccounts = (db: Db, id: string): ReadonlySet<string> =>
  new Set(
    postingsOf(db, id)
      .map((posting) => account(db, posting.accountId))
      .filter((row) => row.system !== null)
      .map((row) => row.id),
  );

/** How a transaction reads from one account's register, as the shape it is edited in. */
export const draftFrom = (db: Db, id: string, accountId: string): EntryDraft => {
  const tx = getTransaction(db, id);
  const own = tx.postings.find((posting) => posting.accountId === accountId);
  if (own === undefined) return invalid("The transaction has no posting in that account");
  const others = tx.postings.filter((posting) => posting !== own);
  const lines = others.map((posting) => {
    const row = account(db, posting.accountId);
    return isBalanceAccount(row)
      ? {
          transferAccount: row.id,
          category: posting.categoryId,
          amount: -posting.amount,
          memo: posting.memo,
        }
      : row.system === "uncategorized"
        ? { category: null, amount: -posting.amount, memo: posting.memo }
        : { category: row.id, amount: -posting.amount, memo: posting.memo };
  });
  const single = lines.length === 1 ? lines[0]! : null;
  return {
    date: tx.date,
    account: accountId,
    amount: own.amount,
    payee: tx.payee,
    category: single?.category ?? null,
    transferAccount: single !== null && "transferAccount" in single ? single.transferAccount : null,
    splits: single === null ? lines : null,
    notes: tx.notes,
    cleared: own.cleared,
    importedPayee: tx.importedPayee,
    importedId: own.importedId,
    scheduleId: tx.scheduleId,
  };
};

export interface TransactionChange {
  readonly id: string;
  readonly account?: string;
  readonly date?: string;
  readonly payee?: string | null;
  readonly notes?: string | null;
  readonly amount?: number;
  readonly category?: string | null;
  readonly transferAccount?: string | null;
  readonly splits?: ReadonlyArray<SplitInput>;
  readonly cleared?: boolean;
  readonly postings?: ReadonlyArray<PostingInput>;
}

const REGISTER_FIELDS = ["amount", "category", "transferAccount", "splits", "cleared"] as const;

/** Changes a transaction; a category given teaches the payee's rule unless `learn` is false. */
export const updateTransaction = (
  book: Book,
  change: TransactionChange,
  { learn = true }: { readonly learn?: boolean } = {},
): Transaction => {
  const result = changeTransaction(book, change);
  const categorized =
    (change.category !== undefined && change.category !== null) ||
    change.splits?.some((line) => line.category != null) === true;
  if (learn && categorized) learnCategories(book.db, [change.id]);
  return result;
};

const linesKey = (draft: EntryDraft) =>
  JSON.stringify([
    draft.amount,
    draft.category,
    draft.transferAccount,
    draft.splits?.map((line) => [
      line.category ?? null,
      line.transferAccount ?? null,
      line.amount,
      line.memo ?? null,
    ]) ?? null,
  ]);

const sameLines = (a: EntryDraft, b: EntryDraft) => linesKey(a) === linesKey(b);

const changeTransaction = (book: Book, change: TransactionChange): Transaction => {
  const { db } = book;
  const current = getTransaction(db, change.id);
  const header: Partial<typeof t.transactions.$inferInsert> = {};
  if (change.date !== undefined) header.date = dayToInt(change.date);
  if (change.payee !== undefined) header.payeeId = payeeIdFor(db, change.payee);
  if (change.notes !== undefined) header.notes = change.notes;
  if (Object.keys(header).length > 0)
    db.update(t.transactions).set(header).where(eq(t.transactions.id, change.id)).run();

  if (change.postings !== undefined) {
    for (const posting of change.postings) account(db, posting.account);
    replacePostings(db, change.id, change.postings);
    return getTransaction(db, change.id);
  }
  const touchesRegister = REGISTER_FIELDS.some((field) => change[field] !== undefined);
  if (!touchesRegister) return getTransaction(db, change.id);
  if (change.account === undefined) return invalid("Name the account whose register is edited");
  const draft = draftFrom(db, change.id, change.account);
  const switchesToSingle = change.category !== undefined || change.transferAccount !== undefined;
  const next: EntryDraft = {
    ...draft,
    amount: change.amount ?? draft.amount,
    category:
      change.category !== undefined
        ? change.category
        : change.transferAccount !== undefined && change.transferAccount !== draft.transferAccount
          ? null
          : draft.category,
    transferAccount:
      change.transferAccount !== undefined ? change.transferAccount : draft.transferAccount,
    splits: change.splits !== undefined ? change.splits : switchesToSingle ? null : draft.splits,
    cleared: change.cleared ?? draft.cleared,
  };
  if (sameLines(next, draft)) {
    if (next.cleared !== draft.cleared)
      db.update(t.postings)
        .set({ cleared: next.cleared })
        .where(eq(t.postings.id, current.postings.find((p) => p.accountId === change.account)!.id))
        .run();
    return getTransaction(db, change.id);
  }
  // An amount change on a split scales nothing: the splits must be given again to match.
  if (next.splits !== null && change.amount !== undefined && change.splits === undefined)
    invalid("Give the split lines again with the new amount");
  const postings = postingsOf(db, change.id);
  const position = postings.findIndex((posting) => posting.accountId === change.account);
  const own = postings[position]!;
  const [ownPosting, ...lines] = entryPostings(db, next, heldAccounts(db, change.id));
  // A transfer's category lives on the off-budget posting and is edited from the other side, so
  // seen from the off-budget account it stays while the transfer from the budget does.
  const fromBudget = lines.some((line) => {
    const row = account(db, line.account);
    return isBalanceAccount(row) && row.onBudget;
  });
  const ownCategory =
    next.transferAccount === draft.transferAccount && fromBudget ? own.categoryId : null;
  replacePostings(
    db,
    change.id,
    lines.toSpliced(position, 0, { ...ownPosting!, category: ownCategory }),
  );
  return getTransaction(db, change.id);
};

export const updateTransactions = (
  book: Book,
  input: Omit<TransactionChange, "id" | "amount" | "splits" | "transferAccount" | "postings"> & {
    readonly ids: ReadonlyArray<string>;
    readonly accountOf?: ReadonlyArray<{ readonly id: string; readonly account: string }>;
  },
): Array<Transaction> => {
  const { ids, accountOf = [], ...change } = input;
  const seenFrom = new Map(accountOf.map((each) => [each.id, each.account]));
  return ids.map((id) => {
    const account = seenFrom.get(id) ?? change.account;
    return updateTransaction(book, {
      ...change,
      id,
      ...(account === undefined ? {} : { account }),
    });
  });
};

/** Which of these transactions have a reconciled posting. */
export const reconciledTransactions = (db: Db, ids: ReadonlyArray<string>): ReadonlySet<string> =>
  new Set(
    db
      .select({ id: t.postings.transactionId })
      .from(t.postings)
      .where(and(inArray(t.postings.transactionId, [...ids]), eq(t.postings.reconciled, true)))
      .all()
      .map((row) => row.id),
  );

/** Deleting a reconciled transaction changes a balance already agreed, so it has to be confirmed. */
export const deleteConfirmed = (
  book: Book,
  input: { readonly ids: ReadonlyArray<string>; readonly confirmReconciled?: boolean },
) => {
  const reconciled = reconciledTransactions(book.db, input.ids).size;
  if (reconciled > 0 && input.confirmReconciled !== true)
    invalid(
      `${reconciled} of these transactions ${reconciled === 1 ? "is" : "are"} reconciled: pass confirmReconciled to delete anyway`,
    );
  return deleteTransactions(book, input.ids);
};

export const deleteTransactions = (book: Book, ids: ReadonlyArray<string>) => {
  for (const id of ids) getTransaction(book.db, id);
  book.db
    .delete(t.transactions)
    .where(inArray(t.transactions.id, [...ids]))
    .run();
  return { deleted: [...ids] };
};

export const duplicateTransactions = (book: Book, ids: ReadonlyArray<string>): Array<Transaction> =>
  ids.map((id) => {
    const tx = getTransaction(book.db, id);
    return getTransaction(
      book.db,
      insertTransaction(book.db, {
        date: tx.date,
        payee: tx.payee,
        notes: tx.notes,
        postings: tx.postings.map((posting) => ({
          account: posting.accountId,
          amount: posting.amount,
          memo: posting.memo,
          category: posting.categoryId,
        })),
      }),
    );
  });

const isUncategorized = (db: Db, posting: { readonly accountId: string }) =>
  account(db, posting.accountId).system === "uncategorized";

export const mergeTransactions = (
  book: Book,
  input: { readonly keep: string; readonly drop: string },
) => {
  const { db } = book;
  if (input.keep === input.drop) invalid("Merge two different transactions");
  const keep = getTransaction(db, input.keep);
  const drop = getTransaction(db, input.drop);
  const kept = keep.postings.find(
    (posting) =>
      isBalanceAccount(account(db, posting.accountId)) &&
      drop.postings.some(
        (each) => each.accountId === posting.accountId && each.amount === posting.amount,
      ),
  );
  if (kept === undefined) return invalid("Merge transactions of one account and the same amount");
  const dropped = drop.postings.find(
    (each) => each.accountId === kept.accountId && each.amount === kept.amount,
  )!;
  const counter = keep.postings.filter((posting) => posting.id !== kept.id);
  const takesCounter = counter.every((posting) => isUncategorized(db, posting));
  const lost = drop.postings.some(
    (posting) =>
      posting.reconciled && (posting.id === dropped.id ? kept.reconciled : !takesCounter),
  );
  if (lost) invalid("Merging would lose a reconciled posting: delete that transaction instead");
  db.update(t.transactions)
    .set({
      payeeId: keep.payeeId ?? drop.payeeId,
      notes: keep.notes ?? drop.notes,
      importedPayee: keep.importedPayee ?? drop.importedPayee,
      scheduleId: keep.scheduleId ?? drop.scheduleId,
    })
    .where(eq(t.transactions.id, keep.id))
    .run();
  // What the dropped copy cleared stays so, and what it reconciled on the amount they share.
  for (const posting of drop.postings) {
    const shared = posting.id === dropped.id;
    const match = shared
      ? kept
      : keep.postings.find((each) => each.accountId === posting.accountId);
    if (match !== undefined && (posting.cleared || posting.reconciled))
      db.update(t.postings)
        .set({
          cleared: match.cleared || posting.cleared,
          reconciled: match.reconciled || (shared && posting.reconciled),
        })
        .where(eq(t.postings.id, match.id))
        .run();
  }
  // An uncategorized copy takes the other's category, split or transfer.
  if (takesCounter) {
    db.delete(t.postings)
      .where(
        inArray(
          t.postings.id,
          counter.map((posting) => posting.id),
        ),
      )
      .run();
    const taken = drop.postings.filter((posting) => posting.id !== dropped.id);
    const ids = (postings: typeof taken) => postings.map((posting) => posting.id);
    db.update(t.postings)
      .set({ transactionId: keep.id })
      .where(inArray(t.postings.id, ids(taken)))
      .run();
    const cleared = new Set(
      counter.filter((posting) => posting.cleared).map((posting) => posting.accountId),
    );
    db.update(t.postings)
      .set({ cleared: true })
      .where(inArray(t.postings.id, ids(taken.filter((posting) => cleared.has(posting.accountId)))))
      .run();
  }
  db.delete(t.transactions).where(eq(t.transactions.id, drop.id)).run();
  // Only once the dropped copy is gone: an account holds a bank's id once.
  if (kept.importedId === null && dropped.importedId !== null)
    db.update(t.postings)
      .set({ importedId: dropped.importedId })
      .where(eq(t.postings.id, kept.id))
      .run();
  return getTransaction(db, keep.id);
};

/**
 * Two imported legs of one movement become one transfer, as Actual's "Make transfer": different
 * accounts, amounts that cancel, and neither one a transfer or a split. `from` stays; a category
 * stays only where the transfer crosses the budget, on the off-budget side.
 */
export const makeTransfer = (
  book: Book,
  input: { readonly from: string; readonly to: string },
): Transaction => {
  const { db } = book;
  if (input.from === input.to) invalid("Make a transfer of two different transactions");
  const leg = (id: string) => {
    const tx = getTransaction(db, id);
    const [own, counter, ...rest] = tx.postings.toSorted(
      (a, b) =>
        Number(isBalanceAccount(account(db, b.accountId))) -
        Number(isBalanceAccount(account(db, a.accountId))),
    );
    if (
      own === undefined ||
      counter === undefined ||
      rest.length > 0 ||
      !isBalanceAccount(account(db, own.accountId)) ||
      isBalanceAccount(account(db, counter.accountId))
    )
      return invalid("A transfer needs two plain transactions, neither a split nor a transfer");
    return { tx, own, counter };
  };
  const from = leg(input.from);
  const to = leg(input.to);
  if (from.own.accountId === to.own.accountId)
    invalid("A transfer needs transactions in two different accounts");
  if (from.own.amount + to.own.amount !== 0)
    invalid("A transfer needs two transactions whose amounts cancel");
  const fromRow = account(db, from.own.accountId);
  const toRow = account(db, to.own.accountId);
  const named = ({ counter }: typeof from) =>
    account(db, counter.accountId).system === null ? counter.accountId : null;
  const offBudgetSide = fromRow.onBudget === toRow.onBudget ? null : fromRow.onBudget ? to : from;
  const budgetSide = offBudgetSide === to ? from : to;
  const category = offBudgetSide === null ? null : named(budgetSide);

  db.delete(t.postings)
    .where(inArray(t.postings.id, [from.counter.id, to.counter.id]))
    .run();
  db.update(t.postings)
    .set({ transactionId: from.tx.id, sortOrder: 1 })
    .where(eq(t.postings.id, to.own.id))
    .run();
  if (offBudgetSide !== null)
    db.update(t.postings)
      .set({ categoryId: category })
      .where(eq(t.postings.id, offBudgetSide.own.id))
      .run();
  db.update(t.transactions)
    .set({
      payeeId: from.tx.payeeId ?? to.tx.payeeId,
      notes: from.tx.notes ?? to.tx.notes,
      importedPayee: from.tx.importedPayee ?? to.tx.importedPayee,
    })
    .where(eq(t.transactions.id, from.tx.id))
    .run();
  db.delete(t.transactions).where(eq(t.transactions.id, to.tx.id)).run();
  return getTransaction(db, from.tx.id);
};

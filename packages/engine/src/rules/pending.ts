import { sql } from "drizzle-orm";
import type { Book } from "../book.ts";
import { draftFrom, updateTransaction } from "../ledger/transactions.ts";
import { keptCounterparty } from "./query.ts";
import { runRulesOn } from "./run.ts";
import { loadRules } from "./store.ts";
import {
  fromRuleTransaction,
  toRuleTransaction,
  useBookFormulaPreferences,
} from "./transaction.ts";

export interface PendingCategory {
  readonly id: string;
  readonly account: string;
  readonly category: string;
}

/** Which transactions to look at: by id, or every one in an account scope. */
export interface PendingScope {
  readonly ids?: ReadonlyArray<string>;
  readonly payee?: string;
  readonly account?: string;
  readonly onBudget?: boolean;
}

interface Candidate {
  readonly transaction_id: string;
  readonly account_id: string;
  readonly reconciled: number;
}

/**
 * Uncategorized transactions on budget accounts, neither split nor transfer: the only ones a
 * category rule may fill in after the fact (docs/rules/rules-and-payees.md).
 */
const candidates = (book: Book, scope: PendingScope): Array<Candidate> => {
  if (scope.ids?.length === 0 || scope.onBudget === false) return [];
  const ids = scope.ids === undefined ? sql`1` : sql`t.id IN ${scope.ids}`;
  const account = scope.account === undefined ? sql`1` : sql`p.account_id = ${scope.account}`;
  const payee = scope.payee === undefined ? sql`1` : sql`t.payee_id = ${scope.payee}`;
  // Starts from the uncategorized postings, which are few, rather than from every budget posting.
  return book.db.all<Candidate>(
    sql`SELECT p.transaction_id, p.account_id, p.reconciled
       FROM accounts c
       JOIN postings u ON u.account_id = c.id
       JOIN transactions t ON t.id = u.transaction_id
       JOIN postings p ON p.transaction_id = t.id AND p.id <> u.id
       JOIN accounts a ON a.id = p.account_id
       WHERE c.system = 'uncategorized'
         AND a.type IN ('asset', 'liability') AND a.on_budget = 1 AND ${ids} AND ${account} AND ${payee}
         AND (SELECT count(*) FROM postings q WHERE q.transaction_id = t.id) = 2
       ORDER BY t.date DESC, t.created_at DESC`,
  );
};

/**
 * The category today's rules give each uncategorized transaction in scope, when they give one.
 * Rules run on the transaction as it is now; only the category they end on counts.
 */
export const pendingCategories = (book: Book, scope: PendingScope): Array<PendingCategory> => {
  const { db } = book;
  const found = candidates(book, scope);
  if (found.length === 0) return [];
  const rules = loadRules(db).map((each) => each.rule);
  if (rules.length === 0) return [];
  useBookFormulaPreferences(db);
  return found.flatMap((row) => {
    const entry = draftFrom(db, row.transaction_id, row.account_id);
    const original = toRuleTransaction(db, entry, {
      id: row.transaction_id,
      reconciled: row.reconciled === 1,
      counterpartyAccount: keptCounterparty(db, row.account_id, entry.importedId),
    });
    const after = fromRuleTransaction(db, entry, runRulesOn(db, original, rules), original);
    return after === null ||
      after.category === null ||
      after.splits !== null ||
      after.transferAccount !== null
      ? []
      : [{ id: row.transaction_id, account: row.account_id, category: after.category }];
  });
};

/** Puts on each uncategorized transaction in scope the category today's rules give it; their ids. */
export const fillRuleCategories = (book: Book, scope: PendingScope): Array<string> =>
  pendingCategories(book, scope).map(({ id, account, category }) => {
    updateTransaction(book, { id, account, category }, { learn: false });
    return id;
  });

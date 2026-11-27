/** What receipts read of the ledger: a transaction's paying side, its categories, its claims. */
import { intToDay } from "@reeve/contract/rules";
import type { Book } from "../book.ts";
import { inList } from "./context.ts";

export interface LedgerTransaction {
  readonly id: string;
  readonly date: string;
  readonly payeeId: string | null;
  readonly payee: string | null;
  readonly importedPayee: string | null;
  /** The one posting on an asset or liability account; null for a transfer between two. */
  readonly side: {
    readonly postingId: string;
    readonly accountId: string;
    readonly account: string;
    /** Register amount: negative for a payment. */
    readonly amount: number;
  } | null;
  /**
   * Money paid out per counterpart: a category id, null for Uncategorized, `transfer:<id>` or
   * `other:<id>` for the rest.
   */
  readonly counter: ReadonlyMap<string | null, number>;
  /** The single category it is on now (null: Uncategorized); undefined for a split or a transfer. */
  readonly currentCategory: string | null | undefined;
}

interface PostingRow {
  readonly transaction_id: string;
  readonly posting_id: string;
  readonly account_id: string;
  readonly name: string;
  readonly type: string;
  readonly system: string | null;
  readonly amount: number;
}

interface HeaderRow {
  readonly id: string;
  readonly date: number;
  readonly payee_id: string | null;
  readonly payee: string | null;
  readonly imported_payee: string | null;
}

const isBalance = (type: string) => type === "asset" || type === "liability";

const counterKey = (posting: PostingRow): string | null =>
  posting.system === "uncategorized"
    ? null
    : posting.type === "expense" || posting.type === "income"
      ? posting.account_id
      : isBalance(posting.type)
        ? `transfer:${posting.account_id}`
        : `other:${posting.account_id}`;

/** Transactions by id, as receipts see them. Missing ids are left out. */
export const ledgerTransactions = (
  book: Book,
  ids: ReadonlyArray<string>,
): Map<string, LedgerTransaction> => {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const headers = book.client
    .prepare(
      `SELECT t.id, t.date, t.payee_id, p.name AS payee, t.imported_payee
       FROM transactions t LEFT JOIN payees p ON p.id = t.payee_id
       WHERE t.id IN (${inList(unique)})`,
    )
    .all(...unique) as unknown as Array<HeaderRow>;
  const postings = Map.groupBy(
    book.client
      .prepare(
        `SELECT q.transaction_id, q.id AS posting_id, q.account_id, a.name, a.type, a.system, q.amount
         FROM postings q JOIN accounts a ON a.id = q.account_id
         WHERE q.transaction_id IN (${inList(unique)}) ORDER BY q.sort_order`,
      )
      .all(...unique) as unknown as Array<PostingRow>,
    (row) => row.transaction_id,
  );
  return new Map(
    headers.map((header) => {
      const rows = postings.get(header.id) ?? [];
      const balance = rows.filter((row) => isBalance(row.type));
      const own = balance.length === 1 ? balance[0]! : null;
      const others = rows.filter((row) => row !== own);
      const counter = new Map<string | null, number>();
      for (const row of others) {
        const key = counterKey(row);
        counter.set(key, (counter.get(key) ?? 0) + row.amount);
      }
      const single = others.length === 1 ? counterKey(others[0]!) : undefined;
      return [
        header.id,
        {
          id: header.id,
          date: intToDay(header.date),
          payeeId: header.payee_id,
          payee: header.payee,
          importedPayee: header.imported_payee,
          side:
            own === null
              ? null
              : {
                  postingId: own.posting_id,
                  accountId: own.account_id,
                  account: own.name,
                  amount: own.amount,
                },
          counter,
          currentCategory:
            single === undefined || (single !== null && single.includes(":")) ? undefined : single,
        },
      ];
    }),
  );
};

export interface Claim {
  readonly receiptId: string;
  readonly transactionId: string;
  readonly amount: number;
}

/** Every receipt payment on these transactions. */
export const claimsOn = (book: Book, transactionIds: ReadonlyArray<string>): Array<Claim> => {
  const unique = [...new Set(transactionIds)];
  if (unique.length === 0) return [];
  return (
    book.client
      .prepare(
        `SELECT receipt_id, transaction_id, amount FROM receipt_payments
         WHERE transaction_id IN (${inList(unique)}) ORDER BY created_at, rowid`,
      )
      .all(...unique) as unknown as Array<{
      receipt_id: string;
      transaction_id: string;
      amount: number;
    }>
  ).map((row) => ({
    receiptId: row.receipt_id,
    transactionId: row.transaction_id,
    amount: row.amount,
  }));
};

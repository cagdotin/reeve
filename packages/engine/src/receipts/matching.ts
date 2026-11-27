/**
 * Matching receipts to the bank transactions that pay them: candidates in a date window scored by
 * `scoreMatch` (`contract/src/receipts.ts`), payment links, and auto-matching the sure ones.
 */
import { addDays, daysBetween, dayToInt, intToDay } from "@reeve/contract/rules";
import { isSureMatch, MATCH_WINDOW, scoreMatch } from "@reeve/contract/receipts";
import { and, eq } from "drizzle-orm";
import type { SQLInputValue } from "node:sqlite";
import { invalid, newId, type Book } from "../book.ts";
import { getTransaction } from "../ledger/transactions.ts";
import { loadContext } from "./context.ts";
import { claimsOn, ledgerTransactions, type LedgerTransaction } from "./ledger.ts";
import * as r from "./schema.ts";
import { isApplied, splitLines } from "./split.ts";
import type { MatchCandidate } from "./types.ts";
import { getReceipt, receiptRow, receiptRows, summaries, type ReceiptRow } from "./view.ts";

const paidByReceipt = (book: Book, receiptId: string) =>
  book.db.select().from(r.receiptPayments).where(eq(r.receiptPayments.receiptId, receiptId)).all();

const payeeName = (book: Book, id: string | null) =>
  id === null
    ? null
    : ((
        book.client.prepare("SELECT name FROM payees WHERE id = ?").get(id) as
          | { name: string }
          | undefined
      )?.name ?? null);

/** Transactions with one posting on an asset or liability account dated in the receipt's window. */
const windowTransactions = (book: Book, date: string): Array<LedgerTransaction> => {
  const ids = (
    book.client
      .prepare(
        `SELECT DISTINCT t.id FROM transactions t
         JOIN postings p ON p.transaction_id = t.id JOIN accounts a ON a.id = p.account_id
         WHERE a.type IN ('asset', 'liability') AND t.date BETWEEN ? AND ?`,
      )
      .all(
        dayToInt(addDays(date, -MATCH_WINDOW.before)),
        dayToInt(addDays(date, MATCH_WINDOW.after)),
      ) as Array<{ id: string }>
  ).map((row) => row.id);
  return [...ledgerTransactions(book, ids).values()].filter((each) => each.side !== null);
};

/** Transactions that may pay a receipt, best first. */
export const candidatesFor = (book: Book, receipt: ReceiptRow): Array<MatchCandidate> => {
  const payments = paidByReceipt(book, receipt.id);
  const linked = new Set(payments.map((payment) => payment.transactionId));
  const needed = receipt.total - payments.reduce((total, payment) => total + payment.amount, 0);
  if (needed === 0) return [];
  const transactions = windowTransactions(book, intToDay(receipt.date)).filter(
    (each) => !linked.has(each.id),
  );
  const claims = claimsOn(
    book,
    transactions.map((each) => each.id),
  );
  const storeName = payeeName(book, receipt.payeeId);
  return transactions
    .flatMap((transaction): Array<MatchCandidate> => {
      const side = transaction.side!;
      const claimed = claims
        .filter((claim) => claim.transactionId === transaction.id)
        .reduce((total, claim) => total + claim.amount, 0);
      const days = daysBetween(intToDay(receipt.date), transaction.date);
      const match = scoreMatch(
        {
          amount: needed,
          date: intToDay(receipt.date),
          payeeId: receipt.payeeId,
          payeeName: storeName,
        },
        {
          amount: -side.amount,
          claimed,
          days,
          payeeId: transaction.payeeId,
          payeeNames: [transaction.payee, transaction.importedPayee].filter(
            (name): name is string => name !== null,
          ),
        },
      );
      if (match === null) return [];
      return [
        {
          transactionId: transaction.id,
          date: transaction.date,
          accountId: side.accountId,
          account: side.account,
          payeeId: transaction.payeeId,
          payee: transaction.payee,
          amount: side.amount,
          claimed,
          days,
          score: match.score,
          amountMatch: match.amount,
          sure: isSureMatch(match, days),
          reasons: match.reasons,
        },
      ];
    })
    .toSorted((a, b) => b.score - a.score || Math.abs(a.days) - Math.abs(b.days));
};

export const suggestMatches = (book: Book, id: string, limit = 10) =>
  candidatesFor(book, receiptRow(book, id)).slice(0, limit);

/** Links a transaction to a receipt for an amount (by default what is left, at most what is free). */
export const linkPayment = (
  book: Book,
  input: { readonly receipt: string; readonly transaction: string; readonly amount?: number },
) => {
  const { db } = book;
  const receipt = receiptRow(book, input.receipt);
  getTransaction(db, input.transaction);
  const transaction = ledgerTransactions(book, [input.transaction]).get(input.transaction)!;
  if (transaction.side === null)
    return invalid("A transfer between two accounts cannot pay a receipt");
  const outflow = -transaction.side.amount;
  if (receipt.total !== 0 && Math.sign(outflow) !== Math.sign(receipt.total))
    invalid(
      outflow < 0
        ? "The transaction is money coming in: it can pay only a refund (a negative total)"
        : "The transaction is money going out: it cannot pay a refund",
    );
  const claims = claimsOn(book, [transaction.id]);
  const free =
    outflow -
    claims
      .filter((claim) => claim.receiptId !== receipt.id)
      .reduce((total, claim) => total + claim.amount, 0);
  const left =
    receipt.total -
    paidByReceipt(book, receipt.id)
      .filter((payment) => payment.transactionId !== transaction.id)
      .reduce((total, payment) => total + payment.amount, 0);
  if (input.amount === undefined && Math.sign(left) !== Math.sign(free))
    invalid("Nothing is left to pay on this receipt");
  const amount = input.amount ?? (Math.abs(left) <= Math.abs(free) ? left : free);
  if (!Number.isSafeInteger(amount) || amount === 0) invalid("Nothing is left to pay with it");
  if (Math.sign(amount) !== Math.sign(outflow))
    invalid("A payment goes the way its transaction does: positive for money going out");
  if (Math.abs(amount) > Math.abs(free))
    invalid(`The transaction has only ${free} left that no other receipt claims`);
  const existing = db
    .select()
    .from(r.receiptPayments)
    .where(
      and(
        eq(r.receiptPayments.receiptId, receipt.id),
        eq(r.receiptPayments.transactionId, transaction.id),
      ),
    )
    .get();
  if (existing === undefined)
    db.insert(r.receiptPayments)
      .values({
        id: newId(),
        receiptId: receipt.id,
        transactionId: transaction.id,
        amount,
        createdAt: Date.now(),
      })
      .run();
  else if (existing.amount !== amount)
    db.update(r.receiptPayments).set({ amount }).where(eq(r.receiptPayments.id, existing.id)).run();
  return getReceipt(book, receipt.id);
};

export const unlinkPayment = (
  book: Book,
  input: { readonly receipt: string; readonly transaction: string },
) => {
  receiptRow(book, input.receipt);
  book.db
    .delete(r.receiptPayments)
    .where(
      and(
        eq(r.receiptPayments.receiptId, input.receipt),
        eq(r.receiptPayments.transactionId, input.transaction),
      ),
    )
    .run();
  return getReceipt(book, input.receipt);
};

/**
 * Links each receipt without payments to its one sure candidate; a transaction that is the sure
 * candidate of two receipts is linked to neither.
 */
export const autoMatch = (book: Book, range: { readonly from?: string; readonly to?: string }) => {
  const unpaid = receiptRows(book, range).filter(
    (receipt) => paidByReceipt(book, receipt.id).length === 0 && receipt.total !== 0,
  );
  const proposals = unpaid.map((receipt) => ({
    receipt,
    sure: candidatesFor(book, receipt).filter((candidate) => candidate.sure),
  }));
  const wanted = new Map<string, number>();
  for (const { sure } of proposals)
    if (sure.length === 1)
      wanted.set(sure[0]!.transactionId, (wanted.get(sure[0]!.transactionId) ?? 0) + 1);
  const linked: Array<{ receiptId: string; transactionId: string; amount: number }> = [];
  const ambiguous: Array<{ receiptId: string; transactionIds: Array<string> }> = [];
  const unmatched: Array<string> = [];
  for (const { receipt, sure } of proposals) {
    if (sure.length === 0) unmatched.push(receipt.id);
    else if (sure.length > 1 || wanted.get(sure[0]!.transactionId)! > 1)
      ambiguous.push({
        receiptId: receipt.id,
        transactionIds: sure.map((each) => each.transactionId),
      });
    else {
      linkPayment(book, {
        receipt: receipt.id,
        transaction: sure[0]!.transactionId,
        amount: receipt.total,
      });
      linked.push({
        receiptId: receipt.id,
        transactionId: sure[0]!.transactionId,
        amount: receipt.total,
      });
    }
  }
  return { linked, ambiguous, unmatched };
};

export const transactionReceipts = (book: Book, transactionId: string) => {
  getTransaction(book.db, transactionId);
  const payments = book.db
    .select()
    .from(r.receiptPayments)
    .where(eq(r.receiptPayments.transactionId, transactionId))
    .all();
  const rows = payments.map((payment) => receiptRow(book, payment.receiptId));
  return summaries(book, rows).map((summary, index) => ({
    ...summary,
    paidByTransaction: payments[index]!.amount,
  }));
};

/** Transactions with receipts, for a register to mark, each with whether its split is applied. */
export const transactionsWithReceipts = (
  book: Book,
  input: { readonly account?: string; readonly from?: string; readonly to?: string },
) => {
  const where = ["1 = 1"];
  const params: Array<SQLInputValue> = [];
  if (input.account !== undefined) {
    where.push(
      "EXISTS (SELECT 1 FROM postings p WHERE p.transaction_id = t.id AND p.account_id = ?)",
    );
    params.push(input.account);
  }
  if (input.from !== undefined) {
    where.push("t.date >= ?");
    params.push(dayToInt(input.from));
  }
  if (input.to !== undefined) {
    where.push("t.date <= ?");
    params.push(dayToInt(input.to));
  }
  const rows = book.client
    .prepare(
      `SELECT rp.transaction_id, rp.receipt_id FROM receipt_payments rp
       JOIN transactions t ON t.id = rp.transaction_id
       WHERE ${where.join(" AND ")} ORDER BY t.date DESC, rp.created_at`,
    )
    .all(...params) as Array<{ transaction_id: string; receipt_id: string }>;
  const ids = [...new Set(rows.map((row) => row.transaction_id))];
  const transactions = ledgerTransactions(book, ids);
  const claims = claimsOn(book, ids);
  const lines = splitLines(
    book,
    loadContext(book),
    claims.map((claim) => claim.receiptId),
  );
  return ids.map((id) => {
    const transaction = transactions.get(id);
    return {
      transactionId: id,
      receiptIds: rows.filter((row) => row.transaction_id === id).map((row) => row.receipt_id),
      applied: transaction !== undefined && isApplied(transaction, claims, lines),
    };
  });
};

/** Payments of `from` receipts moved to the transaction `to`, as merge_transactions needs. */
export const movePayments = (book: Book, from: string, to: string) => {
  const { db } = book;
  for (const payment of db
    .select()
    .from(r.receiptPayments)
    .where(eq(r.receiptPayments.transactionId, from))
    .all()) {
    const existing = db
      .select()
      .from(r.receiptPayments)
      .where(
        and(
          eq(r.receiptPayments.receiptId, payment.receiptId),
          eq(r.receiptPayments.transactionId, to),
        ),
      )
      .get();
    if (existing === undefined)
      db.update(r.receiptPayments)
        .set({ transactionId: to })
        .where(eq(r.receiptPayments.id, payment.id))
        .run();
    else {
      db.update(r.receiptPayments)
        .set({ amount: existing.amount + payment.amount })
        .where(eq(r.receiptPayments.id, existing.id))
        .run();
      db.delete(r.receiptPayments).where(eq(r.receiptPayments.id, payment.id)).run();
    }
  }
};

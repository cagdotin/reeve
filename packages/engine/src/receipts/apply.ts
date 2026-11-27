/**
 * Applying a receipt to the ledger: its transactions' category side rewritten, through the
 * ledger's own `updateTransaction`, as one split line per budget category (`planSplit` in
 * `contract/src/receipts.ts` decides the amounts).
 */
import { isPlanApplied, type SplitPlan } from "@reeve/contract/receipts";
import { InvalidRequest } from "@reeve/contract";
import { eq } from "drizzle-orm";
import { invalid, type Book } from "../book.ts";
import { categoryRow } from "../ledger/categories.ts";
import { getTransaction, updateTransaction } from "../ledger/transactions.ts";
import { effectiveBudgetCategory, loadContext, type Context } from "./context.ts";
import { claimsOn, ledgerTransactions, type LedgerTransaction } from "./ledger.ts";
import { linkPayment } from "./matching.ts";
import * as r from "./schema.ts";
import { planFor, splitLines } from "./split.ts";
import type { SplitPreview } from "./types.ts";
import { getReceipt, receiptRow } from "./view.ts";

const REMAINDER_MEMO = "Not on the receipt";

/** The receipt's linked transactions: the one named, or all. */
const linkedTransactions = (book: Book, receiptId: string, transaction: string | undefined) => {
  const linked = book.db
    .select({ transactionId: r.receiptPayments.transactionId })
    .from(r.receiptPayments)
    .where(eq(r.receiptPayments.receiptId, receiptId))
    .all()
    .map((row) => row.transactionId);
  if (transaction !== undefined) {
    if (!linked.includes(transaction))
      invalid("The transaction does not pay this receipt: link it first");
    return [transaction];
  }
  if (linked.length === 0) invalid("No transaction pays this receipt yet: link one first");
  return linked;
};

/** Why a plan failed, naming the lines that have no budget category. */
const failure = (book: Book, context: Context, transactionId: string, reason: string) => {
  const receipts = claimsOn(book, [transactionId]).map((claim) => claim.receiptId);
  const lines = receipts.flatMap((id) =>
    book.db
      .select()
      .from(r.receiptLines)
      .where(eq(r.receiptLines.receiptId, id))
      .all()
      .filter((line) => effectiveBudgetCategory(context, line) === null),
  );
  return lines.length === 0
    ? invalid(reason)
    : invalid(
        `These lines have no budget category; give them one (or their item category one): ${lines
          .map((line) => `${line.position} "${line.text}" (${line.id})`)
          .join(", ")}`,
      );
};

interface Planned {
  readonly transaction: LedgerTransaction;
  readonly plan: Extract<SplitPlan, { ok: true }>;
  readonly receiptIds: ReadonlyArray<string>;
}

/** The category an earlier apply left the remainder on, by its memo. */
const earlierRemainder = (book: Book, transactionId: string): string | null | undefined => {
  const row = book.client
    .prepare(
      "SELECT a.id, a.system FROM postings q JOIN accounts a ON a.id = q.account_id WHERE q.transaction_id = ? AND q.memo = ?",
    )
    .get(transactionId, REMAINDER_MEMO) as { id: string; system: string | null } | undefined;
  return row === undefined ? undefined : row.system === "uncategorized" ? null : row.id;
};

const plan = (
  book: Book,
  context: Context,
  transactionId: string,
  remainderCategory: string | null,
): Planned => {
  const found = ledgerTransactions(book, [transactionId]).get(transactionId)!;
  const transaction =
    found.currentCategory === undefined
      ? { ...found, currentCategory: earlierRemainder(book, transactionId) }
      : found;
  const claims = claimsOn(book, [transactionId]);
  const result = planFor(
    transaction,
    claims,
    splitLines(
      book,
      context,
      claims.map((claim) => claim.receiptId),
    ),
    remainderCategory,
  );
  if (!result.ok) return failure(book, context, transactionId, result.reason);
  return { transaction, plan: result, receiptIds: claims.map((claim) => claim.receiptId) };
};

const preview = (context: Context, { transaction, plan, receiptIds }: Planned): SplitPreview => {
  const name = (id: string | null) =>
    id === null ? "Uncategorized" : (context.budgetCategories.get(id) ?? "");
  return {
    transactionId: transaction.id,
    accountId: transaction.side!.accountId,
    amount: transaction.side!.amount,
    receiptIds,
    splits: [
      ...plan.splits.map((split) => ({
        categoryId: split.categoryId,
        category: name(split.categoryId),
        amount: -split.amount,
      })),
      ...(plan.remainder === null
        ? []
        : [
            {
              categoryId: plan.remainder.categoryId,
              category: name(plan.remainder.categoryId),
              amount: -plan.remainder.amount,
            },
          ]),
    ],
    remainder:
      plan.remainder === null ? null : { ...plan.remainder, amount: -plan.remainder.amount },
    spread: plan.spread,
    applied: isPlanApplied(plan, transaction.counter),
  };
};

const checkRemainder = (book: Book, remainderCategory: string | null | undefined) => {
  if (remainderCategory !== undefined && remainderCategory !== null)
    categoryRow(book.db, remainderCategory);
  return remainderCategory ?? null;
};

export const splitPreview = (
  book: Book,
  input: {
    readonly id: string;
    readonly transaction?: string;
    readonly remainderCategory?: string | null;
  },
): SplitPreview => {
  receiptRow(book, input.id);
  const linked = linkedTransactions(book, input.id, input.transaction);
  if (linked.length > 1) invalid("Several transactions pay this receipt: name one");
  const context = loadContext(book);
  return preview(
    context,
    plan(book, context, linked[0]!, checkRemainder(book, input.remainderCategory)),
  );
};

export const applyReceipt = (
  book: Book,
  input: {
    readonly id: string;
    readonly transaction?: string;
    readonly remainderCategory?: string | null;
  },
) => {
  receiptRow(book, input.id);
  const remainderCategory = checkRemainder(book, input.remainderCategory);
  if (input.transaction !== undefined) {
    getTransaction(book.db, input.transaction);
    const linked = claimsOn(book, [input.transaction]).some(
      (claim) => claim.receiptId === input.id,
    );
    if (!linked) linkPayment(book, { receipt: input.id, transaction: input.transaction });
  }
  const context = loadContext(book);
  const transactions = linkedTransactions(book, input.id, input.transaction).map((id) =>
    write(book, plan(book, context, id, remainderCategory)),
  );
  markApplied(book, input.id, false);
  return { receipt: getReceipt(book, input.id), transactions };
};

const write = (book: Book, { transaction, plan: split }: Planned) =>
  updateTransaction(
    book,
    {
      id: transaction.id,
      account: transaction.side!.accountId,
      splits: [
        ...split.splits.map((line) => ({ category: line.categoryId, amount: -line.amount })),
        ...(split.remainder === null
          ? []
          : [
              {
                category: split.remainder.categoryId,
                amount: -split.remainder.amount,
                memo: REMAINDER_MEMO,
              },
            ]),
      ],
    },
    { learn: false },
  );

const markApplied = (book: Book, id: string, automatically: boolean) =>
  book.db.update(r.receipts).set({ autoApplied: automatically }).where(eq(r.receipts.id, id)).run();

/**
 * Applies a receipt to the one transaction that pays it, as the autoApplyReceipts setting does;
 * false, writing nothing, where a manual apply would refuse.
 */
export const autoApply = (book: Book, id: string, transactionId: string): boolean => {
  let planned: Planned;
  try {
    planned = plan(book, loadContext(book), transactionId, null);
  } catch (error) {
    if (error instanceof InvalidRequest) return false;
    throw error;
  }
  write(book, planned);
  markApplied(book, id, true);
  return true;
};

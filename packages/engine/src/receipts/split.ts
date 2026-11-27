/** The split a transaction gets from the receipts it pays, from the book's rows. */
import { isPlanApplied, planSplit, type SplitPlan } from "@reeve/contract/receipts";
import { asc, inArray } from "drizzle-orm";
import type { Book } from "../book.ts";
import { effectiveBudgetCategory, type Context } from "./context.ts";
import type { Claim, LedgerTransaction } from "./ledger.ts";
import * as r from "./schema.ts";

export type SplitLines = ReadonlyMap<
  string,
  ReadonlyArray<{ readonly budgetCategoryId: string | null; readonly lineTotal: number }>
>;

/** Each receipt's line totals with their effective budget categories. */
export const splitLines = (
  book: Book,
  context: Context,
  receiptIds: ReadonlyArray<string>,
): SplitLines => {
  const unique = [...new Set(receiptIds)];
  const rows =
    unique.length === 0
      ? []
      : book.db
          .select()
          .from(r.receiptLines)
          .where(inArray(r.receiptLines.receiptId, unique))
          .orderBy(asc(r.receiptLines.position))
          .all();
  const byReceipt = Map.groupBy(rows, (row) => row.receiptId);
  return new Map(
    unique.map((id) => [
      id,
      (byReceipt.get(id) ?? []).map((line) => ({
        budgetCategoryId: effectiveBudgetCategory(context, line),
        lineTotal: line.lineTotal,
      })),
    ]),
  );
};

/** The plan for one transaction from every receipt that claims part of it. */
export const planFor = (
  transaction: LedgerTransaction,
  claims: ReadonlyArray<Claim>,
  lines: SplitLines,
  remainderCategory: string | null,
): SplitPlan => {
  if (transaction.side === null)
    return { ok: false, reason: "The transaction is a transfer between two accounts" };
  return planSplit({
    amount: -transaction.side.amount,
    receipts: claims
      .filter((claim) => claim.transactionId === transaction.id)
      .map((claim) => ({
        id: claim.receiptId,
        amount: claim.amount,
        lines: lines.get(claim.receiptId) ?? [],
      })),
    remainderCategory,
    currentCategory: transaction.currentCategory,
  });
};

/** Whether the transaction's postings carry the split its receipts make. */
export const isApplied = (
  transaction: LedgerTransaction,
  claims: ReadonlyArray<Claim>,
  lines: SplitLines,
): boolean => {
  const carries = (remainderCategory: string | null) => {
    const plan = planFor(
      { ...transaction, currentCategory: null },
      claims,
      lines,
      remainderCategory,
    );
    return plan.ok && isPlanApplied(plan, transaction.counter);
  };
  // A tip is spread over the receipt's categories unless applying it named a category for it, and
  // where a remainder went does not matter here, only that it is on one category.
  return carries(null) || carries("any category");
};

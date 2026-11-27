/** Reading receipts: their lines with effective categories, payments, photos, status, warnings. */
import { computedLineTotal, lineMismatch, receiptTotals } from "@reeve/contract/receipts";
import { dayToInt, intToDay, formatAmount } from "@reeve/contract/rules";
import { asc, eq, inArray } from "drizzle-orm";
import type { SQLInputValue } from "node:sqlite";
import { notFound, type Book } from "../book.ts";
import * as t from "../db/schema.ts";
import {
  effectiveBudgetCategory,
  effectiveItemCategory,
  inList,
  loadContext,
  type Context,
  type LineRow,
} from "./context.ts";
import { claimsOn, ledgerTransactions, type Claim, type LedgerTransaction } from "./ledger.ts";
import { photoView } from "./photos.ts";
import * as r from "./schema.ts";
import { isApplied, splitLines, type SplitLines } from "./split.ts";
import type {
  Receipt,
  ReceiptLine,
  ReceiptStatus,
  ReceiptSummary,
  ReceiptUnit,
  ReceiptWarning,
} from "./types.ts";

export type ReceiptRow = typeof r.receipts.$inferSelect;
type AdjustmentRow = typeof r.receiptAdjustments.$inferSelect;
type PaymentRow = typeof r.receiptPayments.$inferSelect;

export const receiptRow = (book: Book, id: string): ReceiptRow =>
  book.db.select().from(r.receipts).where(eq(r.receipts.id, id)).get() ?? notFound("receipt", id);

export const lineView = (context: Context, row: LineRow): ReceiptLine => {
  const budgetCategoryId = effectiveBudgetCategory(context, row);
  return {
    id: row.id,
    receiptId: row.receiptId,
    position: row.position,
    text: row.text,
    code: row.code,
    quantity: row.quantity,
    unit: row.unit as ReceiptUnit | null,
    unitPrice: row.unitPrice,
    lineTotal: row.lineTotal,
    computedTotal: computedLineTotal(row),
    packSize: row.packSize,
    productId: row.productId,
    product: row.productId === null ? null : (context.products.get(row.productId)?.name ?? null),
    itemCategoryId: row.itemCategoryId,
    budgetCategoryId: row.budgetCategoryId,
    notes: row.notes,
    effectiveItemCategoryId: effectiveItemCategory(context, row),
    effectiveBudgetCategoryId: budgetCategoryId,
    effectiveBudgetCategory:
      budgetCategoryId === null ? null : (context.budgetCategories.get(budgetCategoryId) ?? null),
  };
};

/** Everything a set of receipts needs to be read, fetched once. */
interface Loaded {
  readonly context: Context;
  readonly lines: ReadonlyMap<string, ReadonlyArray<LineRow>>;
  readonly adjustments: ReadonlyMap<string, ReadonlyArray<AdjustmentRow>>;
  readonly payments: ReadonlyMap<string, ReadonlyArray<PaymentRow>>;
  readonly payees: ReadonlyMap<string, string>;
  readonly transactions: ReadonlyMap<string, LedgerTransaction>;
  readonly claims: ReadonlyArray<Claim>;
  readonly splitLines: SplitLines;
}

const byReceipt = <A extends { readonly receiptId: string }>(rows: ReadonlyArray<A>) =>
  Map.groupBy(rows, (row) => row.receiptId);

const load = (book: Book, rows: ReadonlyArray<ReceiptRow>, context = loadContext(book)): Loaded => {
  const ids = rows.map((row) => row.id);
  const where = <
    T extends typeof r.receiptLines | typeof r.receiptAdjustments | typeof r.receiptPayments,
  >(
    table: T,
  ) => inArray(table.receiptId, ids);
  const lines =
    ids.length === 0
      ? []
      : book.db
          .select()
          .from(r.receiptLines)
          .where(where(r.receiptLines))
          .orderBy(asc(r.receiptLines.position))
          .all();
  const adjustments =
    ids.length === 0
      ? []
      : book.db
          .select()
          .from(r.receiptAdjustments)
          .where(where(r.receiptAdjustments))
          .orderBy(asc(r.receiptAdjustments.position))
          .all();
  const payments =
    ids.length === 0
      ? []
      : book.db
          .select()
          .from(r.receiptPayments)
          .where(where(r.receiptPayments))
          .orderBy(asc(r.receiptPayments.createdAt))
          .all();
  const transactionIds = payments.map((payment) => payment.transactionId);
  const claims = claimsOn(book, transactionIds);
  const payeeIds = [...new Set(rows.flatMap((row) => (row.payeeId === null ? [] : [row.payeeId])))];
  return {
    context,
    lines: byReceipt(lines),
    adjustments: byReceipt(adjustments),
    payments: byReceipt(payments),
    payees: new Map(
      payeeIds.length === 0
        ? []
        : book.db
            .select({ id: t.payees.id, name: t.payees.name })
            .from(t.payees)
            .where(inArray(t.payees.id, payeeIds))
            .all()
            .map((row) => [row.id, row.name]),
    ),
    transactions: ledgerTransactions(book, transactionIds),
    claims,
    splitLines: splitLines(
      book,
      context,
      claims.map((claim) => claim.receiptId),
    ),
  };
};

const paymentApplied = (loaded: Loaded, transactionId: string) => {
  const transaction = loaded.transactions.get(transactionId);
  return transaction !== undefined && isApplied(transaction, loaded.claims, loaded.splitLines);
};

const statusOf = (loaded: Loaded, row: ReceiptRow): ReceiptStatus => {
  const lines = loaded.lines.get(row.id) ?? [];
  const payments = loaded.payments.get(row.id) ?? [];
  const totals = receiptTotals({
    lines,
    adjustments: loaded.adjustments.get(row.id) ?? [],
    payments,
    total: row.total,
  });
  const uncategorizedLines = lines.filter(
    (line) => effectiveBudgetCategory(loaded.context, line) === null,
  ).length;
  return {
    ...totals,
    categorized: lines.length > 0 && uncategorizedLines === 0,
    applied:
      payments.length > 0 &&
      payments.every((payment) => paymentApplied(loaded, payment.transactionId)),
    lineCount: lines.length,
    unassignedLines: lines.filter((line) => line.productId === null).length,
    uncategorizedLines,
  };
};

const warningsOf = (
  loaded: Loaded,
  row: ReceiptRow,
  status: ReceiptStatus,
): Array<ReceiptWarning> => {
  const warnings: Array<ReceiptWarning> = [];
  for (const line of loaded.lines.get(row.id) ?? []) {
    const difference = lineMismatch(line);
    if (difference !== null)
      warnings.push({
        code: "line_total_mismatch",
        message: `Line ${line.position} "${line.text}": ${formatAmount(line.lineTotal)} given, quantity × unit price is ${formatAmount(line.lineTotal - difference)}`,
        lineId: line.id,
      });
  }
  if (!status.balanced && status.lineCount > 0)
    warnings.push({
      code: "unbalanced",
      message: `Lines and adjustments come to ${formatAmount(status.expectedTotal)}, the total is ${formatAmount(row.total)} (${formatAmount(status.difference)} apart)`,
      lineId: null,
    });
  const paid = loaded.payments.get(row.id)?.length ?? 0;
  if (paid > 0 && status.paidAmount !== row.total)
    warnings.push(
      Math.abs(status.paidAmount) < Math.abs(row.total)
        ? {
            code: "unpaid",
            message: `Payments cover ${formatAmount(status.paidAmount)} of ${formatAmount(row.total)}`,
            lineId: null,
          }
        : {
            code: "overpaid",
            message: `Payments come to ${formatAmount(status.paidAmount)}, more than the total ${formatAmount(row.total)}`,
            lineId: null,
          },
    );
  return warnings;
};

const header = (loaded: Loaded, row: ReceiptRow) => ({
  id: row.id,
  payeeId: row.payeeId,
  payee: row.payeeId === null ? null : (loaded.payees.get(row.payeeId) ?? null),
  date: intToDay(row.date),
  time: row.time,
  total: row.total,
  notes: row.notes,
  externalId: row.externalId,
  createdAt: row.createdAt,
});

export const getReceipt = (book: Book, id: string): Receipt => {
  const row = receiptRow(book, id);
  const loaded = load(book, [row]);
  const status = statusOf(loaded, row);
  return {
    ...header(loaded, row),
    lines: (loaded.lines.get(id) ?? []).map((line) => lineView(loaded.context, line)),
    adjustments: (loaded.adjustments.get(id) ?? []).map((adjustment) => ({
      id: adjustment.id,
      position: adjustment.position,
      kind: adjustment.kind as Receipt["adjustments"][number]["kind"],
      amount: adjustment.amount,
      description: adjustment.description,
    })),
    payments: (loaded.payments.get(id) ?? []).map((payment) => {
      const transaction = loaded.transactions.get(payment.transactionId);
      return {
        transactionId: payment.transactionId,
        amount: payment.amount,
        date: transaction?.date ?? intToDay(row.date),
        accountId: transaction?.side?.accountId ?? null,
        account: transaction?.side?.account ?? null,
        payee: transaction?.payee ?? null,
        transactionAmount: transaction?.side?.amount ?? 0,
        applied: paymentApplied(loaded, payment.transactionId),
      };
    }),
    photos: book.db
      .select()
      .from(r.receiptPhotos)
      .where(eq(r.receiptPhotos.receiptId, id))
      .orderBy(asc(r.receiptPhotos.position))
      .all()
      .map((photo) => photoView(book, photo)),
    status,
    autoApplied: row.autoApplied && status.applied,
    warnings: warningsOf(loaded, row, status),
  };
};

/** Receipts as list rows, in the order given. */
export const summaries = (book: Book, rows: ReadonlyArray<ReceiptRow>): Array<ReceiptSummary> => {
  const loaded = load(book, rows);
  const photoCounts = new Map(
    rows.length === 0
      ? []
      : (
          book.client
            .prepare(
              `SELECT receipt_id, count(*) AS n FROM receipt_photos WHERE receipt_id IN (${inList(rows)}) GROUP BY receipt_id`,
            )
            .all(...rows.map((row) => row.id)) as Array<{ receipt_id: string; n: number }>
        ).map((each) => [each.receipt_id, each.n]),
  );
  return rows.map((row) => ({
    ...header(loaded, row),
    photoCount: photoCounts.get(row.id) ?? 0,
    transactionIds: (loaded.payments.get(row.id) ?? []).map((payment) => payment.transactionId),
    status: statusOf(loaded, row),
  }));
};

export interface ReceiptQuery {
  readonly from?: string;
  readonly to?: string;
  readonly payeeIds?: ReadonlyArray<string>;
  readonly unmatched?: boolean;
  readonly unbalanced?: boolean;
  readonly uncategorized?: boolean;
  readonly unapplied?: boolean;
  readonly query?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/** Receipts rows newest first by the filters SQL can answer. */
export const receiptRows = (book: Book, query: ReceiptQuery): Array<ReceiptRow> => {
  const where: Array<string> = ["1 = 1"];
  const params: Array<SQLInputValue> = [];
  if (query.from !== undefined) {
    where.push("r.date >= ?");
    params.push(dayToInt(query.from));
  }
  if (query.to !== undefined) {
    where.push("r.date <= ?");
    params.push(dayToInt(query.to));
  }
  if (query.payeeIds !== undefined) {
    where.push(`r.payee_id IN (${inList(query.payeeIds)})`);
    params.push(...query.payeeIds);
  }
  if (query.query !== undefined && query.query.trim() !== "") {
    const like = `%${query.query.trim().toLowerCase()}%`;
    where.push(`(lower(coalesce(r.notes, '')) LIKE ? OR lower(coalesce(p.name, '')) LIKE ? OR EXISTS (
      SELECT 1 FROM receipt_lines l WHERE l.receipt_id = r.id
        AND (lower(l.text) LIKE ? OR lower(coalesce(l.code, '')) LIKE ? OR lower(coalesce(l.notes, '')) LIKE ?)))`);
    params.push(like, like, like, like, like);
  }
  const ids = (
    book.client
      .prepare(
        `SELECT r.id FROM receipts r LEFT JOIN payees p ON p.id = r.payee_id
         WHERE ${where.join(" AND ")} ORDER BY r.date DESC, r.created_at DESC, r.id`,
      )
      .all(...params) as Array<{ id: string }>
  ).map((row) => row.id);
  if (ids.length === 0) return [];
  const rows = new Map(
    book.db
      .select()
      .from(r.receipts)
      .where(inArray(r.receipts.id, ids))
      .all()
      .map((row) => [row.id, row]),
  );
  return ids.map((id) => rows.get(id)!);
};

export const listReceipts = (book: Book, query: ReceiptQuery) => {
  let list = summaries(book, receiptRows(book, query));
  if (query.unmatched === true) list = list.filter((each) => !each.status.matched);
  if (query.unbalanced === true) list = list.filter((each) => !each.status.balanced);
  if (query.uncategorized === true) list = list.filter((each) => !each.status.categorized);
  if (query.unapplied === true)
    list = list.filter((each) => each.status.matched && !each.status.applied);
  const offset = query.offset ?? 0;
  return { receipts: list.slice(offset, offset + (query.limit ?? 100)), total: list.length };
};

/** Of these transactions, those an applied receipt has split: its lines decide their categories. */
export const receiptAppliedTransactions = (
  book: Book,
  transactionIds: ReadonlyArray<string>,
): Set<string> => {
  if (transactionIds.length === 0) return new Set();
  const receiptIds = book.db
    .selectDistinct({ id: r.receiptPayments.receiptId })
    .from(r.receiptPayments)
    .where(inArray(r.receiptPayments.transactionId, [...transactionIds]))
    .all()
    .map((row) => row.id);
  if (receiptIds.length === 0) return new Set();
  const loaded = load(
    book,
    book.db.select().from(r.receipts).where(inArray(r.receipts.id, receiptIds)).all(),
  );
  return new Set(transactionIds.filter((id) => paymentApplied(loaded, id)));
};

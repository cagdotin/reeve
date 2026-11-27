/**
 * The book setting `autoApplyReceipts` (docs/rules/purchases.md): after a receipts write, each receipt it
 * left ready (balanced, categorized, paid by exactly one transaction that pays only it) is applied
 * in the same handler call, so the write and the apply are one undo step. A receipt that was ready
 * and not applied before the write is left alone: its transaction was edited by hand, or it was
 * ready before the setting was on, and neither is the setting's to overwrite.
 */
import { FEATURES } from "@reeve/contract/features";
import { eq, inArray } from "drizzle-orm";
import { readSettings, type Book } from "../book.ts";
import { autoApply } from "./apply.ts";
import { inList } from "./context.ts";
import * as r from "./schema.ts";
import { getReceipt, summaries } from "./view.ts";

/** The receipts a write may make ready: these ids, or every receipt. */
export type Touched = ReadonlyArray<string> | "all";

interface State {
  readonly transactionId: string;
  readonly ready: boolean;
  readonly applied: boolean;
}

/** Of the touched receipts, those paid by one transaction that pays no other receipt. */
const soleClaims = (book: Book, touched: Touched): Map<string, string> => {
  if (touched !== "all" && touched.length === 0) return new Map();
  const ids = touched === "all" ? [] : [...new Set(touched)];
  const rows = book.client
    .prepare(
      `SELECT rp.receipt_id, rp.transaction_id FROM receipt_payments rp
       WHERE (SELECT count(*) FROM receipt_payments o WHERE o.receipt_id = rp.receipt_id) = 1
         AND (SELECT count(*) FROM receipt_payments o WHERE o.transaction_id = rp.transaction_id) = 1
         ${touched === "all" ? "" : `AND rp.receipt_id IN (${inList(ids)})`}`,
    )
    .all(...ids) as Array<{ receipt_id: string; transaction_id: string }>;
  return new Map(rows.map((row) => [row.receipt_id, row.transaction_id]));
};

const states = (book: Book, touched: Touched): Map<string, State> => {
  const claims = soleClaims(book, touched);
  if (claims.size === 0) return new Map();
  const rows = book.db
    .select()
    .from(r.receipts)
    .where(inArray(r.receipts.id, [...claims.keys()]))
    .all();
  return new Map(
    summaries(book, rows).map(({ id, status }) => [
      id,
      {
        transactionId: claims.get(id)!,
        ready: status.balanced && status.matched && status.categorized,
        applied: status.applied,
      },
    ]),
  );
};

/** A write's result with the receipts in it read again after applying. */
const refreshed = (book: Book, value: unknown, applied: ReadonlySet<string>): unknown => {
  if (Array.isArray(value)) return value.map((each) => refreshed(book, each, applied));
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  if ("lines" in record && "status" in record && typeof record.id === "string")
    return applied.has(record.id) ? getReceipt(book, record.id) : value;
  if ("receipt" in record) return { ...record, receipt: refreshed(book, record.receipt, applied) };
  return value;
};

/**
 * Runs a receipts write and, with the setting on, applies what it made ready. `touched` names the
 * receipts the write may change, read before it runs; `created` adds those its result names.
 */
export const autoApplying =
  <I, A>(
    touched: (book: Book, input: I) => Touched,
    handler: (book: Book, input: I) => A,
    created: (result: A) => ReadonlyArray<string> = () => [],
  ) =>
  (book: Book, input: I): A => {
    if (!FEATURES.purchases || !readSettings(book.db).autoApplyReceipts)
      return handler(book, input);
    const scope = touched(book, input);
    const before = states(book, scope);
    const result = handler(book, input);
    const after = states(book, scope === "all" ? "all" : [...scope, ...created(result)]);
    const applied = new Set<string>();
    for (const [id, state] of after) {
      if (!state.ready || state.applied) continue;
      const was = before.get(id);
      if (was !== undefined && was.ready && !was.applied) continue;
      if (autoApply(book, id, state.transactionId)) applied.add(id);
    }
    return applied.size === 0 ? result : (refreshed(book, result, applied) as A);
  };

/** The receipt a line is on, if the line exists. */
export const lineReceipt = (book: Book, id: string): Touched =>
  book.db
    .select({ id: r.receiptLines.receiptId })
    .from(r.receiptLines)
    .where(eq(r.receiptLines.id, id))
    .all()
    .map((row) => row.id);

/** The receipt an adjustment is on, if the adjustment exists. */
export const adjustmentReceipt = (book: Book, id: string): Touched =>
  book.db
    .select({ id: r.receiptAdjustments.receiptId })
    .from(r.receiptAdjustments)
    .where(eq(r.receiptAdjustments.id, id))
    .all()
    .map((row) => row.id);

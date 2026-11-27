/** Writing receipts: the header, its lines and its adjustments. */
import { ReceiptInput } from "@reeve/contract/catalog";
import { isUnit, lineAmount } from "@reeve/contract/receipts";
import { dayToInt } from "@reeve/contract/rules";
import { Schema } from "effect";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { invalid, newId, notFound, type Book } from "../book.ts";
import type { Db } from "../db/open.ts";
import * as t from "../db/schema.ts";
import { payeeIdFor } from "../ledger/payees.ts";
import { aliasMatch } from "./aliases.ts";
import { checkBudgetCategory, itemCategoryRow } from "./categories.ts";
import { linkPayment, suggestMatches } from "./matching.ts";
import { trashReceiptFolder } from "./photos.ts";
import * as r from "./schema.ts";
import type { ReceiptLineInput, ReceiptUnit } from "./types.ts";
import { getReceipt, receiptRow } from "./view.ts";

type LineRow = typeof r.receiptLines.$inferSelect;

const ADJUSTMENT_KINDS = new Set([
  "tax",
  "discount",
  "coupon",
  "tip",
  "deposit",
  "fee",
  "rounding",
  "other",
]);

const blankToNull = (value: string | null | undefined) =>
  value === undefined || value === null || value.trim() === "" ? null : value;

const checkAmount = (value: number, what: string) => {
  if (!Number.isSafeInteger(value)) invalid(`${what} is a whole number of minor units`);
};

/** What a receipt says was paid: a purchase or a refund, never nothing. */
const checkTotal = (total: number) => {
  checkAmount(total, "The total");
  if (total === 0) invalid("A receipt's total can't be zero: enter what was paid");
};

const checkPayee = (db: Db, id: string) =>
  db.select({ id: t.payees.id }).from(t.payees).where(eq(t.payees.id, id)).get() ??
  notFound("payee", id);

const checkProduct = (db: Db, id: string) =>
  db.select({ id: r.products.id }).from(r.products).where(eq(r.products.id, id)).get() ??
  notFound("product", id);

/** The store a header names: a payee id, or a name that finds or creates the payee. */
const storeOf = (
  db: Db,
  input: { readonly payee?: string | null; readonly payeeId?: string | null },
): string | null | undefined => {
  if (input.payeeId !== undefined && input.payeeId !== null) {
    checkPayee(db, input.payeeId);
    return input.payeeId;
  }
  if (input.payee !== undefined) return payeeIdFor(db, input.payee);
  return input.payeeId === null ? null : undefined;
};

/** A line as stored: its total computed when not given, its product from an alias when left out. */
const lineValues = (
  db: Db,
  payeeId: string | null,
  input: ReceiptLineInput,
  label: string,
): Omit<LineRow, "id" | "receiptId" | "position"> => {
  if (input.text.trim() === "") invalid(`${label} needs its text`);
  const quantity = input.quantity ?? 1;
  if (!Number.isFinite(quantity)) invalid(`${label}: quantity is a number`);
  const unit = input.unit ?? null;
  if (unit !== null && !isUnit(unit)) invalid(`${label}: unknown unit ${unit}`);
  const unitPrice = input.unitPrice ?? null;
  if (unitPrice !== null && !Number.isFinite(unitPrice)) invalid(`${label}: unitPrice is a number`);
  const lineTotal =
    input.lineTotal ??
    (unitPrice === null
      ? invalid(`${label} "${input.text}" needs lineTotal or unitPrice`)
      : lineAmount(quantity, unitPrice));
  checkAmount(lineTotal, `${label}'s total`);
  const code = blankToNull(input.code);
  let productId = input.productId ?? null;
  let packSize = input.packSize ?? null;
  if (productId !== null) checkProduct(db, productId);
  else if (input.productId === undefined) {
    const match = aliasMatch(db, payeeId, input.text, code);
    if (match !== null) {
      productId = match.productId;
      packSize ??= match.packSize;
    }
  }
  if (packSize !== null && !(packSize > 0)) invalid(`${label}: packSize is more than zero`);
  if (input.itemCategoryId != null) itemCategoryRow(db, input.itemCategoryId);
  checkBudgetCategory(db, input.budgetCategoryId);
  return {
    text: input.text,
    code,
    quantity,
    unit,
    unitPrice,
    lineTotal,
    packSize,
    productId,
    itemCategoryId: input.itemCategoryId ?? null,
    budgetCategoryId: input.budgetCategoryId ?? null,
    notes: blankToNull(input.notes),
  };
};

const lineIds = (db: Db, receiptId: string) =>
  db
    .select({ id: r.receiptLines.id })
    .from(r.receiptLines)
    .where(eq(r.receiptLines.receiptId, receiptId))
    .orderBy(asc(r.receiptLines.position))
    .all()
    .map((row) => row.id);

const renumberLines = (db: Db, ids: ReadonlyArray<string>) =>
  ids.forEach((id, index) =>
    db
      .update(r.receiptLines)
      .set({ position: index + 1 })
      .where(eq(r.receiptLines.id, id))
      .run(),
  );

const insertLines = (
  book: Book,
  receiptId: string,
  lines: ReadonlyArray<ReceiptLineInput>,
  before: string | null = null,
) => {
  const { db } = book;
  const receipt = receiptRow(book, receiptId);
  const existing = lineIds(db, receiptId);
  if (before !== null && !existing.includes(before)) notFound("receipt line", before);
  const added = lines.map((line, index) => {
    const id = newId();
    db.insert(r.receiptLines)
      .values({
        id,
        receiptId,
        position: existing.length + index + 1,
        ...lineValues(db, receipt.payeeId, line, `Line ${existing.length + index + 1}`),
      })
      .run();
    return id;
  });
  if (before !== null) {
    const at = existing.indexOf(before);
    renumberLines(db, [...existing.slice(0, at), ...added, ...existing.slice(at)]);
  }
};

const insertAdjustment = (
  db: Db,
  receiptId: string,
  input: { readonly kind: string; readonly amount: number; readonly description?: string | null },
) => {
  if (!ADJUSTMENT_KINDS.has(input.kind)) invalid(`Unknown adjustment kind ${input.kind}`);
  checkAmount(input.amount, "An adjustment");
  const position =
    (db
      .select({ max: sql<number | null>`max(${r.receiptAdjustments.position})` })
      .from(r.receiptAdjustments)
      .where(eq(r.receiptAdjustments.receiptId, receiptId))
      .get()?.max ?? 0) + 1;
  db.insert(r.receiptAdjustments)
    .values({
      id: newId(),
      receiptId,
      position,
      kind: input.kind,
      amount: input.amount,
      description: blankToNull(input.description),
    })
    .run();
};

const createResult = (book: Book, id: string, created: boolean) => {
  const receipt = getReceipt(book, id);
  return {
    receipt,
    created,
    suggestions: receipt.status.matched ? [] : suggestMatches(book, id, 5),
  };
};

export const createReceipt = (book: Book, input: ReceiptInput) => {
  const { db } = book;
  const externalId = blankToNull(input.externalId);
  if (externalId !== null) {
    const existing = db
      .select({ id: r.receipts.id })
      .from(r.receipts)
      .where(eq(r.receipts.externalId, externalId))
      .get();
    if (existing !== undefined) return createResult(book, existing.id, false);
  }
  checkTotal(input.total);
  const id = newId();
  db.insert(r.receipts)
    .values({
      id,
      payeeId: storeOf(db, input) ?? null,
      date: dayToInt(input.date),
      time: blankToNull(input.time),
      total: input.total,
      notes: blankToNull(input.notes),
      externalId,
      createdAt: Date.now(),
    })
    .run();
  insertLines(book, id, input.lines ?? []);
  for (const adjustment of input.adjustments ?? []) insertAdjustment(db, id, adjustment);
  for (const payment of input.payments ?? [])
    linkPayment(book, {
      receipt: id,
      transaction: payment.transactionId,
      ...(payment.amount === undefined ? {} : { amount: payment.amount }),
    });
  return createResult(book, id, true);
};

const decodeReceipts = Schema.decodeUnknownSync(
  Schema.Union([ReceiptInput, Schema.Array(ReceiptInput)]),
);

export const importReceipts = (
  book: Book,
  input: { readonly path?: string; readonly content?: string },
) => {
  let text: string;
  if (input.path !== undefined) {
    if (input.content !== undefined) invalid("Give a path or content, not both");
    const path = resolve(input.path);
    if (!existsSync(path)) invalid(`${path} does not exist`);
    text = readFileSync(path, "utf8");
  } else if (input.content !== undefined) text = input.content;
  else return invalid("Give a path or content");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return invalid(`Not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  let decoded: ReceiptInput | ReadonlyArray<ReceiptInput>;
  try {
    decoded = decodeReceipts(parsed);
  } catch (error) {
    return invalid(`Not a receipt: ${error instanceof Error ? error.message : String(error)}`);
  }
  const list: ReadonlyArray<ReceiptInput> = Array.isArray(decoded)
    ? decoded
    : [decoded as ReceiptInput];
  return list.map((receipt) => createReceipt(book, receipt));
};

export const updateReceipt = (
  book: Book,
  input: {
    readonly id: string;
    readonly payee?: string | null;
    readonly payeeId?: string | null;
    readonly date?: string;
    readonly time?: string | null;
    readonly total?: number;
    readonly notes?: string | null;
    readonly externalId?: string | null;
  },
) => {
  const { db } = book;
  receiptRow(book, input.id);
  const change: Partial<typeof r.receipts.$inferInsert> = {};
  const store = storeOf(db, input);
  if (store !== undefined) change.payeeId = store;
  if (input.date !== undefined) change.date = dayToInt(input.date);
  if (input.time !== undefined) change.time = blankToNull(input.time);
  if (input.total !== undefined) {
    checkTotal(input.total);
    change.total = input.total;
  }
  if (input.notes !== undefined) change.notes = blankToNull(input.notes);
  if (input.externalId !== undefined) {
    const externalId = blankToNull(input.externalId);
    if (externalId !== null) {
      const other = db
        .select({ id: r.receipts.id })
        .from(r.receipts)
        .where(eq(r.receipts.externalId, externalId))
        .get();
      if (other !== undefined && other.id !== input.id)
        invalid(`Receipt ${other.id} already has externalId ${externalId}`);
    }
    change.externalId = externalId;
  }
  if (Object.keys(change).length > 0)
    db.update(r.receipts).set(change).where(eq(r.receipts.id, input.id)).run();
  return getReceipt(book, input.id);
};

export const deleteReceipt = (book: Book, id: string) => {
  receiptRow(book, id);
  book.db.delete(r.receipts).where(eq(r.receipts.id, id)).run();
  trashReceiptFolder(book, id);
  return { deleted: id };
};

export const addLines = (
  book: Book,
  input: {
    readonly receipt: string;
    readonly lines: ReadonlyArray<ReceiptLineInput>;
    readonly before?: string | null;
  },
) => {
  insertLines(book, input.receipt, input.lines, input.before ?? null);
  return getReceipt(book, input.receipt);
};

export const lineRow = (db: Db, id: string): LineRow =>
  db.select().from(r.receiptLines).where(eq(r.receiptLines.id, id)).get() ??
  notFound("receipt line", id);

export const updateLine = (
  book: Book,
  input: Partial<Omit<ReceiptLineInput, "text">> & { readonly id: string; readonly text?: string },
) => {
  const { db } = book;
  const row = lineRow(db, input.id);
  const receipt = receiptRow(book, row.receiptId);
  const repriced =
    input.lineTotal === undefined &&
    (input.quantity !== undefined || input.unitPrice !== undefined);
  const merged: ReceiptLineInput = {
    text: input.text ?? row.text,
    code: input.code !== undefined ? input.code : row.code,
    quantity: input.quantity ?? row.quantity,
    unit: (input.unit !== undefined ? input.unit : row.unit) as ReceiptUnit | null,
    unitPrice: input.unitPrice !== undefined ? input.unitPrice : row.unitPrice,
    // A new quantity or price with a unit price computes the total again.
    ...(repriced && (input.unitPrice !== undefined ? input.unitPrice : row.unitPrice) !== null
      ? {}
      : { lineTotal: input.lineTotal ?? row.lineTotal }),
    productId: input.productId !== undefined ? input.productId : row.productId,
    itemCategoryId: input.itemCategoryId !== undefined ? input.itemCategoryId : row.itemCategoryId,
    budgetCategoryId:
      input.budgetCategoryId !== undefined ? input.budgetCategoryId : row.budgetCategoryId,
    packSize: input.packSize !== undefined ? input.packSize : row.packSize,
    notes: input.notes !== undefined ? input.notes : row.notes,
  };
  db.update(r.receiptLines)
    .set(lineValues(db, receipt.payeeId, merged, `Line ${row.position}`))
    .where(eq(r.receiptLines.id, row.id))
    .run();
  return getReceipt(book, row.receiptId);
};

export const deleteLines = (
  book: Book,
  input: { readonly receipt: string; readonly ids: ReadonlyArray<string> },
) => {
  const { db } = book;
  receiptRow(book, input.receipt);
  for (const id of input.ids)
    if (lineRow(db, id).receiptId !== input.receipt)
      invalid(`Line ${id} is not on receipt ${input.receipt}`);
  if (input.ids.length > 0)
    db.delete(r.receiptLines)
      .where(inArray(r.receiptLines.id, [...input.ids]))
      .run();
  renumberLines(db, lineIds(db, input.receipt));
  return getReceipt(book, input.receipt);
};

export const reorderLines = (
  book: Book,
  input: { readonly receipt: string; readonly ids: ReadonlyArray<string> },
) => {
  const { db } = book;
  receiptRow(book, input.receipt);
  const existing = lineIds(db, input.receipt);
  for (const id of input.ids)
    if (!existing.includes(id)) invalid(`Line ${id} is not on receipt ${input.receipt}`);
  renumberLines(db, [...new Set([...input.ids, ...existing])]);
  return getReceipt(book, input.receipt);
};

export const addAdjustment = (
  book: Book,
  input: {
    readonly receipt: string;
    readonly kind: string;
    readonly amount: number;
    readonly description?: string | null;
  },
) => {
  receiptRow(book, input.receipt);
  insertAdjustment(book.db, input.receipt, input);
  return getReceipt(book, input.receipt);
};

const adjustmentRow = (db: Db, id: string) =>
  db.select().from(r.receiptAdjustments).where(eq(r.receiptAdjustments.id, id)).get() ??
  notFound("receipt adjustment", id);

export const updateAdjustment = (
  book: Book,
  input: {
    readonly id: string;
    readonly kind?: string;
    readonly amount?: number;
    readonly description?: string | null;
  },
) => {
  const { db } = book;
  const row = adjustmentRow(db, input.id);
  const change: Partial<typeof r.receiptAdjustments.$inferInsert> = {};
  if (input.kind !== undefined) {
    if (!ADJUSTMENT_KINDS.has(input.kind)) invalid(`Unknown adjustment kind ${input.kind}`);
    change.kind = input.kind;
  }
  if (input.amount !== undefined) {
    checkAmount(input.amount, "An adjustment");
    change.amount = input.amount;
  }
  if (input.description !== undefined) change.description = blankToNull(input.description);
  if (Object.keys(change).length > 0)
    db.update(r.receiptAdjustments).set(change).where(eq(r.receiptAdjustments.id, row.id)).run();
  return getReceipt(book, row.receiptId);
};

export const deleteAdjustment = (book: Book, id: string) => {
  const row = adjustmentRow(book.db, id);
  book.db.delete(r.receiptAdjustments).where(eq(r.receiptAdjustments.id, id)).run();
  return getReceipt(book, row.receiptId);
};

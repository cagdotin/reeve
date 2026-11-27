/** Products: things bought, apart from how receipts print them; generic ones above specific. */
import { isUnit, normalizeText } from "@reeve/contract/receipts";
import { eq, inArray } from "drizzle-orm";
import { invalid, newId, notFound, type Book } from "../book.ts";
import { listAliases, moveAliases } from "./aliases.ts";
import { itemCategoryRow } from "./categories.ts";
import {
  itemSubtree,
  loadContext,
  productItemCategory,
  productSubtree,
  type Context,
  type ProductRow,
} from "./context.ts";
import { lastPurchases } from "./prices.ts";
import * as r from "./schema.ts";
import type { Product, ReceiptUnit } from "./types.ts";

type Purchases = ReturnType<typeof lastPurchases>;

const toProduct = (context: Context, purchases: Purchases, row: ProductRow): Product => {
  const last = purchases.last.get(row.id);
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    itemCategoryId: row.itemCategoryId,
    effectiveItemCategoryId: productItemCategory(context, row.id),
    unit: row.unit as ReceiptUnit,
    size: row.size,
    sizeUnit: row.sizeUnit as ReceiptUnit | null,
    notes: row.notes,
    archived: row.archived,
    purchaseCount: purchases.counts.get(row.id) ?? 0,
    lastPrice:
      last === undefined
        ? null
        : {
            date: last.date,
            payeeId: last.payeeId,
            payee: last.payee,
            lineTotal: last.lineTotal,
            quantity: last.quantity,
            unit: last.unit,
            pricePerBase: last.pricePerBase,
          },
  };
};

export const productRow = (book: Book, id: string): ProductRow =>
  book.db.select().from(r.products).where(eq(r.products.id, id)).get() ?? notFound("product", id);

export const productView = (book: Book, id: string): Product => {
  const context = loadContext(book);
  return toProduct(context, lastPurchases(book, context), productRow(book, id));
};

export const listProducts = (
  book: Book,
  input: {
    readonly query?: string;
    readonly itemCategoryId?: string;
    readonly payeeId?: string;
    readonly archived?: boolean;
    readonly limit?: number;
    readonly offset?: number;
  },
) => {
  const context = loadContext(book);
  const purchases = lastPurchases(book, context);
  let rows = [...context.products.values()];
  if (input.archived !== true) rows = rows.filter((row) => !row.archived);
  if (input.query !== undefined && input.query.trim() !== "") {
    const query = normalizeText(input.query);
    const aliased = new Set(
      listAliases(book, {})
        .filter((alias) => !alias.rejected && alias.key.includes(query))
        .map((alias) => alias.productId),
    );
    rows = rows.filter((row) => normalizeText(row.name).includes(query) || aliased.has(row.id));
  }
  if (input.itemCategoryId !== undefined) {
    const subtree = itemSubtree(context, input.itemCategoryId);
    rows = rows.filter((row) => {
      const category = productItemCategory(context, row.id);
      return category !== null && subtree.has(category);
    });
  }
  if (input.payeeId !== undefined) {
    const bought = new Set(
      (
        book.client
          .prepare(
            "SELECT DISTINCT l.product_id FROM receipt_lines l JOIN receipts r ON r.id = l.receipt_id WHERE r.payee_id = ? AND l.product_id IS NOT NULL",
          )
          .all(input.payeeId) as Array<{ product_id: string }>
      ).map((row) => row.product_id),
    );
    rows = rows.filter((row) => bought.has(row.id));
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const offset = input.offset ?? 0;
  return {
    products: rows
      .slice(offset, offset + (input.limit ?? 100))
      .map((row) => toProduct(context, purchases, row)),
    total: rows.length,
  };
};

export const getProduct = (book: Book, id: string) => {
  const context = loadContext(book);
  const purchases = lastPurchases(book, context);
  const row = context.products.get(id) ?? notFound("product", id);
  return {
    ...toProduct(context, purchases, row),
    aliases: listAliases(book, { productId: id }),
    children: [...context.products.values()]
      .filter((each) => each.parentId === id)
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .map((each) => toProduct(context, purchases, each)),
  };
};

interface ProductFields {
  readonly name?: string;
  readonly parentId?: string | null;
  readonly itemCategoryId?: string | null;
  readonly unit?: string;
  readonly size?: number | null;
  readonly sizeUnit?: string | null;
  readonly notes?: string | null;
  readonly archived?: boolean;
}

const checkFields = (book: Book, id: string | null, fields: ProductFields) => {
  if (fields.name !== undefined && fields.name.trim() === "") invalid("A product needs a name");
  if (fields.unit !== undefined && !isUnit(fields.unit)) invalid(`Unknown unit ${fields.unit}`);
  if (fields.sizeUnit != null && !isUnit(fields.sizeUnit))
    invalid(`Unknown unit ${fields.sizeUnit}`);
  if (fields.size != null && !(fields.size > 0)) invalid("A size is more than zero");
  if (fields.itemCategoryId != null) itemCategoryRow(book.db, fields.itemCategoryId);
  if (fields.parentId != null) {
    productRow(book, fields.parentId);
    if (id !== null && productSubtree(loadContext(book), id).has(fields.parentId))
      invalid("A product cannot be under itself or a product under it");
  }
};

const sizeOk = (size: number | null, sizeUnit: string | null) => {
  if ((size === null) !== (sizeUnit === null)) invalid("Give size and sizeUnit together");
};

export const createProduct = (
  book: Book,
  input: ProductFields & { readonly name: string },
): Product => {
  checkFields(book, null, input);
  sizeOk(input.size ?? null, input.sizeUnit ?? null);
  const id = newId();
  book.db
    .insert(r.products)
    .values({
      id,
      name: input.name.trim(),
      parentId: input.parentId ?? null,
      itemCategoryId: input.itemCategoryId ?? null,
      unit: input.unit ?? "piece",
      size: input.size ?? null,
      sizeUnit: input.sizeUnit ?? null,
      notes: input.notes ?? null,
      archived: input.archived ?? false,
      createdAt: Date.now(),
    })
    .run();
  return productView(book, id);
};

export const updateProduct = (
  book: Book,
  input: ProductFields & { readonly id: string },
): Product => {
  const row = productRow(book, input.id);
  checkFields(book, row.id, input);
  const change: Partial<ProductRow> = {};
  if (input.name !== undefined) change.name = input.name.trim();
  if (input.parentId !== undefined) change.parentId = input.parentId;
  if (input.itemCategoryId !== undefined) change.itemCategoryId = input.itemCategoryId;
  if (input.unit !== undefined) change.unit = input.unit;
  if (input.size !== undefined) change.size = input.size;
  if (input.sizeUnit !== undefined) change.sizeUnit = input.sizeUnit;
  if (input.notes !== undefined) change.notes = input.notes;
  if (input.archived !== undefined) change.archived = input.archived;
  sizeOk(
    change.size !== undefined ? change.size : row.size,
    change.sizeUnit !== undefined ? change.sizeUnit : row.sizeUnit,
  );
  if (Object.keys(change).length > 0)
    book.db.update(r.products).set(change).where(eq(r.products.id, row.id)).run();
  return productView(book, row.id);
};

export const deleteProduct = (book: Book, id: string) => {
  const row = productRow(book, id);
  book.db
    .update(r.products)
    .set({ parentId: row.parentId })
    .where(eq(r.products.parentId, id))
    .run();
  book.db.delete(r.products).where(eq(r.products.id, id)).run();
  return { deleted: id };
};

export const mergeProducts = (
  book: Book,
  input: { readonly target: string; readonly merge: ReadonlyArray<string> },
): Product => {
  const target = productRow(book, input.target);
  const others = [...new Set(input.merge)].filter((id) => id !== target.id);
  for (const id of others) productRow(book, id);
  if (others.length === 0) return productView(book, target.id);
  const context = loadContext(book);
  for (const id of others)
    if (productSubtree(context, id).has(target.id))
      invalid("Merge a product into one above it, not into one under it");
  const { db } = book;
  db.update(r.receiptLines)
    .set({ productId: target.id })
    .where(inArray(r.receiptLines.productId, others))
    .run();
  moveAliases(db, others, target.id);
  db.update(r.products)
    .set({ parentId: target.id })
    .where(inArray(r.products.parentId, others))
    .run();
  db.delete(r.products).where(inArray(r.products.id, others)).run();
  return productView(book, target.id);
};

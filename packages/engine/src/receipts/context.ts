/** What reading receipts needs at hand: item categories, products, budget category names. */
import { nearestInTree } from "@reeve/contract/receipts";
import { and, inArray, isNull } from "drizzle-orm";
import type { Book } from "../book.ts";
import * as t from "../db/schema.ts";
import * as r from "./schema.ts";

export type ItemCategoryRow = typeof r.itemCategories.$inferSelect;
export type ProductRow = typeof r.products.$inferSelect;
export type LineRow = typeof r.receiptLines.$inferSelect;

export interface Context {
  readonly itemCategories: ReadonlyMap<string, ItemCategoryRow>;
  readonly products: ReadonlyMap<string, ProductRow>;
  /** Budget categories (expense and income accounts) by id, with their names. */
  readonly budgetCategories: ReadonlyMap<string, string>;
}

export const loadContext = (book: Book): Context => ({
  itemCategories: new Map(
    book.db
      .select()
      .from(r.itemCategories)
      .all()
      .map((row) => [row.id, row]),
  ),
  products: new Map(
    book.db
      .select()
      .from(r.products)
      .all()
      .map((row) => [row.id, row]),
  ),
  budgetCategories: new Map(
    book.db
      .select({ id: t.accounts.id, name: t.accounts.name })
      .from(t.accounts)
      .where(and(inArray(t.accounts.type, ["expense", "income"]), isNull(t.accounts.system)))
      .all()
      .map((row) => [row.id, row.name]),
  ),
});

/** A product's item category, else the nearest parent product's. */
export const productItemCategory = (context: Context, productId: string | null): string | null =>
  nearestInTree(
    productId,
    (id) => context.products.get(id)?.parentId,
    (id) => context.products.get(id)?.itemCategoryId,
  );

/** An item category's budget category, else the nearest ancestor's. */
export const itemBudgetCategory = (
  context: Context,
  itemCategoryId: string | null,
): string | null =>
  nearestInTree(
    itemCategoryId,
    (id) => context.itemCategories.get(id)?.parentId,
    (id) => context.itemCategories.get(id)?.budgetCategoryId,
  );

type LineCategories = Pick<LineRow, "itemCategoryId" | "budgetCategoryId" | "productId">;

export const effectiveItemCategory = (context: Context, line: LineCategories): string | null =>
  line.itemCategoryId ?? productItemCategory(context, line.productId);

export const effectiveBudgetCategory = (context: Context, line: LineCategories): string | null =>
  line.budgetCategoryId ?? itemBudgetCategory(context, effectiveItemCategory(context, line));

/** The ids of an item category and every one under it. */
export const itemSubtree = (context: Context, id: string): Set<string> => {
  const children = Map.groupBy(context.itemCategories.values(), (row) => row.parentId);
  const ids = new Set<string>();
  const visit = (at: string) => {
    if (ids.has(at)) return;
    ids.add(at);
    for (const child of children.get(at) ?? []) visit(child.id);
  };
  visit(id);
  return ids;
};

/** The ids of a product and every product under it. */
export const productSubtree = (context: Context, id: string): Set<string> => {
  const children = Map.groupBy(context.products.values(), (row) => row.parentId);
  const ids = new Set<string>();
  const visit = (at: string) => {
    if (ids.has(at)) return;
    ids.add(at);
    for (const child of children.get(at) ?? []) visit(child.id);
  };
  visit(id);
  return ids;
};

/** The placeholders of `IN (...)` for a list of values in `book.client` SQL. */
export const inList = (values: ReadonlyArray<unknown>) =>
  values.map(() => "?").join(", ") || "NULL";

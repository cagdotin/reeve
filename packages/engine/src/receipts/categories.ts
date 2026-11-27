/**
 * Item categories: what things are (Dairy, Produce, Cleaning), a tree of any depth apart from the
 * budget's categories. Each may name a default budget category, which its subtree inherits.
 */
import { eq, inArray, isNull } from "drizzle-orm";
import { invalid, newId, notFound, type Book } from "../book.ts";
import type { Db } from "../db/open.ts";
import { categoryRow } from "../ledger/categories.ts";
import { reorder } from "../ledger/accounts.ts";
import { itemBudgetCategory, itemSubtree, loadContext } from "./context.ts";
import * as r from "./schema.ts";
import type { ItemCategory } from "./types.ts";

type Row = typeof r.itemCategories.$inferSelect;

/** Every item category in tree order: each followed by its children, siblings by sort order. */
export const listItemCategories = (book: Book): Array<ItemCategory> => {
  const context = loadContext(book);
  const rows = [...context.itemCategories.values()];
  const children = Map.groupBy(
    rows.toSorted((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    (row) =>
      row.parentId !== null && context.itemCategories.has(row.parentId) ? row.parentId : null,
  );
  const visit = (parent: string | null, depth: number): Array<ItemCategory> =>
    (children.get(parent) ?? []).flatMap((row) => [
      {
        id: row.id,
        name: row.name,
        parentId: row.parentId,
        budgetCategoryId: row.budgetCategoryId,
        effectiveBudgetCategoryId: itemBudgetCategory(context, row.id),
        hidden: row.hidden,
        sortOrder: row.sortOrder,
        depth,
      },
      ...visit(row.id, depth + 1),
    ]);
  return visit(null, 0);
};

export const itemCategoryRow = (db: Db, id: string): Row =>
  db.select().from(r.itemCategories).where(eq(r.itemCategories.id, id)).get() ??
  notFound("item category", id);

const findItemCategory = (book: Book, id: string): ItemCategory =>
  listItemCategories(book).find((category) => category.id === id) ?? notFound("item category", id);

/** Throws unless `id` is a budget category (an expense or income category). */
export const checkBudgetCategory = (db: Db, id: string | null | undefined) => {
  if (id !== undefined && id !== null) categoryRow(db, id);
};

const siblingIds = (db: Db, parentId: string | null) =>
  db
    .select()
    .from(r.itemCategories)
    .where(
      parentId === null
        ? isNull(r.itemCategories.parentId)
        : eq(r.itemCategories.parentId, parentId),
    )
    .all()
    .toSorted((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((row) => row.id);

const renumber = (db: Db, ids: ReadonlyArray<string>) =>
  ids.forEach((id, index) =>
    db
      .update(r.itemCategories)
      .set({ sortOrder: index + 1 })
      .where(eq(r.itemCategories.id, id))
      .run(),
  );

export const createItemCategory = (
  book: Book,
  input: {
    readonly name: string;
    readonly parentId?: string | null;
    readonly budgetCategoryId?: string | null;
    readonly before?: string | null;
  },
): ItemCategory => {
  const name = input.name.trim();
  if (name === "") invalid("An item category needs a name");
  const parentId = input.parentId ?? null;
  if (parentId !== null) itemCategoryRow(book.db, parentId);
  checkBudgetCategory(book.db, input.budgetCategoryId);
  const id = newId();
  book.db
    .insert(r.itemCategories)
    .values({
      id,
      name,
      parentId,
      budgetCategoryId: input.budgetCategoryId ?? null,
      createdAt: Date.now(),
    })
    .run();
  renumber(book.db, reorder(siblingIds(book.db, parentId), id, input.before));
  return findItemCategory(book, id);
};

export const updateItemCategory = (
  book: Book,
  input: {
    readonly id: string;
    readonly name?: string;
    readonly hidden?: boolean;
    readonly budgetCategoryId?: string | null;
  },
): ItemCategory => {
  itemCategoryRow(book.db, input.id);
  const change: Partial<Row> = {};
  if (input.name !== undefined) {
    if (input.name.trim() === "") invalid("An item category needs a name");
    change.name = input.name.trim();
  }
  if (input.hidden !== undefined) change.hidden = input.hidden;
  if (input.budgetCategoryId !== undefined) {
    checkBudgetCategory(book.db, input.budgetCategoryId);
    change.budgetCategoryId = input.budgetCategoryId;
  }
  if (Object.keys(change).length > 0)
    book.db.update(r.itemCategories).set(change).where(eq(r.itemCategories.id, input.id)).run();
  return findItemCategory(book, input.id);
};

export const moveItemCategory = (
  book: Book,
  input: {
    readonly id: string;
    readonly parentId?: string | null;
    readonly before?: string | null;
  },
): Array<ItemCategory> => {
  const row = itemCategoryRow(book.db, input.id);
  const parentId =
    input.parentId !== undefined
      ? input.parentId
      : input.before !== undefined && input.before !== null
        ? itemCategoryRow(book.db, input.before).parentId
        : row.parentId;
  if (parentId !== null) {
    itemCategoryRow(book.db, parentId);
    if (itemSubtree(loadContext(book), row.id).has(parentId))
      invalid("An item category cannot move under itself or its children");
  }
  const former = siblingIds(book.db, row.parentId).filter((id) => id !== row.id);
  book.db.update(r.itemCategories).set({ parentId }).where(eq(r.itemCategories.id, row.id)).run();
  renumber(book.db, former);
  renumber(book.db, reorder(siblingIds(book.db, parentId), row.id, input.before));
  return listItemCategories(book);
};

/** Deletes an item category; its children, products and lines move up to its parent. */
export const deleteItemCategory = (book: Book, id: string) => {
  const row = itemCategoryRow(book.db, id);
  const children = siblingIds(book.db, id);
  const siblings = siblingIds(book.db, row.parentId);
  if (children.length > 0) {
    book.db
      .update(r.itemCategories)
      .set({ parentId: row.parentId })
      .where(inArray(r.itemCategories.id, children))
      .run();
    renumber(
      book.db,
      siblings.flatMap((each) => (each === id ? children : [each])),
    );
  }
  book.db
    .update(r.products)
    .set({ itemCategoryId: row.parentId })
    .where(eq(r.products.itemCategoryId, id))
    .run();
  book.db
    .update(r.receiptLines)
    .set({ itemCategoryId: row.parentId })
    .where(eq(r.receiptLines.itemCategoryId, id))
    .run();
  book.db.delete(r.itemCategories).where(eq(r.itemCategories.id, id)).run();
  return { deleted: id };
};

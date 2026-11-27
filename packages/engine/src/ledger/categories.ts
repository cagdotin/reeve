import type { Category, CategoryGroup } from "@reeve/contract";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { invalid, newId, notFound, notesOf, readSettings, type Book } from "../book.ts";
import type { Db } from "../db/open.ts";
import * as t from "../db/schema.ts";
import { reorder } from "./accounts.ts";
import { dropFromRules, moveInRules } from "./rule-references.ts";

type GroupRow = typeof t.categoryGroups.$inferSelect;
type AccountRow = typeof t.accounts.$inferSelect;

const categoryRows = (db: Db) =>
  db
    .select()
    .from(t.accounts)
    .where(and(inArray(t.accounts.type, ["income", "expense"]), sql`${t.accounts.system} IS NULL`))
    .orderBy(asc(t.accounts.sortOrder))
    .all();

const toCategory = (row: AccountRow, notes: Map<string, string>): Category => ({
  id: row.id,
  name: row.name,
  groupId: row.groupId!,
  parentId: row.parentId,
  isIncome: row.type === "income",
  hidden: row.hidden,
  sortOrder: row.sortOrder,
  notes: notes.get(row.id) ?? null,
  description: row.description,
});

const cleanDescription = (description: string | null) => description?.trim() || null;

/** A group's categories in tree order: each one followed by its subcategories. */
const treeOrder = (rows: ReadonlyArray<AccountRow>): Array<AccountRow> => {
  const ids = new Set(rows.map((row) => row.id));
  const children = Map.groupBy(rows, (row) =>
    row.parentId !== null && ids.has(row.parentId) ? row.parentId : null,
  );
  const visit = (parent: string | null): Array<AccountRow> =>
    (children.get(parent) ?? []).flatMap((row) => [row, ...visit(row.id)]);
  return visit(null);
};

/** The groups in budget order, the income group last, each with its categories in tree order. */
export const listCategories = (book: Book): Array<CategoryGroup> => {
  const notes = notesOf(book.db);
  const categories = new Map(
    [...Map.groupBy(categoryRows(book.db), (row) => row.groupId)].map(([id, rows]) => [
      id,
      treeOrder(rows),
    ]),
  );
  return book.db
    .select()
    .from(t.categoryGroups)
    .orderBy(asc(t.categoryGroups.isIncome), asc(t.categoryGroups.sortOrder))
    .all()
    .map((group) => ({
      id: group.id,
      name: group.name,
      isIncome: group.isIncome,
      hidden: group.hidden,
      sortOrder: group.sortOrder,
      notes: notes.get(group.id) ?? null,
      description: group.description,
      categories: (categories.get(group.id) ?? []).map((row) => toCategory(row, notes)),
    }));
};

const groupRow = (db: Db, id: string): GroupRow =>
  db.select().from(t.categoryGroups).where(eq(t.categoryGroups.id, id)).get() ??
  notFound("category group", id);

export const categoryRow = (db: Db, id: string): AccountRow => {
  const row = db.select().from(t.accounts).where(eq(t.accounts.id, id)).get();
  if (row === undefined || row.system !== null || (row.type !== "expense" && row.type !== "income"))
    return notFound("category", id);
  return row;
};

const findGroup = (book: Book, id: string) =>
  listCategories(book).find((group) => group.id === id) ?? notFound("category group", id);

export const createCategoryGroup = (
  book: Book,
  input: {
    readonly name: string;
    readonly isIncome?: boolean;
    readonly description?: string | null;
  },
): CategoryGroup => {
  const id = newId();
  const max =
    book.db
      .select({ max: sql<number | null>`max(${t.categoryGroups.sortOrder})` })
      .from(t.categoryGroups)
      .get()?.max ?? 0;
  book.db
    .insert(t.categoryGroups)
    .values({
      id,
      name: input.name.trim(),
      isIncome: input.isIncome ?? false,
      sortOrder: max + 1,
      description: cleanDescription(input.description ?? null),
    })
    .run();
  return findGroup(book, id);
};

export const updateCategoryGroup = (
  book: Book,
  input: {
    readonly id: string;
    readonly name?: string;
    readonly hidden?: boolean;
    readonly description?: string | null;
  },
): CategoryGroup => {
  groupRow(book.db, input.id);
  const change: Partial<GroupRow> = {};
  if (input.name !== undefined) change.name = input.name.trim();
  if (input.hidden !== undefined) change.hidden = input.hidden;
  if (input.description !== undefined) change.description = cleanDescription(input.description);
  if (Object.keys(change).length > 0)
    book.db.update(t.categoryGroups).set(change).where(eq(t.categoryGroups.id, input.id)).run();
  return findGroup(book, input.id);
};

export const moveCategoryGroup = (
  book: Book,
  input: { readonly id: string; readonly before?: string | null },
): Array<CategoryGroup> => {
  groupRow(book.db, input.id);
  const ids = listCategories(book).map((group) => group.id);
  reorder(ids, input.id, input.before).forEach((id, index) =>
    book.db
      .update(t.categoryGroups)
      .set({ sortOrder: index + 1 })
      .where(eq(t.categoryGroups.id, id))
      .run(),
  );
  return listCategories(book);
};

const hasActivity = (db: Db, categoryId: string) =>
  db
    .select({ id: t.postings.id })
    .from(t.postings)
    .where(sql`${t.postings.accountId} = ${categoryId} OR ${t.postings.categoryId} = ${categoryId}`)
    .get() !== undefined;

/** Moves a category's postings and budgets to another category, adding budgets month by month. */
const transferCategory = (db: Db, from: string, to: string) => {
  const target = categoryRow(db, to);
  const source = categoryRow(db, from);
  if (target.type !== source.type)
    invalid("Transfer to a category of the same kind, income or expense");
  db.update(t.postings).set({ accountId: to }).where(eq(t.postings.accountId, from)).run();
  db.update(t.postings).set({ categoryId: to }).where(eq(t.postings.categoryId, from)).run();
  const budgets = db.select().from(t.budgets).where(eq(t.budgets.categoryId, from)).all();
  for (const row of budgets) {
    db.insert(t.budgets)
      .values({ ...row, categoryId: to })
      .onConflictDoUpdate({
        target: [t.budgets.budgetType, t.budgets.month, t.budgets.categoryId],
        set: { amount: sql`${t.budgets.amount} + ${row.amount}` },
      })
      .run();
  }
};

const removeCategory = (db: Db, id: string, transferTo: string | undefined) => {
  if (transferTo !== undefined) {
    transferCategory(db, id, transferTo);
    moveInRules(db, "category", new Set([id]), transferTo);
  } else {
    if (hasActivity(db, id))
      invalid("The category has transactions: name transferCategory to move them to");
    dropFromRules(db, "category", new Set([id]));
  }
  db.delete(t.budgets).where(eq(t.budgets.categoryId, id)).run();
  db.delete(t.notes).where(eq(t.notes.id, id)).run();
  db.delete(t.accounts).where(eq(t.accounts.id, id)).run();
};

export const deleteCategoryGroup = (
  book: Book,
  input: { readonly id: string; readonly transferCategory?: string },
) => {
  groupRow(book.db, input.id);
  const members = categoryRows(book.db).filter((row) => row.groupId === input.id);
  if (
    input.transferCategory !== undefined &&
    members.some((row) => row.id === input.transferCategory)
  )
    invalid("Transfer to a category outside the group being deleted");
  book.db.update(t.accounts).set({ parentId: null }).where(eq(t.accounts.groupId, input.id)).run();
  for (const member of members) removeCategory(book.db, member.id, input.transferCategory);
  dropFromRules(book.db, "category_group", new Set([input.id]));
  book.db.delete(t.notes).where(eq(t.notes.id, input.id)).run();
  book.db.delete(t.categoryGroups).where(eq(t.categoryGroups.id, input.id)).run();
  return { deleted: input.id };
};

const renumber = (db: Db, ids: ReadonlyArray<string>) =>
  ids.forEach((id, index) =>
    db
      .update(t.accounts)
      .set({ sortOrder: index + 1 })
      .where(eq(t.accounts.id, id))
      .run(),
  );

/** The categories under one parent of a group (its top level when parent is null), in order. */
const siblingIds = (db: Db, groupId: string, parent: string | null) =>
  categoryRows(db)
    .filter((row) => row.groupId === groupId && row.parentId === parent)
    .map((row) => row.id);

const maxDepth = (book: Book) => readSettings(book.db).categoryDepth;

/** How many levels down a category sits: 1 at the top of its group. */
const depthOf = (db: Db, id: string): number => {
  const parents = new Map(categoryRows(db).map((row) => [row.id, row.parentId]));
  let depth = 0;
  for (let at: string | null | undefined = id; at != null; at = parents.get(at)) depth += 1;
  return depth;
};

/** A category and every category under it. */
const subtreeOf = (db: Db, id: string): Array<string> => {
  const children = Map.groupBy(categoryRows(db), (row) => row.parentId);
  const visit = (at: string): Array<string> => [
    at,
    ...(children.get(at) ?? []).flatMap((row) => visit(row.id)),
  ];
  return visit(id);
};

/** How many levels a category's subtree spans: 1 for a category without subcategories. */
const heightOf = (db: Db, id: string): number => {
  const children = Map.groupBy(categoryRows(db), (row) => row.parentId);
  const visit = (at: string): number =>
    1 + Math.max(0, ...(children.get(at) ?? []).map((row) => visit(row.id)));
  return visit(id);
};

/** The deepest nesting among the book's categories: 0 without categories, 1 when flat. */
export const deepestNesting = (book: Book): number =>
  Math.max(0, ...categoryRows(book.db).map((row) => depthOf(book.db, row.id)));

/** Checks a categoryDepth setting against the categories the book has. */
export const checkCategoryDepth = (book: Book, depth: number) => {
  if (!Number.isInteger(depth) || depth < 1)
    invalid("categoryDepth is a whole number of levels, at least 1");
  const deepest = deepestNesting(book);
  if (depth < deepest)
    invalid(
      `Categories nest ${deepest} levels deep; move subcategories up before lowering categoryDepth to ${depth}`,
    );
};

const parentRow = (db: Db, id: string): AccountRow => {
  const row = db.select().from(t.accounts).where(eq(t.accounts.id, id)).get();
  if (row !== undefined && row.system !== null)
    invalid("A system account cannot hold subcategories");
  return categoryRow(db, id);
};

const tooDeep = (depth: number) =>
  invalid(`Categories nest at most ${depth} level${depth === 1 ? "" : "s"} deep in this book`);

export const createCategory = (
  book: Book,
  input: {
    readonly name: string;
    readonly groupId?: string;
    readonly parent?: string | null;
    readonly before?: string | null;
    readonly description?: string | null;
  },
): Category => {
  const parent =
    input.parent === undefined || input.parent === null ? null : parentRow(book.db, input.parent);
  if (parent !== null && input.groupId !== undefined && input.groupId !== parent.groupId)
    invalid("A subcategory stays in its parent's group");
  const groupId = parent?.groupId ?? input.groupId;
  if (groupId === undefined || groupId === null) return invalid("Name a group or a parent");
  const group = groupRow(book.db, groupId);
  if (parent !== null && depthOf(book.db, parent.id) + 1 > maxDepth(book)) tooDeep(maxDepth(book));
  const id = newId();
  book.db
    .insert(t.accounts)
    .values({
      id,
      name: input.name.trim(),
      type: group.isIncome ? "income" : "expense",
      groupId: group.id,
      parentId: parent?.id ?? null,
      description: cleanDescription(input.description ?? null),
      createdAt: Date.now(),
    })
    .run();
  renumber(book.db, reorder(siblingIds(book.db, group.id, parent?.id ?? null), id, input.before));
  return toCategory(categoryRow(book.db, id), notesOf(book.db));
};

export const updateCategory = (
  book: Book,
  input: {
    readonly id: string;
    readonly name?: string;
    readonly hidden?: boolean;
    readonly description?: string | null;
  },
): Category => {
  categoryRow(book.db, input.id);
  const change: Partial<AccountRow> = {};
  if (input.name !== undefined) change.name = input.name.trim();
  if (input.hidden !== undefined) change.hidden = input.hidden;
  if (input.description !== undefined) change.description = cleanDescription(input.description);
  if (Object.keys(change).length > 0)
    book.db.update(t.accounts).set(change).where(eq(t.accounts.id, input.id)).run();
  return toCategory(categoryRow(book.db, input.id), notesOf(book.db));
};

/**
 * Where a move puts a category: under `parent` when given; without it, beside `before`, else
 * under its current parent while it stays in its group, else at the top of the new group.
 */
const moveTarget = (
  db: Db,
  category: AccountRow,
  input: {
    readonly groupId?: string;
    readonly parent?: string | null;
    readonly before?: string | null;
  },
): string | null => {
  if (input.parent !== undefined) return input.parent;
  if (input.before !== undefined && input.before !== null)
    return categoryRow(db, input.before).parentId;
  return input.groupId === undefined || input.groupId === category.groupId
    ? category.parentId
    : null;
};

export const moveCategory = (
  book: Book,
  input: {
    readonly id: string;
    readonly groupId?: string;
    readonly parent?: string | null;
    readonly before?: string | null;
  },
): Array<CategoryGroup> => {
  const category = categoryRow(book.db, input.id);
  const target = moveTarget(book.db, category, input);
  const parent = target === null ? null : parentRow(book.db, target);
  const subtree = subtreeOf(book.db, category.id);
  if (parent !== null) {
    if (subtree.includes(parent.id))
      invalid("A category cannot move under itself or its subcategories");
    if (parent.type !== category.type)
      invalid("A subcategory is of its parent's kind, income or expense");
    if (input.groupId !== undefined && input.groupId !== parent.groupId)
      invalid("A subcategory stays in its parent's group");
  }
  const group = groupRow(book.db, parent?.groupId ?? input.groupId ?? category.groupId!);
  if (group.isIncome !== (category.type === "income"))
    invalid("Income categories stay in the income group, and expense ones outside it");
  const depth = parent === null ? 0 : depthOf(book.db, parent.id);
  if (depth + heightOf(book.db, category.id) > maxDepth(book)) tooDeep(maxDepth(book));
  const formerSiblings = siblingIds(book.db, category.groupId!, category.parentId);
  book.db
    .update(t.accounts)
    .set({ parentId: parent?.id ?? null })
    .where(eq(t.accounts.id, category.id))
    .run();
  if (group.id !== category.groupId)
    book.db
      .update(t.accounts)
      .set({ groupId: group.id })
      .where(inArray(t.accounts.id, subtree))
      .run();
  renumber(
    book.db,
    formerSiblings.filter((id) => id !== category.id),
  );
  renumber(
    book.db,
    reorder(siblingIds(book.db, group.id, parent?.id ?? null), category.id, input.before),
  );
  return listCategories(book);
};

export const deleteCategory = (
  book: Book,
  input: { readonly id: string; readonly transferCategory?: string },
) => {
  const category = categoryRow(book.db, input.id);
  if (input.transferCategory === input.id) invalid("A category cannot transfer to itself");
  const children = siblingIds(book.db, category.groupId!, category.id);
  const siblings = siblingIds(book.db, category.groupId!, category.parentId);
  if (children.length > 0) {
    book.db
      .update(t.accounts)
      .set({ parentId: category.parentId })
      .where(inArray(t.accounts.id, children))
      .run();
    renumber(
      book.db,
      siblings.flatMap((id) => (id === category.id ? children : [id])),
    );
  }
  removeCategory(book.db, input.id, input.transferCategory);
  return { deleted: input.id };
};

/** The default categories of a new Actual budget; opening balances go to equity instead. */
export const createDefaultCategories = (book: Book) => {
  const groups: ReadonlyArray<readonly [string, boolean, ReadonlyArray<string>]> = [
    ["Usual Expenses", false, ["Food", "General", "Bills", "Bills (Flexible)"]],
    ["Investments and Savings", false, ["Savings"]],
    ["Income", true, ["Income"]],
  ];
  for (const [name, isIncome, categories] of groups) {
    const group = createCategoryGroup(book, { name, isIncome });
    for (const category of categories) createCategory(book, { name: category, groupId: group.id });
  }
};

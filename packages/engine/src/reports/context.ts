import { readSettings, type Book } from "../book.ts";

/** The book's first day of the week, 0 for Sunday. */
export const firstDayOfWeek = (book: Book): number => readSettings(book.db).firstDayOfWeek;

export interface CategoryRow {
  readonly id: string;
  readonly name: string;
  readonly hidden: number;
  readonly group_id: string;
  readonly group_name: string;
  readonly group_hidden: number;
  readonly is_income: number;
  readonly parent_id: string | null;
}

/** Rows sorted by group and sibling order, put in tree order: each followed by its subtree. */
const inTreeOrder = (rows: ReadonlyArray<CategoryRow>): Array<CategoryRow> => {
  const ids = new Set(rows.map((row) => row.id));
  const children = Map.groupBy(rows, (row) =>
    row.parent_id !== null && ids.has(row.parent_id) ? row.parent_id : null,
  );
  const visit = (parent: string | null): Array<CategoryRow> =>
    (children.get(parent) ?? []).flatMap((row) => [row, ...visit(row.id)]);
  return visit(null);
};

/** The budget's categories in the order the budget shows them: expense groups first. */
export const categoryRows = (book: Book): Array<CategoryRow> =>
  inTreeOrder(
    book.client
      .prepare(
        `SELECT c.id, c.name, c.hidden, g.id AS group_id, g.name AS group_name, g.hidden AS group_hidden,
           g.is_income, c.parent_id
         FROM accounts c JOIN category_groups g ON g.id = c.group_id
         WHERE c.type IN ('expense', 'income') AND c.system IS NULL
         ORDER BY g.is_income, g.sort_order, g.name, c.sort_order, c.name`,
      )
      .all() as unknown as Array<CategoryRow>,
  );

export const groupRows = (book: Book) =>
  book.client
    .prepare(
      "SELECT id, name, hidden, is_income FROM category_groups ORDER BY is_income, sort_order, name",
    )
    .all() as unknown as Array<{ id: string; name: string; hidden: number; is_income: number }>;

interface CategoryCondition {
  readonly field: string;
  readonly op: string;
  readonly value?: unknown;
}

const isCategoryCondition = (condition: CategoryCondition) =>
  condition.field === "category" || condition.field === "category_group";

/** Whether a category condition can be checked on the categories alone (Actual's rule). */
export const isSupportedCategoryCondition = (condition: CategoryCondition): boolean => {
  if (!isCategoryCondition(condition)) return false;
  if (["is", "isNot", "contains", "doesNotContain", "matches"].includes(condition.op))
    return typeof condition.value === "string";
  if (condition.op === "oneOf" || condition.op === "notOneOf")
    return Array.isArray(condition.value) && condition.value.every((id) => typeof id === "string");
  return false;
};

/**
 * The categories the category conditions keep, as Actual's `filterCategoriesByConditions`: all of
 * them when there are none, or when one cannot be checked on the categories alone.
 */
export const filterCategoriesByConditions = <C extends CategoryRow>(
  categories: ReadonlyArray<C>,
  conditions: ReadonlyArray<CategoryCondition> | undefined,
  op: "and" | "or" | undefined,
): Array<C> => {
  const relevant = (conditions ?? []).filter(isCategoryCondition);
  if (relevant.length === 0 || !relevant.every(isSupportedCategoryCondition))
    return [...categories];
  const matches = (category: C, condition: CategoryCondition) => {
    const key = condition.field === "category_group" ? category.group_id : category.id;
    const text = condition.field === "category_group" ? category.group_name : category.name;
    const value = condition.value;
    switch (condition.op) {
      case "is":
        return key === value;
      case "isNot":
        return key !== value;
      case "oneOf":
        return (value as Array<string>).includes(key);
      case "notOneOf":
        return !(value as Array<string>).includes(key);
      case "contains":
        return text.toLowerCase().includes(String(value).toLowerCase());
      case "doesNotContain":
        return !text.toLowerCase().includes(String(value).toLowerCase());
      case "matches":
        try {
          return String(value).length <= 256 && new RegExp(String(value), "i").test(text);
        } catch {
          return false;
        }
      default:
        return true;
    }
  };
  return categories.filter((category) =>
    op === "or"
      ? relevant.some((condition) => matches(category, condition))
      : relevant.every((condition) => matches(category, condition)),
  );
};

/** What each category is budgeted per month, for the book's budget type. */
export const budgetedRows = (book: Book, from: number, to: number) =>
  book.client
    .prepare(
      `SELECT month, category_id, amount FROM budgets
       WHERE budget_type = ? AND month >= ? AND month <= ? AND amount != 0`,
    )
    .all(readSettings(book.db).budgetType, from, to) as unknown as Array<{
    month: number;
    category_id: string;
    amount: number;
  }>;

import type { BudgetMonth, BudgetType, BudgetView, CategoryGroup } from "@reeve/contract";
import {
  addMonths,
  budgetRange,
  computeBudget,
  currentMonth,
  intToMonth,
  monthRange,
  monthToInt,
  rollUpCategories,
  type MonthResult,
} from "@reeve/contract/rules";
import { and, eq } from "drizzle-orm";
import { notesOf, readSettings, type Book } from "../book.ts";
import * as t from "../db/schema.ts";
import { listCategories } from "../ledger/categories.ts";

/** Postings of transactions that touch a budget account: only those move the budget. */
export const IN_BUDGET = `EXISTS (
  SELECT 1 FROM postings q JOIN accounts b ON b.id = q.account_id
  WHERE q.transaction_id = p.transaction_id AND b.on_budget = 1)`;

interface Amounts {
  readonly get: (month: string, id: string) => number;
}

const keyed = (rows: ReadonlyArray<{ month: number; id: string; amount: number }>): Amounts => {
  const map = new Map(rows.map((row) => [`${row.month}:${row.id}`, row.amount]));
  return { get: (month, id) => map.get(`${monthToInt(month)}:${id}`) ?? 0 };
};

/** Each category's activity per month: spending negative, income positive. */
const activityOf = (book: Book): Amounts =>
  keyed(
    book.client
      .prepare(
        `SELECT month, id, sum(amount) AS amount FROM (
           SELECT t.date / 100 AS month, p.account_id AS id, -p.amount AS amount
           FROM postings p JOIN transactions t ON t.id = p.transaction_id
           JOIN accounts a ON a.id = p.account_id
           WHERE a.type IN ('expense', 'income') AND a.system IS NULL AND ${IN_BUDGET}
           UNION ALL
           SELECT t.date / 100, p.category_id, -p.amount
           FROM postings p JOIN transactions t ON t.id = p.transaction_id
           JOIN accounts a ON a.id = p.account_id
           WHERE p.category_id IS NOT NULL AND a.on_budget = 0 AND ${IN_BUDGET}
         ) GROUP BY month, id`,
      )
      .all() as Array<{ month: number; id: string; amount: number }>,
  );

/**
 * Money into the budget that no category counts, per month: opening balances (equity) and
 * transfers from off-budget accounts without a category; transfers out are negative.
 */
const otherIncomeOf = (book: Book): ((month: string) => number) => {
  const rows = book.client
    .prepare(
      `SELECT t.date / 100 AS month, -sum(p.amount) AS amount
       FROM postings p JOIN transactions t ON t.id = p.transaction_id
       JOIN accounts a ON a.id = p.account_id
       WHERE ((a.type IN ('asset', 'liability') AND a.on_budget = 0 AND p.category_id IS NULL)
              OR a.type = 'equity') AND ${IN_BUDGET}
       GROUP BY month`,
    )
    .all() as Array<{ month: number; amount: number }>;
  const map = new Map(rows.map((row) => [row.month, row.amount]));
  return (month) => map.get(monthToInt(month)) ?? 0;
};

/**
 * Whether a category rolls over in a month: as its latest row says, so that a month past those
 * set_carryover wrote, which the calendar reaches later, goes on as the one before.
 */
export const carryoverFrom = (
  rows: ReadonlyArray<{
    readonly month: number;
    readonly categoryId: string;
    readonly carryover: boolean;
  }>,
) => {
  const byCategory = Map.groupBy(
    rows.toSorted((a, b) => a.month - b.month),
    (row) => row.categoryId,
  );
  return (month: string, category: string): boolean => {
    const at = monthToInt(month);
    return byCategory.get(category)?.findLast((row) => row.month <= at)?.carryover ?? false;
  };
};

const budgetRows = (book: Book, type: BudgetType) =>
  book.db.select().from(t.budgets).where(eq(t.budgets.budgetType, type)).all();

/** The months a book's budget offers, from its first transaction to a year ahead or more. */
export const rangeOf = (book: Book, type: BudgetType) => {
  const first = book.client.prepare("SELECT min(date) / 100 AS month FROM transactions").get() as {
    month: number | null;
  };
  const allocated = book.client
    .prepare(
      `SELECT max(b.month) AS month FROM budgets b JOIN accounts c ON c.id = b.category_id
       WHERE b.budget_type = ? AND b.amount != 0`,
    )
    .get(type) as { month: number | null };
  const now = currentMonth();
  return budgetRange(
    first.month === null ? now : intToMonth(first.month),
    now,
    allocated.month === null ? null : intToMonth(allocated.month),
  );
};

export interface Computed {
  readonly type: BudgetType;
  readonly range: { readonly start: string; readonly end: string };
  readonly months: ReadonlyMap<string, MonthResult>;
  readonly goals: (
    month: string,
    category: string,
  ) => { goal: number | null; longGoal: number | null };
}

/** Computes every month of the budget from the start of its range through `until`. */
export const computeMonths = (book: Book, until?: string): Computed => {
  const type = readSettings(book.db).budgetType;
  const range = rangeOf(book, type);
  const last = until !== undefined && until > range.end ? until : range.end;
  const rows = budgetRows(book, type);
  const budgeted = keyed(
    rows.map((row) => ({ month: row.month, id: row.categoryId, amount: row.amount })),
  );
  const carry = carryoverFrom(rows);
  const goals = new Map(rows.map((row) => [`${row.month}:${row.categoryId}`, row]));
  const holds = new Map(
    book.db
      .select()
      .from(t.budgetMonths)
      .where(eq(t.budgetMonths.budgetType, type))
      .all()
      .map((row) => [row.month, row.hold]),
  );
  const activity = activityOf(book);
  const groups = listCategories(book);
  const results = computeBudget({
    type,
    months: monthRange(range.start, last),
    groups: groups.map((group) => ({
      id: group.id,
      isIncome: group.isIncome,
      categories: group.categories.map((category) => ({
        id: category.id,
        isIncome: category.isIncome,
      })),
    })),
    activity: activity.get,
    otherIncome: otherIncomeOf(book),
    budgeted: budgeted.get,
    carryover: carry,
    hold: (month) => holds.get(monthToInt(month)) ?? 0,
  });
  return {
    type,
    range,
    months: new Map(results.map((result) => [result.month, result])),
    goals: (month, id) => {
      const row = goals.get(`${monthToInt(month)}:${id}`);
      return { goal: row?.goal ?? null, longGoal: row?.longGoal ?? null };
    },
  };
};

/** One computed month; a month before the range is empty. */
export const monthOf = (computed: Computed, month: string): MonthResult | undefined =>
  computed.months.get(month);

export const getBudget = (
  book: Book,
  input: { readonly month?: string; readonly count?: number },
): BudgetView => {
  const first = input.month ?? currentMonth();
  const count = Math.min(12, Math.max(1, input.count ?? 1));
  const months = monthRange(first, addMonths(first, count - 1));
  const computed = computeMonths(book, months.at(-1));
  const notes = notesOf(book.db);
  const groups = listCategories(book);
  const tree = groups.flatMap((group) => group.categories);
  const uncategorized = book.client
    .prepare(
      `SELECT count(DISTINCT p.transaction_id) AS count, coalesce(sum(p.amount), 0) AS amount
       FROM postings p JOIN accounts a ON a.id = p.account_id
       WHERE a.system = 'uncategorized' AND ${IN_BUDGET}`,
    )
    .get() as { count: number; amount: number };
  return {
    budgetType: computed.type,
    range: computed.range,
    groups,
    months: months.map((month): BudgetMonth => {
      const result = computed.months.get(month);
      const note = notes.get(`budget-${month}`) ?? null;
      if (result === undefined) return emptyMonth(groups, computed.type, month, note);
      const own = new Map(result.categories.map((row) => [row.id, row]));
      const totals = rollUpCategories(tree, (id) => own.get(id));
      return {
        month,
        note,
        groups: result.groups,
        summary: result.summary,
        categories: result.categories.map((category) => ({
          ...category,
          ...computed.goals(month, category.id),
          total: totals.get(category.id) ?? {
            budgeted: category.budgeted,
            spent: category.spent,
            balance: category.balance,
          },
        })),
      };
    }),
    uncategorized: { count: uncategorized.count, amount: -uncategorized.amount },
  };
};

const emptyMonth = (
  groups: ReadonlyArray<CategoryGroup>,
  type: BudgetType,
  month: string,
  note: string | null,
): BudgetMonth => {
  return {
    month,
    note,
    categories: groups.flatMap((group) =>
      group.categories.map((category) => ({
        id: category.id,
        budgeted: 0,
        spent: 0,
        balance: 0,
        carryover: false,
        goal: null,
        longGoal: null,
        total: { budgeted: 0, spent: 0, balance: 0 },
      })),
    ),
    groups: groups.map((group) => ({ id: group.id, budgeted: 0, spent: 0, balance: 0 })),
    summary:
      type === "envelope"
        ? {
            type: "envelope",
            income: 0,
            fromLastMonth: 0,
            lastMonthOverspent: 0,
            totalBudgeted: 0,
            hold: 0,
            toBudget: 0,
            totalSpent: 0,
            totalBalance: 0,
          }
        : {
            type: "tracking",
            budgetedIncome: 0,
            income: 0,
            budgetedExpenses: 0,
            spent: 0,
            budgetedSaved: 0,
            saved: 0,
          },
  };
};

export const budgetRow = (book: Book, type: BudgetType, month: string, category: string) =>
  book.db
    .select()
    .from(t.budgets)
    .where(
      and(
        eq(t.budgets.budgetType, type),
        eq(t.budgets.month, monthToInt(month)),
        eq(t.budgets.categoryId, category),
      ),
    )
    .get();

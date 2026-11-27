/** A book as templates read it: Actual's budget sheet cells, categories and schedules. */
import type { BudgetType } from "@reeve/contract";
import {
  currentMonth,
  dayToInt,
  intToDay,
  intToMonth,
  monthToInt,
  prevMonth,
  today,
  type MonthResult,
} from "@reeve/contract/rules";
import { readSettings, type Book } from "../book.ts";
import { budgetRow, computeMonths } from "../budget/view.ts";
import { listCategories } from "../ledger/categories.ts";
import type { TemplateEnv } from "./context.ts";
import type {
  ScheduledTransaction,
  ScheduleStore,
  StoredCondition,
  StoredSchedule,
  TransactionQuery,
} from "./schedule.ts";

/** Postings of transactions that touch a budget account, as `budget/view.ts` counts them. */
const IN_BUDGET = `EXISTS (
  SELECT 1 FROM postings q JOIN accounts b ON b.id = q.account_id
  WHERE q.transaction_id = p.transaction_id AND b.on_budget = 1)`;

/** Each posting that moves a category, with the category; Uncategorized has none. */
const CATEGORY_LINES = `
  SELECT p.transaction_id AS tid,
         CASE WHEN a.system IS NULL THEN p.account_id END AS category, -p.amount AS amount
  FROM postings p JOIN accounts a ON a.id = p.account_id
  WHERE a.type IN ('expense', 'income') AND ${IN_BUDGET}
  UNION ALL
  SELECT p.transaction_id, p.category_id, -p.amount
  FROM postings p JOIN accounts a ON a.id = p.account_id
  WHERE p.category_id IS NOT NULL AND a.on_budget = 0 AND ${IN_BUDGET}`;

const transactionsOf = (book: Book, query: TransactionQuery): Array<ScheduledTransaction> => {
  const where: Array<string> = [];
  const params: Array<string | number> = [];
  if (query.category !== undefined) {
    where.push("x.category = ?");
    params.push(query.category);
  }
  if (query.schedules !== undefined) {
    if (query.schedules.length === 0) return [];
    where.push(`t.schedule_id IN (${query.schedules.map(() => "?").join(", ")})`);
    params.push(...query.schedules);
  }
  if (query.unlinked) where.push("t.schedule_id IS NULL");
  if (query.after !== undefined) {
    where.push("t.date > ?");
    params.push(dayToInt(query.after));
  }
  if (query.from !== undefined) {
    where.push("t.date >= ?");
    params.push(dayToInt(query.from));
  }
  if (query.before !== undefined) {
    where.push("t.date < ?");
    params.push(dayToInt(query.before));
  }
  const rows = book.client
    .prepare(
      `SELECT t.date AS date, x.amount AS amount, t.schedule_id AS schedule, x.category AS category
       FROM (${CATEGORY_LINES}) x JOIN transactions t ON t.id = x.tid
       ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY t.date`,
    )
    .all(...params) as Array<{
    date: number;
    amount: number;
    schedule: string | null;
    category: string | null;
  }>;
  return rows.map((row) => ({ ...row, date: intToDay(row.date) }));
};

const parseJson = (value: unknown): unknown =>
  typeof value === "string" ? JSON.parse(value) : value;

/** The `schedules` rows and their rules, read directly (see the report on the schedules domain). */
export const bookSchedules = (book: Book): ScheduleStore => ({
  active: () =>
    book.client
      .prepare("SELECT id, name FROM schedules WHERE name IS NOT NULL ORDER BY created_at")
      .all() as Array<{ id: string; name: string | null }>,
  find: (ref) => {
    const by = ref.scheduleId ? "s.id = ?" : "TRIM(s.name) = ?";
    const key = ref.scheduleId ?? ref.name;
    if (key === undefined) return undefined;
    const row = book.client
      .prepare(
        `SELECT s.id, s.name, s.completed, s.next_date AS nextDate, r.conditions, r.actions
         FROM schedules s JOIN rules r ON r.id = s.rule_id WHERE ${by} LIMIT 1`,
      )
      .get(key) as
      | {
          id: string;
          name: string | null;
          completed: number;
          nextDate: number | null;
          conditions: string;
          actions: string;
        }
      | undefined;
    if (row === undefined) return undefined;
    return {
      id: row.id,
      name: row.name,
      completed: Boolean(row.completed),
      nextDate: row.nextDate === null ? null : intToDay(row.nextDate),
      conditions: (parseJson(row.conditions) ?? []) as ReadonlyArray<StoredCondition>,
      actions: (parseJson(row.actions) ?? []) as ReadonlyArray<unknown>,
    } satisfies StoredSchedule;
  },
  transactions: (query) => transactionsOf(book, query),
});

const CELLS = [
  ["budget-", "budgeted"],
  ["leftover-", "balance"],
  ["sum-amount-", "spent"],
] as const;

/** The last month an average counts, as Actual's `getAverageStartMonth`: never this month or later. */
const averageStartMonth = (month: string, now: string) => {
  const previous = prevMonth(month);
  return previous >= now ? prevMonth(now) : previous;
};

/** The template environment of a book; `invalidate` after writing so reads see the change. */
export interface BookEnv extends TemplateEnv {
  readonly type: BudgetType;
  readonly goal: (month: string, category: string) => number | null;
  readonly invalidate: () => void;
}

export const bookEnv = (book: Book, month: string): BookEnv => {
  const settings = readSettings(book.db);
  const type = settings.budgetType;
  let computed: ReadonlyMap<string, MonthResult> | null = null;
  const monthResult = (at: string) => {
    computed ??= computeMonths(book, month).months;
    return computed.get(at);
  };
  const categoryIn = (at: string, id: string) =>
    monthResult(at)?.categories.find((row) => row.id === id);
  const value = (at: string, key: string): number => {
    const result = monthResult(at);
    if (result === undefined) return 0;
    const summary = result.summary;
    if (key === "to-budget") return summary.type === "envelope" ? summary.toBudget : 0;
    if (key === "total-income") return summary.income;
    if (key === "total-saved") return summary.type === "tracking" ? summary.budgetedSaved : 0;
    for (const [prefix, cell] of CELLS) {
      if (!key.startsWith(prefix)) continue;
      const row = categoryIn(at, key.slice(prefix.length));
      return row === undefined ? 0 : row[cell];
    }
    return 0;
  };
  const categories = () =>
    listCategories(book).flatMap((group) =>
      group.categories.map((category) => ({
        id: category.id,
        name: category.name,
        isIncome: category.isIncome,
      })),
    );
  const firstActivityMonth = (category: string, endMonth: string): string | null => {
    const end = monthToInt(endMonth);
    const row = book.client
      .prepare(
        `SELECT min(month) AS month FROM (
           SELECT month FROM budgets WHERE budget_type = ? AND category_id = ? AND month <= ?
           UNION ALL
           SELECT t.date / 100 FROM (${CATEGORY_LINES}) x JOIN transactions t ON t.id = x.tid
           WHERE x.category = ? AND t.date / 100 <= ?)`,
      )
      .get(type, category, end, category, end) as { month: number | null };
    return row.month === null ? null : intToMonth(row.month);
  };
  const now = today();
  return {
    type,
    isTracking: type === "tracking",
    hideFraction: settings.hideFraction,
    today: now,
    value,
    carryover: (at, id) => categoryIn(at, id)?.carryover ?? false,
    categories,
    categoryAverage: (at, maxMonths, category) => {
      const first = averageStartMonth(at, currentMonth());
      const firstActivity = firstActivityMonth(category, first);
      const averaged: Array<string> = [];
      let previous = first;
      for (let i = 0; i < maxMonths; i++) {
        if (firstActivity !== null && previous < firstActivity) break;
        averaged.push(previous);
        previous = prevMonth(previous);
      }
      if (averaged.length === 0) return 0;
      const total = averaged.reduce((sum, at2) => sum + value(at2, `sum-amount-${category}`), 0);
      return Math.round(total / averaged.length);
    },
    schedules: bookSchedules(book),
    goal: (at, category) => budgetRow(book, type, at, category)?.goal ?? null,
    invalidate: () => {
      computed = null;
    },
  };
};

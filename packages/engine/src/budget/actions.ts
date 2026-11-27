import type { BudgetType } from "@reeve/contract";
import {
  addMonths,
  formatAmount,
  heldAmount,
  monthRange,
  monthToInt,
  prevMonth,
} from "@reeve/contract/rules";
import { and, desc, eq, gt, lt } from "drizzle-orm";
import { invalid, notesOf, readSettings, setNote, type Book } from "../book.ts";
import * as t from "../db/schema.ts";
import { categoryRow } from "../ledger/categories.ts";
import { budgetRow, computeMonths, rangeOf } from "./view.ts";

const typeOf = (book: Book): BudgetType => readSettings(book.db).budgetType;

/** Whether a category rolls over in the months before `month`, which a new month inherits. */
const inheritedCarryover = (book: Book, type: BudgetType, month: string, category: string) =>
  book.db
    .select({ carryover: t.budgets.carryover })
    .from(t.budgets)
    .where(
      and(
        eq(t.budgets.budgetType, type),
        eq(t.budgets.categoryId, category),
        lt(t.budgets.month, monthToInt(month)),
      ),
    )
    .orderBy(desc(t.budgets.month))
    .get()?.carryover ?? false;

const upsert = (
  book: Book,
  type: BudgetType,
  month: string,
  category: string,
  change: { readonly amount?: number; readonly carryover?: boolean },
) => {
  const existing = budgetRow(book, type, month, category);
  if (existing === undefined) {
    book.db
      .insert(t.budgets)
      .values({
        budgetType: type,
        month: monthToInt(month),
        categoryId: category,
        amount: change.amount ?? 0,
        carryover: change.carryover ?? inheritedCarryover(book, type, month, category),
      })
      .run();
    return;
  }
  book.db
    .update(t.budgets)
    .set(change)
    .where(
      and(
        eq(t.budgets.budgetType, type),
        eq(t.budgets.month, monthToInt(month)),
        eq(t.budgets.categoryId, category),
      ),
    )
    .run();
};

/** A category a month can assign money to. An envelope budget counts income only as it arrives. */
const assignableCategory = (book: Book, id: string) => {
  const row = categoryRow(book.db, id);
  if (row.type === "income" && typeOf(book) === "envelope")
    invalid(
      `${row.name} is an income category: an envelope budget counts income as it arrives, so it has no budgeted amount. A tracking budget plans income.`,
    );
  return row;
};

export const setBudget = (
  book: Book,
  input: { readonly month: string; readonly category: string; readonly amount: number },
) => {
  assignableCategory(book, input.category);
  upsert(book, typeOf(book), input.month, input.category, { amount: input.amount });
  return { month: input.month };
};

const budgetedOf = (book: Book, type: BudgetType, month: string, category: string) =>
  budgetRow(book, type, month, category)?.amount ?? 0;

const addToBudget = (
  book: Book,
  type: BudgetType,
  month: string,
  category: string,
  delta: number,
) =>
  upsert(book, type, month, category, { amount: budgetedOf(book, type, month, category) + delta });

/** Sets rolling over for a category from `month` through the end of the budget's range. */
export const setCarryover = (
  book: Book,
  input: { readonly month: string; readonly category: string; readonly carryover: boolean },
) => {
  categoryRow(book.db, input.category);
  const type = typeOf(book);
  const { end } = rangeOf(book, type);
  const last = end > input.month ? end : input.month;
  for (const month of monthRange(input.month, last))
    upsert(book, type, month, input.category, { carryover: input.carryover });
  // A row past the range would otherwise bring the old setting back there.
  book.db
    .update(t.budgets)
    .set({ carryover: input.carryover })
    .where(
      and(
        eq(t.budgets.budgetType, type),
        eq(t.budgets.categoryId, input.category),
        gt(t.budgets.month, monthToInt(last)),
      ),
    )
    .run();
  return { month: input.month };
};

const nameOf = (book: Book, id: string) =>
  id === "to-budget"
    ? "To Budget"
    : id === "overbudgeted"
      ? "Overbudgeted"
      : categoryRow(book.db, id).name;

/** Notes a move of money on the month, as Actual's movement notes. */
const noteMovement = (book: Book, month: string, amount: number, from: string, to: string) => {
  const settings = readSettings(book.db);
  const id = `budget-${month}`;
  const existing = notesOf(book.db).get(id);
  const day = new Date().toLocaleDateString("en-US", { month: "long", day: "2-digit" });
  const line = `- Reassigned ${formatAmount(amount, settings)} from ${nameOf(book, from)} → ${nameOf(book, to)} on ${day}`;
  setNote(book.db, id, existing === undefined ? line : `${existing}\n${line}`);
};

export const moveBudget = (
  book: Book,
  input: {
    readonly month: string;
    readonly from: string;
    readonly to: string;
    readonly amount: number;
  },
) => {
  if (input.from === input.to) invalid("Move money between two different places");
  if (input.amount <= 0) invalid("Move a positive amount");
  for (const place of [input.from, input.to])
    if (place !== "to-budget") assignableCategory(book, place);
  const type = typeOf(book);
  if (input.from !== "to-budget") addToBudget(book, type, input.month, input.from, -input.amount);
  if (input.to !== "to-budget") addToBudget(book, type, input.month, input.to, input.amount);
  noteMovement(book, input.month, input.amount, input.from, input.to);
  return { month: input.month };
};

const computedMonth = (book: Book, month: string) => {
  const computed = computeMonths(book, month);
  const result = computed.months.get(month);
  if (result === undefined) return invalid(`${month} is outside the budget's months`);
  return result;
};

const balanceIn = (result: ReturnType<typeof computedMonth>, category: string) =>
  result.categories.find((row) => row.id === category)?.balance ?? 0;

const toBudgetIn = (result: ReturnType<typeof computedMonth>) =>
  result.summary.type === "envelope" ? result.summary.toBudget : 0;

export const coverOverspending = (
  book: Book,
  input: {
    readonly month: string;
    readonly category: string;
    readonly from: string;
    readonly amount?: number;
  },
) => {
  assignableCategory(book, input.category);
  if (input.from !== "to-budget") assignableCategory(book, input.from);
  const result = computedMonth(book, input.month);
  const type = typeOf(book);
  const toCover = input.amount !== undefined ? -input.amount : balanceIn(result, input.category);
  const available = input.from === "to-budget" ? toBudgetIn(result) : balanceIn(result, input.from);
  if (toCover >= 0 || available <= 0) return { month: input.month };
  const amount = Math.min(Math.abs(toCover), available);
  if (input.from !== "to-budget") addToBudget(book, type, input.month, input.from, -amount);
  addToBudget(book, type, input.month, input.category, amount);
  noteMovement(book, input.month, amount, input.from, input.category);
  return { month: input.month };
};

export const coverOverbudgeted = (
  book: Book,
  input: { readonly month: string; readonly category: string; readonly amount?: number },
) => {
  assignableCategory(book, input.category);
  const result = computedMonth(book, input.month);
  const toCover = input.amount !== undefined ? -input.amount : toBudgetIn(result);
  const available = balanceIn(result, input.category);
  if (toCover >= 0 || available <= 0) return { month: input.month };
  const amount = Math.min(Math.abs(toCover), available);
  addToBudget(book, typeOf(book), input.month, input.category, -amount);
  noteMovement(book, input.month, amount, input.category, "overbudgeted");
  return { month: input.month };
};

const setHold = (book: Book, month: string, hold: number) =>
  book.db
    .insert(t.budgetMonths)
    .values({ budgetType: typeOf(book), month: monthToInt(month), hold })
    .onConflictDoUpdate({
      target: [t.budgetMonths.budgetType, t.budgetMonths.month],
      set: { hold },
    })
    .run();

export const holdForNextMonth = (
  book: Book,
  input: { readonly month: string; readonly amount: number },
) => {
  if (typeOf(book) !== "envelope") invalid("Only an envelope budget holds money for next month");
  const result = computedMonth(book, input.month);
  if (result.summary.type !== "envelope" || result.summary.toBudget + result.summary.hold <= 0)
    invalid("There is nothing in To Budget to hold");
  const summary = result.summary as { toBudget: number; hold: number };
  setHold(book, input.month, heldAmount(summary.toBudget, summary.hold, input.amount));
  return { month: input.month };
};

export const resetHold = (book: Book, input: { readonly month: string }) => {
  setHold(book, input.month, 0);
  return { month: input.month };
};

const expenseIds = (book: Book) =>
  book.db
    .select({ id: t.accounts.id })
    .from(t.accounts)
    .where(and(eq(t.accounts.type, "expense")))
    .all()
    .filter((row) => {
      try {
        categoryRow(book.db, row.id);
        return true;
      } catch {
        return false;
      }
    })
    .map((row) => row.id);

/** Actual's month and category budget menu actions. */
export const applyBudgetAction = (
  book: Book,
  input: {
    readonly month: string;
    readonly action:
      | "copy-last"
      | "set-zero"
      | "average-3"
      | "average-6"
      | "average-12"
      | "copy-until-year-end"
      | "set-to-spent";
    readonly category?: string;
  },
) => {
  const type = typeOf(book);
  const categories =
    input.category !== undefined ? [assignableCategory(book, input.category).id] : expenseIds(book);
  const { month } = input;
  const computed = computeMonths(book, month);
  const spentIn = (at: string, category: string) =>
    computed.months.get(at)?.categories.find((row) => row.id === category)?.spent ?? 0;
  for (const category of categories) {
    switch (input.action) {
      case "copy-last":
        upsert(book, type, month, category, {
          amount: budgetedOf(book, type, prevMonth(month), category),
        });
        break;
      case "set-zero":
        upsert(book, type, month, category, { amount: 0 });
        break;
      case "average-3":
      case "average-6":
      case "average-12": {
        const count = Number(input.action.split("-")[1]);
        const months = monthRange(addMonths(month, -count), prevMonth(month));
        const total = months.reduce((sum, at) => sum + spentIn(at, category), 0);
        upsert(book, type, month, category, { amount: -Math.round(total / count) });
        break;
      }
      case "copy-until-year-end": {
        const amount = budgetedOf(book, type, month, category);
        const yearEnd = `${month.slice(0, 4)}-12`;
        for (const later of monthRange(month, yearEnd).slice(1))
          upsert(book, type, later, category, { amount });
        break;
      }
      case "set-to-spent":
        upsert(book, type, month, category, { amount: -spentIn(month, category) });
        break;
    }
  }
  return { month };
};

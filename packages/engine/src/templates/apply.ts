/** Running templates over a month, as Actual's `goal-template.ts` and `cleanup-template.ts`. */
import { and, eq } from "drizzle-orm";
import { monthToInt } from "@reeve/contract/rules";
import { invalid, notesOf, type Book } from "../book.ts";
import { setBudget } from "../budget/actions.ts";
import { budgetRow } from "../budget/view.ts";
import * as t from "../db/schema.ts";
import { listCategories } from "../ledger/categories.ts";
import {
  CategoryTemplateContext,
  distributeRemainder,
  type TemplateCategory,
  type TemplateEnv,
} from "./context.ts";
import { bookEnv, type BookEnv } from "./env.ts";
import { cleanupOfNote, templateErrors, templatesOfNote } from "./notes.ts";
import type { CleanupTemplate, Template } from "./types.ts";

interface TemplateGoal {
  readonly category: string;
  readonly goal: number | null;
  readonly longGoal: number | null;
}

export interface ComputedTemplates {
  readonly contexts: Array<CategoryTemplateContext>;
  readonly errors: Array<string>;
  readonly orphanGoals: Array<TemplateGoal>;
}

/**
 * Runs the templates of `categories` for a month: priority by priority within To Budget (a
 * tracking budget's budgeted savings), then the remainder. Without `force`, only categories that
 * have nothing budgeted yet.
 */
export const computeTemplates = (
  env: TemplateEnv & { readonly goal: (month: string, category: string) => number | null },
  month: string,
  force: boolean,
  categoryTemplates: ReadonlyMap<string, ReadonlyArray<Template>>,
  categories: ReadonlyArray<TemplateCategory & { readonly name: string }>,
  skipAvailableClamp = false,
): ComputedTemplates => {
  const contexts: Array<CategoryTemplateContext> = [];
  let availBudget = env.value(month, env.isTracking ? "total-saved" : "to-budget");
  const priorities = new Set<number>();
  const errors: Array<string> = [];
  const orphanGoals: Array<TemplateGoal> = [];
  for (const category of categories) {
    const templates = categoryTemplates.get(category.id);
    const budgeted = env.value(month, `budget-${category.id}`);
    if ((budgeted === 0 || force) && templates !== undefined) {
      try {
        const context = CategoryTemplateContext.init(
          templates,
          category,
          month,
          budgeted,
          env,
          skipAvailableClamp,
        );
        // What was budgeted by hand is not the templates' to spend.
        if (!context.isGoalOnly()) availBudget += budgeted;
        availBudget += context.getLimitExcess();
        for (const priority of context.getPriorities()) priorities.add(priority);
        contexts.push(context);
      } catch (error) {
        errors.push(`${category.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (templates === undefined && env.goal(month, category.id) !== null) {
      orphanGoals.push({ category: category.id, goal: null, longGoal: null });
    }
  }
  if (errors.length > 0) return { contexts, errors, orphanGoals };

  for (const priority of [...priorities].sort((a, b) => a - b)) {
    const availStart = availBudget;
    for (const context of contexts)
      availBudget -= context.runTemplatesForPriority(priority, availBudget, availStart);
  }
  distributeRemainder(contexts, availBudget);
  return { contexts, errors, orphanGoals };
};

/** Every category's templates from its notes; a category without template lines has none. */
export const noteTemplates = (book: Book): Map<string, Array<Template>> => {
  const result = new Map<string, Array<Template>>();
  for (const group of listCategories(book))
    for (const category of group.categories) {
      const templates = templatesOfNote(category.notes);
      if (templates.length > 0) result.set(category.id, templates);
    }
  return result;
};

/** Sets a month's goal and long goal for a category, as Actual's `setGoal`. */
export const setGoal = (book: Book, env: BookEnv, month: string, goal: TemplateGoal) => {
  if (budgetRow(book, env.type, month, goal.category) === undefined)
    setBudget(book, {
      month,
      category: goal.category,
      amount: env.value(month, `budget-${goal.category}`),
    });
  book.db
    .update(t.budgets)
    .set({ goal: goal.goal, longGoal: goal.longGoal })
    .where(
      and(
        eq(t.budgets.budgetType, env.type),
        eq(t.budgets.month, monthToInt(month)),
        eq(t.budgets.categoryId, goal.category),
      ),
    )
    .run();
};

export type ApplyMessage = "templates-applied" | "templates-up-to-date" | "template-errors";

export interface ApplyResult {
  readonly month: string;
  readonly message: ApplyMessage;
  readonly applied: number;
  readonly errors: ReadonlyArray<string>;
}

/** The categories a whole-month run covers: visible ones, and income only in a tracking budget. */
const monthCategories = (book: Book, tracking: boolean) =>
  listCategories(book)
    .filter((group) => !group.hidden)
    .flatMap((group) => group.categories.filter((category) => !category.hidden))
    .filter((category) => tracking || !category.isIncome);

const categoriesById = (book: Book, ids: ReadonlyArray<string>) => {
  const all = listCategories(book).flatMap((group) => group.categories);
  return all.filter((category) => ids.includes(category.id));
};

/** Applies templates to a month and writes the budgets and goals, as Actual's `processTemplate`. */
export const applyTemplates = (
  book: Book,
  input: {
    readonly month: string;
    readonly force: boolean;
    /** Only these categories (with `force`); every visible category when left out. */
    readonly categories?: ReadonlyArray<string>;
  },
): ApplyResult => {
  const { month } = input;
  const env = bookEnv(book, month);
  const all = noteTemplates(book);
  const templates =
    input.categories === undefined
      ? all
      : new Map([...all].filter(([id]) => input.categories?.includes(id)));
  const categories =
    input.categories === undefined
      ? monthCategories(book, env.isTracking)
      : categoriesById(book, input.categories);
  const { contexts, errors, orphanGoals } = computeTemplates(
    env,
    month,
    input.force,
    templates,
    categories,
  );
  if (errors.length > 0) return { month, message: "template-errors", applied: 0, errors };
  for (const goal of orphanGoals) setGoal(book, env, month, goal);
  if (contexts.length === 0) return { month, message: "templates-up-to-date", applied: 0, errors };
  for (const context of contexts) {
    const values = context.getValues();
    setBudget(book, { month, category: context.category.id, amount: values.budgeted });
    setGoal(book, env, month, {
      category: context.category.id,
      goal: values.goal,
      longGoal: values.longGoal ? 1 : null,
    });
  }
  return { month, message: "templates-applied", applied: contexts.length, errors };
};

export interface TemplateProblem {
  readonly category: string;
  readonly name: string;
  readonly message: string;
}

/** Actual's check: lines that do not parse and schedules that do not exist, per category. */
export const checkTemplates = (book: Book): Array<TemplateProblem> => {
  const scheduleNames = bookEnv(book, "1970-01")
    .schedules.active()
    .map((schedule) => schedule.name);
  return listCategories(book).flatMap((group) =>
    group.categories.flatMap((category) =>
      templateErrors(category.name, templatesOfNote(category.notes), scheduleNames).map(
        (message) => ({ category: category.id, name: category.name, message }),
      ),
    ),
  );
};

// ---------------------------------------------------------------------------------------------
// End-of-month cleanup
// ---------------------------------------------------------------------------------------------

export type CleanupMessage = "cleanup-applied" | "cleanup-up-to-date" | "cleanup-no-funds";

export interface CleanupResult {
  readonly month: string;
  readonly message: CleanupMessage;
  readonly sources: number;
  readonly sinks: number;
  readonly warnings: ReadonlyArray<string>;
}

interface CleanupCategory {
  readonly id: string;
  readonly name: string;
  readonly isIncome: boolean;
  readonly def: ReadonlyArray<CleanupTemplate>;
}

/**
 * Actual's end-of-month cleanup: sources give their leftover back, overspent categories are
 * covered, and sinks share what is then in To Budget by weight; a named group does the same
 * within itself first.
 */
export const cleanupTemplates = (book: Book, input: { readonly month: string }): CleanupResult => {
  const { month } = input;
  const env = bookEnv(book, month);
  if (env.isTracking) invalid("End-of-month cleanup is for envelope budgets");
  const value = (key: string) => env.value(month, key);
  const write = (category: string, amount: number) => {
    setBudget(book, { month, category, amount });
    env.invalidate();
  };
  const rolls = (category: string) => env.carryover(month, category);

  const notes = notesOf(book.db);
  const groupNames = new Map<string, string>();
  const warnings: Array<string> = [];
  const categories: Array<CleanupCategory> = listCategories(book).flatMap((group) =>
    group.categories.map((category) => {
      const def = cleanupOfNote(notes.get(category.id) ?? null, groupNames);
      if (category.isIncome && def.length > 0)
        warnings.push(`${category.name} is an income category, so its month-end rules do nothing.`);
      return {
        id: category.id,
        name: category.name,
        isIncome: category.isIncome,
        def: category.isIncome ? [] : def,
      };
    }),
  );

  // Named groups first.
  type Member = { category: string; groupId: string; weight: number };
  let sourceGroups: Array<Member> = [];
  const sinkGroups: Array<Member> = [];
  const overspendGroups: Array<Member> = [];
  for (const category of categories)
    for (const row of category.def) {
      if (row.role === "source" && row.groupId !== null)
        sourceGroups.push({ category: category.id, groupId: row.groupId, weight: 0 });
      else if (row.role === "sink" && row.groupId !== null)
        sinkGroups.push({ category: category.id, groupId: row.groupId, weight: row.weight });
      else if (row.role === "overspend")
        overspendGroups.push({ category: category.id, groupId: row.groupId, weight: 0 });
    }
  const nameOf = (id: string) => categories.find((category) => category.id === id)?.name ?? id;
  while (sourceGroups.length > 0) {
    const groupId = sourceGroups[0]!.groupId;
    const sources = sourceGroups.filter((member) => member.groupId === groupId);
    const sinks = sinkGroups.filter((member) => member.groupId === groupId);
    const overspent = overspendGroups.filter((member) => member.groupId === groupId);
    if (sinks.length > 0 || overspent.length > 0) {
      let available = 0;
      for (const { category } of sources) {
        const balance = value(`leftover-${category}`);
        if (balance < 0) {
          warnings.push(`${nameOf(category)} does not have available funds.`);
          continue;
        }
        write(category, value(`budget-${category}`) - balance);
        available += balance;
      }
      const totalWeight = sinks.reduce((sum, member) => sum + member.weight, 0);
      for (let i = 0; i < overspent.length && available > 0; i++) {
        const { category } = overspent[i]!;
        const balance = value(`leftover-${category}`);
        const budgeted = value(`budget-${category}`);
        if (balance < 0 && !rolls(category)) {
          if (Math.abs(balance) <= available) {
            write(category, budgeted + Math.abs(balance));
            available -= Math.abs(balance);
          } else {
            write(category, budgeted + available);
            available = 0;
          }
        }
      }
      for (let i = 0; i < sinks.length && available > 0; i++) {
        const { category, weight } = sinks[i]!;
        write(
          category,
          value(`budget-${category}`) + Math.round((weight / totalWeight) * available),
        );
      }
    } else {
      warnings.push(
        `Cleanup group "${groupNames.get(groupId) ?? groupId}" has no matching sink categories.`,
      );
    }
    sourceGroups = sourceGroups.filter((member) => member.groupId !== groupId);
  }

  // Then every category's own source and sink.
  let sources = 0;
  let totalWeight = 0;
  const sinkCategories: Array<{ category: CleanupCategory; weight: number }> = [];
  for (const category of categories) {
    if (category.def.some((row) => row.role === "source" && row.groupId === null)) {
      const balance = value(`leftover-${category.id}`);
      const budgeted = value(`budget-${category.id}`);
      if (balance >= 0) {
        write(category.id, budgeted - balance);
        setGoal(book, env, month, {
          category: category.id,
          goal: budgeted - balance,
          longGoal: 0,
        });
        sources += 1;
      } else {
        warnings.push(`${category.name} does not have available funds.`);
      }
    }
    const sink = category.def.find((row) => row.role === "sink" && row.groupId === null);
    if (sink !== undefined && sink.role === "sink") {
      sinkCategories.push({ category, weight: sink.weight });
      totalWeight += sink.weight;
    }
  }

  // Overspent categories are covered first, unless they roll overspending over.
  for (const category of categories) {
    const available = value("to-budget");
    const balance = value(`leftover-${category.id}`);
    const budgeted = value(`budget-${category.id}`);
    if (balance >= 0 || category.isIncome || rolls(category.id)) continue;
    if (Math.abs(balance) <= available) write(category.id, budgeted + Math.abs(balance));
    else write(category.id, budgeted + available);
  }

  const budgetAvailable = value("to-budget");
  if (budgetAvailable < 0) warnings.push("Global: No funds are available to reallocate.");
  sinkCategories.forEach(({ category, weight }, i) => {
    const budgeted = value(`budget-${category.id}`);
    let toBudget = budgeted + Math.round((weight / totalWeight) * budgetAvailable);
    if (i === sinkCategories.length - 1) {
      const current = value("to-budget");
      if (toBudget > current) toBudget = budgeted + current;
    }
    write(category.id, toBudget);
  });

  const sinks = sinkCategories.length;
  const result = (message: CleanupMessage): CleanupResult => ({
    month,
    message,
    sources,
    sinks,
    warnings,
  });
  if (warnings.length > 0) return result("cleanup-no-funds");
  if (sources === 0 || budgetAvailable === 0) return result("cleanup-up-to-date");
  return result("cleanup-applied");
};

import { eq } from "drizzle-orm";
import type { Db } from "../db/open.ts";
import * as t from "../db/schema.ts";

export type RuleItem = { readonly field?: string; readonly op?: string; readonly value?: unknown };

type RuleRow = typeof t.rules.$inferSelect;

/** The ids a rule names in a field, in its conditions and actions, which are JSON. */
export const namedInRule = (rule: RuleRow, field: string): ReadonlySet<string> =>
  new Set(
    [...(rule.conditions as Array<RuleItem>), ...(rule.actions as Array<RuleItem>)]
      .filter((item) => item.field === field)
      .flatMap((item) =>
        Array.isArray(item.value) ? (item.value as Array<unknown>) : [item.value],
      )
      .filter((value): value is string => typeof value === "string"),
  );

/** Replaces ids a field names in every rule. */
export const moveInRules = (db: Db, field: string, from: ReadonlySet<string>, to: string) => {
  const swap = (value: unknown): unknown =>
    typeof value === "string" && from.has(value)
      ? to
      : Array.isArray(value)
        ? [...new Set(value.map(swap))]
        : value;
  const fix = (items: unknown) =>
    (items as Array<RuleItem>).map((item) =>
      item.field === field ? { ...item, value: swap(item.value) } : item,
    );
  for (const rule of db.select().from(t.rules).all()) {
    if (![...namedInRule(rule, field)].some((id) => from.has(id))) continue;
    db.update(t.rules)
      .set({ conditions: fix(rule.conditions), actions: fix(rule.actions) })
      .where(eq(t.rules.id, rule.id))
      .run();
  }
};

/**
 * Takes deleted ids out of the rules. A condition that needs one can never mean what it said, so
 * its rule goes, rather than matching what has none; a list only loses it. A schedule lives on its
 * rule, so that rule stays with what is left.
 */
export const dropFromRules = (db: Db, field: string, gone: ReadonlySet<string>) => {
  const scheduled = new Set(
    db
      .select({ ruleId: t.schedules.ruleId })
      .from(t.schedules)
      .all()
      .map((row) => row.ruleId),
  );
  const without = (values: ReadonlyArray<unknown>) =>
    values.filter((value) => typeof value !== "string" || !gone.has(value));
  for (const rule of db.select().from(t.rules).all()) {
    if (![...namedInRule(rule, field)].some((id) => gone.has(id))) continue;
    const conditions = (rule.conditions as Array<RuleItem>).map((item) =>
      item.field === field && Array.isArray(item.value)
        ? { ...item, value: without(item.value) }
        : item,
    );
    const actions = (rule.actions as Array<RuleItem>).filter(
      (item) => item.field !== field || typeof item.value !== "string" || !gone.has(item.value),
    );
    const hopeless = conditions.some(
      (item) =>
        item.field === field &&
        (Array.isArray(item.value)
          ? item.value.length === 0
          : typeof item.value === "string" && gone.has(item.value)),
    );
    if ((hopeless || actions.length === 0) && !scheduled.has(rule.id))
      db.delete(t.rules).where(eq(t.rules.id, rule.id)).run();
    else
      db.update(t.rules)
        .set({
          conditions: conditions.filter(
            (item) =>
              item.field !== field || typeof item.value !== "string" || !gone.has(item.value),
          ),
          actions,
        })
        .where(eq(t.rules.id, rule.id))
        .run();
  }
};

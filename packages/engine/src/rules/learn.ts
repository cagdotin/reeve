import type { RuleAction, RuleCondition, RuleEntity } from "./types.ts";
import { dayToInt, intToDay } from "@reeve/contract/rules";
import { and, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "../db/open.ts";
import * as t from "../db/schema.ts";
import { addDays, currentDay, subDays } from "./dates.ts";
import { insertRule, loadRules, updateRule, type LoadedRule } from "./store.ts";

/** A category picked often enough among a payee's latest transactions: three times or more. */
export const getProbableCategory = (
  transactions: ReadonlyArray<{ readonly category: string | null }>,
): string | null => {
  const scores = new Map<string, number>();
  for (const trans of transactions)
    if (trans.category) scores.set(trans.category, (scores.get(trans.category) ?? 0) + 1);
  let winner: { score: number | undefined; category: string | null } | null = null;
  for (const trans of transactions) {
    const score = trans.category ? scores.get(trans.category) : undefined;
    if (
      winner === null ||
      (score !== undefined && (winner.score === undefined || score > winner.score))
    )
      winner = { score, category: trans.category };
  }
  return winner !== null && winner.score !== undefined && winner.score >= 3
    ? winner.category
    : null;
};

interface RegisterLine {
  readonly transaction_id: string;
  readonly payee_id: string;
  readonly date: number;
  readonly category: string | null;
}

/**
 * Register lines of payees that learn categories in open accounts, newest first: one per line on
 * the other side (each line of a split), with no category for a transfer or uncategorized.
 */
const learningLines = (db: Db, from: string, to: string): Array<RegisterLine> =>
  db.all<RegisterLine>(
    sql`SELECT t.id AS transaction_id, t.payee_id, t.date,
         CASE WHEN c.type IN ('expense', 'income') AND c.system IS NULL THEN c.id END AS category
       FROM transactions t
       JOIN payees pe ON pe.id = t.payee_id AND pe.learn_categories = 1
       JOIN postings p ON p.transaction_id = t.id
       JOIN accounts a ON a.id = p.account_id AND a.type IN ('asset', 'liability') AND a.closed = 0
       JOIN postings q ON q.transaction_id = t.id AND q.id <> p.id
       JOIN accounts c ON c.id = q.account_id
       WHERE t.date >= ${dayToInt(from)} AND t.date <= ${dayToInt(to)}
       ORDER BY t.date DESC, t.created_at DESC, q.sort_order`,
  );

const isSetter = (
  { entity }: LoadedRule,
  op: "is" | "oneOf",
  payee: string,
  category?: string,
): boolean => {
  const [condition] = entity.conditions;
  const [action] = entity.actions;
  return (
    entity.stage === "default" &&
    entity.conditions.length === 1 &&
    entity.actions.length === 1 &&
    action?.op === "set" &&
    action.field === "category" &&
    (category === undefined || action.value === category) &&
    condition?.field === "payee" &&
    (op === "is"
      ? condition.op === "is" && condition.value === payee
      : condition.op === "oneOf" &&
        Array.isArray(condition.value) &&
        condition.value.includes(payee))
  );
};

/**
 * Learns categories, as Actual's `updateCategoryRules`: for each payee of the changed
 * transactions, when one of them is among its five latest and three or more of those share a
 * category, a "payee is X → set category" rule is made or updated.
 */
export const updateCategoryRules = (
  db: Db,
  changed: ReadonlyArray<{
    readonly id: string;
    readonly payee: string | null;
    readonly date: string;
  }>,
) => {
  if (changed.length === 0) return;
  const ids = new Set(changed.map((trans) => trans.id));
  const oldest = changed.reduce(
    (min, trans) => (trans.date < min ? trans.date : min),
    changed[0]!.date,
  );
  // Six months back and ahead: old habits are forgotten, and nothing loads every transaction.
  const lines = learningLines(db, subDays(oldest, 180), addDays(currentDay(), 180));
  const byPayee = Map.groupBy(lines, (line) => line.payee_id);
  const categories = new Map<string, string>();
  for (const payee of new Set(changed.map((trans) => trans.payee))) {
    if (!payee) continue;
    const latest = (byPayee.get(payee) ?? []).slice(0, 5);
    if (!latest.some((line) => ids.has(line.transaction_id))) continue;
    const category = getProbableCategory(latest);
    if (category) categories.set(payee, category);
  }
  if (categories.size === 0) return;
  const rules = loadRules(db);
  for (const [payee, category] of categories) {
    const setters = rules.filter((rule) => isSetter(rule, "is", payee));
    if (setters.length > 0) {
      // Every such rule follows, in case several were made.
      for (const { entity } of setters) {
        const action = entity.actions[0] as Extract<RuleAction, { op: "set" }>;
        if (action.value !== category)
          updateRule(db, entity.id, { actions: [{ ...action, value: category }] });
      }
    } else if (!rules.some((rule) => isSetter(rule, "oneOf", payee, category)))
      insertRule(db, {
        stage: "default",
        conditionsOp: "and",
        conditions: [{ op: "is", field: "payee", value: payee }],
        actions: [{ op: "set", field: "category", value: category }],
      });
  }
};

/** Learns from transactions just created or given a category, by id. */
export const learnCategories = (db: Db, ids: ReadonlyArray<string>) => {
  if (ids.length === 0) return;
  const rows = db.all<{ id: string; payee: string; date: number }>(
    sql`SELECT t.id, t.payee_id AS payee, t.date FROM transactions t
       WHERE t.id IN (${sql.join(
         ids.map((id) => sql`${id}`),
         sql`, `,
       )})
         AND t.payee_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM postings q JOIN accounts c ON c.id = q.account_id
           WHERE q.transaction_id = t.id AND c.type IN ('expense', 'income') AND c.system IS NULL)`,
  );
  updateCategoryRules(
    db,
    rows.map((row) => ({ id: row.id, payee: row.payee, date: intToDay(row.date) })),
  );
};

/**
 * Renames imported payees, as Actual's `updatePayeeRenameRule`: the pre rule setting payee `to`
 * for "imported payee is one of" gets `fromNames` added, or one is made.
 */
export const updatePayeeRenameRule = (
  db: Db,
  fromNames: ReadonlyArray<string>,
  to: string,
): RuleEntity => {
  const existing = loadRules(db).find(({ entity }) => {
    const [condition] = entity.conditions;
    const [action] = entity.actions;
    return (
      entity.stage === "pre" &&
      entity.conditions.length === 1 &&
      entity.actions.length === 1 &&
      action?.op === "set" &&
      action.field === "payee" &&
      action.value === to &&
      condition?.op === "oneOf" &&
      condition.field === "imported_payee"
    );
  });
  if (existing === undefined)
    return insertRule(db, {
      stage: "pre",
      conditionsOp: "and",
      conditions: [{ op: "oneOf", field: "imported_payee", value: [...fromNames] }],
      actions: [{ op: "set", field: "payee", value: to }],
    });
  const condition = existing.entity.conditions[0] as RuleCondition;
  const names = [
    ...new Set([...(condition.value as Array<string>), ...fromNames.filter((name) => name !== "")]),
  ];
  return updateRule(db, existing.entity.id, { conditions: [{ ...condition, value: names }] });
};

/**
 * Sends what later imports call a payee to `to`: the imported names on its transactions and the
 * names it had join the rename rule, so a merge or a rename holds for the lines still to come.
 */
export const renameFutureImports = (
  db: Db,
  to: { readonly id: string; readonly name: string },
  formerNames: ReadonlyArray<string>,
): RuleEntity | null => {
  const imported = db
    .selectDistinct({ name: t.transactions.importedPayee })
    .from(t.transactions)
    .where(and(inArray(t.transactions.payeeId, [to.id]), isNotNull(t.transactions.importedPayee)))
    .all()
    .map((row) => row.name!);
  const own = to.name.trim().toLowerCase();
  const names = new Map<string, string>();
  for (const name of [...formerNames, ...imported]) {
    const key = name.trim().toLowerCase();
    if (key !== "" && key !== own && !names.has(key)) names.set(key, name.trim());
  }
  return names.size === 0 ? null : updatePayeeRenameRule(db, [...names.values()], to.id);
};

/**
 * A category rule a person writes for a payee is theirs to keep: learning stops for each payee its
 * "payee is" or "payee is one of" conditions name, so it never rewrites the rule (docs/rules/rules-and-payees.md).
 */
export const stopLearning = (db: Db, rule: Pick<RuleEntity, "conditions" | "actions">) => {
  if (!rule.actions.some((action) => action.op === "set" && action.field === "category")) return;
  const payees = rule.conditions
    .filter(({ field, op }) => field === "payee" && (op === "is" || op === "oneOf"))
    .flatMap(({ value }) => (Array.isArray(value) ? value : [value]))
    .filter((value): value is string => typeof value === "string");
  if (payees.length > 0)
    db.update(t.payees).set({ learnCategories: false }).where(inArray(t.payees.id, payees)).run();
};

import type { RuleAction, RuleCondition, RuleEntity, RuleStage } from "./types.ts";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { invalid, newId, notFound } from "../book.ts";
import type { Db } from "../db/open.ts";
import * as t from "../db/schema.ts";
import { RuleError } from "./condition.ts";
import { Rule, type ActionData, type ConditionData, type Stage } from "./rule.ts";

type RuleRow = typeof t.rules.$inferSelect;

/** A stored condition as the engine's: amount_inflow is amount with the inflow option. */
export const conditionData = (condition: RuleCondition | ConditionData): ConditionData => {
  if (condition.field === "amount_inflow")
    return { op: condition.op, field: "amount", value: condition.value, options: { inflow: true } };
  if (condition.field === "amount_outflow")
    return {
      op: condition.op,
      field: "amount",
      value: condition.value,
      options: { outflow: true },
    };
  return condition;
};

/** A stored action as the engine's, with its options apart, as Actual keeps them. */
export const actionData = (action: RuleAction): ActionData => {
  switch (action.op) {
    case "set":
      return {
        op: "set",
        field: action.field,
        value: action.value,
        options: {
          ...(action.template === undefined ? {} : { template: action.template }),
          ...(action.formula === undefined ? {} : { formula: action.formula }),
          ...(action.splitIndex === undefined ? {} : { splitIndex: action.splitIndex }),
        },
      };
    case "set-split-amount":
      return {
        op: "set-split-amount",
        value: action.value,
        options: {
          splitIndex: action.splitIndex,
          method: action.method,
          ...(action.formula === undefined ? {} : { formula: action.formula }),
        },
      };
    case "delete-transaction":
      return { op: action.op };
    default:
      return { op: action.op, value: action.value };
  }
};

export const toStage = (stage: string): Stage =>
  stage === "pre" ? "pre" : stage === "post" ? "post" : null;

export interface RuleShape {
  readonly id?: string;
  readonly stage: RuleStage;
  readonly conditionsOp: "and" | "or";
  readonly conditions: ReadonlyArray<RuleCondition>;
  readonly actions: ReadonlyArray<RuleAction>;
}

/** The engine's rule; throws a RuleError when it cannot work. */
export const makeRule = (shape: RuleShape): Rule =>
  new Rule({
    ...(shape.id === undefined ? {} : { id: shape.id }),
    stage: toStage(shape.stage),
    conditionsOp: shape.conditionsOp,
    conditions: shape.conditions.map(conditionData),
    actions: shape.actions.map(actionData),
  });

/** The rule, or the operation's failure when it cannot work. */
export const validRule = (shape: RuleShape): Rule => {
  try {
    return makeRule(shape);
  } catch (error) {
    if (error instanceof RuleError) return invalid(error.message);
    throw error;
  }
};

export const entityOf = (row: RuleRow): RuleEntity => ({
  id: row.id,
  stage: row.stage,
  conditionsOp: row.conditionsOp,
  conditions: row.conditions as ReadonlyArray<RuleCondition>,
  actions: row.actions as ReadonlyArray<RuleAction>,
});

export interface LoadedRule {
  readonly entity: RuleEntity;
  readonly rule: Rule;
}

/** Every rule that can work, with its stored form; a broken one is left out, as Actual does. */
export const loadRules = (db: Db): Array<LoadedRule> =>
  db
    .select()
    .from(t.rules)
    // Rules that rank the same run in the order they were made.
    .orderBy(asc(t.rules.createdAt), sql`rowid`)
    .all()
    .flatMap((row) => {
      const entity = entityOf(row);
      if (!Array.isArray(entity.conditions) || !Array.isArray(entity.actions)) return [];
      try {
        return [{ entity, rule: makeRule(entity) }];
      } catch (error) {
        if (error instanceof RuleError) return [];
        throw error;
      }
    });

export const getRuleRow = (db: Db, id: string): RuleRow =>
  db.select().from(t.rules).where(eq(t.rules.id, id)).get() ?? notFound("rule", id);

const ID_OPS = new Set(["is", "isNot", "oneOf", "notOneOf"]);

/** The rows a rule's id field can name. */
const TARGETS: Readonly<Record<string, (db: Db) => ReadonlyArray<{ readonly id: string }>>> = {
  account: (db) =>
    db
      .select({ id: t.accounts.id })
      .from(t.accounts)
      .where(inArray(t.accounts.type, ["asset", "liability"]))
      .all(),
  category: (db) =>
    db
      .select({ id: t.accounts.id })
      .from(t.accounts)
      .where(inArray(t.accounts.type, ["expense", "income"]))
      .all(),
  category_group: (db) => db.select({ id: t.categoryGroups.id }).from(t.categoryGroups).all(),
  payee: (db) => db.select({ id: t.payees.id }).from(t.payees).all(),
};

type RuleItems = Pick<RuleShape, "conditions" | "actions">;

const namedIds = (shape: RuleItems) =>
  [
    ...shape.conditions.filter((each) => ID_OPS.has(each.op)),
    ...shape.actions.flatMap((each) =>
      each.op === "set" && each.template === undefined && each.formula === undefined ? [each] : [],
    ),
  ].flatMap((each) =>
    (Array.isArray(each.value) ? (each.value as Array<unknown>) : [each.value])
      .filter((value): value is string => typeof value === "string" && value !== "")
      .map((id) => ({ field: each.field as string, id })),
  );

/**
 * Refuses a rule that names what does not exist. What `kept` already named stays allowed, so a rule
 * from an older book can still be edited.
 */
export const refuseMissingNames = (db: Db, shape: RuleItems, kept?: RuleItems) => {
  const known = new Set(kept === undefined ? [] : namedIds(kept).map((each) => each.id));
  for (const { field, id } of namedIds(shape)) {
    const targets = TARGETS[field];
    if (targets === undefined || known.has(id)) continue;
    if (!targets(db).some((row) => row.id === id)) notFound(field.replace("_", " "), id);
  }
};

export const insertRule = (db: Db, shape: RuleShape): RuleEntity => {
  validRule(shape);
  const id = shape.id ?? newId();
  db.insert(t.rules)
    .values({
      id,
      stage: shape.stage,
      conditionsOp: shape.conditionsOp,
      conditions: [...shape.conditions],
      actions: [...shape.actions],
      createdAt: Date.now(),
    })
    .run();
  return entityOf(getRuleRow(db, id));
};

export const updateRule = (db: Db, id: string, change: Partial<RuleShape>): RuleEntity => {
  const next = { ...entityOf(getRuleRow(db, id)), ...change, id };
  validRule(next);
  db.update(t.rules)
    .set({
      stage: next.stage,
      conditionsOp: next.conditionsOp,
      conditions: [...next.conditions],
      actions: [...next.actions],
    })
    .where(eq(t.rules.id, id))
    .run();
  return entityOf(getRuleRow(db, id));
};

/** Deletes rules; one that belongs to a schedule is kept, as Actual's `deleteRule`. */
export const deleteRules = (db: Db, ids: ReadonlyArray<string>) => {
  for (const id of ids) getRuleRow(db, id);
  const linked = new Set(
    ids.length === 0
      ? []
      : db
          .select({ ruleId: t.schedules.ruleId })
          .from(t.schedules)
          .where(inArray(t.schedules.ruleId, [...ids]))
          .all()
          .map((row) => row.ruleId),
  );
  const deleted = ids.filter((id) => !linked.has(id));
  if (deleted.length > 0) db.delete(t.rules).where(inArray(t.rules.id, deleted)).run();
  return { deleted, kept: ids.filter((id) => linked.has(id)) };
};

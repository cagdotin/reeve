import { Action, type ActionOp, type ActionOptions } from "./action.ts";
import { Condition, type ConditionOptions } from "./condition.ts";

/** A transaction as Actual's rules see it: `payee`, `imported_payee`, `subtransactions`, ... */
export type RuleTransaction = Record<string, any>;

type Grouped = RuleTransaction & { subtransactions?: Array<RuleTransaction> };

const num = (n: unknown): number => (typeof n === "number" ? n : 0);

const splitError = (total: number, parent: RuleTransaction) => ({
  type: "SplitTransactionError" as const,
  version: 1 as const,
  difference: num(parent["amount"]) - total,
});

const recalculateSplit = (trans: Grouped): Grouped => {
  const total = (trans.subtransactions ?? []).reduce((sum, sub) => sum + num(sub["amount"]), 0);
  const { error: _error, ...rest } = trans;
  return { ...rest, error: total === num(trans["amount"]) ? null : splitError(total, trans) };
};

const makeChild = (parent: RuleTransaction): RuleTransaction => ({
  amount: 0,
  category: parent["category"] ?? null,
  payee: parent["payee"] ?? null,
  account: parent["account"],
  date: parent["date"],
  cleared: parent["cleared"] ?? null,
  reconciled: parent["reconciled"] ?? null,
  is_child: true,
  parent_id: parent["id"],
  error: null,
});

/** The split remainder: what the parent's amount still lacks from its children. */
const remainder = (list: Array<RuleTransaction>): number => {
  const { error } = recalculateSplit({ ...list[0], subtransactions: list.slice(1) });
  return error ? error.difference : 0;
};

const splitIndexOf = (action: Action) => (action.options?.splitIndex ?? 0) + 1;

function execSplitActions(actions: Array<Action>, transaction: RuleTransaction): Grouped {
  const amountActions = actions.filter((action) => action.op === "set-split-amount");
  // The parent, then the child that index 0 ("apply to all") works on, then one per split.
  const { error: _error, subtransactions: _subs, ...parent } = transaction;
  const list: Array<RuleTransaction> = [
    {
      ...parent,
      is_parent: true,
      payee: null,
      error: num(parent["amount"]) === 0 ? null : splitError(0, parent),
    },
    makeChild(transaction),
  ];

  for (const action of actions) {
    const index = splitIndexOf(action);
    while (index >= list.length) {
      const previous = list[list.length - 1]!;
      list.push({ ...makeChild(transaction), payee: previous["payee"] ?? transaction["payee"] });
    }
    const child = list[index]!;
    child["parent_amount"] = transaction["amount"];
    child["parent_notes"] = transaction["notes"] ?? "";
    child["parent_imported_payee"] = transaction["imported_payee"] ?? "";
    child["parent_payee"] = transaction["payee"] ?? "";
    child["parent_account"] = transaction["account"] ?? "";
    child["balance"] = transaction["balance"];
    child["_balanceOfPrefetched"] = transaction["_balanceOfPrefetched"];
    action.exec(child);
  }

  const afterFixed = remainder(list);
  for (const action of amountActions.filter((each) => each.options?.method === "fixed-percent"))
    list[splitIndexOf(action)]!["amount"] = Math.round((afterFixed * action.value) / 100);

  const remainderActions = amountActions.filter((each) => each.options?.method === "remainder");
  const afterPercents = remainder(list);
  if (remainderActions.length > 0) {
    const each = Math.round(afterPercents / remainderActions.length);
    let last = -1;
    for (const action of remainderActions) {
      list[splitIndexOf(action)]!["amount"] = each;
      last = Math.max(last, splitIndexOf(action));
    }
    // The last remainder split takes what rounding left over.
    list[last]!["amount"] += remainder(list);
  }

  list.splice(1, 1);
  return recalculateSplit({ ...list[0], subtransactions: list.slice(1) });
}

/** Applies actions to a copy of the transaction; split actions make it a split. */
export function execActions(actions: Array<Action>, transaction: RuleTransaction): Grouped {
  const parentActions = actions.filter((action) => !action.options?.splitIndex);
  const childActions = actions.filter((action) => action.options?.splitIndex);
  const splitCount =
    actions.reduce((max, action) => Math.max(max, action.options?.splitIndex ?? 0), 0) + 1;
  for (const action of parentActions) action.exec(transaction);
  if (splitCount === 1 || transaction["is_child"]) return transaction;
  return execSplitActions(childActions, transaction);
}

export interface ConditionData {
  readonly op: string;
  readonly field: string;
  readonly value: unknown;
  readonly options?: ConditionOptions | null;
}

export interface ActionData {
  readonly op: ActionOp;
  readonly field?: string | null;
  readonly value?: unknown;
  readonly options?: ActionOptions | null;
}

export type Stage = "pre" | "post" | null;

export class Rule {
  readonly id: string | undefined;
  readonly stage: Stage;
  readonly conditionsOp: "and" | "or";
  readonly conditions: Array<Condition>;
  readonly actions: Array<Action>;

  constructor(data: {
    readonly id?: string;
    readonly stage?: Stage;
    readonly conditionsOp: "and" | "or";
    readonly conditions: ReadonlyArray<ConditionData>;
    readonly actions: ReadonlyArray<ActionData>;
  }) {
    this.id = data.id;
    this.stage = data.stage ?? null;
    this.conditionsOp = data.conditionsOp;
    this.conditions = data.conditions.map(
      (each) => new Condition(each.op, each.field, each.value, each.options),
    );
    this.actions = data.actions.map(
      (each) => new Action(each.op, each.field ?? null, each.value, each.options),
    );
  }

  evalConditions(object: RuleTransaction): boolean {
    if (this.conditions.length === 0) return false;
    return this.conditionsOp === "or"
      ? this.conditions.some((condition) => condition.eval(object))
      : this.conditions.every((condition) => condition.eval(object));
  }

  /** The fields the actions change, not the whole transaction. */
  execActions(object: RuleTransaction): RuleTransaction {
    const result = execActions(this.actions, { ...object });
    const changes: RuleTransaction = {};
    for (const key of Object.keys(result))
      if (result[key] !== object[key]) changes[key] = result[key];
    return changes;
  }

  exec(object: RuleTransaction): RuleTransaction | null {
    return this.evalConditions(object) ? this.execActions(object) : null;
  }

  apply(object: RuleTransaction): RuleTransaction {
    return { ...object, ...this.exec(object) };
  }

  getId(): string | undefined {
    return this.id;
  }
}

const OP_SCORES: Record<string, number> = {
  is: 10,
  isNot: 10,
  oneOf: 9,
  notOneOf: 9,
  isapprox: 5,
  isbetween: 5,
  gt: 1,
  gte: 1,
  lt: 1,
  lte: 1,
  contains: 0,
  doesNotContain: 0,
  matches: 0,
  hasTags: 0,
  hasAnyTag: 0,
  onBudget: 0,
  offBudget: 0,
};

const EXACT = new Set(["is", "isNot", "isapprox", "oneOf", "notOneOf"]);

const score = (rule: Rule): number => {
  const total = rule.conditions.reduce((sum, condition) => sum + (OP_SCORES[condition.op] ?? 0), 0);
  return rule.conditions.every((condition) => EXACT.has(condition.op)) ? total * 2 : total;
};

const rankStage = (rules: Array<Rule>): Array<Rule> => {
  const scores = new Map(rules.map((rule) => [rule, score(rule)]));
  // The sort is stable: ties keep the order the rules came in, oldest first from storage.
  return [...rules].sort((a, b) => scores.get(a)! - scores.get(b)!);
};

/**
 * The order rules run in: stage pre, then default, then post; within a stage the least specific
 * first, so the most specific rule has the last word.
 */
export const rankRules = (rules: Iterable<Rule>): Array<Rule> => {
  const all = [...rules];
  return [
    ...rankStage(all.filter((rule) => rule.stage === "pre")),
    ...rankStage(all.filter((rule) => rule.stage !== "pre" && rule.stage !== "post")),
    ...rankStage(all.filter((rule) => rule.stage === "post")),
  ];
};

/** Calls `func` with each id a rule's conditions and set actions give `fieldName`. */
export const iterateIds = (
  rules: ReadonlyArray<Rule>,
  fieldName: string,
  func: (rule: Rule, id: any) => void | boolean,
) => {
  ruleLoop: for (const rule of rules) {
    for (const condition of rule.conditions) {
      if (condition.type !== "id" || condition.field !== fieldName) continue;
      if (condition.op === "is" || condition.op === "isNot") {
        if (func(rule, condition.value)) continue ruleLoop;
      } else if (condition.op === "oneOf" || condition.op === "notOneOf") {
        for (const value of condition.value) if (func(rule, value)) continue ruleLoop;
      }
    }
    for (const action of rule.actions)
      if (action.type === "id" && action.field === fieldName && action.op === "set")
        if (func(rule, action.value)) break;
  }
};

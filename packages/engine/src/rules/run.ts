import type { Db } from "../db/open.ts";
import * as t from "../db/schema.ts";
import type { EntryDraft } from "../ledger/transactions.ts";
import type { Action } from "./action.ts";
import { execActions, rankRules, type Rule, type RuleTransaction } from "./rule.ts";
import { loadRules } from "./store.ts";
import {
  actionsReferenceBalance,
  fromRuleTransaction,
  prefetchBalanceOf,
  runningBalance,
  settle,
  toRuleTransaction,
  useBookFormulaPreferences,
} from "./transaction.ts";

export interface EntryContext {
  /** The transaction the entry already is, when rules run on an existing one. */
  readonly id?: string;
  readonly reconciled?: boolean;
  /** The other party's account number on the bank line the entry came from. */
  readonly counterpartyAccount?: string | null;
}

const scheduleRuleIds = (db: Db) =>
  db.select({ id: t.schedules.id, ruleId: t.schedules.ruleId }).from(t.schedules).all();

/**
 * Runs rules on a transaction shaped as Actual's rules see it, as Actual's `runRules`: ranked by
 * stage then specificity, each rule on what the earlier ones made. A transaction linked to a
 * schedule gets that schedule's rule whatever its conditions, and no other schedule's rule.
 */
export const runRulesOn = (
  db: Db,
  trans: RuleTransaction,
  rules: ReadonlyArray<Rule> = loadRules(db).map((each) => each.rule),
  onRan?: (rule: Rule, before: RuleTransaction, after: RuleTransaction) => void,
): RuleTransaction => {
  const ranked = rankRules(rules);
  const schedules = scheduleRuleIds(db);
  const ownRule =
    trans["schedule"] == null
      ? undefined
      : schedules.find((schedule) => schedule.id === trans["schedule"])?.ruleId;
  const otherScheduleRules = new Set(
    schedules.map((schedule) => schedule.ruleId).filter((id) => id !== ownRule),
  );
  let current: RuleTransaction = {
    ...trans,
    _balanceOfPrefetched: prefetchBalanceOf(
      db,
      trans,
      ranked.flatMap((rule) => rule.actions),
    ),
  };
  let hasBalance = false;
  const ensureBalance = (actions: ReadonlyArray<Action>) => {
    if (hasBalance || !current["account"] || !actionsReferenceBalance(actions)) return;
    current["balance"] = runningBalance(
      db,
      current["account"],
      current["date"],
      current["id"] ?? null,
    );
    hasBalance = true;
  };
  for (const rule of ranked) {
    const id = rule.getId();
    const runs =
      id !== undefined && id === ownRule
        ? true
        : id !== undefined && otherScheduleRules.has(id) && ownRule !== undefined
          ? false
          : rule.evalConditions(current);
    if (runs) {
      const before = current;
      ensureBalance(rule.actions);
      current = { ...current, ...rule.execActions(current) };
      settle(db, current);
      onRan?.(rule, before, current);
    } else settle(db, current);
  }
  return current;
};

/**
 * Runs the book's rules on a register entry before it is written, in stage order (pre, default,
 * post), as Actual runs them on a new or imported transaction. Null when a rule deletes it.
 */
export const runRules = (
  db: Db,
  entry: EntryDraft,
  context: EntryContext = {},
): EntryDraft | null => {
  const rules = loadRules(db).map((each) => each.rule);
  if (rules.length === 0) return entry;
  useBookFormulaPreferences(db);
  const original = toRuleTransaction(db, entry, context);
  return fromRuleTransaction(db, entry, runRulesOn(db, original, rules), original);
};

/** Applies actions to a register entry without checking conditions, as Actual's `applyActions`. */
export const applyActions = (
  db: Db,
  entry: EntryDraft,
  actions: ReadonlyArray<Action>,
  context: EntryContext = {},
): EntryDraft | null => {
  useBookFormulaPreferences(db);
  const original = toRuleTransaction(db, entry, context);
  const trans: RuleTransaction = {
    ...original,
    _balanceOfPrefetched: prefetchBalanceOf(db, original, actions),
  };
  if (actionsReferenceBalance(actions))
    trans["balance"] = runningBalance(db, entry.account, entry.date, context.id ?? null);
  const result = execActions([...actions], trans);
  settle(db, result);
  return fromRuleTransaction(db, entry, result, original);
};

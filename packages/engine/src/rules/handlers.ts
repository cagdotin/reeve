import type { rules } from "@reeve/contract/catalog";
import type { RuleAction, RuleCondition, RuleEntity } from "./types.ts";
import type { Transaction } from "@reeve/contract";
import { ruleCategory } from "@reeve/contract/rules";
import { eq } from "drizzle-orm";
import { invalid, type Book } from "../book.ts";
import { accountsInScope, hasScope } from "../ledger/account-scope.ts";
import * as t from "../db/schema.ts";
import type { DomainHandlers } from "../handler.ts";
import { listRegister } from "../ledger/register.ts";
import {
  deleteTransactions,
  draftFrom,
  entryPostings,
  getTransaction,
  heldAccounts,
  moneyLeftUndone,
  reconciledTransactions,
  updateTransaction,
  type EntryDraft,
} from "../ledger/transactions.ts";
import { areScheduleConditionsEqual, extractScheduleConds } from "../schedules/status.ts";
import { Action } from "./action.ts";
import { ruleActivity } from "./activity.ts";
import { RuleError } from "./condition.ts";
import { stopLearning, updatePayeeRenameRule } from "./learn.ts";
import { transactionRules } from "./explain.ts";
import { joinOtherLeg } from "../imports/reconcile.ts";
import { keptCounterparty, matchingRows, type RegisterMatch } from "./query.ts";
import { iterateIds, rankRules, Rule } from "./rule.ts";
import { fillRuleCategories, pendingCategories } from "./pending.ts";
import { applyActions, runRules } from "./run.ts";
import {
  actionData,
  deleteRules,
  entityOf,
  getRuleRow,
  insertRule,
  loadRules,
  refuseMissingNames,
  updateRule,
  validRule,
} from "./store.ts";

const listRules = (book: Book, payee: string | undefined) => {
  const loaded = loadRules(book.db);
  const entities = new Map(loaded.map(({ entity, rule }) => [rule, entity]));
  let ranked = rankRules(loaded.map(({ rule }) => rule));
  if (payee !== undefined) {
    const named = new Set<Rule>();
    iterateIds(ranked, "payee", (rule, id) => {
      if (id === payee) named.add(rule);
    });
    ranked = ranked.filter((rule) => named.has(rule));
  }
  return ranked.map((rule) => entities.get(rule)!);
};

const conditionsOf = (
  conditions: ReadonlyArray<RuleCondition>,
  conditionsOp: "and" | "or" = "and",
) => validRule({ stage: "default", conditionsOp, conditions, actions: [] }).conditions;

const actionsOf = (actions: ReadonlyArray<RuleAction>): Array<Action> => {
  try {
    return actions
      .map(actionData)
      .map((each) => new Action(each.op, each.field ?? null, each.value, each.options));
  } catch (error) {
    if (error instanceof RuleError) return invalid(error.message);
    throw error;
  }
};

interface Selection {
  readonly ids?: ReadonlyArray<string>;
  readonly account?: string;
  readonly conditions?: ReadonlyArray<RuleCondition>;
  readonly conditionsOp?: "and" | "or";
}

/** The register rows a selection names: transactions by id, or those matching conditions. */
const selectRows = (book: Book, selection: Selection): Array<RegisterMatch> => {
  if (selection.ids !== undefined) {
    const ids = new Set(selection.ids);
    for (const id of ids) getTransaction(book.db, id);
    return book.db
      .select({
        transactionId: t.postings.transactionId,
        postingId: t.postings.id,
        accountId: t.postings.accountId,
        type: t.accounts.type,
      })
      .from(t.postings)
      .innerJoin(t.accounts, eq(t.accounts.id, t.postings.accountId))
      .all()
      .filter(
        (row) =>
          ids.has(row.transactionId) &&
          (row.type === "asset" || row.type === "liability") &&
          (selection.account === undefined || row.accountId === selection.account),
      );
  }
  if (selection.conditions === undefined)
    return invalid("Name the transactions: ids or conditions");
  return matchingRows(
    book.db,
    conditionsOf(selection.conditions, selection.conditionsOp),
    selection.conditionsOp ?? "and",
    selection.account,
  );
};

/** Writes a rule-changed entry back over the transaction it came from. */
const writeBack = (book: Book, id: string, before: EntryDraft, after: EntryDraft) => {
  const { db } = book;
  if (JSON.stringify(before) === JSON.stringify(after)) return false;
  const header: Partial<typeof t.transactions.$inferInsert> = {};
  if (after.scheduleId !== before.scheduleId) header.scheduleId = after.scheduleId;
  if (after.importedPayee !== before.importedPayee) header.importedPayee = after.importedPayee;
  if (Object.keys(header).length > 0)
    db.update(t.transactions).set(header).where(eq(t.transactions.id, id)).run();
  const lines =
    after.splits !== null && after.splits.length > 0
      ? { splits: after.splits }
      : { category: after.category, transferAccount: after.transferAccount };
  const registerChanged =
    after.amount !== before.amount ||
    after.category !== before.category ||
    after.transferAccount !== before.transferAccount ||
    JSON.stringify(after.splits) !== JSON.stringify(before.splits) ||
    after.cleared !== before.cleared;
  updateTransaction(
    book,
    {
      id,
      ...(after.date === before.date ? {} : { date: after.date }),
      ...(after.payee === before.payee ? {} : { payee: after.payee }),
      ...(after.notes === before.notes ? {} : { notes: after.notes }),
      ...(after.account !== before.account
        ? { postings: entryPostings(db, after, heldAccounts(db, id)) }
        : registerChanged
          ? { account: before.account, amount: after.amount, cleared: after.cleared, ...lines }
          : {}),
    },
    { learn: false },
  );
  return true;
};

const applyRules = (
  book: Book,
  input: Selection & { readonly rule?: string; readonly actions?: ReadonlyArray<RuleAction> },
) => {
  const { db } = book;
  let actions: Array<Action> | undefined;
  let selection: Selection = input;
  if (input.rule !== undefined) {
    const entity = entityOf(getRuleRow(db, input.rule));
    actions = actionsOf(entity.actions);
    if (input.ids === undefined && input.conditions === undefined)
      selection = { ...input, conditions: entity.conditions, conditionsOp: entity.conditionsOp };
  } else if (input.actions !== undefined) actions = actionsOf(input.actions);
  const rows = selectRows(book, selection);
  // Rules run on each side of a transfer, and the two may disagree: only the end result counts.
  const was = new Map(
    rows.map((row) => [row.transactionId, JSON.stringify(getTransaction(db, row.transactionId))]),
  );
  const deleted = new Set<string>();
  for (const row of rows) {
    if (deleted.has(row.transactionId)) continue;
    // Rules on its other side may have moved the transaction off this account.
    const sides = getTransaction(db, row.transactionId).postings;
    if (!sides.some((posting) => posting.accountId === row.accountId)) continue;
    const before = draftFrom(db, row.transactionId, row.accountId);
    const reconciled =
      db
        .select({ reconciled: t.postings.reconciled })
        .from(t.postings)
        .where(eq(t.postings.id, row.postingId))
        .get()?.reconciled ?? false;
    const context = {
      id: row.transactionId,
      reconciled,
      counterpartyAccount: keptCounterparty(db, row.accountId, before.importedId),
    };
    const after =
      actions === undefined
        ? runRules(db, before, context)
        : applyActions(db, before, actions, context);
    if (after === null) {
      // Only a person can agree to delete what is reconciled.
      if (reconciledTransactions(db, [row.transactionId]).size > 0) continue;
      deleteTransactions(book, [row.transactionId]);
      deleted.add(row.transactionId);
    } else {
      const written = moneyLeftUndone(db, before, after, row.transactionId);
      writeBack(book, row.transactionId, before, written);
      const joined =
        before.transferAccount === null ? joinOtherLeg(book, row.transactionId, written) : null;
      if (joined !== null) deleted.add(joined);
    }
  }
  // A rule's actions alone may rename a payee whose category rules then hold.
  if (actions !== undefined)
    fillRuleCategories(book, { ids: [...was.keys()].filter((id) => !deleted.has(id)) });
  return {
    updated: [...was.keys()]
      .filter((id) => !deleted.has(id))
      .map((id): Transaction => getTransaction(db, id))
      .filter((transaction) => JSON.stringify(transaction) !== was.get(transaction.id)),
    deleted: [...deleted],
  };
};

/** The transactions recategorizing leaves alone, as the composition root decides (receipts). */
export type HeldTransactions = (book: Book, ids: ReadonlyArray<string>) => ReadonlySet<string>;

const noneHeld: HeldTransactions = () => new Set();

interface Recategorization {
  readonly id: string;
  readonly before: EntryDraft;
  readonly after: EntryDraft;
}

/**
 * What setting a rule's category on the existing transactions its conditions match changes
 * (docs/rules/rules-and-payees.md): only the category, through apply_rules' matching and actions. Splits,
 * transfers, the transactions `held` names and those that have the category already are left out.
 */
const recategorizations = (
  book: Book,
  rows: ReadonlyArray<RegisterMatch>,
  category: string,
  held: HeldTransactions,
): Array<Recategorization> => {
  const { db } = book;
  const first = new Map<string, RegisterMatch>();
  for (const row of rows) if (!first.has(row.transactionId)) first.set(row.transactionId, row);
  const skip = held(book, [...first.keys()]);
  const actions = actionsOf([{ op: "set", field: "category", value: category }]);
  return [...first].flatMap(([id, row]) => {
    if (skip.has(id)) return [];
    const before = draftFrom(db, id, row.accountId);
    // A split's lines carry its categories. A transfer's category rides on the off-budget
    // account's posting, which rewriting from the register would unreconcile.
    if (before.splits !== null || before.transferAccount !== null) return [];
    const after = applyActions(db, before, actions, { id });
    return after === null || after.category === before.category ? [] : [{ id, before, after }];
  });
};

const ruleRows = (book: Book, rule: RuleEntity) =>
  matchingRows(book.db, conditionsOf(rule.conditions, rule.conditionsOp), rule.conditionsOp);

/** Sets a saved rule's category on the transactions it matches; their ids. */
const recategorize = (book: Book, rule: RuleEntity, category: string, held: HeldTransactions) =>
  recategorizations(book, ruleRows(book, rule), category, held)
    .filter(({ id, before, after }) => writeBack(book, id, before, after))
    .map(({ id }) => id);

const setsPayee = (rule: RuleEntity) =>
  rule.actions.some((action) => action.op === "set" && action.field === "payee");

/** A rule that renames: the uncategorized transactions it matches get today's rules' category. */
const categorizeRenamed = (book: Book, rule: RuleEntity) =>
  setsPayee(rule)
    ? fillRuleCategories(book, {
        ids: [...new Set(ruleRows(book, rule).map((row) => row.transactionId))],
      })
    : [];

const SCHEDULE_FIELDS = ["payee", "account", "amount", "date"] as const;

/**
 * A schedule reads its payee, account, amount and date from its rule, and only update_schedule moves
 * its next date with them. Everything else on the rule stays free. schedules.ts writes rules itself.
 */
const refuseScheduleChange = (book: Book, before: RuleEntity, after: Partial<RuleEntity>) => {
  const schedule = book.db
    .select({ id: t.schedules.id, name: t.schedules.name })
    .from(t.schedules)
    .where(eq(t.schedules.ruleId, before.id))
    .get();
  if (schedule === undefined) return;
  const was = extractScheduleConds(before.conditions);
  const now = extractScheduleConds(after.conditions ?? before.conditions);
  const named = schedule.name === null ? "a schedule" : `schedule "${schedule.name}"`;
  const changed = SCHEDULE_FIELDS.filter(
    (field) => !areScheduleConditionsEqual(was[field], now[field]),
  );
  if (changed.length > 0)
    invalid(`This rule belongs to ${named}: change its ${changed.join(", ")} with update_schedule`);
  if ((after.conditionsOp ?? before.conditionsOp) !== before.conditionsOp)
    invalid(`This rule belongs to ${named}: all of its conditions have to match`);
  const linked = (actions: ReadonlyArray<RuleAction>) =>
    actions.some((action) => action.op === "link-schedule" && action.value === schedule.id);
  if (linked(before.actions) && !linked(after.actions ?? before.actions))
    invalid(`This rule belongs to ${named}: it has to keep its link-schedule action`);
};

/** Rules: conditions and actions that change transactions as they are added or imported. */
export const ruleHandlers = {
  list_rules: (book, input) => listRules(book, input.payee),
  rule_activity: (book, input) => ruleActivity(book, input),
  get_rule: (book, input) => entityOf(getRuleRow(book.db, input.id)),
  create_rule: (book, input, held: HeldTransactions = noneHeld) => {
    const { recategorize: wanted = true, ...shape } = input;
    refuseMissingNames(book.db, shape);
    const rule = insertRule(book.db, {
      ...shape,
      stage: shape.stage ?? "default",
      conditionsOp: shape.conditionsOp ?? "and",
    });
    stopLearning(book.db, rule);
    const category = ruleCategory(rule.actions);
    const recategorized =
      wanted && category !== null ? recategorize(book, rule, category, held) : [];
    return { ...rule, recategorized, categorized: categorizeRenamed(book, rule) };
  },
  update_rule: (book, input, held: HeldTransactions = noneHeld) => {
    const { id, recategorize: wanted = true, ...change } = input;
    const before = entityOf(getRuleRow(book.db, id));
    refuseScheduleChange(book, before, change);
    refuseMissingNames(book.db, { ...before, ...change }, before);
    const was = ruleCategory(before.actions);
    const rule = updateRule(book.db, id, change);
    stopLearning(book.db, rule);
    const category = ruleCategory(rule.actions);
    const recategorized =
      wanted && category !== null && category !== was
        ? recategorize(book, rule, category, held)
        : [];
    return { ...rule, recategorized, categorized: categorizeRenamed(book, rule) };
  },
  delete_rules: (book, input) => deleteRules(book.db, input.ids),
  apply_rules: (book, input) => applyRules(book, input),
  preview_rule: (book, input, held: HeldTransactions = noneHeld) => {
    let conditions = input.conditions;
    let conditionsOp = input.conditionsOp;
    if (input.rule !== undefined) {
      const entity = entityOf(getRuleRow(book.db, input.rule));
      conditions ??= entity.conditions;
      conditionsOp ??= entity.conditionsOp;
    }
    if (conditions === undefined) return invalid("Give a rule or conditions");
    const everyMatch = matchingRows(
      book.db,
      conditionsOf(conditions, conditionsOp),
      conditionsOp ?? "and",
      input.account,
    );
    const inScope = new Set(accountsInScope(book, input));
    const matches = everyMatch.filter((match) => inScope.has(match.accountId));
    const limited = matches.slice(0, input.limit ?? 200);
    const postings = new Set(limited.map((match) => match.postingId));
    const page = listRegister(book, {
      ids: [...new Set(limited.map((match) => match.transactionId))],
      // A transfer's other side is listed too, then dropped below, so a limit here would cut rows.
      limit: Number.MAX_SAFE_INTEGER,
    });
    const rows = page.rows.filter((row) => postings.has(row.postingId));
    const transactions = new Set(matches.map((match) => match.transactionId)).size;
    if (input.category === undefined) return { rows, total: matches.length, transactions };
    const everywhere = !hasScope(input)
      ? matches
      : matchingRows(book.db, conditionsOf(conditions, conditionsOp), conditionsOp ?? "and");
    return {
      rows,
      total: matches.length,
      transactions,
      recategorizes: recategorizations(book, everywhere, input.category, held).length,
    };
  },
  transaction_rules: (book, input) => transactionRules(book, input),
  run_rules: (book, input) => {
    const ruled = runRules(
      book.db,
      {
        date: input.date,
        account: input.account,
        amount: input.amount,
        payee: input.payee ?? null,
        category: input.category ?? null,
        transferAccount: input.transferAccount ?? null,
        splits: input.splits ?? null,
        notes: input.notes ?? null,
        cleared: input.cleared ?? false,
        importedPayee: input.importedPayee ?? null,
        importedId: null,
        scheduleId: input.scheduleId ?? null,
      },
      { counterpartyAccount: input.counterpartyAccount ?? null },
    );
    if (ruled === null) return null;
    const { importedId: _importedId, ...entry } = ruled;
    return entry;
  },
  create_payee_rename_rule: (book, input) => {
    refuseMissingNames(book.db, {
      conditions: [],
      actions: [{ op: "set", field: "payee", value: input.to }],
    });
    const rule = updatePayeeRenameRule(book.db, input.fromNames, input.to);
    return { ...rule, categorized: categorizeRenamed(book, rule) };
  },
  pending_rule_categories: (book, input) => ({ transactions: pendingCategories(book, input) }),
  apply_rule_categories: (book, input) => ({ categorized: fillRuleCategories(book, input) }),
} satisfies DomainHandlers<typeof rules>;

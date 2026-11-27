import { addMonths, monthRange } from "@reeve/contract/rules";
import { BEYOND_UNDO, dumpDifference, type Dump, type World } from "./world.ts";

/** A stated rule the book broke, named so that a failure says which one. */
export class RuleBroken extends Error {
  constructor(rule: string, detail: string) {
    super(`${rule}\n${detail}`);
    this.name = "RuleBroken";
  }
}

const show = (rows: ReadonlyArray<unknown>) => rows.map((row) => JSON.stringify(row)).join("\n");

/** Rule 1: every transaction has two or more postings, and they sum to zero. */
export const transactionsBalance = (world: World) => {
  const broken = world.all(
    `SELECT t.id, count(p.id) AS postings, coalesce(sum(p.amount), 0) AS total
     FROM transactions t LEFT JOIN postings p ON p.transaction_id = t.id
     GROUP BY t.id HAVING postings < 2 OR total != 0`,
  );
  if (broken.length > 0)
    throw new RuleBroken(
      "Rule 1: every transaction has 2+ postings and sums to zero",
      show(broken),
    );
};

const IN_BUDGET = `EXISTS (
  SELECT 1 FROM postings q JOIN accounts b ON b.id = q.account_id
  WHERE q.transaction_id = p.transaction_id AND b.on_budget = 1)`;

const throughMonth = (rows: Array<{ month: number; amount: number }>) => (month: string) => {
  const at = Number(month.replace("-", ""));
  return rows.reduce((sum, row) => (row.month <= at ? sum + row.amount : sum), 0);
};

/**
 * Rule 2, in an envelope budget, for each month m of the budget's range:
 * on-budget postings dated through m = To Budget(m) + hold(m) + the balances of the expense
 * categories in m + money on Uncategorized dated through m.
 *
 * Income categories have no term of their own: their money lands in To Budget. Uncategorized counts
 * through m here, while get_budget reports it over all time.
 */
export const everyCentHasAPlace = async (world: World) => {
  const { budgetType, range } = await world.call("get_budget", { count: 1 });
  if (budgetType !== "envelope") return;
  const money = throughMonth(
    world.all(
      `SELECT t.date / 100 AS month, sum(p.amount) AS amount
       FROM postings p JOIN transactions t ON t.id = p.transaction_id
       JOIN accounts a ON a.id = p.account_id WHERE a.on_budget = 1 GROUP BY month`,
    ),
  );
  const uncategorized = throughMonth(
    world.all(
      `SELECT t.date / 100 AS month, -sum(p.amount) AS amount
       FROM postings p JOIN transactions t ON t.id = p.transaction_id
       JOIN accounts a ON a.id = p.account_id
       WHERE a.system = 'uncategorized' AND ${IN_BUDGET} GROUP BY month`,
    ),
  );
  const months = monthRange(range.start, range.end);
  for (let index = 0; index < months.length; index += 12) {
    const view = await world.call("get_budget", { month: months[index], count: 12 });
    for (const { month, summary } of view.months) {
      const places = summary.toBudget + summary.hold + summary.totalBalance + uncategorized(month);
      if (money(month) !== places)
        throw new RuleBroken(
          "Rule 2: on-budget money = To Budget + held + category balances + uncategorized",
          `${month}: money ${money(month)}, places ${places}, ` +
            `uncategorized ${uncategorized(month)}, ${JSON.stringify(summary)}`,
        );
    }
  }
};

export type Reconciled = ReadonlyMap<
  string,
  { readonly transaction: string; readonly account: string; readonly amount: number }
>;

export const reconciledPostings = (world: World): Reconciled =>
  new Map(
    world
      .all(
        `SELECT id, transaction_id AS "transaction", account_id AS account, amount
         FROM postings WHERE reconciled = 1`,
      )
      .map(({ id, ...posting }) => [id, posting]),
  );

/**
 * Rule 3: a reconciled posting keeps its account and amount through any write. It leaves only by a
 * delete that passed confirmReconciled, or by merging its transaction into one with a reconciled
 * posting of the same account and amount. Undo and redo are rule 6's: they restore a whole earlier
 * state, its reconciled marks included.
 */
export const reconciledPostingsStay = (
  before: Reconciled,
  now: Reconciled,
  op: string,
  input: Record<string, any>,
) => {
  const unchanged = (id: string) => {
    const [was, is] = [before.get(id), now.get(id)];
    return is !== undefined && is.account === was?.account && is.amount === was.amount;
  };
  const unclaimed = [...now].filter(([id]) => !before.has(id) || !unchanged(id));
  for (const [id, posting] of before) {
    if (unchanged(id)) continue;
    if (
      op === "delete_transactions" &&
      input["confirmReconciled"] === true &&
      input["ids"].includes(posting.transaction)
    )
      continue;
    if (op === "merge_transactions" && posting.transaction === input["drop"]) {
      const heir = unclaimed.findIndex(
        ([, each]) =>
          each.transaction === input["keep"] &&
          each.account === posting.account &&
          each.amount === posting.amount,
      );
      if (heir !== -1) {
        unclaimed.splice(heir, 1);
        continue;
      }
    }
    throw new RuleBroken(
      "Rule 3: a reconciled posting keeps its account and amount",
      `${op} left posting ${id} ${JSON.stringify(posting)} as ${JSON.stringify(now.get(id) ?? "gone")}`,
    );
  }
};

/** What each rule field that holds ids may name. */
const RULE_TARGETS: Readonly<Record<string, string>> = {
  account: "SELECT id FROM accounts WHERE type IN ('asset', 'liability')",
  category: "SELECT id FROM accounts WHERE type IN ('expense', 'income')",
  category_group: "SELECT id FROM category_groups",
  payee: "SELECT id FROM payees",
};

/** The ops whose value is an id; contains and matches read names, whatever the field. */
const ID_OPS = new Set(["is", "isNot", "oneOf", "notOneOf", "set"]);

/** Rule 4: everything points at something that exists. */
export const referencesExist = (world: World) => {
  const dangling: Array<unknown> = [
    ...world.all("PRAGMA foreign_key_check"),
    ...world.all(
      `SELECT 'budget' AS row, category_id AS id FROM budgets
       WHERE category_id NOT IN (SELECT id FROM accounts WHERE type IN ('expense', 'income'))
       UNION ALL
       SELECT 'posting category', category_id FROM postings
       WHERE category_id IS NOT NULL
         AND category_id NOT IN
           (SELECT id FROM accounts WHERE type IN ('expense', 'income') AND system IS NULL)
       UNION ALL
       SELECT 'transaction schedule', schedule_id FROM transactions
       WHERE schedule_id IS NOT NULL AND schedule_id NOT IN (SELECT id FROM schedules)
       UNION ALL
       SELECT 'note', id FROM notes
       WHERE id NOT LIKE 'budget-%'
         AND id NOT IN (SELECT id FROM accounts UNION SELECT id FROM category_groups)`,
    ),
  ];
  const idsOf = (sql: string) => new Set(world.all<{ id: string }>(sql).map((row) => row.id));
  const known = new Map(Object.entries(RULE_TARGETS).map(([field, sql]) => [field, idsOf(sql)]));
  const schedules = idsOf("SELECT id FROM schedules");
  for (const rule of world.all<{ id: string; conditions: string; actions: string }>(
    "SELECT id, conditions, actions FROM rules",
  )) {
    for (const item of [...JSON.parse(rule.conditions), ...JSON.parse(rule.actions)]) {
      const targets = ID_OPS.has(item.op) ? known.get(item.field) : undefined;
      const named: Array<unknown> = Array.isArray(item.value) ? item.value : [item.value];
      for (const value of named)
        if (typeof value === "string" && targets?.has(value) === false)
          dangling.push({ rule: rule.id, field: item.field, id: value });
      if (item.op === "link-schedule" && !schedules.has(item.value))
        dangling.push({ rule: rule.id, field: "schedule", id: item.value });
    }
  }
  if (dangling.length > 0)
    throw new RuleBroken("Rule 4: everything points at something that exists", show(dangling));
};

/** Rule 5: a refused operation changes nothing, undo's bookkeeping included. */
export const refusalChangedNothing = (before: Dump, after: Dump, op: string, why: string) => {
  const difference = dumpDifference(before, after);
  if (difference !== null)
    throw new RuleBroken(
      "Rule 5: a refused operation changes nothing",
      `${op} was refused (${why}) and changed:\n${difference}`,
    );
};

/** Rule 6: undo restores the database exactly, and redo reapplies it. */
export const restored = (expected: Dump, actual: Dump, what: string) => {
  const undone = (dump: Dump): Dump =>
    Object.fromEntries(Object.entries(dump).filter(([table]) => !BEYOND_UNDO.includes(table)));
  const difference = dumpDifference(undone(expected), undone(actual));
  if (difference !== null)
    throw new RuleBroken(
      "Rule 6: undo restores the database exactly, and redo reapplies it",
      `${what}; expected - and found +:\n${difference}`,
    );
};

/** A posting as the rules below compare it. */
export interface Posting {
  readonly id: string;
  readonly transaction: string;
  readonly account: string;
  readonly amount: number;
  readonly cleared: number;
  readonly category: string | null;
  readonly type: string;
  readonly system: string | null;
  readonly onBudget: number;
}
export type Postings = ReadonlyArray<Posting>;

export const postingsOf = (world: World): Postings =>
  world.all(
    `SELECT p.id, p.transaction_id AS "transaction", p.account_id AS account, p.amount, p.cleared,
       p.category_id AS category, a.type, a.system, a.on_budget AS onBudget
     FROM postings p JOIN accounts a ON a.id = p.account_id ORDER BY p.sort_order`,
  );

export type RuleBodies = ReadonlyMap<string, string>;

export const ruleBodies = (world: World): RuleBodies =>
  new Map(
    world
      .all<{ id: string; stage: string; conditions: string; actions: string }>(
        "SELECT id, stage, conditions, actions FROM rules",
      )
      .map(({ id, ...rule }) => [id, JSON.stringify(rule)]),
  );

const bodyOf = (body: string) => {
  const { stage, conditions, actions } = JSON.parse(body);
  return {
    stage,
    conditions: JSON.parse(conditions) as Array<any>,
    actions: JSON.parse(actions) as Array<any>,
  };
};

/** Whether this apply_rules could set a field, by a rule in the book or one in its input. */
const applySets = (op: string, input: Record<string, any>, rules: RuleBodies, field: string) =>
  op === "apply_rules" &&
  [
    ...[...rules.values()].flatMap((body) => bodyOf(body).actions),
    ...(input["actions"] ?? []),
  ].some((action) => action.op === "set" && action.field === field);

const nameCleared = (
  op: string,
  input: Record<string, any>,
  transaction: string,
  account: string,
) => {
  if (op === "import_transactions") return input["account"] === account;
  if (op === "update_transactions")
    return (
      input["ids"].includes(transaction) &&
      input["account"] === account &&
      input["cleared"] !== undefined
    );
  if (op !== "update_transaction" || input["id"] !== transaction) return false;
  return input["postings"] === undefined
    ? input["account"] === account && input["cleared"] !== undefined
    : input["postings"].some((each: any) => each.account === account && each.cleared !== undefined);
};

/**
 * Rule 7: a cleared mark stays until a write names it. A side of a transaction is its account, as a
 * rewrite that wipes a mark may also give the posting a new id.
 */
export const clearedMarksStay = (
  before: Postings,
  after: Postings,
  rules: RuleBodies,
  op: string,
  input: Record<string, any>,
) => {
  if (applySets(op, input, rules, "cleared")) return;
  const sides = (postings: Postings) =>
    Map.groupBy(postings, (posting) => `${posting.transaction} ${posting.account}`);
  const now = sides(after);
  for (const [side, postings] of sides(before)) {
    const later = now.get(side);
    const { transaction, account } = postings[0]!;
    // Fewer postings on the account means a line went, and its mark with it.
    if (later?.length !== postings.length || nameCleared(op, input, transaction, account)) continue;
    const marked = postings.filter((posting) => posting.cleared).length;
    const stillMarked = later.filter((posting) => posting.cleared).length;
    if (stillMarked < marked)
      throw new RuleBroken(
        "Rule 7: a cleared mark stays until a write names it",
        `${op} ${JSON.stringify(input)} took it off ${JSON.stringify(postings)}: ${JSON.stringify(later)}`,
      );
  }
};

/**
 * Rule 8: a transfer's category stays while the transfer does, from whichever side it is edited,
 * until the budget side names another, the postings are given again or the category itself goes.
 */
export const transferCategoriesStay = (
  before: Postings,
  after: Postings,
  rules: RuleBodies,
  op: string,
  input: Record<string, any>,
) => {
  if (op === "delete_category" || op === "delete_category_group") return;
  if (applySets(op, input, rules, "category")) return;
  const accountsOf = (postings: Postings, transaction: string) =>
    postings
      .filter((posting) => posting.transaction === transaction)
      .map((posting) => posting.account)
      .toSorted()
      .join();
  const crossesBudget = (postings: Postings, off: Posting) =>
    off.onBudget === 0 &&
    postings.some((each) => each.transaction === off.transaction && each.onBudget === 1);
  const fromBudgetSide = (transaction: string) =>
    before.some(
      (posting) =>
        posting.transaction === transaction &&
        posting.account === input["account"] &&
        posting.onBudget === 1,
    );
  const named = (transaction: string) =>
    (op === "update_transaction" &&
      input["id"] === transaction &&
      (input["postings"] !== undefined ||
        input["splits"] !== undefined ||
        (input["category"] !== undefined && fromBudgetSide(transaction)))) ||
    (op === "update_transactions" &&
      input["ids"].includes(transaction) &&
      input["category"] !== undefined &&
      fromBudgetSide(transaction));
  for (const posting of before) {
    if (posting.category === null || named(posting.transaction)) continue;
    // Moving an account across the budget can end the crossing that gives a category its meaning.
    if (!crossesBudget(before, posting)) continue;
    if (accountsOf(before, posting.transaction) !== accountsOf(after, posting.transaction))
      continue;
    const later = after.filter(
      (each) => each.transaction === posting.transaction && each.account === posting.account,
    );
    if (!later.some((each) => each.category === posting.category))
      throw new RuleBroken(
        "Rule 8: a transfer's category stays while the transfer does",
        `${op} ${JSON.stringify(input)} took ${posting.category} off ${posting.id}`,
      );
  }
};

/** Rule 9: a category named in create_transaction is the category it gets, whatever rules match. */
export const pickedCategoryStays = (
  world: World,
  op: string,
  input: Record<string, any>,
  result: any,
) => {
  const picked = input["category"];
  if (op !== "create_transaction" || picked === undefined || input["splits"] !== undefined) return;
  const [own, other]: Array<any> = result.postings;
  if (input["transferAccount"] !== undefined) {
    const budgets = world.all(
      "SELECT DISTINCT on_budget FROM accounts WHERE id IN (?, ?)",
      own.accountId,
      other.accountId,
    );
    // A transfer that does not cross the budget has nowhere to carry a category.
    if (budgets.length === 1) return;
  }
  const kept = result.postings.some(
    (posting: any) => posting.accountId === picked || posting.categoryId === picked,
  );
  if (!kept)
    throw new RuleBroken(
      "Rule 9: a category named in create_transaction stays",
      `${JSON.stringify(input)} became ${JSON.stringify(result.postings)}`,
    );
};

/** What a rule may still refuse: the person's transaction is gone by that rule's own action. */
const RULE_MAY_REFUSE = /A rule deleted the transaction/;

/** Rule 10: a rule never makes a new transaction fail: the same write passes on the book without rules. */
export const noRuleRefuses = async (
  world: World,
  op: string,
  input: Record<string, unknown>,
  why: string,
) => {
  if (op !== "create_transaction" && op !== "import_transactions") return;
  if (RULE_MAY_REFUSE.test(why)) return;
  if (await world.succeedsWithoutRules(op, input))
    throw new RuleBroken(
      "Rule 10: a rule never makes a new transaction fail",
      `${op} ${JSON.stringify(input)} was refused (${why}), and passes with no rules`,
    );
};

/** Each category's set_carryover calls, in the order they came. */
export type Rollover = ReadonlyMap<string, ReadonlyArray<{ month: string; carryover: boolean }>>;

export const rolloverAfter = (
  rollover: Rollover,
  op: string,
  input: Record<string, any>,
): Rollover => {
  if (op !== "set_carryover") return rollover;
  const { category, month, carryover } = input;
  return new Map(rollover).set(category, [...(rollover.get(category) ?? []), { month, carryover }]);
};

/**
 * Rule 11: rollover in a month is what the latest set_carryover at or before that month said, off
 * before any, in every month, also those past the budget's range.
 */
export const rolloverAsSaid = async (world: World, rollover: Rollover) => {
  if (rollover.size === 0) return;
  const { range } = await world.call("get_budget", { count: 1 });
  const months = new Set([
    ...[...rollover.values()].flatMap((said) => said.map((each) => each.month)),
    addMonths(range.end, 1),
    addMonths(range.end, 2),
  ]);
  for (const month of months) {
    const view = await world.call("get_budget", { month, count: 1 });
    for (const { id, carryover } of view.months[0].categories) {
      const said = rollover.get(id);
      if (said === undefined) continue;
      const expected = said.findLast((each) => each.month <= month)?.carryover ?? false;
      if (carryover !== expected)
        throw new RuleBroken(
          "Rule 11: rollover stays as the latest set_carryover said",
          `${id} in ${month} is ${carryover}; set_carryover said ${JSON.stringify(said)}`,
        );
    }
  }
};

/**
 * Rule 12: merging needs a shared account and amount, and keeps what both copies had. The kept copy
 * keeps its counter postings when it has any of its own; an uncategorized one takes the dropped copy's.
 * A cleared mark on the shared posting of either copy stays.
 */
export const mergeKeepsBothCopies = (
  before: Postings,
  after: Postings,
  input: Record<string, any>,
) => {
  const broken = (detail: string) =>
    new RuleBroken("Rule 12: a merge keeps what both copies had", `${input["keep"]}: ${detail}`);
  const lines = (postings: Postings) =>
    postings.map((each) => `${each.account} ${each.amount} ${each.category}`).toSorted();
  const copy = (id: string) => before.filter((posting) => posting.transaction === id);
  const [keep, drop] = [copy(input["keep"]), copy(input["drop"])];
  const shared = keep.find(
    (posting) =>
      (posting.type === "asset" || posting.type === "liability") &&
      drop.some((each) => each.account === posting.account && each.amount === posting.amount),
  );
  if (shared === undefined) throw broken("the copies share no account and amount");
  const twin = drop.find(
    (each) => each.account === shared.account && each.amount === shared.amount,
  )!;
  const others = keep.filter((posting) => posting !== shared);
  const taken = others.every((posting) => posting.system === "uncategorized")
    ? drop.filter((each) => each !== twin)
    : others;
  const merged = after.filter((posting) => posting.transaction === input["keep"]);
  const [expected, found] = [lines([shared, ...taken]), lines(merged)];
  if (expected.join() !== found.join())
    throw broken(`expected ${expected.join(", ")}; found ${found.join(", ")}`);
  if (
    (shared.cleared || twin.cleared) &&
    !merged.some(
      (each) => each.account === shared.account && each.amount === shared.amount && each.cleared,
    )
  )
    throw broken("the shared posting lost its cleared mark");
};

const LEARNS = new Set(["create_transaction", "update_transaction", "update_transactions"]);

/** A rule learning may rewrite: one condition, "payee is X", and one action, setting a category. */
const learnable = (body: string) => {
  const { stage, conditions, actions } = bodyOf(body);
  return (
    stage === "default" &&
    conditions.length === 1 &&
    conditions[0].field === "payee" &&
    conditions[0].op === "is" &&
    actions.length === 1 &&
    actions[0].op === "set" &&
    actions[0].field === "category"
  );
};

/** Rule 13: a write about a transaction changes only the rules learning owns, "payee is X". */
export const onlyLearningRewritesRules = (before: RuleBodies, after: RuleBodies, op: string) => {
  if (!LEARNS.has(op)) return;
  const broken = (what: string) =>
    new RuleBroken(
      "Rule 13: a write about a transaction leaves other rules alone",
      `${op} ${what}`,
    );
  for (const [id, body] of before)
    if (after.get(id) !== body && !learnable(body))
      throw broken(`changed rule ${id}: ${body} to ${after.get(id) ?? "nothing"}`);
  for (const [id, body] of after)
    if (!before.has(id) && !learnable(body)) throw broken(`made rule ${id}: ${body}`);
};

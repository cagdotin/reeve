import type { RuleOverview } from "@reeve/contract/catalog";
import { accountLimits, addMonths, intToDay, monthOf, ruleCategory } from "@reeve/contract/rules";
import { sql } from "drizzle-orm";
import type { Book } from "../book.ts";
import type { Db } from "../db/open.ts";
import * as t from "../db/schema.ts";
import { accountsInScope, hasScope, type AccountScope } from "../ledger/account-scope.ts";
import { daysBetween, ruleDisagrees } from "../ledger/payee-insights.ts";
import type { Condition } from "./condition.ts";
import { currentDay, subDays } from "./dates.ts";
import { registerTransactions, rowMatches } from "./query.ts";
import { rankRules, type RuleTransaction } from "./rule.ts";
import { loadRules } from "./store.ts";
import type { RuleEntity } from "./types.ts";

const TREND_MONTHS = 12;
const LISTED_SUGGESTIONS = 50;
/** Unmatched transactions that make a payee worth a rule, as learning needs before it makes one. */
const REPEAT = 3;
/** Uncategorized transactions that make a payee worth a rule on their own. */
const UNCATEGORIZED_REPEAT = 2;

type Entry = ReturnType<typeof registerTransactions>[number];

const INDEXED = ["payee", "account", "category", "category_group"] as const;
type IndexedField = (typeof INDEXED)[number];

const isIndexed = (field: string): field is IndexedField =>
  (INDEXED as ReadonlyArray<string>).includes(field);

/**
 * The register rows by the ids they carry. A condition lowercases what it reads, so the keys do too:
 * this only narrows which rows to check, and has to find every row the condition would match.
 */
const indexEntries = (entries: ReadonlyArray<Entry>) => {
  const index = new Map(INDEXED.map((field) => [field, new Map<string, Array<number>>()] as const));
  entries.forEach((entry, order) => {
    for (const row of entry.rows)
      for (const field of INDEXED) {
        const value: unknown = row[field];
        if (typeof value !== "string") continue;
        const key = value.toLowerCase();
        const orders = index.get(field)!.get(key);
        if (orders === undefined) index.get(field)!.set(key, [order]);
        else if (orders.at(-1) !== order) orders.push(order);
      }
  });
  return index;
};

/** The rows a condition can match when it names ids, newest first; undefined when it does not. */
const rowsNamedBy = (condition: Condition, index: ReturnType<typeof indexEntries>) => {
  if (!isIndexed(condition.field)) return undefined;
  const values: ReadonlyArray<unknown> | null =
    condition.op === "is" ? [condition.value] : condition.op === "oneOf" ? condition.value : null;
  if (values === null || values.some((value) => typeof value !== "string")) return undefined;
  const byValue = index.get(condition.field)!;
  const lists = values.map((value) => byValue.get(value as string) ?? []);
  return lists.length === 1 ? lists[0]! : [...new Set(lists.flat())].toSorted((a, b) => a - b);
};

/** The fewest rows that can hold every match: a "payee is X" rule never reads the whole book. */
const candidatesOf = (
  conditions: ReadonlyArray<Condition>,
  conditionsOp: "and" | "or",
  index: ReturnType<typeof indexEntries>,
): ReadonlyArray<number> | undefined => {
  const lists = conditions.map((condition) => rowsNamedBy(condition, index));
  if (conditionsOp === "and") {
    const known = lists.filter((list) => list !== undefined);
    return known.length === 0
      ? undefined
      : known.reduce((least, list) => (list.length < least.length ? list : least));
  }
  if (lists.some((list) => list === undefined)) return undefined;
  return [...new Set(lists.flat() as Array<number>)].toSorted((a, b) => a - b);
};

/** Recurring dates are by far the slowest to check, so they go after what may rule a row out. */
const cheapestFirst = (conditions: ReadonlyArray<Condition>) =>
  conditions.toSorted((a, b) => Number(a.field === "date") - Number(b.field === "date"));

const TEXT_FIELDS = new Set(["imported_payee", "counterparty_account", "payee_name", "notes"]);

/** JSON that ignores key order, since rules are written by several hands. */
const canonical = (item: object) =>
  JSON.stringify(Object.entries(item).toSorted(([a], [b]) => a.localeCompare(b)));

const sortedJson = (items: ReadonlyArray<object>) => items.map(canonical).toSorted().join();

const normalValue = (field: string, value: unknown): unknown => {
  const each = (one: unknown) =>
    TEXT_FIELDS.has(field) && typeof one === "string" ? one.toLowerCase() : one;
  return Array.isArray(value) ? value.map(each).map(String).toSorted() : each(value);
};

/** Conditions in any order, with text in any case, as they match; one has no "and" or "or". */
const conditionsKey = (rule: RuleEntity) => {
  const normal = rule.conditions.map((each) => ({
    ...each,
    value: normalValue(each.field, each.value),
  }));
  return `${rule.conditions.length < 2 ? "" : rule.conditionsOp}:${sortedJson(normal)}`;
};

const duplicatedRules = (rules: ReadonlyArray<RuleEntity>) => {
  const groups = Map.groupBy(
    rules,
    // Actions compare exactly: their values are written as given and they run in this order.
    (rule) => `${rule.stage}|${conditionsKey(rule)}|${rule.actions.map(canonical).join()}`,
  );
  return new Set([...groups.values()].filter((same) => same.length > 1).flat());
};

const conflictingRules = (rules: ReadonlyArray<RuleEntity>) => {
  const setters = rules.filter((rule) => ruleCategory(rule.actions) !== null);
  const groups = Map.groupBy(setters, conditionsKey);
  return new Set(
    [...groups.values()]
      .filter((same) => new Set(same.map((rule) => ruleCategory(rule.actions))).size > 1)
      .flat(),
  );
};

const FIELDS_READ: Readonly<Record<string, ReadonlyArray<string>>> = {
  category: ["category", "category_group"],
  payee: ["payee", "payee_name"],
  payee_name: ["payee", "payee_name"],
};

/**
 * Whether a rule removes the evidence of itself, so that a lack of matches says nothing: it deletes
 * what it matches, or changes a field its conditions read, as "payee is A → set payee to B" does.
 */
const erasesItsMatches = (rule: RuleEntity) =>
  rule.actions.some((action) => {
    if (action.op === "delete-transaction") return true;
    if (action.op !== "set") return false;
    const read = FIELDS_READ[action.field] ?? [action.field];
    return rule.conditions.some((condition) => read.includes(condition.field));
  });

type Stale = RuleOverview["rules"][number]["problems"]["stale"][number];

const STALE_FIELDS = new Set(["account", "category", "category_group", "payee"]);
const NAMING_OPS = new Set(["is", "isNot", "oneOf", "notOneOf"]);

/** What can make a name a rule uses stale: hidden categories and groups, closed accounts, none. */
const staleLookup = (db: Db) => {
  const groups = new Map(
    db
      .select()
      .from(t.categoryGroups)
      .all()
      .map((row) => [row.id, row]),
  );
  const accounts = new Map(
    db
      .select()
      .from(t.accounts)
      .all()
      .map((row) => [row.id, row]),
  );
  const payees = new Set(
    db
      .select({ id: t.payees.id })
      .from(t.payees)
      .all()
      .map((row) => row.id),
  );
  return (field: Stale["field"], id: string): Stale | null => {
    if (field === "payee") return payees.has(id) ? null : { state: "deleted", field, name: null };
    if (field === "category_group") {
      const group = groups.get(id);
      if (group === undefined) return { state: "deleted", field, name: null };
      return group.hidden ? { state: "hidden", field, name: group.name } : null;
    }
    const account = accounts.get(id);
    if (account === undefined) return { state: "deleted", field, name: null };
    if (field === "account")
      return account.closed ? { state: "closed", field, name: account.name } : null;
    const hidden =
      account.hidden || (account.groupId !== null && groups.get(account.groupId)?.hidden === true);
    return hidden ? { state: "hidden", field, name: account.name } : null;
  };
};

const staleNames = (rule: RuleEntity, lookup: ReturnType<typeof staleLookup>) => {
  const named = [
    ...rule.conditions
      .filter((condition) => NAMING_OPS.has(condition.op))
      .map(({ field, value }) => ({ field: field as string, value })),
    ...rule.actions.flatMap((action) =>
      action.op === "set" && action.template === undefined && action.formula === undefined
        ? [{ field: action.field as string, value: action.value }]
        : [],
    ),
  ];
  const seen = new Map<string, Stale>();
  for (const { field, value } of named) {
    if (!STALE_FIELDS.has(field)) continue;
    for (const id of Array.isArray(value) ? value : [value]) {
      if (typeof id !== "string") continue;
      const stale = lookup(field as Stale["field"], id);
      if (stale !== null) seen.set(`${field}:${id}`, stale);
    }
  }
  return [...seen.values()];
};

interface TransactionFact {
  readonly id: string;
  readonly day: string;
  readonly payee: string | null;
  /** It has a category or could have one: not a transfer or an opening balance. */
  readonly countable: boolean;
  /** Uncategorized as the register's Uncategorized view counts it. */
  readonly uncategorized: boolean;
}

const transactionFacts = (db: Db): Array<TransactionFact> =>
  db
    .all<{
      id: string;
      date: number;
      payee: string | null;
      categorized: number | null;
      missing: number | null;
      on_budget: number | null;
    }>(
      sql`SELECT t.id, t.date, t.payee_id AS payee,
            max(a.type IN ('expense', 'income') AND a.system IS NULL) AS categorized,
            max(a.system = 'uncategorized') AS missing,
            max(a.type IN ('asset', 'liability') AND a.on_budget = 1) AS on_budget
          FROM transactions t
          JOIN postings p ON p.transaction_id = t.id
          JOIN accounts a ON a.id = p.account_id
          GROUP BY t.id`,
    )
    .map((row) => ({
      id: row.id,
      day: intToDay(row.date),
      payee: row.payee,
      countable: row.categorized === 1 || row.missing === 1,
      uncategorized: row.missing === 1 && row.on_budget === 1,
    }));

/** The category most of a payee's transactions carry; a split counts for each of its categories. */
const majorityCategory = (counts: ReadonlyMap<string, number>) => {
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const ranked = [...counts].toSorted((a, b) => b[1] - a[1]);
  const [top] = ranked;
  return top !== undefined && top[1] * 2 > total ? top[0] : null;
};

const suggestionsFrom = (
  db: Db,
  facts: ReadonlyArray<TransactionFact>,
  categorySetters: ReadonlySet<string>,
  categoriesOf: ReadonlyMap<string, ReadonlyArray<string>>,
  firstMonth: string,
) => {
  const tally = new Map<
    string,
    { unmatched: number; uncategorized: number; last: string; categories: Map<string, number> }
  >();
  for (const fact of facts) {
    if (fact.payee === null || !fact.countable || monthOf(fact.day) < firstMonth) continue;
    const own = tally.get(fact.payee) ?? {
      unmatched: 0,
      uncategorized: 0,
      last: fact.day,
      categories: new Map<string, number>(),
    };
    tally.set(fact.payee, own);
    if (fact.day > own.last) own.last = fact.day;
    for (const category of categoriesOf.get(fact.id) ?? [])
      own.categories.set(category, (own.categories.get(category) ?? 0) + 1);
    if (categorySetters.has(fact.id)) continue;
    own.unmatched += 1;
    if (fact.uncategorized) own.uncategorized += 1;
  }
  const payees = new Map(
    db
      .select({ id: t.payees.id, name: t.payees.name })
      .from(t.payees)
      .all()
      .map((row) => [row.id, row.name]),
  );
  const categories = new Map(
    db
      .select({ id: t.accounts.id, name: t.accounts.name })
      .from(t.accounts)
      .all()
      .map((row) => [row.id, row.name]),
  );
  return [...tally]
    .filter(([, own]) => own.unmatched >= REPEAT || own.uncategorized >= UNCATEGORIZED_REPEAT)
    .map(([id, own]) => {
      const category = majorityCategory(own.categories);
      return {
        id,
        name: payees.get(id) ?? "",
        unmatched: own.unmatched,
        uncategorized: own.uncategorized,
        lastTransaction: own.last,
        category,
        categoryName: category === null ? null : (categories.get(category) ?? null),
      };
    })
    .toSorted(
      (a, b) =>
        b.uncategorized - a.uncategorized ||
        b.unmatched - a.unmatched ||
        a.name.localeCompare(b.name),
    );
};

type Ranked = ReturnType<typeof rankRules>[number];

/** What an account condition reads of a transaction, for each account in a scope. */
const scopeRows = (db: Db, ids: ReadonlyArray<string>): Array<RuleTransaction> => {
  const wanted = new Set(ids);
  return db
    .select({ id: t.accounts.id, name: t.accounts.name, onBudget: t.accounts.onBudget })
    .from(t.accounts)
    .all()
    .filter((account) => wanted.has(account.id))
    .map((account) => ({
      account: account.id,
      _account: { offbudget: account.onBudget ? 0 : 1 },
      _names: { account: account.name },
    }));
};

export const ruleActivity = (
  book: Book,
  input: AccountScope & { readonly since?: string },
): RuleOverview => {
  const { db } = book;
  const { since } = input;
  const today = currentDay();
  const previousSince = since === undefined ? null : subDays(since, daysBetween(since, today) + 1);
  const inRange = (day: string) => since === undefined || day >= since;
  const inPrevious = (day: string) =>
    previousSince !== null && since !== undefined && day >= previousSince && day < since;

  const thisMonth = monthOf(today);
  const monthNames = Array.from({ length: TREND_MONTHS }, (_, index) =>
    addMonths(thisMonth, index + 1 - TREND_MONTHS),
  );
  const monthIndex = new Map(monthNames.map((month, index) => [month, index]));
  const firstMonth = monthNames[0]!;

  const entries = registerTransactions(db);
  const index = indexEntries(entries);
  const everyFact = transactionFacts(db);
  const factOf = new Map(everyFact.map((fact) => [fact.id, fact]));
  const scoped = hasScope(input);
  const accounts = new Set(scoped ? accountsInScope(book, input) : []);
  const onScope = (entry: Entry) => !scoped || accounts.has(entry.match.accountId);
  const rowsOfScope = scopeRows(db, [...accounts]);
  const touched = new Set(entries.filter(onScope).map((entry) => entry.match.transactionId));
  const facts = scoped ? everyFact.filter((fact) => touched.has(fact.id)) : everyFact;
  const categoriesOf = new Map<string, Array<string>>();
  for (const { match, rows } of entries)
    for (const { category } of rows)
      if (typeof category === "string") {
        const own = categoriesOf.get(match.transactionId) ?? [];
        categoriesOf.set(match.transactionId, own);
        if (!own.includes(category)) own.push(category);
      }

  const schedules = new Map(
    db
      .select({
        id: t.schedules.id,
        rule: t.schedules.ruleId,
        name: t.schedules.name,
        completed: t.schedules.completed,
      })
      .from(t.schedules)
      .all()
      .map(({ rule, ...schedule }) => [rule, schedule]),
  );
  const loaded = loadRules(db);
  const entityOf = new Map(loaded.map(({ entity, rule }) => [rule, entity]));
  const ranked = rankRules(loaded.map(({ rule }) => rule));
  const entities = ranked.map((rule) => entityOf.get(rule)!);
  const duplicates = duplicatedRules(entities);
  const conflicts = conflictingRules(entities);
  const lookup = staleLookup(db);

  const covered = new Set<string>();
  const coveredByCategoryRule = new Set<string>();
  const activeMonths = new Array<number>(TREND_MONTHS).fill(0);
  let active = 0;
  let activeBefore = 0;

  const canAct = (rule: Ranked) => {
    const limits = accountLimits(rule);
    return (
      !scoped ||
      limits.length === 0 ||
      rowsOfScope.some((row) => rowMatches([row], limits, rule.conditionsOp))
    );
  };

  const rules = ranked.flatMap((rule, position) => {
    if (!canAct(rule)) return [];
    const entity = entityOf.get(rule)!;
    const conditions = cheapestFirst(rule.conditions);
    const candidates =
      conditions.length === 0 ? [] : candidatesOf(conditions, rule.conditionsOp, index);
    const setsCategory = entity.actions.some(
      (action) => action.op === "set" && action.field === "category",
    );
    const category = ruleCategory(entity.actions);
    const seen = new Set<string>();
    const months = new Array<number>(TREND_MONTHS).fill(0);
    const categorizedNewestFirst: Array<ReadonlyArray<string>> = [];
    let matches = 0;
    let matchesBefore = 0;
    let lastMatch = null as string | null;
    let carrying = 0;
    let recent = false;
    const pool = candidates === undefined ? entries : candidates.map((order) => entries[order]!);
    for (const entry of pool) {
      if (!rowMatches(entry.rows, conditions, rule.conditionsOp)) continue;
      const id = entry.match.transactionId;
      const day = factOf.get(id)!.day;
      recent ||= monthIndex.has(monthOf(day));
      if (!onScope(entry) || seen.has(id)) continue;
      seen.add(id);
      lastMatch ??= day;
      if (inRange(day)) matches += 1;
      else if (inPrevious(day)) matchesBefore += 1;
      const month = monthIndex.get(monthOf(day));
      if (month !== undefined) months[month]! += 1;
      covered.add(id);
      if (setsCategory) coveredByCategoryRule.add(id);
      const carried = categoriesOf.get(id);
      if (category !== null && carried !== undefined) {
        categorizedNewestFirst.push(carried);
        if (carried.includes(category)) carrying += 1;
      }
    }

    if (matches > 0) active += 1;
    if (matchesBefore > 0) activeBefore += 1;
    months.forEach((count, month) => {
      if (count > 0) activeMonths[month]! += 1;
    });
    const schedule = schedules.get(entity.id) ?? null;
    return {
      ...entity,
      position: position + 1,
      schedule,
      everyAccount: accountLimits(rule).length === 0,
      matches,
      totalMatches: seen.size,
      lastMatch,
      months,
      categorized: categorizedNewestFirst.length,
      carryingCategory: carrying,
      problems: {
        conflict: conflicts.has(entity),
        duplicate: duplicates.has(entity),
        quiet: everyFact.length > 0 && !recent && schedule === null && !erasesItsMatches(entity),
        disagrees: category !== null && ruleDisagrees(categorizedNewestFirst, new Set([category])),
        stale: staleNames(entity, lookup),
      },
    };
  });

  const countable = facts.filter((fact) => fact.countable);
  const totalsOf = (isIn: (day: string) => boolean) => {
    const within = countable.filter((fact) => isIn(fact.day));
    return {
      transactions: within.length,
      covered: within.filter((fact) => covered.has(fact.id)).length,
      uncategorized: within.filter((fact) => fact.uncategorized).length,
    };
  };
  const months = monthNames.map((month, position) => ({
    month,
    active: activeMonths[position]!,
    ...totalsOf((day) => monthOf(day) === month),
  }));

  const suggestions = suggestionsFrom(db, facts, coveredByCategoryRule, categoriesOf, firstMonth);
  return {
    rules,
    summary: {
      active,
      ...totalsOf(inRange),
      previous: previousSince === null ? null : { active: activeBefore, ...totalsOf(inPrevious) },
    },
    months,
    suggestions: suggestions.slice(0, LISTED_SUGGESTIONS),
    suggestionCount: suggestions.length,
    uncategorizedPayees: suggestions.filter((each) => each.uncategorized >= UNCATEGORIZED_REPEAT)
      .length,
  };
};

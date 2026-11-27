import type { PayeeOverview } from "@reeve/contract";
import { addMonths, intToDay, monthOf } from "@reeve/contract/rules";
import { sql } from "drizzle-orm";
import type { Book } from "../book.ts";
import type { Db } from "../db/open.ts";
import * as t from "../db/schema.ts";
import { currentDay, subDays } from "../rules/dates.ts";
import { accountsInScope, hasScope, type AccountScope } from "./account-scope.ts";
import { daysBetween, latestPriceChange, quietFor, ruleDisagrees } from "./payee-insights.ts";
import { listPayees, payeesNamedBy, type RuleItem } from "./payees.ts";

const TREND_MONTHS = 12;
const LISTED = 5;

/** What each payee's rules say: how many name it, a schedule among them, what plain ones set. */
const payeeRuleFacts = (db: Db) => {
  const scheduledRules = new Set(
    db
      .select({ rule: t.schedules.ruleId })
      .from(t.schedules)
      .all()
      .map((row) => row.rule),
  );
  const counts = new Map<string, number>();
  const scheduled = new Set<string>();
  const setters = new Set<string>();
  const duplicated = new Set<string>();
  const sets = new Map<string, Set<string>>();
  for (const rule of db.select().from(t.rules).all()) {
    for (const id of payeesNamedBy(rule)) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
      if (scheduledRules.has(rule.id)) scheduled.add(id);
    }
    const [condition, ...moreConditions] = rule.conditions as Array<RuleItem>;
    const [action, ...moreActions] = rule.actions as Array<RuleItem>;
    if (
      rule.stage === "default" &&
      moreConditions.length === 0 &&
      moreActions.length === 0 &&
      condition?.field === "payee" &&
      condition.op === "is" &&
      typeof condition.value === "string" &&
      action?.op === "set" &&
      action.field === "category" &&
      typeof action.value === "string"
    ) {
      const key = JSON.stringify([condition.value, action.value]);
      if (setters.has(key)) duplicated.add(condition.value);
      setters.add(key);
      sets.set(condition.value, (sets.get(condition.value) ?? new Set<string>()).add(action.value));
    }
  }
  return { counts, scheduled, duplicated, sets };
};

interface PayeeLine {
  readonly payee: string;
  readonly date: string;
  readonly spent: number;
}

const onAccounts = (accounts: ReadonlyArray<string> | null) =>
  accounts === null
    ? sql``
    : sql`AND EXISTS (SELECT 1 FROM postings own WHERE own.transaction_id = t.id
        AND own.account_id IN (${sql.join(
          accounts.map((id) => sql`${id}`),
          sql`, `,
        )}))`;

/** Every transaction naming a payee with what it spent on expense categories, oldest first. */
const payeeLines = (db: Db, accounts: ReadonlyArray<string> | null): Array<PayeeLine> =>
  db
    .all<{ payee: string; date: number; spent: number | null }>(
      sql`SELECT t.payee_id AS payee, t.date,
            (SELECT sum(p.amount) FROM postings p
             JOIN accounts a ON a.id = p.account_id AND a.type = 'expense'
             WHERE p.transaction_id = t.id) AS spent
          FROM transactions t
          WHERE t.payee_id IS NOT NULL ${onAccounts(accounts)}
          ORDER BY t.date, t.created_at`,
    )
    .map((row) => ({ ...row, date: intToDay(row.date), spent: row.spent ?? 0 }));

/** Each transaction's budget categories, by payee, newest first. */
const payeeCategories = (db: Db, accounts: ReadonlyArray<string> | null) => {
  const rows = db.all<{ payee: string; tx: string; id: string; name: string }>(
    sql`SELECT t.payee_id AS payee, t.id AS tx, a.id, a.name
        FROM transactions t
        JOIN postings p ON p.transaction_id = t.id
        JOIN accounts a ON a.id = p.account_id
          AND a.type IN ('expense', 'income') AND a.system IS NULL
        WHERE t.payee_id IS NOT NULL ${onAccounts(accounts)}
        ORDER BY t.date DESC, t.created_at DESC`,
  );
  const names = new Map(rows.map((row) => [row.id, row.name]));
  const byPayee = new Map<string, Map<string, Array<string>>>();
  for (const { payee, tx, id } of rows) {
    const transactions = byPayee.get(payee) ?? new Map<string, Array<string>>();
    transactions.set(tx, [...(transactions.get(tx) ?? []), id]);
    byPayee.set(payee, transactions);
  }
  return { names, byPayee };
};

const totalsOf = (
  lines: ReadonlyArray<PayeeLine>,
  firsts: ReadonlyMap<string, string>,
  isIn: (day: string) => boolean,
) => {
  const within = lines.filter((line) => isIn(line.date));
  const payees = new Set(within.map((line) => line.payee));
  return {
    payees: payees.size,
    newPayees: [...payees].filter((id) => isIn(firsts.get(id)!)).length,
    transactions: within.length,
    spent: within.reduce((sum, line) => sum + line.spent, 0),
  };
};

const spentByPayee = (lines: ReadonlyArray<PayeeLine>, isIn: (day: string) => boolean) => {
  const spent = new Map<string, number>();
  for (const line of lines)
    if (isIn(line.date)) spent.set(line.payee, (spent.get(line.payee) ?? 0) + line.spent);
  return spent;
};

/** The payees whose spending moved most between two periods. */
const moversOf = (
  spent: ReadonlyMap<string, number>,
  before: ReadonlyMap<string, number>,
  named: ReadonlyMap<string, string>,
) =>
  [...new Set([...spent.keys(), ...before.keys()])]
    .map((id) => ({
      id,
      name: named.get(id)!,
      spent: spent.get(id) ?? 0,
      previousSpent: before.get(id) ?? 0,
    }))
    .filter((mover) => mover.spent !== mover.previousSpent)
    .toSorted(
      (a, b) =>
        Math.abs(b.spent - b.previousSpent) - Math.abs(a.spent - a.previousSpent) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, LISTED);

export const payeeActivity = (
  book: Book,
  input: AccountScope & { readonly since?: string },
): PayeeOverview => {
  const today = currentDay();
  const { since } = input;
  const inRange = (day: string) => since === undefined || day >= since;
  const scoped = hasScope(input);
  const accounts = scoped ? accountsInScope(book, input) : null;
  const lines = payeeLines(book.db, accounts);
  const linesOf = Map.groupBy(lines, (line) => line.payee);
  const firsts = new Map([...linesOf].map(([id, own]) => [id, own[0]!.date]));
  const { names: categoryNames, byPayee: categoriesOf } = payeeCategories(book.db, accounts);
  const { counts, scheduled, duplicated, sets } = payeeRuleFacts(book.db);
  const spent = spentByPayee(lines, inRange);

  const listed = listPayees(book).filter((payee) => !scoped || linesOf.has(payee.id));
  const all = listed.map((payee) => {
    const own = linesOf.get(payee.id) ?? [];
    const transactions = [...(categoriesOf.get(payee.id)?.values() ?? [])];
    const uses = new Map<string, number>();
    for (const ids of transactions)
      for (const id of new Set(ids)) uses.set(id, (uses.get(id) ?? 0) + 1);
    return {
      ...payee,
      transactionCount: scoped ? own.length : payee.transactionCount,
      rangeTransactions: own.filter((line) => inRange(line.date)).length,
      rangeSpent: spent.get(payee.id) ?? 0,
      lastTransaction: own.at(-1)?.date ?? null,
      categories: [...uses]
        .map(([id, count]) => ({ id, name: categoryNames.get(id)!, transactions: count }))
        .toSorted((a, b) => b.transactions - a.transactions || a.name.localeCompare(b.name)),
      ruleCount: counts.get(payee.id) ?? 0,
      scheduled: scheduled.has(payee.id),
      duplicateRules: duplicated.has(payee.id),
      ruleDisagrees: ruleDisagrees(transactions, sets.get(payee.id) ?? new Set()),
      newInRange: since !== undefined && own[0] !== undefined && own[0].date >= since,
    };
  });
  const named = new Map(all.map((payee) => [payee.id, payee.name]));

  const previousSince = since === undefined ? null : subDays(since, daysBetween(since, today) + 1);
  const inPrevious = (day: string) =>
    previousSince !== null && since !== undefined && day >= previousSince && day < since;

  const thisMonth = monthOf(today);
  const months = Array.from({ length: TREND_MONTHS }, (_, index) => {
    const month = addMonths(thisMonth, index + 1 - TREND_MONTHS);
    return { month, ...totalsOf(lines, firsts, (day) => monthOf(day) === month) };
  });

  const priceChanges = [...linesOf].flatMap(([id, own]) => {
    const change = latestPriceChange(own.map(({ date, spent: amount }) => ({ date, amount })));
    return change === null ? [] : [{ id, name: named.get(id)!, ...change }];
  });
  const quiet = [...linesOf].flatMap(([id, own]) => {
    const silence = quietFor(
      own.map((line) => line.date),
      today,
    );
    return silence === null
      ? []
      : [{ id, name: named.get(id)!, lastTransaction: own.at(-1)!.date, ...silence }];
  });

  return {
    payees: since === undefined ? all : all.filter((payee) => payee.rangeTransactions > 0),
    total: all.length,
    earliest: lines[0]?.date ?? null,
    summary: {
      ...totalsOf(lines, firsts, inRange),
      previous: previousSince === null ? null : totalsOf(lines, firsts, inPrevious),
    },
    months,
    movers: since === undefined ? [] : moversOf(spent, spentByPayee(lines, inPrevious), named),
    priceChanges: priceChanges
      .toSorted((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name))
      .slice(0, LISTED),
    quiet: quiet
      .toSorted((a, b) => a.silentDays - b.silentDays || a.name.localeCompare(b.name))
      .slice(0, LISTED),
    attention: {
      unused: all.filter((payee) => payee.transactionCount === 0).length,
      repeatWithoutRule: all.filter((payee) => payee.transactionCount >= 3 && payee.ruleCount === 0)
        .length,
      duplicateRules: all.filter((payee) => payee.duplicateRules).length,
      ruleDisagrees: all.filter((payee) => payee.ruleDisagrees).length,
    },
  };
};

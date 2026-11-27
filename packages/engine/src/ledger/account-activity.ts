import { addDays, addMonths, dayToInt, intToDay, lastDay, monthRange } from "@reeve/contract/rules";
import type { catalog } from "@reeve/contract/catalog";
import type { Book } from "../book.ts";
import { accountsInScope } from "./account-scope.ts";
import { currentDay } from "../rules/dates.ts";
import { forecastBalances } from "../schedules/forecast.ts";
import { listScheduledTransactions } from "../schedules/schedules.ts";

type AccountActivity = (typeof catalog)["account_activity"]["success"]["Type"];

const STALE_DAYS = 30;
const LISTED = 6;
/** Months after this one the projection reaches: further out, schedules alone say little. */
const PROJECTED_MONTHS = 2;
/** A mistyped year must not make a chart of thousands of months. */
const MAX_MONTHS = 240;
const MAX_FUTURE_MONTHS = 12;

// Subqueries that SQLite builds once: correlated per row, these took seconds on 20,000 transactions.
const UNCATEGORIZED_ROW = `t.id IN (
  SELECT q.transaction_id FROM postings q JOIN accounts c ON c.id = q.account_id
  WHERE c.system = 'uncategorized')`;

const OPENING_ROW = `t.id IN (
  SELECT e.transaction_id FROM postings e JOIN accounts x ON x.id = e.account_id
  WHERE x.type = 'equity')`;

const placeholders = (values: ReadonlyArray<unknown>) => values.map(() => "?").join(", ");
const monthOfInt = (value: number) => {
  const text = String(value);
  return `${text.slice(0, 4)}-${text.slice(4, 6)}`;
};

interface Input {
  readonly account?: string;
  readonly onBudget?: boolean;
  readonly uncategorized?: boolean;
  readonly months?: number;
  readonly month?: string;
}

/** The accounts in scope, closed ones too: their past is part of the balance's history. */
const scopeOf = (book: Book, input: Input): Array<string> =>
  accountsInScope(book, input.uncategorized === true ? { ...input, onBudget: true } : input);

interface Moved {
  readonly change: number;
  readonly opening: number;
  readonly count: number;
}

/** What each month did to the scope's balance. */
const movedByMonth = (book: Book, scope: ReadonlyArray<string>, uncategorized: boolean) =>
  new Map(
    (
      book.client
        .prepare(
          `SELECT t.date / 100 AS month, sum(p.amount) AS change, count(*) AS count,
             sum(CASE WHEN ${OPENING_ROW} THEN p.amount ELSE 0 END) AS opening
           FROM postings p JOIN transactions t ON t.id = p.transaction_id
           WHERE p.account_id IN (${placeholders(scope)})
             ${uncategorized ? `AND ${UNCATEGORIZED_ROW}` : ""}
           GROUP BY t.date / 100`,
        )
        .all(...scope) as unknown as Array<Moved & { month: number }>
    ).map((row): [string, Moved] => [monthOfInt(row.month), row]),
  );

interface Leg {
  readonly month: string;
  readonly category: string;
  readonly categoryName: string;
  readonly categoryType: string;
  readonly payee: string | null;
  readonly payeeName: string | null;
  readonly in: number;
  readonly out: number;
  readonly count: number;
}

/**
 * The category lines of the scope's transactions, each in the direction it went. They all belong
 * to the balance postings on the side their net faces, shared by amount: in "Checking pays Food 60
 * and Savings 40", Food is all Checking's and none of Savings', which only received a transfer. A
 * paycheck of income 1000 and tax 200 into Checking is net money in, so both lines are Checking's.
 */
const categoryLegs = (
  book: Book,
  scope: ReadonlyArray<string>,
  uncategorized: boolean,
): Array<Leg> => {
  const list = placeholders(scope);
  const rows = book.client
    .prepare(
      `WITH balances AS (
         SELECT p.transaction_id AS tx,
           sum(CASE WHEN a.type IN ('expense', 'income') THEN p.amount ELSE 0 END) AS net,
           sum(CASE WHEN a.type IN ('asset', 'liability') THEN min(p.amount, 0) ELSE 0 END) AS credit,
           sum(CASE WHEN a.type IN ('asset', 'liability') THEN max(p.amount, 0) ELSE 0 END) AS debit,
           sum(CASE WHEN p.account_id IN (${list}) THEN min(p.amount, 0) ELSE 0 END) AS scope_credit,
           sum(CASE WHEN p.account_id IN (${list}) THEN max(p.amount, 0) ELSE 0 END) AS scope_debit
         FROM postings p JOIN accounts a ON a.id = p.account_id
         GROUP BY p.transaction_id
         HAVING scope_credit <> 0 OR scope_debit <> 0
       ),
       shares AS (
         SELECT tx,
           CASE WHEN net >= 0 AND credit <> 0 THEN scope_credit * 1.0 / credit
                WHEN debit <> 0 THEN scope_debit * 1.0 / debit
                WHEN credit <> 0 THEN scope_credit * 1.0 / credit
                ELSE 0 END AS share
         FROM balances
       )
       SELECT t.date / 100 AS month, q.account_id AS category, c.name AS categoryName,
         c.type AS categoryType, t.payee_id AS payee, pe.name AS payeeName, count(*) AS count,
         round(sum(max(q.amount, 0) * b.share)) AS out,
         round(sum(max(-q.amount, 0) * b.share)) AS "in"
       FROM shares b
       JOIN transactions t ON t.id = b.tx
       JOIN postings q ON q.transaction_id = b.tx
       JOIN accounts c ON c.id = q.account_id AND c.type IN ('expense', 'income')
       LEFT JOIN payees pe ON pe.id = t.payee_id
       ${uncategorized ? "WHERE c.system = 'uncategorized'" : ""}
       GROUP BY t.date / 100, q.account_id, t.payee_id`,
    )
    .all(...scope, ...scope) as unknown as Array<Omit<Leg, "month"> & { month: number }>;
  return rows.map((row) => ({ ...row, month: monthOfInt(row.month) }));
};

/** Sums category lines for ranking, in a period and in the one before it. */
const rankBy = (
  legs: ReadonlyArray<Leg>,
  idOf: (leg: Leg) => string | null,
  nameOf: (leg: Leg) => string | null,
  inPeriod: (month: string) => boolean,
  inPrevious: (month: string) => boolean,
) => {
  const ranks = new Map<
    string,
    { id: string; name: string; amount: number; previous: number; count: number }
  >();
  for (const leg of legs) {
    const id = idOf(leg);
    const here = inPeriod(leg.month);
    if (id === null || (!here && !inPrevious(leg.month))) continue;
    const rank = ranks.get(id) ?? {
      id,
      name: nameOf(leg) ?? "",
      amount: 0,
      previous: 0,
      count: 0,
    };
    if (here) {
      rank.amount += leg.out - leg.in;
      rank.count += leg.count;
    } else rank.previous += leg.out - leg.in;
    ranks.set(id, rank);
  }
  return [...ranks.values()];
};

/** What the scope's register rows wait on, and how far reconciling has got. */
const tidiness = (
  book: Book,
  scope: ReadonlyArray<string>,
  schedulable: ReadonlyArray<string>,
  today: string,
) => {
  const staleBy = dayToInt(addDays(today, -(STALE_DAYS + 1)));
  const row = book.client
    .prepare(
      `SELECT
         coalesce(sum(p.cleared = 0 AND p.reconciled = 0 AND t.date <= ?), 0) AS oldUncleared,
         coalesce(sum(p.cleared = 1 AND p.reconciled = 0), 0) AS toReconcile,
         max(CASE WHEN p.reconciled = 1 THEN t.date END) AS lastReconciled,
         coalesce(sum(a.on_budget = 1 AND ${UNCATEGORIZED_ROW}), 0) AS uncategorized
       FROM postings p
       JOIN transactions t ON t.id = p.transaction_id
       JOIN accounts a ON a.id = p.account_id
       WHERE p.account_id IN (${placeholders(scope)})`,
    )
    .get(staleBy, ...scope) as {
    oldUncleared: number;
    toReconcile: number;
    lastReconciled: number | null;
    uncategorized: number;
  };
  const scheduled = listScheduledTransactions(book, {}).filter(
    (each) => each.accountId !== null && schedulable.includes(each.accountId),
  );
  return {
    uncategorized: row.uncategorized,
    oldUncleared: row.oldUncleared,
    toReconcile: row.toReconcile,
    lastReconciled: row.lastReconciled === null ? null : intToDay(row.lastReconciled),
    missedSchedules: new Set(
      scheduled
        .filter((each) => each.status === "missed" && !each.forceUpcoming)
        .map((each) => each.scheduleId),
    ).size,
  };
};

/**
 * Month-end balances with the schedules' coming transactions added, from the balance recorded for
 * this month on. Missed occurrences stay out: they did not happen and may never. The forecast
 * carries both sides of a transfer, so one inside the scope cancels out.
 */
const projectionOf = (
  book: Book,
  scope: ReadonlyArray<string>,
  today: string,
  balanceAt: (month: string) => number,
): AccountActivity["projection"] => {
  const thisMonth = today.slice(0, 7);
  const end = addMonths(thisMonth, PROJECTED_MONTHS);
  const scheduled = new Map<string, number>();
  for (const point of forecastBalances(book, {
    accounts: scope,
    from: today,
    to: lastDay(end),
  }).dataPoints)
    for (const each of point.transactions) {
      const month = point.date.slice(0, 7);
      scheduled.set(month, (scheduled.get(month) ?? 0) + each.amount);
    }
  if (scheduled.size === 0) return [];
  // The rest of this month shows in the next point, so the line starts on what is recorded.
  let added = scheduled.get(thisMonth) ?? 0;
  return monthRange(thisMonth, end).map((month, index) => {
    if (index === 0) return { month, balance: balanceAt(month), scheduled: 0 };
    const step = (scheduled.get(month) ?? 0) + (index === 1 ? added : 0);
    if (index > 1) added += step;
    else added = step;
    return { month, balance: balanceAt(month) + added, scheduled: step };
  });
};

/** A closed account's schedules count on that account's own page and nowhere else. */
const schedulableOf = (book: Book, scope: ReadonlyArray<string>, input: Input) =>
  input.account !== undefined || scope.length === 0
    ? scope
    : (
        book.client
          .prepare(`SELECT id FROM accounts WHERE closed = 0 AND id IN (${placeholders(scope)})`)
          .all(...scope) as Array<{ id: string }>
      ).map((row) => row.id);

const empty = { in: 0, out: 0, transfers: 0, opening: 0, count: 0 };

export const accountActivity = (book: Book, input: Input): AccountActivity => {
  const today = currentDay();
  const thisMonth = today.slice(0, 7);
  const uncategorized = input.uncategorized === true;
  const uncategorizedId =
    (
      book.client.prepare("SELECT id FROM accounts WHERE system = 'uncategorized'").get() as
        | { id: string }
        | undefined
    )?.id ?? null;
  const scope = scopeOf(book, input);
  const moved =
    scope.length === 0 ? new Map<string, Moved>() : movedByMonth(book, scope, uncategorized);
  const legs = scope.length === 0 ? [] : categoryLegs(book, scope, uncategorized);
  const recorded = [...moved.keys()].toSorted();
  const earliest = recorded[0] ?? null;

  const inOut = new Map<string, { in: number; out: number }>();
  for (const leg of legs) {
    const totals = inOut.get(leg.month) ?? { in: 0, out: 0 };
    totals.in += leg.in;
    totals.out += leg.out;
    inOut.set(leg.month, totals);
  }
  const totalsOf = (month: string) => {
    const { change = 0, opening = 0, count = 0 } = moved.get(month) ?? {};
    const money = inOut.get(month) ?? { in: 0, out: 0 };
    return {
      in: money.in,
      out: money.out,
      // What is left of the change; for the queue, money.in and money.out are all it shows.
      transfers: uncategorized ? 0 : change - money.in + money.out - opening,
      opening: uncategorized ? 0 : opening,
      count,
    };
  };
  const sumOf = (months: ReadonlyArray<string>) =>
    months.map(totalsOf).reduce(
      (sum, each) => ({
        in: sum.in + each.in,
        out: sum.out + each.out,
        transfers: sum.transfers + each.transfers,
        opening: sum.opening + each.opening,
        count: sum.count + each.count,
      }),
      empty,
    );

  // The chart runs to any future-dated transaction, as the account's balance does.
  const lastRecorded = recorded.at(-1) ?? thisMonth;
  const lastChartable = addMonths(thisMonth, MAX_FUTURE_MONTHS);
  const lastMonth =
    lastRecorded <= thisMonth
      ? thisMonth
      : lastRecorded <= lastChartable
        ? lastRecorded
        : lastChartable;
  const balanceAt = (month: string) =>
    recorded
      .filter((each) => each <= month)
      .reduce((total, each) => total + moved.get(each)!.change, 0);

  const oldest = addMonths(lastMonth, 1 - MAX_MONTHS);
  const wanted = input.months === undefined ? oldest : addMonths(thisMonth, 1 - input.months);
  const firstWanted = earliest === null || wanted >= earliest ? wanted : earliest;
  const chartStart = earliest === null ? null : firstWanted > thisMonth ? thisMonth : firstWanted;
  // Past the limit only the months with rows are charted, so the balance still reaches them.
  const chart =
    chartStart === null
      ? []
      : [...monthRange(chartStart, lastMonth), ...recorded.filter((each) => each > lastMonth)];

  // A row waiting to be categorized counts whenever it is dated: the queue is all of them.
  const periodMonths =
    input.month !== undefined
      ? [input.month]
      : chartStart === null
        ? []
        : uncategorized
          ? chart
          : monthRange(chartStart, thisMonth);
  const period = new Set(periodMonths);
  const firstOfPeriod = periodMonths[0];
  const previousMonths =
    firstOfPeriod === undefined
      ? []
      : periodMonths.map((_, index) => addMonths(firstOfPeriod, index - periodMonths.length));
  // A previous period the scope only partly reaches back to would make any period look like growth.
  const hasPrevious =
    (input.month !== undefined || input.months !== undefined) &&
    earliest !== null &&
    previousMonths[0] !== undefined &&
    earliest <= previousMonths[0];
  const previous = new Set(hasPrevious ? previousMonths : []);

  const inPeriod = (month: string) => period.has(month);
  const inPrevious = (month: string) => previous.has(month);
  const top = (ranks: ReadonlyArray<AccountActivity["categories"][number]>) =>
    (uncategorized
      ? ranks.filter((rank) => rank.count > 0).toSorted((a, b) => b.count - a.count)
      : ranks.filter((rank) => rank.amount > 0).toSorted((a, b) => b.amount - a.amount)
    ).slice(0, LISTED);
  const spending = legs.filter((leg) => leg.categoryType === "expense");
  const schedulable = schedulableOf(book, scope, input);

  return {
    uncategorizedId,
    earliest,
    months: chart.map((month) => ({
      month,
      balance: uncategorized ? null : balanceAt(month),
      ...totalsOf(month),
    })),
    period: {
      from: firstOfPeriod ?? null,
      to: periodMonths.at(-1) ?? null,
      ...sumOf(periodMonths),
      previous: hasPrevious ? sumOf(previousMonths) : null,
    },
    categories: top(
      rankBy(
        spending,
        (leg) => leg.category,
        (leg) => leg.categoryName,
        inPeriod,
        inPrevious,
      ),
    ),
    payees: top(
      rankBy(
        spending,
        (leg) => leg.payee,
        (leg) => leg.payeeName,
        inPeriod,
        inPrevious,
      ),
    ),
    accounts:
      uncategorized && firstOfPeriod !== undefined
        ? waitingByAccount(book, scope, periodMonths)
        : [],
    projection:
      uncategorized || schedulable.length === 0
        ? []
        : projectionOf(book, schedulable, today, balanceAt),
    attention:
      scope.length === 0
        ? {
            uncategorized: 0,
            oldUncleared: 0,
            toReconcile: 0,
            lastReconciled: null,
            missedSchedules: 0,
          }
        : tidiness(book, scope, schedulable, today),
  };
};

/** How many uncategorized rows each account holds in the period. */
const waitingByAccount = (
  book: Book,
  scope: ReadonlyArray<string>,
  months: ReadonlyArray<string>,
): AccountActivity["accounts"] => {
  const rows = book.client
    .prepare(
      `SELECT a.id, a.name, count(*) AS count, sum(-p.amount) AS amount
       FROM postings p
       JOIN transactions t ON t.id = p.transaction_id
       JOIN accounts a ON a.id = p.account_id
       WHERE p.account_id IN (${placeholders(scope)}) AND t.date >= ? AND t.date <= ?
         AND ${UNCATEGORIZED_ROW}
       GROUP BY a.id ORDER BY count(*) DESC, a.name LIMIT ${LISTED}`,
    )
    .all(
      ...scope,
      dayToInt(`${months[0]!}-01`),
      dayToInt(lastDay(months.at(-1)!)),
    ) as unknown as Array<{
    id: string;
    name: string;
    count: number;
    amount: number;
  }>;
  return rows.map((row) => ({ ...row, previous: 0 }));
};

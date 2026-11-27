/**
 * Finds recurring transactions in each open account's history that could become schedules, as
 * Actual's `server/schedules/find-schedules.ts`: for each pattern and start day it takes three
 * occurrences and looks for a transaction of the same payee and a close amount within two days of
 * each, then keeps each payee's best ranked match and walks its start back while it still matches.
 */
import type { DiscoveredSchedule } from "./types.ts";
import { addDays, daysBetween, intToDay } from "@reeve/contract/rules";
import * as d from "date-fns";
import { readSettings, type Book } from "../book.ts";
import { accountsInScope, type AccountScope } from "../ledger/account-scope.ts";
import {
  dayOf,
  getRecurringDescription,
  getScheduleDates,
  getUpcomingDates,
  parseDay,
  type RecurConfig,
} from "./recurrence.ts";

interface Line {
  readonly date: string;
  readonly amount: number;
  readonly payee: string | null;
  readonly account: string;
  readonly scheduled: boolean;
  readonly transfer: boolean;
}

interface Candidate {
  readonly rank: number;
  readonly amount: number;
  readonly account: string;
  readonly payee: string | null;
  readonly date: RecurConfig;
  readonly exactDate: boolean;
  readonly exactAmount: boolean;
}

/** Actual's `getApproxNumberThreshold`: 7.5% of the amount. */
const approxThreshold = (amount: number) => Math.round(Math.abs(amount) * 0.075);

/** Every register line of an account: its posting, the payee, and whether it is a transfer. */
const linesOf = (book: Book, account: string): Array<Line> =>
  (
    book.client
      .prepare(
        `SELECT t.date, p.amount, t.payee_id AS payee, t.schedule_id AS schedule,
           EXISTS (SELECT 1 FROM postings o JOIN accounts a ON a.id = o.account_id
                   WHERE o.transaction_id = t.id AND o.id != p.id
                     AND a.type IN ('asset', 'liability')) AS transfer
         FROM postings p JOIN transactions t ON t.id = p.transaction_id
         WHERE p.account_id = ?`,
      )
      .all(account) as Array<{
      date: number;
      amount: number;
      payee: string | null;
      schedule: string | null;
      transfer: number;
    }>
  ).map((row) => ({
    date: intToDay(row.date),
    amount: row.amount,
    payee: row.payee,
    account,
    scheduled: row.schedule !== null,
    transfer: row.transfer === 1,
  }));

const takeDates = (config: RecurConfig) => getUpcomingDates(config, 3, config.start);

const near = (lines: ReadonlyArray<Line>, date: string) => {
  const low = addDays(date, -2);
  const high = addDays(date, 2);
  return lines.filter((line) => line.date >= low && line.date <= high);
};

/** The closer the day, the higher the rank: 1 on the day, 1/2 a day off, and so on. */
const getRank = (day1: string, day2: string) => 1 / (Math.abs(daysBetween(day1, day2)) + 1);

const matchSchedules = (
  allOccurs: ReadonlyArray<{ readonly date: string; readonly transactions: ReadonlyArray<Line> }>,
  config: RecurConfig,
): Array<Candidate> => {
  const reversed = allOccurs.toReversed();
  const [baseOccur, ...occurs] = reversed;
  if (baseOccur === undefined) return [];
  const candidates: Array<Candidate> = [];
  for (const trans of baseOccur.transactions) {
    const threshold = approxThreshold(trans.amount);
    const found = occurs.map((occur) => {
      const matched = occur.transactions.find(
        (each) =>
          each.amount >= trans.amount - threshold && each.amount <= trans.amount + threshold,
      );
      return matched !== undefined && matched.payee === trans.payee
        ? { trans: matched, rank: getRank(occur.date, matched.date) }
        : null;
    });
    if (found.includes(null)) continue;
    const matches = found as Array<{ trans: Line; rank: number }>;
    const rank = matches.reduce(
      (total, match) => total + match.rank,
      getRank(baseOccur.date, trans.date),
    );
    candidates.push({
      rank,
      amount: trans.amount,
      account: trans.account,
      payee: trans.payee,
      date: config,
      // Every exact day ranks 1, so all exact sums to the number of occurrences.
      exactDate: rank === reversed.length,
      exactAmount: matches.every((match) => match.trans.amount === trans.amount),
    });
  }
  return candidates;
};

const schedulesForPattern = (
  lines: ReadonlyArray<Line>,
  baseStart: Date,
  numDays: number,
  baseConfig: Omit<RecurConfig, "start"> | ((start: Date) => RecurConfig | false),
): Array<Candidate> => {
  const unscheduled = lines.filter((line) => !line.scheduled && !line.transfer);
  const candidates: Array<Candidate> = [];
  for (let i = 0; i < numDays; i++) {
    const start = d.addDays(baseStart, i);
    const config =
      typeof baseConfig === "function"
        ? baseConfig(start)
        : ({ ...baseConfig, start: dayOf(start) } as RecurConfig);
    if (config === false) continue;
    const data = takeDates(config).map((date) => ({ date, transactions: near(unscheduled, date) }));
    candidates.push(...matchSchedules(data, config));
  }
  return candidates;
};

const weekdayCode = (date: Date) => d.format(date, "iiii").slice(0, 2).toUpperCase() as "MO";

const patternsFor = (lines: ReadonlyArray<Line>, latest: string): Array<Candidate> => {
  const latestDate = parseDay(latest);
  return [
    // Weekly.
    ...schedulesForPattern(lines, d.subWeeks(latestDate, 4), 14, { frequency: "weekly" }),
    // Every two weeks: six weeks cover three, and one more week back.
    ...schedulesForPattern(lines, d.subWeeks(latestDate, 7), 14, {
      frequency: "weekly",
      interval: 2,
    }),
    // Monthly on a day; days past the 28th are left to the last-day pattern.
    ...schedulesForPattern(lines, d.subMonths(latestDate, 4), 62, (start) =>
      d.getDate(start) > 28 ? false : { start: dayOf(start), frequency: "monthly" },
    ),
    // Monthly on the last day.
    ...schedulesForPattern(lines, d.subMonths(latestDate, 3), 1, {
      frequency: "monthly",
      patterns: [{ type: "day", value: -1 }],
    }),
    ...schedulesForPattern(lines, d.subMonths(latestDate, 4), 1, {
      frequency: "monthly",
      patterns: [{ type: "day", value: -1 }],
    }),
    // Monthly on the 1st and 3rd, or the 2nd and 4th, weekday of the start day.
    ...schedulesForPattern(lines, d.subWeeks(latestDate, 8), 14, (start) => ({
      start: dayOf(start),
      frequency: "monthly",
      patterns: [
        { type: weekdayCode(start), value: 1 },
        { type: weekdayCode(start), value: 3 },
      ],
    })),
    ...schedulesForPattern(lines, d.subWeeks(latestDate, 8), 14, (start) => ({
      start: dayOf(start),
      frequency: "monthly",
      patterns: [
        { type: weekdayCode(start), value: 2 },
        { type: weekdayCode(start), value: 4 },
      ],
    })),
  ];
};

const MAX_START_STEPS = 600;

/** Walks the recurrence's start back by its interval while its first occurrence still matches. */
const findStartDate = (lines: ReadonlyArray<Line>, candidate: Candidate): RecurConfig => {
  let current = candidate.date;
  const threshold = approxThreshold(candidate.amount);
  for (let step = 0; step < MAX_START_STEPS; step++) {
    const interval = current.interval || 1;
    const start = parseDay(current.start);
    const previous: RecurConfig = {
      ...current,
      start: dayOf(
        current.frequency === "weekly"
          ? d.subWeeks(start, interval)
          : current.frequency === "monthly"
            ? d.subMonths(start, interval)
            : d.subYears(start, interval),
      ),
    };
    const [first] = getScheduleDates(previous, { start: previous.start, count: 1 });
    if (first === undefined) break;
    const matches = lines.some(
      (line) =>
        line.payee === candidate.payee &&
        (candidate.exactAmount
          ? line.amount === candidate.amount
          : Math.abs(line.amount - candidate.amount) <= threshold) &&
        (candidate.exactDate
          ? line.date === first
          : line.date >= addDays(first, -2) && line.date <= addDays(first, 2)),
    );
    if (!matches) break;
    current = previous;
  }
  return current;
};

export const findSchedules = (book: Book, scope: AccountScope = {}): Array<DiscoveredSchedule> => {
  const inScope = new Set(accountsInScope(book, scope));
  const accounts = (
    book.client
      .prepare(
        `SELECT id, name FROM accounts WHERE type IN ('asset', 'liability') AND closed = 0
         ORDER BY sort_order`,
      )
      .all() as Array<{ id: string; name: string }>
  ).filter((row) => inScope.has(row.id));
  const payeeNames = new Map(
    (
      book.client.prepare("SELECT id, name FROM payees").all() as Array<{
        id: string;
        name: string;
      }>
    ).map((row) => [row.id, row.name]),
  );
  const accountNames = new Map(accounts.map((row) => [row.id, row.name]));
  const linesByAccount = new Map<string, Array<Line>>();
  const all: Array<Candidate> = [];
  for (const account of accounts) {
    const lines = linesOf(book, account.id);
    linesByAccount.set(account.id, lines);
    const latest = lines.reduce<string | null>(
      (max, line) => (max === null || line.date > max ? line.date : max),
      null,
    );
    if (latest !== null) all.push(...patternsFor(lines, latest));
  }
  const byPayee = new Map<string | null, Array<Candidate>>();
  for (const candidate of all) {
    const group = byPayee.get(candidate.payee);
    if (group === undefined) byPayee.set(candidate.payee, [candidate]);
    else group.push(candidate);
  }
  const { dateFormat } = readSettings(book.db);
  return [...byPayee.values()].map((group) => {
    const winner = group.toSorted((a, b) => b.rank - a.rank)[0]!;
    const date = findStartDate(linesByAccount.get(winner.account) ?? [], winner);
    const recurrence = { ...date, interval: date.interval ?? 1 };
    return {
      accountId: winner.account,
      account: accountNames.get(winner.account) ?? "",
      payeeId: winner.payee,
      payee: winner.payee === null ? null : (payeeNames.get(winner.payee) ?? null),
      amount: winner.amount,
      amountOp: winner.exactAmount ? "is" : "isapprox",
      date: recurrence,
      dateOp: winner.exactDate ? "is" : "isapprox",
      description: getRecurringDescription(recurrence, dateFormat),
    };
  });
};

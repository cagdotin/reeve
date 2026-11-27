/**
 * What the schedules page says about each schedule: what is coming, what it costs a month, and
 * what its recent charges show. Most books link few transactions, and a charge outside a schedule's
 * amount never links at all, so charges also count an unlinked transaction of the same payee and
 * account within two days of a date, at a plausible amount.
 */
import type { ScheduleActivity, ScheduleOverview, ScheduleStatus } from "./types.ts";
import {
  addDays,
  daysBetween,
  dayToInt,
  intToDay,
  monthOf,
  today as currentDay,
} from "@reeve/contract/rules";
import { addMonths } from "date-fns";
import { asc } from "drizzle-orm";
import type { Book } from "../book.ts";
import * as t from "../db/schema.ts";
import { accountsInScope, hasScope, type AccountScope } from "../ledger/account-scope.ts";
import { latestPriceChange } from "../ledger/payee-insights.ts";
import { getApproxNumberThreshold, sortNumbers } from "../rules/fields.ts";
import {
  dayOf,
  getNextDateAfter,
  getOccurrencesBetween,
  getScheduleDates,
  isRecurrence,
  parseDay,
  type DateValue,
  type RecurConfig,
} from "./recurrence.ts";
import { loadSchedule, toSchedule, type LoadedSchedule } from "./schedules.ts";
import { DEFAULT_UPCOMING_SCHEDULE_DAYS, getScheduledAmount } from "./status.ts";

const DEFAULT_DAYS = 90;
const LOOKBACK_MONTHS = 13;
const CHARGES_KEPT = 12;
/** A charge may land this many days from its date, as a rule's `date isapprox` allows. */
const NEAR_DAYS = 2;
/** A larger difference is a different purchase, as `latestPriceChange` takes a larger jump. */
const PLAUSIBLE = 0.5;
const QUIET_DATES = 2;
const QUIET_MIN_DAYS = 14;
/** Amounts that vary never settle on one figure, so this many on one side of it count as a change. */
const VARYING_RUN = 3;
const FUTURE_MONTHS = 12;
const CYCLE_YEARS = 28;
const MOST_CYCLE_YEARS = 400;

/**
 * A whole cycle of the calendar's leap years and weekdays, over any interval that steps through it.
 * It stays short of rschedule's last year, which a very long interval would otherwise pass.
 */
const cycleYears = (interval: number) => Math.min(CYCLE_YEARS * interval, MOST_CYCLE_YEARS);

/**
 * How many times a year a recurrence falls while it runs. Days and weeks always land; a month or a
 * year may not (the 31st, a fifth Friday, a leap day), so those count the dates a whole cycle has.
 */
export const perYear = (config: RecurConfig): number => {
  const interval = Math.max(1, config.interval ?? 1);
  if (config.frequency === "daily") return 365 / interval;
  if (config.frequency === "weekly") return 52 / interval;
  const { endMode: _mode, endOccurrences: _count, endDate: _end, ...open } = config;
  const years = cycleYears(interval);
  const end = dayOf(addMonths(parseDay(config.start), years * 12));
  const dates = getOccurrencesBetween({ op: "is", value: open }, config.start, end);
  return new Set(dates).size / years;
};

interface Line {
  readonly id: string;
  readonly date: string;
  readonly amount: number;
  readonly schedule: string | null;
  readonly payee: string | null;
  readonly account: string;
}

/** The register lines since a day that name a schedule or a payee, oldest first, in one query. */
const linesSince = (book: Book, since: string): Array<Line> =>
  (
    book.client
      .prepare(
        `SELECT t.id, t.date, p.amount, t.schedule_id AS schedule, t.payee_id AS payee,
           p.account_id AS account
         FROM transactions t
         JOIN postings p ON p.transaction_id = t.id
         JOIN accounts a ON a.id = p.account_id AND a.type IN ('asset', 'liability')
         WHERE t.date >= ? AND (t.schedule_id IS NOT NULL OR t.payee_id IS NOT NULL)
         ORDER BY t.date, t.created_at`,
      )
      .all(dayToInt(since)) as Array<Omit<Line, "date"> & { date: number }>
  ).map((row) => ({ ...row, date: intToDay(row.date) }));

/** A recurrence as if it had always run and never ended, so old charges can be read against it. */
const stretchedBack = (date: RecurConfig, since: string): RecurConfig => {
  const { endMode: _mode, endOccurrences: _count, endDate: _end, ...open } = date;
  if (date.start <= since) return open;
  const interval = Math.max(1, date.interval ?? 1);
  const span = daysBetween(since, date.start);
  if (date.frequency === "daily" || date.frequency === "weekly") {
    const step = (date.frequency === "weekly" ? 7 : 1) * interval;
    return { ...open, start: addDays(date.start, -Math.ceil(span / step) * step) };
  }
  const step = (date.frequency === "yearly" ? 12 : 1) * interval;
  const months = Math.ceil(span / 28 / step) * step;
  return { ...open, start: dayOf(addMonths(parseDay(date.start), -months)) };
};

const pastDates = (date: DateValue, since: string, today: string) =>
  isRecurrence(date)
    ? getOccurrencesBetween({ op: "is", value: stretchedBack(date, since) }, since, today)
    : date >= since && date < today
      ? [date]
      : [];

const plausible = (amount: number, expected: number) =>
  Math.sign(amount) === Math.sign(expected) &&
  Math.abs(amount - expected) <= Math.abs(expected) * PLAUSIBLE;

/** For each past date, the unlinked line nearest it; a line counts for one date only. */
const matchedLines = (
  lines: ReadonlyArray<Line>,
  dates: ReadonlyArray<string>,
  expected: number,
): Array<Line> => {
  const taken = new Set<string>();
  for (const date of dates) {
    const low = addDays(date, -NEAR_DAYS);
    const high = addDays(date, NEAR_DAYS);
    const [nearest] = lines
      .filter(
        (line) =>
          line.date >= low &&
          line.date <= high &&
          !taken.has(line.id) &&
          plausible(line.amount, expected),
      )
      .toSorted(
        (a, b) =>
          Math.abs(dayToInt(a.date) - dayToInt(date)) -
            Math.abs(dayToInt(b.date) - dayToInt(date)) ||
          Math.abs(a.amount - expected) - Math.abs(b.amount - expected),
      );
    if (nearest !== undefined) taken.add(nearest.id);
  }
  return lines.filter((line) => taken.has(line.id));
};

/** Whether an amount is what the schedule expects, by its own op, in magnitudes. */
const asExpected = (schedule: LoadedSchedule, amount: number) => {
  if (schedule.amount === null) return true;
  if (schedule.amount.op === "isbetween") {
    const [low, high] = sortNumbers(schedule.amount.value.num1, schedule.amount.value.num2);
    return amount >= low && amount <= high;
  }
  if (schedule.amount.op === "is") return amount === schedule.amount.value;
  const value = schedule.amount.value;
  return Math.abs(amount - value) <= getApproxNumberThreshold(value);
};

/**
 * Charges settled away from what the schedule expects. An exact amount uses the payees page's price
 * test with the expected amount as the price before; one that may vary has to fall outside it, on
 * one side, several charges running.
 */
const driftOf = (
  schedule: LoadedSchedule,
  expected: number,
  charges: ReadonlyArray<ScheduleActivity["charges"][number]>,
): ScheduleActivity["drift"] => {
  const latest = charges.at(-1);
  if (latest === undefined || asExpected(schedule, latest.amount)) return null;
  const change = latestPriceChange([
    { date: "", amount: Math.abs(expected) },
    ...charges.map((each) => ({ date: each.date, amount: Math.abs(each.amount) })),
  ]);
  if (change !== null) return { actual: Math.sign(expected) * change.to, since: change.date };
  if (schedule.amount?.op === "is") return null;
  const run = charges.slice(-VARYING_RUN);
  const side = Math.sign(latest.amount - expected);
  if (
    run.length < VARYING_RUN ||
    !run.every(
      (each) => !asExpected(schedule, each.amount) && Math.sign(each.amount - expected) === side,
    )
  )
    return null;
  const actual = Math.round(run.reduce((sum, each) => sum + each.amount, 0) / run.length);
  return { actual, since: run[0]!.date };
};

/** The latest dates, within its own span, that passed with no charge near or after them. */
const quietOf = (
  schedule: LoadedSchedule,
  charges: ReadonlyArray<ScheduleActivity["charges"][number]>,
  dates: ReadonlyArray<string>,
  endsOn: string | null,
  today: string,
): ScheduleActivity["quiet"] => {
  if (!isRecurrence(schedule.date) || schedule.row.completed) return null;
  const { start } = schedule.date;
  const lastCharge = charges.at(-1)?.date ?? null;
  const unpaid = dates.filter(
    (date) =>
      date >= start &&
      (endsOn === null || date <= endsOn) &&
      (lastCharge === null || addDays(lastCharge, NEAR_DAYS) < date),
  );
  return unpaid.length >= QUIET_DATES && daysBetween(unpaid[0]!, today) >= QUIET_MIN_DAYS
    ? { dates: unpaid.length, lastCharge }
    : null;
};

const endOf = (date: DateValue): string | null => {
  if (!isRecurrence(date)) return null;
  if (date.endMode === "on_date") return date.endDate ?? null;
  if (date.endMode !== "after_n_occurrences") return null;
  return (
    getScheduleDates(
      { ...date, weekendSolveMode: date.weekendSolveMode ?? "after" },
      { start: date.start, count: date.endOccurrences ?? 1 },
    ).at(-1) ?? null
  );
};

/** The open occurrences from the next date through `end`; a paid next date is done. */
const openDates = (
  schedule: LoadedSchedule,
  status: ScheduleStatus,
  end: string,
): Array<string> => {
  if (schedule.row.completed || schedule.nextDate === null || schedule.date === null) return [];
  const dates = [schedule.nextDate];
  for (const day of getOccurrencesBetween(
    { op: "is", value: schedule.date },
    schedule.nextDate,
    addDays(end, 1),
  ))
    if (!dates.includes(day)) dates.push(day);
  return (status === "paid" ? dates.slice(1) : dates).filter((day) => day <= end);
};

/** Whether a date is still to come; a paid next date does not count, and a far one does. */
const stillRuns = (schedule: LoadedSchedule, status: ScheduleStatus, today: string) => {
  if (schedule.row.completed || schedule.nextDate === null || schedule.date === null) return false;
  const yesterday = addDays(today, -1);
  const after = status === "paid" && schedule.nextDate > yesterday ? schedule.nextDate : yesterday;
  return getNextDateAfter({ op: "is", value: schedule.date }, after) !== null;
};

export const scheduleActivity = (
  book: Book,
  input: AccountScope & { readonly days?: number; readonly upcomingLength?: string },
): ScheduleOverview => {
  const today = currentDay();
  const until = addDays(today, Math.max(1, input.days ?? DEFAULT_DAYS));
  const yearEnd = addDays(dayOf(addMonths(parseDay(`${monthOf(today)}-01`), FUTURE_MONTHS)), -1);
  const since = dayOf(addMonths(parseDay(today), -LOOKBACK_MONTHS));
  const upcoming = input.upcomingLength ?? DEFAULT_UPCOMING_SCHEDULE_DAYS;

  const closed = new Set(
    (
      book.client.prepare("SELECT id FROM accounts WHERE closed = 1").all() as Array<{ id: string }>
    ).map((row) => row.id),
  );
  const everySchedule = book.db
    .select()
    .from(t.schedules)
    .orderBy(asc(t.schedules.createdAt))
    .all()
    .map((row) => loadSchedule(book.db, row));
  const postsTo = new Set(
    accountsInScope(book, input).filter((id) => input.account !== undefined || !closed.has(id)),
  );
  const loaded = hasScope(input)
    ? everySchedule.filter((each) => each.accountId !== null && postsTo.has(each.accountId))
    : everySchedule;
  const lines = linesSince(book, since);
  const linkedOf = Map.groupBy(
    lines.filter((line) => line.schedule !== null),
    (line) => line.schedule!,
  );
  const unlinkedOf = Map.groupBy(
    lines.filter((line) => line.schedule === null && line.payee !== null),
    (line) => `${line.payee}:${line.account}`,
  );
  const linkedTotals = new Map(
    (
      book.client
        .prepare(
          `SELECT schedule_id AS id, count(*) AS total FROM transactions
           WHERE schedule_id IS NOT NULL GROUP BY schedule_id`,
        )
        .all() as Array<{ id: string; total: number }>
    ).map((row) => [row.id, row.total]),
  );
  const names = new Map(
    (
      book.client
        .prepare("SELECT id, name FROM accounts WHERE type IN ('expense', 'income')")
        .all() as Array<{ id: string; name: string }>
    ).map((row) => [row.id, row.name]),
  );
  const months = new Map<string, { out: number; in: number }>();
  for (let i = 0; i < FUTURE_MONTHS; i++)
    months.set(dayOf(addMonths(parseDay(`${monthOf(today)}-01`), i)).slice(0, 7), {
      out: 0,
      in: 0,
    });

  const schedules = loaded.map((each): ScheduleActivity => {
    const schedule = toSchedule(book.db, each, upcoming, today);
    const expected = getScheduledAmount(each.amount?.value);
    const linked = (linkedOf.get(each.row.id) ?? []).filter(
      (line) => each.accountId === null || line.account === each.accountId,
    );
    const dates = each.date === null ? [] : pastDates(each.date, since, today);
    const unlinked =
      each.payeeId === null || each.accountId === null || expected === 0
        ? []
        : matchedLines(unlinkedOf.get(`${each.payeeId}:${each.accountId}`) ?? [], dates, expected);
    const charges = [
      ...linked.map((line) => ({ line, linked: true })),
      ...unlinked.map((line) => ({ line, linked: false })),
    ]
      .toSorted((a, b) => a.line.date.localeCompare(b.line.date))
      .slice(-CHARGES_KEPT)
      .map(({ line, linked: isLinked }) => ({
        id: line.id,
        date: line.date,
        amount: line.amount,
        linked: isLinked,
      }));
    // A closed account's schedule is left alone, so nothing on it will happen.
    const posts = each.accountId === null || !closed.has(each.accountId);
    const coming = posts ? openDates(each, schedule.status, yearEnd) : [];
    for (const day of coming) {
      const month = months.get(day.slice(0, 7));
      if (month === undefined || day < today) continue;
      if (expected < 0) month.out -= expected;
      else month.in += expected;
    }
    const endsOn = endOf(each.date ?? today);
    return {
      ...schedule,
      expected,
      monthly:
        posts && isRecurrence(each.date) && stillRuns(each, schedule.status, today)
          ? Math.round((expected * perYear(each.date)) / 12)
          : 0,
      categoryName: schedule.categoryId === null ? null : (names.get(schedule.categoryId) ?? null),
      occurrences: coming.filter((day) => day <= until),
      charges,
      linkedTransactions: linkedTotals.get(each.row.id) ?? 0,
      drift: driftOf(each, expected, charges),
      quiet: quietOf(each, charges, dates, endsOn, today),
      endsOn,
    };
  });
  return {
    today,
    until,
    schedules: schedules.toSorted(
      (a, b) =>
        (a.nextDate ?? "").localeCompare(b.nextDate ?? "") ||
        (a.name ?? "").localeCompare(b.name ?? ""),
    ),
    noAccount: everySchedule.filter((each) => each.accountId === null && !each.row.completed)
      .length,
    months: [...months].map(([month, totals]) => ({ month, ...totals })),
  };
};

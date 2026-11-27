/**
 * Schedule dates: recurrences on rschedule, next dates, weekend moves, occurrences in a range and
 * their descriptions, as Actual's `shared/schedules.ts` and `server/schedules/occurrences.ts`.
 * Days are `YYYY-MM-DD`; rschedule works on local dates at noon, as Actual's.
 */
import type { Recurrence } from "./types.ts";
import { addDays, today as currentDay } from "@reeve/contract/rules";
import * as d from "date-fns";
import { invalid } from "../book.ts";
import { Schedule as RSchedule } from "../rschedule.ts";

/** A recurrence as stored, where an interval may be left out (it is then 1), as Actual's `RecurConfig`. */
export type RecurConfig = Omit<Recurrence, "interval"> & { readonly interval?: number | undefined };

/** A schedule's date: a day or a recurrence. */
export type DateValue = string | RecurConfig;

export interface DateCondition {
  readonly op: string;
  readonly value: DateValue;
}

export const isRecurrence = (value: unknown): value is RecurConfig =>
  typeof value === "object" && value !== null && "frequency" in value;

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/** A day as a local date at noon, as Actual's `parseDate`. */
export const parseDay = (day: string): Date =>
  new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), 12);

/** A local date's day, as Actual's `dayFromDate`. */
export const dayOf = (date: Date): string =>
  `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const midnight = (day: string) => d.startOfDay(parseDay(day));

type RuleOptions = NonNullable<
  NonNullable<ConstructorParameters<typeof RSchedule>[0]>["rrules"]
>[number];

const abbrevDay = (name: string) => name.slice(0, 2).toUpperCase();

/** The rschedule rules of a recurrence, as Actual's `recurConfigToRSchedule`. */
export const recurrenceRules = (config: RecurConfig): Array<RuleOptions> => {
  const base: Record<string, unknown> = {
    start: parseDay(config.start),
    frequency: config.frequency.toUpperCase(),
    byHourOfDay: [12],
  };
  if (config.interval) base["interval"] = config.interval;
  if (config.endMode === "after_n_occurrences") base["count"] = config.endOccurrences;
  if (config.endMode === "on_date" && config.endDate !== undefined)
    base["end"] = parseDay(config.endDate);
  const patterns = config.patterns ?? [];
  if (config.frequency === "monthly" && patterns.length > 0) {
    const days = patterns.filter((pattern) => pattern.type === "day");
    const dayNames = patterns.filter((pattern) => pattern.type !== "day");
    return [
      ...(days.length > 0 ? [{ ...base, byDayOfMonth: days.map((pattern) => pattern.value) }] : []),
      ...(dayNames.length > 0
        ? [
            {
              ...base,
              byDayOfWeek: dayNames.map((pattern) => [abbrevDay(pattern.type), pattern.value]),
            },
          ]
        : []),
    ] as unknown as Array<RuleOptions>;
  }
  return [base as unknown as RuleOptions];
};

interface Recurring {
  readonly schedule: InstanceType<typeof RSchedule>;
  readonly skipWeekend: boolean;
  readonly weekendSolve: "before" | "after";
}

const recurring = (config: RecurConfig): Recurring => {
  try {
    return {
      schedule: new RSchedule({ rrules: recurrenceRules(config) }),
      skipWeekend: config.skipWeekend === true,
      weekendSolve: config.weekendSolveMode ?? "after",
    };
  } catch (error) {
    return invalid(`Invalid recurrence: ${error instanceof Error ? error.message : String(error)}`);
  }
};

/** A weekend day moved to the Friday before or the Monday after. */
export const getDateWithSkippedWeekend = (date: Date, solveMode: "before" | "after"): Date =>
  d.isWeekend(date) ? (solveMode === "after" ? d.nextMonday(date) : d.previousFriday(date)) : date;

const moved = (rec: Recurring, date: Date, noSkipWeekend = false) =>
  rec.skipWeekend && !noSkipWeekend ? getDateWithSkippedWeekend(date, rec.weekendSolve) : date;

/**
 * The first occurrence on or after `start`, moved off the weekend unless `noSkipWeekend`; the last
 * one when the recurrence has ended; the day itself for a one-off date.
 */
export const getNextDate = (
  cond: DateCondition,
  start: string = currentDay(),
  noSkipWeekend = false,
): string | null => {
  if (!isRecurrence(cond.value)) return cond.value;
  const rec = recurring(cond.value);
  let dates = rec.schedule.occurrences({ start: midnight(start), take: 1 }).toArray();
  // A recurrence with limited occurrences: its last one.
  if (dates.length === 0) dates = rec.schedule.occurrences({ reverse: true, take: 1 }).toArray();
  const first = dates[0];
  return first === undefined ? null : dayOf(moved(rec, first.date, noSkipWeekend));
};

const MAX_ADVANCE_ATTEMPTS = 7;

/** The first occurrence, after weekend moves, later than `afterDate`. */
export const getNextDateAfter = (cond: DateCondition, afterDate: string): string | null => {
  let start = addDays(afterDate, -1);
  for (let attempt = 0; attempt < MAX_ADVANCE_ATTEMPTS; attempt++) {
    const occurrence = getNextDate(cond, start, true);
    if (occurrence === null || occurrence < start) return null;
    const nextDate = getNextDate(cond, start);
    if (nextDate !== null && nextDate > afterDate) return nextDate;
    start = addDays(occurrence, 1);
  }
  return null;
};

/** `getNextDate` from today, or an earlier occurrence moved `after` the weekend onto today or later. */
export const getNextDateFrom = (cond: DateCondition, today: string): string | null => {
  const nextDate = getNextDate(cond, today);
  const movedOntoToday = getNextDateAfter(cond, addDays(today, -1));
  return movedOntoToday !== null && (nextDate === null || movedOntoToday < nextDate)
    ? movedOntoToday
    : nextDate;
};

// A weekend move shifts an occurrence by up to two days, and occurrences are at noon while the
// range bounds are at midnight: three days of padding catch both.
const WEEKEND_SHIFT_PAD_DAYS = 3;

/** The days a date falls on in `[startDay, endDay)`, after weekend moves. */
export const getOccurrencesBetween = (
  cond: DateCondition,
  startDay: string,
  endDay: string,
): Array<string> => {
  if (!isRecurrence(cond.value))
    return cond.value >= startDay && cond.value < endDay ? [cond.value] : [];
  const rec = recurring(cond.value);
  const raw = rec.schedule
    .occurrences({
      start: midnight(addDays(startDay, -WEEKEND_SHIFT_PAD_DAYS)),
      end: midnight(addDays(endDay, WEEKEND_SHIFT_PAD_DAYS)),
    })
    .toArray()
    .map((occurrence) => dayOf(moved(rec, occurrence.date)));
  return raw.filter((day) => day >= startDay && day < endDay);
};

/** Whether a recurrence falls on a day, before weekend moves, as a rule's `date is` checks it. */
export const occursOn = (config: RecurConfig, day: string): boolean =>
  recurring(config).schedule.occursOn({ date: parseDay(day) });

/** Whether a recurrence falls within two days of a day, as a rule's `date isapprox` checks it. */
export const occursNear = (config: RecurConfig, day: string): boolean =>
  recurring(config).schedule.occursBetween(
    d.subDays(parseDay(day), 2),
    d.addDays(parseDay(day), 2),
  );

/**
 * The days a schedule's date falls on, ascending, from `start` to `end` and at most `count`, after
 * weekend moves and each listed once, as Actual's `getScheduleDates`.
 */
export const getScheduleDates = (
  date: DateValue,
  options: { readonly start: string; readonly end?: string; readonly count?: number },
): Array<string> => {
  const { start, end, count } = options;
  if (count === 0) return [];
  if (!isRecurrence(date)) return date >= start && (end === undefined || date <= end) ? [date] : [];
  const isOpenEnded = date.endMode === undefined || date.endMode === "never";
  if (end === undefined && count === undefined && isOpenEnded)
    invalid("An open-ended recurrence needs an `end` date or a `count` to be expanded");
  if (date.skipWeekend === true && date.weekendSolveMode === undefined)
    invalid("`weekendSolveMode` is required when `skipWeekend` is set");
  const cond = { op: "is", value: date };
  const dates: Array<string> = [];
  let next = getNextDateAfter(cond, addDays(start, -1));
  while (next !== null && (end === undefined || next <= end)) {
    dates.push(next);
    if (count !== undefined && dates.length >= count) break;
    next = getNextDateAfter(cond, next);
  }
  return dates;
};

/** The next `count` days of a recurrence from today, as the schedule editor previews them. */
export const getUpcomingDates = (
  config: RecurConfig,
  count: number,
  today: string = currentDay(),
): Array<string> => {
  const rec = recurring(config);
  return rec.schedule
    .occurrences({ start: midnight(today), take: count })
    .toArray()
    .map((occurrence) =>
      dayOf(
        config.skipWeekend === true
          ? getDateWithSkippedWeekend(occurrence.date, config.weekendSolveMode ?? "after")
          : occurrence.date,
      ),
    );
};

// ---------------------------------------------------------------------------------------------
// Descriptions
// ---------------------------------------------------------------------------------------------

const DAY_NAMES: Record<string, string> = {
  SU: "Sunday",
  MO: "Monday",
  TU: "Tuesday",
  WE: "Wednesday",
  TH: "Thursday",
  FR: "Friday",
  SA: "Saturday",
};

const ordinal = (value: number) => d.format(new Date(2020, 0, value, 12), "do");

/** A recurrence in words: "Every 2 weeks on Monday, until 06/01/2021 (after weekend)". */
export const getRecurringDescription = (config: RecurConfig, dateFormat: string): string => {
  const interval = config.interval || 1;
  const endModeSuffix =
    config.endMode === "after_n_occurrences"
      ? config.endOccurrences === 1
        ? "once"
        : `${config.endOccurrences} times`
      : config.endMode === "on_date" && config.endDate !== undefined
        ? `until ${d.format(parseDay(config.endDate), dateFormat)}`
        : "";
  const weekendSuffix =
    config.skipWeekend === true && config.weekendSolveMode !== undefined
      ? config.weekendSolveMode === "after"
        ? "(after weekend)"
        : "(before weekend)"
      : "";
  let suffix = endModeSuffix === "" ? "" : `, ${endModeSuffix}`;
  if (weekendSuffix !== "") suffix += ` ${weekendSuffix}`;
  const start = parseDay(config.start);
  const every = (unit: string, plural: string) =>
    interval !== 1 ? `Every ${interval} ${plural}` : `Every ${unit}`;

  let desc: string;
  switch (config.frequency) {
    case "daily":
      desc = interval !== 1 ? `Every ${interval} days` : "Every day";
      break;
    case "weekly":
      desc = `${every("week", "weeks")} on ${d.format(start, "EEEE")}`;
      break;
    case "monthly": {
      const patterns = config.patterns ?? [];
      if (patterns.length === 0) {
        desc = `${every("month", "months")} on the ${d.format(start, "do")}`;
        break;
      }
      // Day names first, then days ascending, the last days (-1) at the end.
      const sorted = [
        ...patterns
          .toSorted((p1, p2) => {
            const typeOrder = (p1.type === "day" ? 1 : 0) - (p2.type === "day" ? 1 : 0);
            return typeOrder === 0 ? p1.value - p2.value : typeOrder;
          })
          .filter((pattern) => pattern.value !== -1),
        ...patterns.filter((pattern) => pattern.value === -1),
      ];
      const uniqueDays = new Set(sorted.map((pattern) => pattern.type));
      const isSameDay = uniqueDays.size === 1 && !uniqueDays.has("day");
      const strs = sorted.map((pattern) => {
        if (pattern.type === "day")
          return pattern.value === -1 ? "last day" : ordinal(pattern.value);
        const dayName = isSameDay ? "" : ` ${DAY_NAMES[pattern.type]}`;
        return (pattern.value === -1 ? "last" : ordinal(pattern.value)) + dayName;
      });
      let range =
        strs.length > 2
          ? `${strs.slice(0, -1).join(", ")}, and ${strs.at(-1)}`
          : strs.join(" and ");
      if (isSameDay) range += ` ${DAY_NAMES[sorted[0]!.type]}`;
      desc = `${every("month", "months")} on the ${range}`;
      break;
    }
    case "yearly":
      desc = `${every("year", "years")} on ${d.format(start, "LLL do")}`;
      break;
    default:
      return "Recurring error";
  }
  return `${desc}${suffix}`.trim();
};

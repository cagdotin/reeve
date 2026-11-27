/**
 * A schedule's dates, as Actual's `shared/schedules.ts` computes them with rSchedule: the next
 * date and the occurrences in a range, moved off weekends when the schedule says so.
 */
import * as d from "date-fns";
import { months, parse } from "./months.ts";
import { Schedule } from "../rschedule.ts";

// rSchedule ships UMD bundles whose subpath folders Node's ESM loader cannot open; require can.

type RSchedule = InstanceType<typeof Schedule>;

/** The contract's `Recurrence`. */
export interface Recurrence {
  readonly start: string;
  readonly frequency: "daily" | "weekly" | "monthly" | "yearly";
  readonly interval?: number;
  readonly patterns?: ReadonlyArray<{ readonly type: string; readonly value: number }>;
  readonly skipWeekend?: boolean;
  readonly weekendSolveMode?: "before" | "after";
  readonly endMode?: "never" | "after_n_occurrences" | "on_date";
  readonly endOccurrences?: number;
  readonly endDate?: string;
}

/** A schedule's date condition: one day, or a recurrence. */
export interface DateCondition {
  readonly op: string;
  readonly value: string | Recurrence;
}

const rulesOf = (config: Recurrence): Array<Record<string, unknown>> => {
  const base: Record<string, unknown> = {
    start: parse(config.start),
    frequency: config.frequency.toUpperCase(),
    byHourOfDay: [12],
  };
  if (config.interval) base["interval"] = config.interval;
  if (config.endMode === "after_n_occurrences") base["count"] = config.endOccurrences;
  if (config.endMode === "on_date" && config.endDate !== undefined)
    base["end"] = parse(config.endDate);
  const patterns = config.patterns ?? [];
  if (config.frequency !== "monthly" || patterns.length === 0) return [base];
  const days = patterns.filter((pattern) => pattern.type === "day");
  const weekdays = patterns.filter((pattern) => pattern.type !== "day");
  return [
    ...(days.length > 0 ? [{ ...base, byDayOfMonth: days.map((pattern) => pattern.value) }] : []),
    ...(weekdays.length > 0
      ? [
          {
            ...base,
            byDayOfWeek: weekdays.map((pattern) => [
              pattern.type.slice(0, 2).toUpperCase(),
              pattern.value,
            ]),
          },
        ]
      : []),
  ];
};

const cache = new WeakMap<Recurrence, RSchedule>();

const scheduleOf = (config: Recurrence): RSchedule => {
  const cached = cache.get(config);
  if (cached !== undefined) return cached;
  const schedule = new Schedule({
    rrules: rulesOf(config) as never,
    data: { skipWeekend: config.skipWeekend, weekendSolve: config.weekendSolveMode },
  });
  cache.set(config, schedule);
  return schedule;
};

export const isRecurrence = (value: unknown): value is Recurrence =>
  typeof value === "object" && value !== null && "frequency" in value;

export const getDateWithSkippedWeekend = (date: Date, solveMode: string | undefined): Date => {
  if (!d.isWeekend(date)) return date;
  if (solveMode === "after") return d.nextMonday(date);
  if (solveMode === "before") return d.previousFriday(date);
  throw new Error("Unknown weekend solve mode, this should not happen!");
};

const occurrenceDate = (occurrence: unknown): Date => (occurrence as { date: Date }).date;

/** The schedule's next date on or after `start`, or its last one when it has ended. */
export const getNextDate = (
  condition: DateCondition,
  start: Date = parse(months.dayFromDate(new Date())),
  noSkipWeekend = false,
): string | null => {
  if (!isRecurrence(condition.value)) return condition.value;
  const config = condition.value;
  const schedule = scheduleOf(config);
  let dates = schedule.occurrences({ start: d.startOfDay(start), take: 1 }).toArray();
  if (dates.length === 0) dates = schedule.occurrences({ reverse: true, take: 1 }).toArray();
  const first = dates[0];
  if (first === undefined) return null;
  let date = occurrenceDate(first);
  if (config.skipWeekend && !noSkipWeekend)
    date = getDateWithSkippedWeekend(date, config.weekendSolveMode);
  return months.dayFromDate(date);
};

// A weekend shift moves an occurrence up to two days, and occurrences fall at noon.
const WEEKEND_SHIFT_PAD_DAYS = 3;

/** The schedule's dates in [startDay, endDay). */
export const getOccurrencesBetween = (
  condition: DateCondition,
  startDay: string,
  endDay: string,
): Array<string> => {
  if (!isRecurrence(condition.value)) {
    const single = typeof condition.value === "string" ? condition.value : null;
    return single !== null && single >= startDay && single < endDay ? [single] : [];
  }
  const config = condition.value;
  const raw = scheduleOf(config)
    .occurrences({
      start: d.startOfDay(parse(months.addDays(startDay, -WEEKEND_SHIFT_PAD_DAYS))),
      end: d.startOfDay(parse(months.addDays(endDay, WEEKEND_SHIFT_PAD_DAYS))),
    })
    .toArray()
    .map((occurrence) => occurrenceDate(occurrence));
  const days = config.skipWeekend
    ? raw.map((date) =>
        months.dayFromDate(getDateWithSkippedWeekend(date, config.weekendSolveMode)),
      )
    : raw.map((date) => months.dayFromDate(date));
  return days.filter((day) => day >= startDay && day < endDay);
};

import * as d from "date-fns";
import { Schedule } from "../rschedule.ts";

/**
 * A day, month or year as a local date at noon, as Actual parses them: noon keeps day arithmetic
 * clear of daylight saving shifts.
 */
export const parseDate = (value: string | number | Date): Date => {
  if (typeof value === "number") return new Date(value);
  if (value instanceof Date) return value;
  const [year, month, day] = value.split("-");
  if (day !== undefined) return new Date(Number(year), Number(month) - 1, Number(day), 12);
  if (month !== undefined) return new Date(Number(year), Number(month) - 1, 1, 12);
  return new Date(Number(year), 0, 1, 12);
};

export const formatDate = (value: string | Date, pattern: string): string =>
  d.format(parseDate(value), pattern);

export const dayFromDate = (value: string | Date): string => formatDate(value, "yyyy-MM-dd");
export const addDays = (day: string | Date, n: number): string =>
  dayFromDate(d.addDays(parseDate(day), n));
export const subDays = (day: string | Date, n: number): string =>
  dayFromDate(d.subDays(parseDate(day), n));
export const isAfter = (a: string, b: string): boolean => d.isAfter(parseDate(a), parseDate(b));
export const isBefore = (a: string, b: string): boolean => d.isBefore(parseDate(a), parseDate(b));
export const currentDay = (): string => d.format(new Date(), "yyyy-MM-dd");

// rSchedule ships UMD bundles whose subpath folders Node's ESM loader cannot open; require can.

export type RecurSchedule = InstanceType<typeof Schedule>;

/** The contract's `Recurrence` (catalog/schedules.ts): when a schedule's transactions come. */
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

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

/** A recurrence as rSchedule rules, as Actual's `recurConfigToRSchedule`. */
export const recurrenceRules = (config: Recurrence): Array<Record<string, unknown>> => {
  const base: Record<string, unknown> = {
    start: parseDate(config.start),
    frequency: config.frequency.toUpperCase(),
    byHourOfDay: [12],
  };
  if (config.interval) base["interval"] = config.interval;
  if (config.endMode === "after_n_occurrences") base["count"] = config.endOccurrences;
  if (config.endMode === "on_date" && config.endDate !== undefined)
    base["end"] = parseDate(config.endDate);
  if (config.frequency !== "monthly" || config.patterns === undefined) return [base];
  if (config.patterns.length === 0) return [base];
  const days = config.patterns.filter((pattern) => pattern.type === "day");
  const weekdays = config.patterns.filter((pattern) => pattern.type !== "day");
  return [
    ...(days.length > 0 ? [{ ...base, byDayOfMonth: days.map((pattern) => pattern.value) }] : []),
    ...(weekdays.length > 0
      ? [
          {
            ...base,
            byDayOfWeek: weekdays.map((pattern) => {
              if (!WEEKDAYS.includes(pattern.type as (typeof WEEKDAYS)[number]))
                throw new Error("Invalid recurring date config");
              return [pattern.type, pattern.value];
            }),
          },
        ]
      : []),
  ];
};

export const recurSchedule = (config: Recurrence): RecurSchedule =>
  new Schedule({ rrules: recurrenceRules(config) as never });

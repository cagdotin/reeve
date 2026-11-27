/**
 * Actual's month and day helpers (`shared/months.ts`) as templates use them: a value is a month
 * `YYYY-MM` or a day `YYYY-MM-DD`, parsed as a local date at noon. `addMonths` answers a month and
 * `addDays` / `addWeeks` a day, which the template arithmetic relies on when it compares them.
 */
import * as d from "date-fns";

export const parse = (value: string | Date): Date => {
  if (value instanceof Date) return value;
  const [year, month, day] = value.split("-");
  if (day !== undefined) return new Date(Number(year), Number(month) - 1, Number(day), 12);
  if (month !== undefined) return new Date(Number(year), Number(month) - 1, 1, 12);
  return new Date(Number(year), 0, 1, 12);
};

const monthOf = (date: Date) => d.format(date, "yyyy-MM");
const dayOf = (date: Date) => d.format(date, "yyyy-MM-dd");

/** An object, so tests can stub one helper as Actual's do. */
export const months = {
  addMonths: (value: string | Date, n: number): string => monthOf(d.addMonths(parse(value), n)),
  subMonths: (value: string | Date, n: number): string => monthOf(d.subMonths(parse(value), n)),
  nextMonth: (value: string | Date): string => monthOf(d.addMonths(parse(value), 1)),
  prevMonth: (value: string | Date): string => monthOf(d.subMonths(parse(value), 1)),
  addDays: (value: string | Date, n: number): string => dayOf(d.addDays(parse(value), n)),
  addWeeks: (value: string | Date, n: number): string => dayOf(d.addWeeks(parse(value), n)),
  dayFromDate: (value: string | Date): string => dayOf(parse(value)),
  firstDayOfMonth: (value: string | Date): string => dayOf(d.startOfMonth(parse(value))),
  differenceInCalendarMonths: (a: string | Date, b: string | Date): number =>
    d.differenceInCalendarMonths(parse(a), parse(b)),
  differenceInCalendarDays: (a: string | Date, b: string | Date): number =>
    d.differenceInCalendarDays(parse(a), parse(b)),
  isAfter: (a: string | Date, b: string | Date): boolean => d.isAfter(parse(a), parse(b)),
};

/** A template amount (whole currency units) in minor units. */
export const amountToInteger = (amount: number): number => Math.round(amount * 100);
export const integerToAmount = (amount: number): number => amount / 100;

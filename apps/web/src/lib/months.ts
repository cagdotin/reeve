import { format, lastDayOfMonth, parse } from "date-fns";

/** A `YYYY-MM` month as "January 2026". */
export const monthLabel = (month: string) =>
  format(parse(month, "yyyy-MM", new Date()), "MMMM yyyy");

/** A `YYYY-MM` month's first and last day, as the register's `from` and `to` filters. */
export const monthDays = (month: string) => ({
  from: `${month}-01`,
  to: format(lastDayOfMonth(parse(month, "yyyy-MM", new Date())), "yyyy-MM-dd"),
});

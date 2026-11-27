/** The intervals and date ranges of Actual's reports, on `YYYY-MM-DD` days and `YYYY-MM` months. */
import {
  addDays,
  addMonths,
  currentMonth,
  daysBetween,
  lastDay,
  monthOf,
  monthRange,
  today,
  weekday,
} from "@reeve/contract/rules";

export type Interval = "Daily" | "Weekly" | "Monthly" | "Quarterly" | "Yearly";

export type TimeFrameMode =
  | "sliding-window"
  | "static"
  | "full"
  | "lastMonth"
  | "lastYear"
  | "yearToDate"
  | "priorYearToDate"
  | "currentQuarter"
  | "previousQuarter";

/** The first day of the week `day` falls in. */
export const weekOf = (day: string, firstDayOfWeek: number): string =>
  addDays(day, -((weekday(day) - firstDayOfWeek + 7) % 7));

/** The first month of the quarter `month` (or a day of it) falls in. */
export const quarterOf = (month: string): string => {
  const index = Math.floor((Number(month.slice(5, 7)) - 1) / 3) * 3 + 1;
  return `${month.slice(0, 4)}-${String(index).padStart(2, "0")}`;
};

export const dayRange = (start: string, end: string): Array<string> => {
  const days: Array<string> = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
};

/** The key of the interval a day falls in: the day, its week's first day, month, quarter or year. */
export const intervalKey = (day: string, interval: Interval, firstDayOfWeek: number): string => {
  switch (interval) {
    case "Daily":
      return day;
    case "Weekly":
      return weekOf(day, firstDayOfWeek);
    case "Monthly":
      return monthOf(day);
    case "Quarterly":
      return quarterOf(monthOf(day));
    case "Yearly":
      return day.slice(0, 4);
  }
};

/** Every interval key from `start` to `end` (days, or months for the longer intervals). */
export const intervalRange = (
  start: string,
  end: string,
  interval: Interval,
  firstDayOfWeek: number,
): Array<string> => {
  switch (interval) {
    case "Daily":
      return dayRange(start, end);
    case "Weekly": {
      const weeks: Array<string> = [];
      const last = weekOf(end, firstDayOfWeek);
      for (let week = weekOf(start, firstDayOfWeek); week <= last; week = addDays(week, 7))
        weeks.push(week);
      return weeks;
    }
    case "Monthly":
      return monthRange(monthOf(start), monthOf(end));
    case "Quarterly": {
      const quarters: Array<string> = [];
      const last = quarterOf(monthOf(end));
      for (
        let quarter = quarterOf(monthOf(start));
        quarter <= last;
        quarter = addMonths(quarter, 3)
      )
        quarters.push(quarter);
      return quarters;
    }
    case "Yearly": {
      const years: Array<string> = [];
      for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year++)
        years.push(String(year));
      return years;
    }
  }
};

/** The first day of an interval key. */
export const keyStart = (key: string): string =>
  key.length === 4 ? `${key}-01-01` : key.length === 7 ? `${key}-01` : key;

const monthsBetween = (from: string, to: string) =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
  Number(to.slice(5, 7)) -
  Number(from.slice(5, 7));

const isDay = (value: string) => value.length === 10;

/**
 * The range a report's time frame covers, as Actual's `calculateTimeRange`: a live mode moves the
 * stored range to now. Months, or days for a day-shaped sliding window.
 */
export const resolveTimeFrame = (
  start: string | undefined,
  end: string | undefined,
  mode: TimeFrameMode | undefined,
  latestTransaction?: string | null,
): { start: string; end: string } => {
  const now = currentMonth();
  const from = start ?? addMonths(now, -5);
  const to = end ?? now;
  switch (mode ?? "sliding-window") {
    case "full": {
      const latest = latestTransaction ? monthOf(latestTransaction) : null;
      return { start: from, end: latest !== null && latest > now ? latest : now };
    }
    case "sliding-window": {
      if (isDay(from) && isDay(to)) {
        const day = today();
        return { start: addDays(day, -Math.max(daysBetween(from, to), 0)), end: day };
      }
      const offset = monthsBetween(monthOf(from), monthOf(to));
      if (from > to) return { start: now, end: addMonths(now, offset) };
      return { start: addMonths(now, -offset), end: now };
    }
    case "lastMonth":
      return { start: addMonths(now, -1), end: addMonths(now, -1) };
    case "lastYear": {
      const year = Number(now.slice(0, 4)) - 1;
      return { start: `${year}-01`, end: `${year}-12` };
    }
    case "yearToDate":
      return { start: `${now.slice(0, 4)}-01`, end: now };
    case "priorYearToDate": {
      const year = Number(now.slice(0, 4)) - 1;
      return { start: `${year}-01`, end: `${year}${today().slice(4)}` };
    }
    case "currentQuarter":
      return { start: quarterOf(now), end: addMonths(quarterOf(now), 2) };
    case "previousQuarter": {
      const quarter = addMonths(quarterOf(now), -3);
      return { start: quarter, end: addMonths(quarter, 2) };
    }
    case "static":
      return { start: from, end: to };
  }
};

/** The first day of a month or day. */
export const startDay = (value: string): string => (isDay(value) ? value : `${value}-01`);
/** The last day of a month, or the day itself. */
export const endDay = (value: string): string => (isDay(value) ? value : lastDay(value));

export const DATE_RANGES = [
  "This week",
  "Last week",
  "This month",
  "Last month",
  "Current quarter",
  "Previous quarter",
  "Last 30 days",
  "Last 3 months",
  "Last 6 months",
  "Last 12 months",
  "Year to date",
  "Last year",
  "Prior year to date",
  "All time",
] as const;
export type DateRange = (typeof DATE_RANGES)[number];

/**
 * The days a custom report's live date range covers, as Actual's `getLiveRange`; never before the
 * earliest transaction.
 */
export const liveRange = (
  range: DateRange,
  earliest: string,
  latest: string,
  includeCurrentInterval: boolean,
  firstDayOfWeek: number,
): { start: string; end: string } => {
  const day = today();
  const month = currentMonth();
  const bounded = (start: string, end: string) => ({
    start: start < earliest ? earliest : start,
    end,
  });
  const lastMonths = (offset: number, length: number) => {
    const start = `${addMonths(month, -offset)}-01`;
    return { start, end: lastDay(addMonths(monthOf(start), length)) };
  };
  const lastWeeks = (offset: number, length: number) => {
    const start = addDays(weekOf(day, firstDayOfWeek), -7 * offset);
    return { start, end: addDays(start, 7 * length + 6) };
  };
  const year = Number(month.slice(0, 4));
  switch (range) {
    case "Year to date":
      return bounded(`${year}-01-01`, day);
    case "Last month":
      return bounded(`${addMonths(month, -1)}-01`, lastDay(addMonths(month, -1)));
    case "Last year":
      return bounded(`${year - 1}-01-01`, `${year - 1}-12-31`);
    case "Prior year to date":
      return bounded(`${year - 1}-01-01`, `${year - 1}${day.slice(4)}`);
    case "Current quarter":
      return bounded(`${quarterOf(month)}-01`, lastDay(addMonths(quarterOf(month), 2)));
    case "Previous quarter": {
      const quarter = addMonths(quarterOf(month), -3);
      return bounded(`${quarter}-01`, lastDay(addMonths(quarter, 2)));
    }
    case "Last 30 days":
      return bounded(addDays(day, -29), day);
    case "All time":
      return { start: earliest, end: latest };
    case "This week":
      return lastWeeks(0, 0);
    case "Last week":
      return lastWeeks(1, 1 - (includeCurrentInterval ? 0 : 1));
    case "This month":
      return lastMonths(0, 0);
    case "Last 3 months":
    case "Last 6 months":
    case "Last 12 months": {
      const offset = Number(range.split(" ")[1]);
      return lastMonths(offset, offset - (includeCurrentInterval ? 0 : 1));
    }
  }
};

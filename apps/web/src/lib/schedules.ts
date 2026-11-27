import type {
  DiscoveredSchedule,
  Recurrence,
  ScheduleActivity,
  ScheduleAmount,
  ScheduleStatus,
} from "@reeve/contract/catalog";
import { addDays, daysBetween } from "@reeve/contract/rules";
import { getDay, getDaysInMonth, parseISO } from "date-fns";
import { chosen, type FacetGroup, type FacetValue } from "./facets.ts";
import type { Sort } from "./insights.ts";

export type Row = ScheduleActivity;

export const displayName = (row: Pick<Row, "name" | "payee">) =>
  row.name ?? row.payee ?? "Unnamed schedule";

// ---------------------------------------------------------------------------------------------
// Reading a row
// ---------------------------------------------------------------------------------------------

/** How urgent each status is, most first, with the name of its group in the table. */
export const URGENCY: ReadonlyArray<{ readonly status: ScheduleStatus; readonly label: string }> = [
  { status: "missed", label: "Missed" },
  { status: "due", label: "Due today" },
  { status: "upcoming", label: "Upcoming" },
  { status: "scheduled", label: "Later" },
  { status: "paid", label: "Paid" },
  { status: "completed", label: "Completed" },
];

/** Which way a schedule's money goes; a range's zero end says nothing, so it reads both ends. */
export const amountIsOutflow = (amount: ScheduleAmount | null) => {
  if (amount === null) return true;
  return amount.op === "isbetween" ? amount.value.num1 + amount.value.num2 <= 0 : amount.value <= 0;
};

/** A schedule's amount as it reads: `12.99`, `~12.99`, `90.00–120.00`; money in has a plus. */
export const amountLabel = (amount: ScheduleAmount | null, format: (value: number) => string) => {
  if (amount === null) return "";
  if (amount.op === "isbetween") {
    const [low, high] = [Math.abs(amount.value.num1), Math.abs(amount.value.num2)].toSorted(
      (a, b) => a - b,
    );
    return `${amountIsOutflow(amount) ? "" : "+"}${format(low!)}–${format(high!)}`;
  }
  const sign = amount.value > 0 ? "+" : "";
  return `${amount.op === "isapprox" ? "~" : ""}${sign}${format(Math.abs(amount.value))}`;
};

/** What the op means in words, for a tooltip. */
export const amountMeaning = (amount: ScheduleAmount | null) => {
  if (amount === null) return "No amount set";
  if (amount.op === "is") return "Exactly this amount";
  if (amount.op === "isapprox") return "About this amount: 7.5% either side still matches";
  return "Any amount in this range matches; forecasts use the middle";
};

export const relativeDay = (day: string, today: string) => {
  const days = daysBetween(today, day);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
};

type Pattern = NonNullable<Recurrence["patterns"]>[number];

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

/** Which days of a month its patterns name, so two on one day count once. */
const patternDays = (month: Date, patterns: ReadonlyArray<Pattern>) => {
  const length = getDaysInMonth(month);
  const days = new Set<number>();
  for (const { type, value } of patterns) {
    if (type === "day") {
      const day = value < 0 ? length + value + 1 : value;
      if (day >= 1 && day <= length) days.add(day);
      continue;
    }
    const firstOffset = (WEEKDAYS.indexOf(type) - getDay(month) + 7) % 7;
    const count = Math.floor((length - firstOffset - 1) / 7) + 1;
    const nth = value < 0 ? count + value + 1 : value;
    if (nth >= 1 && nth <= count) days.add(firstOffset + 1 + (nth - 1) * 7);
  }
  return days;
};

/** A whole cycle of leap years and weekdays. */
const CYCLE_YEARS = 28;

/**
 * How many times a year a recurrence falls, for the editor's cost per month. Days and weeks always
 * land; a month or a year may not (the 31st, a fifth Friday, a leap day), so those count a cycle.
 */
export const timesPerYear = ({
  frequency,
  interval,
  start,
  patterns = [],
}: Pick<Recurrence, "frequency" | "interval" | "start" | "patterns">) => {
  const every = Math.max(1, interval);
  if (frequency === "daily") return 365 / every;
  if (frequency === "weekly") return 52 / every;
  const first = parseISO(start);
  const step = frequency === "yearly" ? 12 * every : every;
  const useDays = frequency === "monthly" && patterns.length > 0;
  const steps = frequency === "yearly" ? CYCLE_YEARS : CYCLE_YEARS * 12;
  let dates = 0;
  for (let at = 0; at < steps; at++) {
    const month = new Date(first.getFullYear(), first.getMonth() + at * step, 1);
    if (useDays) dates += patternDays(month, patterns).size;
    else if (first.getDate() <= getDaysInMonth(month)) dates += 1;
  }
  return dates / ((steps * step) / 12);
};

// ---------------------------------------------------------------------------------------------
// Sorting and grouping
// ---------------------------------------------------------------------------------------------

export type ScheduleSortKey =
  | "urgency"
  | "name"
  | "payee"
  | "account"
  | "next"
  | "amount"
  | "monthly";

export type ScheduleSort = Sort<ScheduleSortKey>;

export const DEFAULT_SORT: ScheduleSort = { key: "urgency", descending: false };

export const DESCENDING_FIRST: ReadonlySet<ScheduleSortKey> = new Set([
  "urgency",
  "amount",
  "monthly",
]);

const rank = (row: Row) => URGENCY.findIndex(({ status }) => status === row.status);

const byName = (a: Row, b: Row) =>
  displayName(a).localeCompare(displayName(b), undefined, { sensitivity: "base" });

const SORT_VALUE: Record<ScheduleSortKey, (row: Row) => string | number | null> = {
  urgency: rank,
  name: displayName,
  payee: (row) => row.payee,
  account: (row) => row.account,
  next: (row) => row.nextDate,
  amount: (row) => Math.abs(row.expected),
  monthly: (row) => (row.monthly === 0 ? null : Math.abs(row.monthly)),
};

const compareValues = (a: string | number, b: string | number) =>
  typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b), undefined, { sensitivity: "base" });

const byNext = (a: Row, b: Row) => (a.nextDate ?? "").localeCompare(b.nextDate ?? "");

export const sortSchedules = (rows: ReadonlyArray<Row>, { key, descending }: ScheduleSort) =>
  rows.toSorted((a, b) => {
    const [left, right] = [SORT_VALUE[key](a), SORT_VALUE[key](b)];
    if (left === null || right === null)
      return Number(left === null) - Number(right === null) || byName(a, b);
    return (descending ? -1 : 1) * compareValues(left, right) || byNext(a, b) || byName(a, b);
  });

/** The rows under their urgency, in order, leaving out groups with none. */
export const groupByUrgency = (rows: ReadonlyArray<Row>) =>
  URGENCY.map(({ status, label }) => ({
    status,
    label,
    rows: rows.filter((row) => row.status === status),
  })).filter((group) => group.rows.length > 0);

// ---------------------------------------------------------------------------------------------
// Filters and checks
// ---------------------------------------------------------------------------------------------

/** How far ahead an end counts as soon. */
const ENDING_DAYS = 45;

const isActive = (row: Row) => !row.completed;

type CheckId = "drift" | "quiet" | "uncategorized" | "ending" | "accountless";

const CHECK_PASSES: Record<CheckId, (row: Row, today: string) => boolean> = {
  drift: (row) => isActive(row) && row.drift !== null,
  quiet: (row) => isActive(row) && row.quiet !== null,
  uncategorized: (row) => isActive(row) && row.categoryId === null,
  ending: (row, today) =>
    isActive(row) &&
    row.endsOn !== null &&
    row.endsOn >= today &&
    row.endsOn <= addDays(today, ENDING_DAYS),
  accountless: (row) => isActive(row) && row.accountId === null,
};

const CHECK_LABELS: Record<CheckId, string> = {
  drift: "Charged differently",
  quiet: "Gone quiet",
  uncategorized: "No category",
  ending: "Ending soon",
  accountless: "No account",
};

const countBy = (
  rows: ReadonlyArray<Row>,
  key: (row: Row) => string | null,
  name: (row: Row) => string,
) => {
  const found = new Map<string, { label: string; count: number }>();
  for (const row of rows) {
    const value = key(row);
    if (value === null) continue;
    found.set(value, { label: name(row), count: (found.get(value)?.count ?? 0) + 1 });
  }
  return [...found]
    .map(([value, { label, count }]) => ({ value, label, count }))
    .toSorted((a, b) => a.label.localeCompare(b.label));
};

/** The filters over the rows, each option with how many it would keep. */
export const scheduleFilterGroups = (rows: ReadonlyArray<Row>, today: string): Array<FacetGroup> =>
  [
    {
      id: "status",
      label: "Status",
      options: URGENCY.map(({ status, label }) => ({
        value: status,
        label,
        count: rows.filter((row) => row.status === status).length,
      })).filter((option) => option.count > 0),
    },
    {
      id: "direction",
      label: "Direction",
      options: [
        { value: "out", label: "Going out", count: rows.filter((row) => row.expected < 0).length },
        { value: "in", label: "Coming in", count: rows.filter((row) => row.expected > 0).length },
      ].filter((option) => option.count > 0),
    },
    {
      id: "check",
      label: "Needs attention",
      options: (Object.keys(CHECK_PASSES) as Array<CheckId>)
        .map((value) => ({
          value,
          label: CHECK_LABELS[value],
          count: rows.filter((row) => CHECK_PASSES[value](row, today)).length,
        }))
        .filter((option) => option.count > 0),
    },
    {
      id: "account",
      label: "Account",
      options: countBy(
        rows,
        (row) => row.accountId,
        (row) => row.account ?? "",
      ),
    },
    {
      id: "payee",
      label: "Payee",
      options: countBy(
        rows,
        (row) => row.payeeId,
        (row) => row.payee ?? "",
      ),
    },
    {
      id: "category",
      label: "Category",
      options: countBy(
        rows,
        (row) => row.categoryId,
        (row) => row.categoryName ?? "",
      ),
    },
  ].filter((group) => group.options.length > 0);

/**
 * Whether a row passes the filters: within a group any chosen value, across groups all. Completed
 * schedules stay hidden until the status filter asks for them.
 */
export const passesFilters = (row: Row, filters: FacetValue, today: string) => {
  const statuses = chosen(filters, "status");
  if (statuses === undefined ? row.completed : !statuses.includes(row.status)) return false;
  const directions = chosen(filters, "direction");
  if (directions !== undefined && !directions.includes(row.expected < 0 ? "out" : "in"))
    return false;
  const checks = chosen(filters, "check");
  if (checks !== undefined && !checks.some((id) => CHECK_PASSES[id as CheckId](row, today)))
    return false;
  const within = (group: string, value: string | null) => {
    const values = chosen(filters, group);
    return values === undefined || (value !== null && values.includes(value));
  };
  return (
    within("account", row.accountId) &&
    within("payee", row.payeeId) &&
    within("category", row.categoryId)
  );
};

export const matchesSearch = (row: Row, query: string) => {
  const q = query.trim().toLowerCase();
  return (
    q === "" ||
    [row.name, row.payee, row.account, row.categoryName, row.notes].some((text) =>
      (text ?? "").toLowerCase().includes(q),
    )
  );
};

/** The checklist; each check carries the filters that list exactly its schedules. */
export const attentionItems = (rows: ReadonlyArray<Row>, today: string) => {
  const count = (id: CheckId) => rows.filter((row) => CHECK_PASSES[id](row, today)).length;
  const check = (id: CheckId, open: string, done: string, title: string) => ({
    id,
    open,
    done,
    title,
    count: count(id),
    filters: { check: [id] } as FacetValue,
  });
  return [
    {
      id: "missed",
      open: "missed",
      done: "Nothing missed",
      title: "The date passed with no transaction linked to it",
      count: rows.filter((row) => row.status === "missed").length,
      filters: { status: ["missed"] } as FacetValue,
    },
    check(
      "drift",
      "charged differently",
      "Charges match what schedules expect",
      "Recent charges settled on an amount the schedule does not expect, so new ones may stop linking to it",
    ),
    check(
      "quiet",
      "gone quiet",
      "Every schedule has recent charges",
      "Two or more of its dates passed with no charge from its payee on its account",
    ),
    check(
      "uncategorized",
      "without a category",
      "Every schedule has a category",
      "Its transactions get no category from it",
    ),
    check("ending", "ending soon", "None end soon", `It ends within ${ENDING_DAYS} days`),
    check(
      "accountless",
      "with no account",
      "Every schedule has an account",
      "It cannot be posted, and forecasts leave it out",
    ),
  ];
};

// ---------------------------------------------------------------------------------------------
// Found in the history
// ---------------------------------------------------------------------------------------------

export const foundKey = (found: DiscoveredSchedule) => `${found.accountId}:${found.payeeId ?? ""}`;

/**
 * What the history found that is not on a schedule yet. `find_schedules` skips only transactions
 * linked to a schedule, so one made after its charges would be found again.
 */
export const newCandidates = (
  found: ReadonlyArray<DiscoveredSchedule>,
  rows: ReadonlyArray<Row>,
  dismissed: ReadonlySet<string>,
) => {
  const scheduled = rows.filter(isActive);
  return found
    .filter(
      (each) =>
        each.payeeId === null ||
        !scheduled.some(
          (row) =>
            row.payeeId === each.payeeId &&
            (row.accountId === null || row.accountId === each.accountId),
        ),
    )
    .filter((each) => !dismissed.has(foundKey(each)))
    .toSorted((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
};

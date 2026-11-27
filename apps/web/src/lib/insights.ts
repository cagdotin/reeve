import { addMonths, daysInMonth, monthOf } from "@reeve/contract/rules";

/** How far a value moved, in the format of the value; null when it did not. */
export const signedChange = (
  change: number,
  format: (value: number) => string = String,
): string | null => {
  if (change === 0) return null;
  return `${change > 0 ? "+" : "−"}${format(Math.abs(change))}`;
};

/** Whether a month reaches into the range; every month does over all time. */
export const monthInRange = (month: string, since: string | undefined, until?: string) =>
  (since === undefined || `${month}-31` >= since) &&
  (until === undefined || `${month}-01` <= until);

/** Dates typed for a range; blank is open on that side. */
export interface CustomDates {
  readonly from: string;
  readonly to: string;
}

/** The days typed dates mean, whichever way round they were typed. */
export const customSpan = ({ from, to }: CustomDates) => {
  const [first, last] = from !== "" && to !== "" && from > to ? [to, from] : [from, to];
  return {
    since: first === "" ? undefined : first,
    until: last === "" ? undefined : last,
  };
};

export const ALL_TIME = "all";
export const CUSTOM_RANGE = "custom";

export const RANGE_PRESETS: ReadonlyArray<number> = [1, 3, 6, 12];

/** The range's name; `null` months is all time. */
export const rangeLabel = (months: number | null) =>
  months === null ? "All time" : months === 1 ? "Last month" : `Last ${months} months`;

/** The day `months` months before `day`, on the last of that month if it is shorter. */
export const rangeStart = (day: string, months: number) => {
  const month = addMonths(monthOf(day), -months);
  const date = Math.min(Number(day.slice(8)), daysInMonth(month));
  return `${month}-${String(date).padStart(2, "0")}`;
};

/** The presets as a dropdown's items, with `months` among them when it is not one, and all time. */
export const rangeItems = (presets: ReadonlyArray<number>, months: number | null = null) => [
  ...[...new Set([...presets, ...(months === null ? [] : [months])])]
    .toSorted((a, b) => a - b)
    .map((each) => ({ value: String(each), label: rangeLabel(each) })),
  { value: ALL_TIME, label: rangeLabel(null) },
];

export interface Sort<Key extends string> {
  readonly key: Key;
  readonly descending: boolean;
}

/**
 * A header clicked: its column in its natural order, then reversed, then back to `reset` if there
 * is one. Text sorts ascending first; `descendingFirst` names the columns that do not.
 */
export const nextSort = <Key extends string>(
  sort: Sort<Key>,
  key: Key,
  descendingFirst: ReadonlySet<Key>,
  reset?: Sort<Key>,
): Sort<Key> => {
  const natural = descendingFirst.has(key);
  if (sort.key !== key) return { key, descending: natural };
  return reset !== undefined && sort.descending !== natural
    ? reset
    : { key, descending: !sort.descending };
};

/** The set with `id` added, or taken out if it was in. */
export const toggled = (ids: ReadonlySet<string>, id: string): ReadonlySet<string> => {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

/** Patterns in one payee's history, as plain functions of its transactions, oldest first. */

const PRICE_MIN_CHARGES = 3;
/** Of the charges since a new amount first appeared, how many must be that amount. */
const PRICE_MIN_SETTLED = 0.7;
/** A larger jump is a different purchase, as a day ticket and a monthly pass are. */
const PRICE_MAX_JUMP = 0.5;

const QUIET_MIN_MONTHS = 5;
const QUIET_MIN_DAYS = 30;
const QUIET_GAPS = 2.5;

const RECENT = 5;
const RECENT_MIN = 3;

const DAY_MS = 86_400_000;

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

const median = (values: ReadonlyArray<number>) => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

/**
 * The amount a payee's charges last settled on and the one before it. Its last two charges have to
 * agree on an amount never charged before, which then holds apart from the odd one-off.
 */
export const latestPriceChange = (
  history: ReadonlyArray<{ readonly date: string; readonly amount: number }>,
) => {
  const charges = history.filter((charge) => charge.amount > 0);
  if (charges.length < PRICE_MIN_CHARGES) return null;
  const to = charges.at(-1)!.amount;
  if (charges.at(-2)!.amount !== to) return null;
  const first = charges.findIndex((charge) => charge.amount === to);
  if (first === 0) return null;
  const since = charges.slice(first);
  if (since.filter((charge) => charge.amount === to).length / since.length < PRICE_MIN_SETTLED)
    return null;
  const from = charges[first - 1]!.amount;
  if (Math.abs(to - from) / from > PRICE_MAX_JUMP) return null;
  return { from, to, date: charges[first]!.date };
};

/** How long a payee used across many months has been silent, when that is far longer than usual. */
export const quietFor = (dates: ReadonlyArray<string>, today: string) => {
  const days = [...new Set(dates)];
  if (new Set(days.map((day) => day.slice(0, 7))).size < QUIET_MIN_MONTHS) return null;
  const usualGap = median(days.slice(1).map((day, index) => daysBetween(days[index]!, day)));
  const silentDays = daysBetween(days.at(-1)!, today);
  return silentDays > Math.max(QUIET_MIN_DAYS, QUIET_GAPS * usualGap)
    ? { silentDays, usualGap }
    : null;
};

/** Whether most of the latest transactions, each with its categories, ignore what the rules set. */
export const ruleDisagrees = (
  newestFirst: ReadonlyArray<ReadonlyArray<string>>,
  ruleCategories: ReadonlySet<string>,
) => {
  const recent = newestFirst.slice(0, RECENT);
  if (recent.length < RECENT_MIN || ruleCategories.size === 0) return false;
  const agreeing = recent.filter((categories) => categories.some((id) => ruleCategories.has(id)));
  return agreeing.length * 2 < recent.length;
};

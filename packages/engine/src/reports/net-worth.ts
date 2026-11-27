import type { NetWorthReport, TimeFrameMode } from "./types.ts";
import {
  addDays,
  dayToInt,
  firstDay,
  intToDay,
  lastDay,
  prevMonth,
  today,
} from "@reeve/contract/rules";
import type { AccountScope } from "@reeve/contract/catalog";
import type { Book } from "../book.ts";
import { firstDayOfWeek } from "./context.ts";
import { intervalKey, intervalRange, resolveTimeFrame, weekOf } from "./dates.ts";
import {
  allOf,
  inIds,
  queryLines,
  sqlOf,
  transactionBounds,
  whereOf,
  scopeIds,
  type Condition,
  type ConditionsOp,
} from "./lines.ts";

export interface NetWorthInput {
  readonly start?: string;
  readonly end?: string;
  readonly mode?: TimeFrameMode;
  readonly interval?: "Daily" | "Weekly" | "Monthly" | "Yearly";
  readonly accounts?: ReadonlyArray<string>;
  readonly conditions?: ReadonlyArray<Condition>;
  readonly conditionsOp?: ConditionsOp;
  readonly scope?: AccountScope;
}

/** Actual's net worth spreadsheet: each account's balance at the end of every interval. */
export const netWorthReport = (book: Book, input: NetWorthInput): NetWorthReport => {
  const interval = input.interval ?? "Monthly";
  const weekStart = firstDayOfWeek(book);
  const { latest, earliest } = transactionBounds(book);
  const range = resolveTimeFrame(
    input.start,
    input.end,
    input.mode ?? "static",
    latest === null ? null : intToDay(latest),
  );
  const rangeStart = firstDay(range.start);

  // One interval before the range gives the first interval its change; none when nothing is older.
  let startDate =
    interval === "Daily"
      ? addDays(rangeStart, -1)
      : interval === "Weekly"
        ? weekOf(addDays(rangeStart, -1), weekStart)
        : firstDay(prevMonth(range.start));
  if (earliest !== null && intToDay(earliest) >= rangeStart) {
    const first = intToDay(earliest);
    startDate =
      interval === "Daily"
        ? first
        : interval === "Weekly"
          ? weekOf(first, weekStart)
          : firstDay(range.start);
  }
  let endDate = lastDay(range.end);
  if ((interval === "Daily" || interval === "Weekly") && endDate > today()) endDate = today();

  const accounts = book.client
    .prepare(
      `SELECT id, name FROM accounts WHERE type IN ('asset', 'liability') ORDER BY sort_order, name`,
    )
    .all() as Array<{ id: string; name: string }>;
  const scoped = scopeIds(book, input.scope);
  const chosen = accounts.filter(
    (account) =>
      (input.accounts === undefined || input.accounts.includes(account.id)) &&
      (scoped === undefined || scoped.includes(account.id)),
  );
  const inAccounts = inIds(
    "l.account_id",
    chosen.map((account) => account.id),
  );
  const filters = whereOf(input.conditions, input.conditionsOp);

  const starting = new Map(
    queryLines<{ account_id: string; amount: number }>(
      book,
      "l.account_id, sum(l.amount) AS amount",
      allOf(inAccounts, filters, sqlOf("l.date < ?", dayToInt(startDate))),
      "GROUP BY l.account_id",
    ).map((row) => [row.account_id, row.amount]),
  );
  const changes = new Map<string, Map<string, number>>();
  for (const row of queryLines<{ account_id: string; date: number; amount: number }>(
    book,
    "l.account_id, l.date, sum(l.amount) AS amount",
    allOf(
      inAccounts,
      filters,
      sqlOf("l.date >= ? AND l.date <= ?", dayToInt(startDate), dayToInt(endDate)),
    ),
    "GROUP BY l.account_id, l.date",
  )) {
    const key = intervalKey(intToDay(row.date), interval, weekStart);
    const byKey = changes.get(row.account_id) ?? new Map<string, number>();
    byKey.set(key, (byKey.get(key) ?? 0) + row.amount);
    changes.set(row.account_id, byKey);
  }

  const intervals = intervalRange(startDate, endDate, interval, weekStart);
  const balances = chosen.map((account) => {
    let balance = starting.get(account.id) ?? 0;
    return intervals.map((key) => (balance += changes.get(account.id)?.get(key) ?? 0));
  });
  const prior = chosen.reduce((sum, account) => sum + (starting.get(account.id) ?? 0), 0);

  let lowest: number | null = null;
  let highest: number | null = null;
  let previous = prior;
  const points = intervals.map((date, index) => {
    let assets = 0;
    let debt = 0;
    const perAccount: Record<string, number> = {};
    chosen.forEach((account, i) => {
      const balance = balances[i]![index]!;
      perAccount[account.id] = balance;
      if (balance < 0) debt += -balance;
      else assets += balance;
    });
    const netWorth = assets - debt;
    const change = netWorth - previous;
    previous = netWorth;
    if (lowest === null || netWorth < lowest) lowest = netWorth;
    if (highest === null || netWorth > highest) highest = netWorth;
    return { date, assets, debt, netWorth, change, balances: perAccount };
  });
  const startNetWorth = points[0]?.netWorth ?? 0;
  const endNetWorth = points.at(-1)?.netWorth ?? 0;

  return {
    start: startDate,
    end: endDate,
    interval,
    points,
    netWorth: endNetWorth,
    totalChange: endNetWorth - startNetWorth,
    lowest,
    highest,
    accounts: chosen.filter((_, i) => balances[i]!.some((balance) => balance !== 0)),
  };
};

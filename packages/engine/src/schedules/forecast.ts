/**
 * Balance forecasts, as Actual's `server/forecast/`: each account's balance day by day from its
 * recorded transactions plus the schedules' coming transactions that are not recorded yet, or a
 * tracking budget's balance month by month from what it budgets.
 */
import type { Forecast, RuleAction } from "./types.ts";
import {
  addDays,
  dayToInt,
  intToDay,
  lastDay,
  monthOf,
  monthRange,
  today as currentDay,
} from "@reeve/contract/rules";
import { addMonths } from "date-fns";
import { invalid, readSettings, type Book } from "../book.ts";
import { computeMonths } from "../budget/view.ts";
import type { EntryDraft } from "../ledger/transactions.ts";
import { prepare, queryLines, whereOf, type Condition } from "../reports/lines.ts";
import { runRules } from "../rules/run.ts";
import { dayOf, getNextDate, isRecurrence, parseDay, type DateValue } from "./recurrence.ts";
import { loadSchedule, setAction, type LoadedSchedule } from "./schedules.ts";
import * as t from "../db/schema.ts";
import {
  getScheduledAmount,
  indexPostedScheduleTransactions,
  isScheduleOccurrencePosted,
  type PostedScheduleTransaction,
} from "./status.ts";
import { eq } from "drizzle-orm";

/** The account of schedules without one, in a forecast that includes them. */
export const FORECAST_UNASSIGNED_ACCOUNT_ID = "__unassigned_schedule__";
const TRACKING_BUDGET_ID = "tracking-budget";
const TRACKING_BUDGET_NAME = "Tracking Budget";

type Point = Forecast["dataPoints"][number];
type ForecastTransaction = Point["transactions"][number];

interface ForecastAccount {
  readonly id: string;
  readonly name: string;
  readonly onBudget: boolean;
  readonly balance: number;
}

/** Report filters on a forecast, as Actual's `forecast-filters`. */
export interface ForecastFilters {
  readonly conditions?: ReadonlyArray<Condition> | undefined;
  readonly conditionsOp?: "and" | "or" | undefined;
}

/** Whether account conditions may pick the accounts up front (Actual's `getAccountRestrictionMode`). */
const canRestrictAccounts = (conditions: ReadonlyArray<Condition>, op: "and" | "or") =>
  conditions.some((condition) => condition.field === "account") &&
  (conditions.every((condition) => condition.field === "account") || op === "and");

/** Actual's `matchesAccountCondition`. */
const matchesAccountCondition = (account: ForecastAccount, condition: Condition) => {
  const name = account.name.toLowerCase();
  const value = condition.value;
  switch (condition.op) {
    case "is":
      return account.id === value;
    case "isNot":
      return account.id !== value;
    case "oneOf":
      return Array.isArray(value) && value.includes(account.id);
    case "notOneOf":
      return !(Array.isArray(value) && value.includes(account.id));
    case "contains":
      return name.includes(String(value).toLowerCase());
    case "doesNotContain":
      return !name.includes(String(value).toLowerCase());
    case "matches":
      try {
        return new RegExp(String(value)).test(name);
      } catch {
        return false;
      }
    case "onBudget":
      return account.onBudget;
    case "offBudget":
      return !account.onBudget;
    default:
      return false;
  }
};

/** The accounts the account conditions keep, when they may restrict them. */
const restrictAccounts = (
  accounts: ReadonlyArray<ForecastAccount>,
  conditions: ReadonlyArray<Condition>,
  op: "and" | "or",
): Array<ForecastAccount> => {
  if (!canRestrictAccounts(conditions, op)) return [...accounts];
  const accountConditions = conditions.filter((condition) => condition.field === "account");
  return accounts.filter((account) => {
    const matches = accountConditions.map((condition) =>
      matchesAccountCondition(account, condition),
    );
    return op === "or" ? matches.some(Boolean) : matches.every(Boolean);
  });
};

/** A projected transaction as the report filters see it: the columns of a report line. */
interface FilterRow {
  readonly account_id: string;
  readonly account_name: string;
  readonly on_budget: number;
  readonly date: number;
  readonly amount: number;
  readonly payee_id: string | null;
  readonly payee_name: string | null;
  readonly notes: string | null;
  readonly category_id: string | null;
  readonly category_name: string | null;
  readonly group_id: string | null;
  readonly group_name: string | null;
  readonly transfer_account: string | null;
}

const FILTER_COLUMNS = [
  "account_id",
  "account_name",
  "on_budget",
  "date",
  "amount",
  "payee_id",
  "payee_name",
  "notes",
  "category_id",
  "category_name",
  "group_id",
  "group_name",
  "transfer_account",
] as const;

/** Tests projected transactions against the filters with the SQL the report lines use. */
const filterMatcher = (book: Book, filters: ForecastFilters) => {
  const conditions = filters.conditions ?? [];
  if (conditions.length === 0) return () => true;
  prepare(book);
  const where = whereOf(conditions, filters.conditionsOp);
  const statement = book.client.prepare(
    `SELECT 1 AS hit FROM (SELECT ${FILTER_COLUMNS.map((column) => `? AS ${column}`).join(", ")},
       NULL AS imported_payee, 0 AS cleared, 0 AS reconciled) l WHERE ${where.sql}`,
  );
  return (row: FilterRow) =>
    statement.get(...FILTER_COLUMNS.map((column) => row[column]), ...where.params) !== undefined;
};

interface DateContext {
  readonly start: string;
  readonly end: string;
  readonly firstForecastDate: string;
}

const dateContext = (
  from: string | undefined,
  to: string | undefined,
  today: string,
): DateContext => {
  const start = from ?? today;
  const end = to ?? dayOf(addMonths(parseDay(today), 12));
  if (end < start) return invalid("The forecast ends before it starts");
  return { start, end, firstForecastDate: end < today ? start : start > today ? start : today };
};

const daysOf = (start: string, end: string) => {
  const days: Array<string> = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
};

const accountsOf = (book: Book, ids: ReadonlyArray<string> | undefined): Array<ForecastAccount> => {
  const rows = book.client
    .prepare(
      `SELECT a.id, a.name, a.on_budget AS onBudget, coalesce(sum(p.amount), 0) AS balance
       FROM accounts a LEFT JOIN postings p ON p.account_id = a.id
       WHERE a.type IN ('asset', 'liability')
       GROUP BY a.id ORDER BY a.on_budget DESC, a.sort_order`,
    )
    .all() as Array<{ id: string; name: string; onBudget: number; balance: number }>;
  return rows
    .filter((row) => ids === undefined || ids.includes(row.id))
    .map((row) => ({ ...row, onBudget: row.onBudget === 1 }));
};

const emptyForecast = (context: DateContext): Forecast => ({
  dataPoints: [],
  lowestBalance: { date: context.start, balance: 0, accountId: "", accountName: "" },
  forecastStartDate: context.start,
  forecastEndDate: context.end,
});

/** The days a schedule falls on from its next date through `end`. */
export const getFutureOccurrenceDates = (
  nextDate: string,
  date: DateValue,
  end: string,
): Array<string> => {
  if (!isRecurrence(date)) return date <= end ? [date] : [];
  const cond = { op: "is", value: date };
  const dates = [nextDate];
  const seen = new Set(dates);
  let day = nextDate;
  for (let iterations = 0; day <= end && iterations < 10_000; iterations++) {
    const next = getNextDate(cond, day);
    if (next === null || next > end) break;
    if (seen.has(next)) {
      day = addDays(day, 1);
      continue;
    }
    dates.push(next);
    seen.add(next);
    day = addDays(next, 1);
  }
  return dates;
};

interface Occurrence {
  readonly account: string;
  readonly date: string;
  readonly transaction: ForecastTransaction;
  readonly row: FilterRow;
}

const setValue = (actions: ReadonlyArray<RuleAction>, field: string) => {
  const action = setAction(actions, field);
  return typeof action?.value === "string" ? action.value : null;
};

/** Each coming transaction of the schedules not yet recorded, run through the rules, both sides of a transfer. */
const futureOccurrences = (
  book: Book,
  schedules: ReadonlyArray<LoadedSchedule>,
  end: string,
): Array<Occurrence> => {
  const posted = indexPostedScheduleTransactions(
    (
      book.client
        .prepare(
          "SELECT schedule_id AS schedule, date FROM transactions WHERE schedule_id IS NOT NULL",
        )
        .all() as Array<{ schedule: string; date: number }>
    ).map((row): PostedScheduleTransaction => ({
      schedule: row.schedule,
      date: intToDay(row.date),
    })),
  );
  const payeeNames = new Map(
    book.db
      .select({ id: t.payees.id, name: t.payees.name })
      .from(t.payees)
      .all()
      .map((row) => [row.id, row.name]),
  );
  const payeeIds = new Map([...payeeNames].map(([id, name]) => [name, id]));
  const accounts = new Map(
    (
      book.client.prepare("SELECT id, name, on_budget FROM accounts").all() as Array<{
        id: string;
        name: string;
        on_budget: number;
      }>
    ).map((row) => [row.id, row]),
  );
  const categories = new Map(
    (
      book.client
        .prepare(
          `SELECT c.id, c.name, g.id AS group_id, g.name AS group_name
           FROM accounts c LEFT JOIN category_groups g ON g.id = c.group_id
           WHERE c.type IN ('expense', 'income') AND c.system IS NULL`,
        )
        .all() as Array<{
        id: string;
        name: string;
        group_id: string | null;
        group_name: string | null;
      }>
    ).map((row) => [row.id, row]),
  );
  const rowOf = (fields: {
    readonly account: string;
    readonly date: string;
    readonly amount: number;
    readonly payee: string | null;
    readonly notes: string | null;
    readonly category: string | null;
    readonly transfer: string | null;
  }): FilterRow => {
    const account = accounts.get(fields.account);
    const category = fields.category === null ? undefined : categories.get(fields.category);
    return {
      account_id: fields.account,
      account_name: account?.name ?? "",
      on_budget: account?.on_budget ?? 1,
      date: dayToInt(fields.date),
      amount: fields.amount,
      payee_id: fields.payee === null ? null : (payeeIds.get(fields.payee) ?? null),
      payee_name: fields.payee,
      notes: fields.notes,
      category_id: category?.id ?? null,
      category_name: category?.name ?? null,
      group_id: category?.group_id ?? null,
      group_name: category?.group_name ?? null,
      transfer_account: fields.transfer,
    };
  };
  const occurrences: Array<Occurrence> = [];
  for (const schedule of schedules) {
    if (schedule.amount === null || schedule.date === null || schedule.nextDate === null) continue;
    const scheduleName = schedule.row.name ?? "";
    const amount = getScheduledAmount(schedule.amount.value);
    const payee = schedule.payeeId === null ? null : (payeeNames.get(schedule.payeeId) ?? null);
    for (const date of getFutureOccurrenceDates(schedule.nextDate, schedule.date, end)) {
      if (
        isScheduleOccurrencePosted({
          schedule: {
            postsTransaction: schedule.row.postsTransaction,
            conditions: schedule.conditions,
          },
          scheduleId: schedule.row.id,
          occurrenceDate: date,
          postedTransactions: posted.get(schedule.row.id) ?? [],
        })
      )
        continue;
      const base = {
        payee,
        scheduleId: schedule.row.id,
        scheduleName,
        occurrenceDate: date,
        isAccountless: schedule.accountId === null,
      };
      if (schedule.accountId === null) {
        occurrences.push({
          account: FORECAST_UNASSIGNED_ACCOUNT_ID,
          date,
          transaction: { ...base, amount, isTransfer: false },
          row: rowOf({
            account: FORECAST_UNASSIGNED_ACCOUNT_ID,
            date,
            amount,
            payee,
            notes: setValue(schedule.actions, "notes"),
            category: setValue(schedule.actions, "category"),
            transfer: null,
          }),
        });
        continue;
      }
      const draft: EntryDraft = {
        date,
        account: schedule.accountId,
        amount,
        payee,
        category: setValue(schedule.actions, "category"),
        transferAccount: null,
        splits: null,
        notes: setValue(schedule.actions, "notes"),
        cleared: false,
        importedPayee: null,
        importedId: null,
        scheduleId: schedule.row.id,
      };
      const ruled = runRules(book.db, draft);
      if (ruled === null) continue;
      const transfer =
        ruled.transferAccount !== null && ruled.transferAccount !== ruled.account
          ? ruled.transferAccount
          : null;
      const fields = {
        date: ruled.date,
        payee: ruled.payee,
        notes: ruled.notes,
        category: transfer === null ? ruled.category : null,
      };
      occurrences.push({
        account: ruled.account,
        date: ruled.date,
        transaction: {
          ...base,
          payee: ruled.payee,
          amount: ruled.amount,
          isTransfer: transfer !== null,
        },
        row: rowOf({ ...fields, account: ruled.account, amount: ruled.amount, transfer }),
      });
      if (transfer !== null)
        occurrences.push({
          account: transfer,
          date: ruled.date,
          transaction: { ...base, payee: ruled.payee, amount: -ruled.amount, isTransfer: true },
          row: rowOf({
            ...fields,
            account: transfer,
            amount: -ruled.amount,
            transfer: ruled.account,
          }),
        });
    }
  }
  return occurrences;
};

const lowestOf = (
  points: ReadonlyArray<Point>,
  accounts: ReadonlyArray<ForecastAccount>,
  start: string,
) => {
  const combined = new Map<string, number>();
  for (const point of points)
    combined.set(point.date, (combined.get(point.date) ?? 0) + point.balance);
  let lowest = { date: start, balance: Infinity, accountId: "", accountName: "" };
  for (const [date, balance] of combined)
    if (balance < lowest.balance) lowest = { date, balance, accountId: "", accountName: "" };
  return lowest.balance === Infinity
    ? { ...lowest, balance: accounts.reduce((sum, account) => sum + account.balance, 0) }
    : lowest;
};

const scheduleForecast = (
  book: Book,
  context: DateContext,
  input: {
    readonly accounts?: ReadonlyArray<string>;
    readonly includeAccountless?: boolean;
  } & ForecastFilters,
): Forecast => {
  const conditions = input.conditions ?? [];
  const op = input.conditionsOp ?? "and";
  let accounts = restrictAccounts(accountsOf(book, input.accounts), conditions, op);
  if (accounts.length === 0) return emptyForecast(context);
  const includeUnassigned = input.includeAccountless === true;
  if (includeUnassigned)
    accounts = [
      ...accounts,
      { id: FORECAST_UNASSIGNED_ACCOUNT_ID, name: "", onBudget: true, balance: 0 },
    ];
  const accountIds = new Set(accounts.map((account) => account.id));
  const schedules = book.db
    .select()
    .from(t.schedules)
    .where(eq(t.schedules.completed, false))
    .all()
    .map((row) => loadSchedule(book.db, row))
    .filter((schedule) => includeUnassigned || schedule.accountId !== null);

  const matches = filterMatcher(book, input);
  const byAccountDay = new Map<string, Array<ForecastTransaction>>();
  for (const occurrence of futureOccurrences(book, schedules, context.end)) {
    if (
      occurrence.date < context.firstForecastDate ||
      occurrence.date > context.end ||
      !accountIds.has(occurrence.account) ||
      !matches(occurrence.row)
    )
      continue;
    const key = `${occurrence.account}:${occurrence.date}`;
    const list = byAccountDay.get(key);
    if (list === undefined) byAccountDay.set(key, [occurrence.transaction]);
    else list.push(occurrence.transaction);
  }

  const recorded =
    conditions.length === 0
      ? (book.client
          .prepare(
            `SELECT p.account_id AS account, t.date, sum(p.amount) AS amount
             FROM postings p JOIN transactions t ON t.id = p.transaction_id
             GROUP BY p.account_id, t.date`,
          )
          .all() as Array<{ account: string; date: number; amount: number }>)
      : queryLines<{ account: string; date: number; amount: number }>(
          book,
          "l.account_id AS account, l.date, sum(l.amount) AS amount",
          whereOf(conditions, op),
          "GROUP BY l.account_id, l.date",
        );
  const starting = new Map<string, number>();
  const byDay = new Map<string, number>();
  for (const row of recorded) {
    const day = intToDay(row.date);
    if (day < context.start)
      starting.set(row.account, (starting.get(row.account) ?? 0) + row.amount);
    else if (day <= context.end) byDay.set(`${row.account}:${day}`, row.amount);
  }

  const days = daysOf(context.start, context.end);
  const points = accounts
    .flatMap((account) => {
      let running = starting.get(account.id) ?? 0;
      return days.map((date): Point => {
        const recordedAmount = byDay.get(`${account.id}:${date}`) ?? 0;
        const transactions = byAccountDay.get(`${account.id}:${date}`) ?? [];
        running += recordedAmount + transactions.reduce((sum, tx) => sum + tx.amount, 0);
        return {
          date,
          balance: running,
          accountId: account.id,
          accountName: account.name,
          transactions,
          recordedAmount,
        };
      });
    })
    .toSorted((a, b) => a.date.localeCompare(b.date));
  return {
    dataPoints: points,
    lowestBalance: lowestOf(points, accounts, context.start),
    forecastStartDate: context.start,
    forecastEndDate: context.end,
  };
};

const trackingForecast = (book: Book, context: DateContext): Forecast => {
  if (readSettings(book.db).budgetType !== "tracking")
    return invalid("Tracking budget forecasts require a Tracking Budget file.");
  let running = accountsOf(book, undefined)
    .filter((account) => account.onBudget)
    .reduce((sum, account) => sum + account.balance, 0);
  const startMonth = monthOf(context.start);
  const endMonth = monthOf(context.end);
  const computed = computeMonths(book, endMonth);
  const points = monthRange(startMonth, endMonth).map((month): Point => {
    const summary = computed.months.get(month)?.summary;
    if (summary?.type === "tracking") running += summary.budgetedIncome - summary.budgetedExpenses;
    return {
      date: lastDay(month),
      balance: running,
      accountId: TRACKING_BUDGET_ID,
      accountName: TRACKING_BUDGET_NAME,
      transactions: [],
    };
  });
  const lowest = points.reduce<Point | undefined>(
    (low, point) => (low === undefined || point.balance < low.balance ? point : low),
    undefined,
  );
  return {
    dataPoints: points,
    lowestBalance: {
      date: lowest?.date ?? context.start,
      balance: lowest?.balance ?? running,
      accountId: TRACKING_BUDGET_ID,
      accountName: TRACKING_BUDGET_NAME,
    },
    forecastStartDate: context.start,
    forecastEndDate: context.end,
  };
};

export const forecastBalances = (
  book: Book,
  input: {
    readonly accounts?: ReadonlyArray<string>;
    readonly from?: string;
    readonly to?: string;
    readonly includeAccountless?: boolean;
    readonly source?: "schedules" | "tracking-budget";
  } & ForecastFilters,
  today: string = currentDay(),
): Forecast => {
  const context = dateContext(input.from, input.to, today);
  return input.source === "tracking-budget"
    ? trackingForecast(book, context)
    : scheduleForecast(book, context, input);
};

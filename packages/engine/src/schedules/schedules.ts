/**
 * Schedules on the book, as Actual's `server/schedules/app.ts`: a `schedules` row plus a rule whose
 * conditions hold its payee, account, amount and date and whose actions link the transactions it
 * matches (`link-schedule`) and set what they get (category, notes).
 */
import type {
  Recurrence,
  RuleAction,
  Schedule,
  ScheduleAmount,
  ScheduledTransaction,
  ScheduleStatus,
} from "./types.ts";
import type { Transaction } from "@reeve/contract";
import { dayToInt, intToDay, today as currentDay } from "@reeve/contract/rules";
import { and, asc, eq, gte } from "drizzle-orm";
import { invalid, newId, notFound, readSettings, type Book } from "../book.ts";
import type { Db } from "../db/open.ts";
import * as t from "../db/schema.ts";
import { addEntry, getTransaction } from "../ledger/transactions.ts";
import { payeeIdFor } from "../ledger/payees.ts";
import {
  getNextDateAfter,
  getNextDateFrom,
  getRecurringDescription,
  isRecurrence,
  type DateCondition,
  type DateValue,
  type RecurConfig,
} from "./recurrence.ts";
import {
  areConditionValuesEqual,
  areScheduleConditionsEqual,
  computeSchedulePreviewTransactions,
  DEFAULT_UPCOMING_SCHEDULE_DAYS,
  extractScheduleConds,
  getScheduledAmount,
  getScheduleOccurrenceMatchStartDate,
  getStatus,
  isUpcomingLength,
  updateActions,
  updateConditions,
  type Condition,
} from "./status.ts";

type ScheduleRow = typeof t.schedules.$inferSelect;

/** A schedule with its rule read, as Actual's `schedules` view with `_conditions` and `_actions`. */
export interface LoadedSchedule {
  readonly row: ScheduleRow;
  readonly nextDate: string | null;
  readonly conditions: ReadonlyArray<Condition>;
  readonly actions: ReadonlyArray<RuleAction>;
  readonly payeeId: string | null;
  readonly accountId: string | null;
  readonly amount: ScheduleAmount | null;
  readonly date: DateValue | null;
  readonly dateOp: "is" | "isapprox";
}

const ruleOf = (db: Db, id: string) => db.select().from(t.rules).where(eq(t.rules.id, id)).get();

const amountOf = (cond: Condition | null): ScheduleAmount | null => {
  if (cond === null || cond.value === null || cond.value === undefined) return null;
  return cond.op === "isbetween"
    ? { op: "isbetween", value: cond.value as { num1: number; num2: number } }
    : { op: cond.op as "is" | "isapprox", value: cond.value as number };
};

export const loadSchedule = (db: Db, row: ScheduleRow): LoadedSchedule => {
  const rule = ruleOf(db, row.ruleId);
  const conditions = (rule?.conditions ?? []) as ReadonlyArray<Condition>;
  const actions = (rule?.actions ?? []) as ReadonlyArray<RuleAction>;
  const conds = extractScheduleConds(conditions);
  return {
    row,
    nextDate: row.nextDate === null ? null : intToDay(row.nextDate),
    conditions,
    actions,
    payeeId: (conds.payee?.value as string | null | undefined) ?? null,
    accountId: (conds.account?.value as string | null | undefined) ?? null,
    amount: amountOf(conds.amount),
    date: (conds.date?.value as DateValue | null | undefined) ?? null,
    dateOp: conds.date?.op === "is" ? "is" : "isapprox",
  };
};

const scheduleRow = (db: Db, id: string): ScheduleRow =>
  db.select().from(t.schedules).where(eq(t.schedules.id, id)).get() ?? notFound("schedule", id);

export const loadById = (db: Db, id: string): LoadedSchedule =>
  loadSchedule(db, scheduleRow(db, id));

const loadAll = (db: Db): Array<LoadedSchedule> =>
  db
    .select()
    .from(t.schedules)
    .orderBy(asc(t.schedules.createdAt))
    .all()
    .map((row) => loadSchedule(db, row));

type SetAction = Extract<RuleAction, { op: "set" }>;

/** A set with a split line, template or formula belongs to the rules page, not to the schedule. */
const isPlainSet = (action: RuleAction, field: string): action is SetAction =>
  action.op === "set" &&
  action.field === field &&
  action.splitIndex === undefined &&
  action.template === undefined &&
  action.formula === undefined;

/** A recurrence with its left-out settings spelled out, so saving the defaults changes nothing. */
const withDefaults = (config: RecurConfig) => {
  const skipWeekend = config.skipWeekend === true;
  const endMode = config.endMode ?? "never";
  return {
    start: config.start,
    frequency: config.frequency,
    interval: config.interval ?? 1,
    patterns: config.frequency === "monthly" ? (config.patterns ?? []) : [],
    skipWeekend,
    weekendSolveMode: skipWeekend ? (config.weekendSolveMode ?? "after") : null,
    endMode,
    endOccurrences: endMode === "after_n_occurrences" ? config.endOccurrences : null,
    endDate: endMode === "on_date" ? config.endDate : null,
  };
};

export const setAction = (actions: ReadonlyArray<RuleAction>, field: string) =>
  actions.find((action) => isPlainSet(action, field)) as SetAction | undefined;

/** Whether a transaction linked to the schedule counts for its next date (Actual's `getHasTransactionsQuery`). */
export const hasTransaction = (db: Db, schedule: LoadedSchedule): boolean => {
  if (schedule.nextDate === null) return false;
  const start = getScheduleOccurrenceMatchStartDate(
    { postsTransaction: schedule.row.postsTransaction, conditions: schedule.conditions },
    schedule.nextDate,
  );
  return (
    db
      .select({ id: t.transactions.id })
      .from(t.transactions)
      .where(
        and(
          eq(t.transactions.scheduleId, schedule.row.id),
          gte(t.transactions.date, dayToInt(start)),
        ),
      )
      .get() !== undefined
  );
};

const upcomingOf = (upcomingLength: string | undefined): string => {
  const value = upcomingLength ?? DEFAULT_UPCOMING_SCHEDULE_DAYS;
  return isUpcomingLength(value) ? value : invalid(`${value} is not an upcoming length`);
};

const statusOf = (db: Db, schedule: LoadedSchedule, upcomingLength: string, today: string) =>
  getStatus(
    schedule.nextDate,
    schedule.row.completed,
    hasTransaction(db, schedule),
    upcomingLength,
    today,
  );

const normalized = (date: DateValue): string | Recurrence =>
  isRecurrence(date) ? ({ ...date, interval: date.interval ?? 1 } as Recurrence) : date;

const nameOf = (db: Db, table: typeof t.payees | typeof t.accounts, id: string | null) =>
  id === null
    ? null
    : (db.select({ name: table.name }).from(table).where(eq(table.id, id)).get()?.name ?? null);

export const toSchedule = (
  db: Db,
  schedule: LoadedSchedule,
  upcomingLength: string = DEFAULT_UPCOMING_SCHEDULE_DAYS,
  today: string = currentDay(),
): Schedule => {
  const date = schedule.date ?? schedule.nextDate ?? today;
  const category = setAction(schedule.actions, "category")?.value;
  const notes = setAction(schedule.actions, "notes")?.value;
  return {
    id: schedule.row.id,
    name: schedule.row.name,
    ruleId: schedule.row.ruleId,
    nextDate: schedule.nextDate,
    completed: schedule.row.completed,
    postsTransaction: schedule.row.postsTransaction,
    payeeId: schedule.payeeId,
    payee: nameOf(db, t.payees, schedule.payeeId),
    accountId: schedule.accountId,
    account: nameOf(db, t.accounts, schedule.accountId),
    amount: schedule.amount,
    date: normalized(date),
    dateOp: schedule.dateOp,
    categoryId: typeof category === "string" ? category : null,
    notes: typeof notes === "string" ? notes : null,
    description: isRecurrence(date)
      ? getRecurringDescription(date, readSettings(db).dateFormat)
      : date,
    status: statusOf(db, schedule, upcomingLength, today),
  };
};

export const listSchedules = (
  book: Book,
  input: { readonly completed?: boolean; readonly upcomingLength?: string },
): Array<Schedule> => {
  const upcoming = upcomingOf(input.upcomingLength);
  const today = currentDay();
  return loadAll(book.db)
    .filter((each) => input.completed === undefined || each.row.completed === input.completed)
    .map((each) => toSchedule(book.db, each, upcoming, today))
    .toSorted(
      (a, b) =>
        Number(a.completed) - Number(b.completed) ||
        (a.nextDate ?? "").localeCompare(b.nextDate ?? "") ||
        (a.name ?? "").localeCompare(b.name ?? ""),
    );
};

export const getSchedule = (
  book: Book,
  input: { readonly id: string; readonly upcomingLength?: string },
): Schedule => toSchedule(book.db, loadById(book.db, input.id), upcomingOf(input.upcomingLength));

// ---------------------------------------------------------------------------------------------
// Writing schedules
// ---------------------------------------------------------------------------------------------

const normalizeName = (name: string | null | undefined) => {
  const trimmed = name?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
};

const nameTaken = (db: Db, name: string, scheduleId: string | null) => {
  const found = db
    .select({ id: t.schedules.id })
    .from(t.schedules)
    .where(eq(t.schedules.name, name))
    .get();
  return found !== undefined && found.id !== scheduleId;
};

const insertRule = (
  db: Db,
  conditions: ReadonlyArray<Condition>,
  actions: ReadonlyArray<RuleAction>,
): string => {
  const id = newId();
  db.insert(t.rules)
    .values({
      id,
      stage: "default",
      conditionsOp: "and",
      conditions: [...conditions],
      actions: [...actions],
      createdAt: Date.now(),
    })
    .run();
  return id;
};

const writeNextDate = (db: Db, id: string, nextDate: string | null) =>
  db
    .update(t.schedules)
    .set({ nextDate: nextDate === null ? null : dayToInt(nextDate) })
    .where(eq(t.schedules.id, id))
    .run();

/** Creates a schedule from its rule's conditions and extra actions, as Actual's `createSchedule`. */
export const createScheduleRow = (
  db: Db,
  input: {
    readonly id?: string;
    readonly name?: string | null;
    readonly postsTransaction?: boolean;
    readonly conditions: ReadonlyArray<Condition>;
    readonly actions?: ReadonlyArray<RuleAction>;
  },
  today: string = currentDay(),
): string => {
  const id = input.id ?? newId();
  const { date: dateCond } = extractScheduleConds(input.conditions);
  if (dateCond === null) return invalid("A date condition is required to create a schedule");
  if (dateCond.value === null || dateCond.value === undefined) return invalid("Date is required");
  const name = normalizeName(input.name);
  if (name !== null && nameTaken(db, name, id))
    invalid("Cannot create schedules with the same name");
  const nextDate = getNextDateFrom(dateCond as DateCondition, today);
  const ruleId = insertRule(db, input.conditions, [
    ...(input.actions ?? []),
    { op: "link-schedule", value: id },
  ]);
  db.insert(t.schedules)
    .values({
      id,
      name,
      ruleId,
      nextDate: nextDate === null ? null : dayToInt(nextDate),
      completed: false,
      postsTransaction: input.postsTransaction ?? false,
      createdAt: Date.now(),
    })
    .run();
  return id;
};

/** A schedule whose rule went missing gets a new one, as Actual's `fixRuleForSchedule`. */
const fixRuleForSchedule = (db: Db, id: string, today: string): string => {
  const row = scheduleRow(db, id);
  const ruleId = insertRule(
    db,
    [
      { op: "isapprox", field: "date", value: today },
      { op: "isapprox", field: "amount", value: 0 },
    ],
    [{ op: "link-schedule", value: id }],
  );
  db.update(t.schedules).set({ ruleId }).where(eq(t.schedules.id, id)).run();
  db.delete(t.rules).where(eq(t.rules.id, row.ruleId)).run();
  return ruleId;
};

/**
 * Sets `next_date` again: the occurrence after the current one with `advance`, else the next one
 * from today, as Actual's `setNextDate`.
 */
export const setNextDate = (
  db: Db,
  input: {
    readonly id: string;
    readonly conditions?: ReadonlyArray<Condition>;
    readonly advance?: boolean;
  },
  today: string = currentDay(),
) => {
  const schedule = loadById(db, input.id);
  const conditions = input.conditions ?? schedule.conditions;
  const { date: dateCond } = extractScheduleConds(conditions);
  if (dateCond === null) return;
  const next =
    input.advance === true
      ? schedule.nextDate === null
        ? null
        : getNextDateAfter(dateCond as DateCondition, schedule.nextDate)
      : getNextDateFrom(dateCond as DateCondition, today);
  if (next !== null && next !== schedule.nextDate) writeNextDate(db, input.id, next);
};

/** Changes a schedule and merges new conditions into its rule, as Actual's `updateSchedule`. */
export const updateScheduleRow = (
  db: Db,
  input: {
    readonly id: string;
    readonly name?: string | null;
    readonly postsTransaction?: boolean;
    readonly completed?: boolean;
    readonly conditions?: ReadonlyArray<Condition>;
    /** Replaces the rule's actions but its `link-schedule`. */
    readonly actions?: ReadonlyArray<RuleAction>;
    readonly resetNextDate?: boolean;
  },
  today: string = currentDay(),
) => {
  const row = scheduleRow(db, input.id);
  const change: Partial<typeof t.schedules.$inferInsert> = {};
  if (input.name !== undefined) {
    change.name = normalizeName(input.name);
    if (change.name !== null && nameTaken(db, change.name, input.id))
      invalid("Cannot update schedules with the same name");
  }
  if (input.postsTransaction !== undefined) change.postsTransaction = input.postsTransaction;
  if (input.completed !== undefined) change.completed = input.completed;

  if (input.conditions !== undefined || input.actions !== undefined) {
    let rule = ruleOf(db, row.ruleId);
    if (rule === undefined) rule = ruleOf(db, fixRuleForSchedule(db, input.id, today))!;
    const oldConditions = rule.conditions as ReadonlyArray<Condition>;
    const conditions =
      input.conditions === undefined
        ? oldConditions
        : updateConditions(oldConditions, input.conditions);
    const { date: dateCond } = extractScheduleConds(conditions);
    if (dateCond !== null && (dateCond.value === null || dateCond.value === undefined))
      invalid("Date is required");
    const baseActions =
      input.actions === undefined
        ? (rule.actions as ReadonlyArray<RuleAction>)
        : [...input.actions, { op: "link-schedule" as const, value: input.id }];
    const actions = updateActions(conditions, baseActions) ?? baseActions;
    db.update(t.rules)
      .set({ conditions: [...conditions], actions: [...actions] })
      .where(eq(t.rules.id, rule.id))
      .run();
    const dateOf = (conds: ReadonlyArray<Condition>) => {
      const found = conds.find((cond) => cond.field === "date");
      if (found === undefined) return {};
      const { type: _type, ...fields } = found as Condition & { type?: unknown };
      return isRecurrence(fields.value) ? { ...fields, value: withDefaults(fields.value) } : fields;
    };
    // The next date follows a new date or account (a closed account's schedule does not advance).
    if (
      input.resetNextDate === true ||
      !areScheduleConditionsEqual(
        extractScheduleConds(oldConditions).account,
        extractScheduleConds(conditions).account,
      ) ||
      !areConditionValuesEqual(dateOf(oldConditions), dateOf(conditions))
    )
      setNextDate(db, { id: input.id, conditions }, today);
  } else if (input.resetNextDate === true) {
    setNextDate(db, { id: input.id }, today);
  }
  if (Object.keys(change).length > 0)
    db.update(t.schedules).set(change).where(eq(t.schedules.id, input.id)).run();
};

export const deleteSchedule = (book: Book, id: string) => {
  const row = scheduleRow(book.db, id);
  book.db
    .update(t.transactions)
    .set({ scheduleId: null })
    .where(eq(t.transactions.scheduleId, id))
    .run();
  book.db.delete(t.schedules).where(eq(t.schedules.id, id)).run();
  book.db.delete(t.rules).where(eq(t.rules.id, row.ruleId)).run();
  return { deleted: id };
};

// ---------------------------------------------------------------------------------------------
// Posting and the service that keeps schedules up to date
// ---------------------------------------------------------------------------------------------

const payeeName = (db: Db, id: string | null) => nameOf(db, t.payees, id);

/**
 * Adds a schedule's transaction, linked to it, on its next date or `date`. The schedule's own `set`
 * actions apply here as well as through the rules, which is harmless: setting twice is setting once.
 */
export const postTransactionForSchedule = (db: Db, id: string, date?: string): string | null => {
  const schedule = loadById(db, id);
  if (schedule.accountId === null) return invalid("The schedule has no account to post to");
  const day = date ?? schedule.nextDate;
  if (day === null) return invalid("The schedule has no next date");
  const set = (field: string) => setAction(schedule.actions, field);
  const category = set("category")?.value;
  const notes = set("notes")?.value;
  const amount = set("amount");
  return addEntry(db, {
    date: day,
    account: schedule.accountId,
    amount:
      amount !== undefined &&
      amount.template === undefined &&
      amount.formula === undefined &&
      typeof amount.value === "number"
        ? amount.value
        : getScheduledAmount(schedule.amount?.value),
    payee: payeeName(db, schedule.payeeId),
    category: typeof category === "string" ? category : null,
    transferAccount: null,
    splits: null,
    notes: typeof notes === "string" ? notes : null,
    cleared: set("cleared")?.value === true,
    importedPayee: null,
    importedId: null,
    scheduleId: id,
  });
};

const isRecurringSchedule = (schedule: LoadedSchedule) => isRecurrence(schedule.date);

const advanceRecurring = (db: Db, schedule: LoadedSchedule, today: string) => {
  if (!isRecurringSchedule(schedule)) return null;
  setNextDate(db, { id: schedule.row.id, advance: true }, today);
  const updated = loadById(db, schedule.row.id);
  return updated.nextDate === schedule.nextDate ? null : updated;
};

/** Posts a schedule's transaction now, then moves a recurring schedule to its next occurrence. */
export const postScheduleTransaction = (
  book: Book,
  input: { readonly id: string; readonly today?: boolean },
): Transaction => {
  const schedule = loadById(book.db, input.id);
  const today = currentDay();
  const txId = postTransactionForSchedule(
    book.db,
    input.id,
    input.today === true ? today : undefined,
  );
  if (txId === null) return invalid("A rule deleted the transaction");
  advanceRecurring(book.db, schedule, today);
  return getTransaction(book.db, txId);
};

export interface AdvanceResult {
  readonly posted: Array<string>;
  readonly advanced: Array<string>;
  readonly completed: Array<string>;
}

/** Whether the schedule's account is closed, or gone. */
const accountClosed = (db: Db, id: string | null) =>
  id !== null &&
  (db.select({ closed: t.accounts.closed }).from(t.accounts).where(eq(t.accounts.id, id)).get()
    ?.closed ??
    true);

/**
 * Brings schedules up to date as of `today`, as Actual's `advanceSchedulesService`: posts the due
 * and missed occurrences of schedules that post transactions (catching up every missed one of a
 * recurring schedule), moves paid recurring schedules on, and completes paid one-off schedules
 * whose day has passed. Schedules on closed accounts are left alone.
 */
export const advanceSchedules = (
  book: Book,
  today: string = currentDay(),
  upcomingLength: string = DEFAULT_UPCOMING_SCHEDULE_DAYS,
): AdvanceResult => {
  const { db } = book;
  const result: AdvanceResult = { posted: [], advanced: [], completed: [] };
  const schedules = loadAll(db).filter(
    (each) => !each.row.completed && !accountClosed(db, each.accountId),
  );
  const status = (schedule: LoadedSchedule): ScheduleStatus =>
    statusOf(db, schedule, upcomingLength, today);
  const postsAndOpen = (schedule: LoadedSchedule, s: ScheduleStatus) =>
    schedule.row.postsTransaction &&
    schedule.accountId !== null &&
    (s === "paid" || s === "due" || s === "missed");

  for (const schedule of schedules) {
    const first = status(schedule);
    if (postsAndOpen(schedule, first) && (first !== "paid" || isRecurringSchedule(schedule))) {
      let current = schedule;
      let currentStatus = first;
      while (postsAndOpen(current, currentStatus)) {
        if (currentStatus !== "paid") {
          const txId = postTransactionForSchedule(db, current.row.id);
          if (txId !== null) result.posted.push(txId);
          // A schedule due today stays on today.
          if (currentStatus === "due" || !isRecurringSchedule(current)) break;
        } else if (current.nextDate === today) break;
        const updated = advanceRecurring(db, current, today);
        if (updated === null) break;
        if (!result.advanced.includes(current.row.id)) result.advanced.push(current.row.id);
        current = updated;
        currentStatus = status(current);
      }
    } else if (first === "paid" && schedule.date !== null) {
      if (isRecurringSchedule(schedule)) {
        const before = schedule.nextDate;
        setNextDate(db, { id: schedule.row.id }, today);
        if (loadById(db, schedule.row.id).nextDate !== before)
          result.advanced.push(schedule.row.id);
      } else if ((schedule.date as string) < today) {
        updateScheduleRow(db, { id: schedule.row.id, completed: true }, today);
        result.completed.push(schedule.row.id);
      }
    }
  }
  return result;
};

export const runSchedules = (book: Book, input: { readonly upcomingLength?: string }) =>
  advanceSchedules(book, currentDay(), upcomingOf(input.upcomingLength));

// ---------------------------------------------------------------------------------------------
// Register previews
// ---------------------------------------------------------------------------------------------

export const listScheduledTransactions = (
  book: Book,
  input: { readonly account?: string; readonly upcomingLength?: string },
): Array<ScheduledTransaction> => {
  const { db } = book;
  const upcoming = upcomingOf(input.upcomingLength);
  const today = currentDay();
  const schedules = loadAll(db).filter(
    (each) => input.account === undefined || each.accountId === input.account,
  );
  const statuses = new Map(
    schedules.map((each) => [each.row.id, statusOf(db, each, upcoming, today)]),
  );
  const byId = new Map(schedules.map((each) => [each.row.id, each]));
  const previews = computeSchedulePreviewTransactions(
    schedules.map((each) => ({
      id: each.row.id,
      nextDate: each.nextDate,
      completed: each.row.completed,
      conditions: each.conditions,
      amount: getScheduledAmount(each.amount?.value),
    })),
    statuses,
    upcoming,
    today,
  );
  return previews.map((preview) => {
    const schedule = byId.get(preview.schedule)!;
    const category = setAction(schedule.actions, "category")?.value;
    const notes = setAction(schedule.actions, "notes")?.value;
    return {
      id: preview.id,
      scheduleId: preview.schedule,
      scheduleName: schedule.row.name,
      date: preview.date,
      accountId: schedule.accountId,
      payeeId: schedule.payeeId,
      payee: payeeName(db, schedule.payeeId),
      categoryId: typeof category === "string" ? category : null,
      notes: typeof notes === "string" ? notes : null,
      amount: preview.amount,
      status: statuses.get(preview.schedule)!,
      forceUpcoming: preview.forceUpcoming,
    };
  });
};

// ---------------------------------------------------------------------------------------------
// Operation inputs to conditions and actions
// ---------------------------------------------------------------------------------------------

export interface ScheduleFieldsInput {
  readonly name?: string | null;
  readonly payee?: string | null;
  readonly account?: string | null;
  readonly amount?: number;
  readonly amountOp?: "is" | "isapprox" | "isbetween";
  readonly amountTo?: number;
  readonly postsTransaction?: boolean;
  readonly category?: string | null;
  readonly notes?: string | null;
  readonly date?: string;
  readonly dateOp?: "is" | "isapprox";
  readonly frequency?: Recurrence["frequency"] | null;
  readonly interval?: number;
  readonly patterns?: Recurrence["patterns"];
  readonly skipWeekend?: boolean;
  readonly weekendSolveMode?: "before" | "after";
  readonly endMode?: "never" | "after_n_occurrences" | "on_date";
  readonly endOccurrences?: number;
  readonly endDate?: string;
}

const RECURRENCE_KEYS = [
  "frequency",
  "interval",
  "patterns",
  "skipWeekend",
  "weekendSolveMode",
  "endMode",
  "endOccurrences",
  "endDate",
] as const;

const touchesDate = (input: ScheduleFieldsInput) =>
  input.date !== undefined ||
  input.dateOp !== undefined ||
  RECURRENCE_KEYS.some((key) => input[key] !== undefined);

/** The date value the input makes, over the schedule's current one. */
const dateValueOf = (input: ScheduleFieldsInput, current: DateValue | null): DateValue => {
  const base: Partial<RecurConfig> =
    current === null ? {} : isRecurrence(current) ? { ...current } : { start: current };
  const start = input.date ?? base.start;
  if (start === undefined) return invalid("Date is required");
  const frequency = input.frequency === undefined ? base.frequency : input.frequency;
  if (frequency === null || frequency === undefined) return start;
  const config: Record<string, unknown> = { ...base, start, frequency };
  for (const key of RECURRENCE_KEYS.slice(1))
    if (input[key] !== undefined) config[key] = input[key];
  config["interval"] ??= 1;
  if (config["skipWeekend"] === true) config["weekendSolveMode"] ??= "after";
  if (config["endMode"] === "after_n_occurrences" && typeof config["endOccurrences"] !== "number")
    invalid("Give endOccurrences with endMode after_n_occurrences");
  if (config["endMode"] === "on_date" && typeof config["endDate"] !== "string")
    invalid("Give endDate with endMode on_date");
  if (typeof config["interval"] !== "number" || config["interval"] < 1)
    invalid("The interval is a whole number from 1");
  return config as unknown as RecurConfig;
};

const amountCondition = (
  input: ScheduleFieldsInput,
  current: ScheduleAmount | null,
): Condition | null => {
  const op = input.amountOp ?? current?.op ?? "isapprox";
  const currentLow =
    current === null ? undefined : current.op === "isbetween" ? current.value.num1 : current.value;
  const currentHigh = current?.op === "isbetween" ? current.value.num2 : undefined;
  const value = input.amount ?? currentLow;
  if (value === undefined) return null;
  if (op !== "isbetween") return { op, field: "amount", value };
  const to = input.amountTo ?? currentHigh;
  if (to === undefined) return invalid("Give amountTo with amountOp isbetween");
  return { op, field: "amount", value: { num1: value, num2: to } };
};

const checkAccount = (db: Db, id: string) => {
  const row =
    db.select().from(t.accounts).where(eq(t.accounts.id, id)).get() ?? notFound("account", id);
  if (row.type !== "asset" && row.type !== "liability")
    invalid(`${row.name} is not an asset or liability account`);
};

const checkCategory = (db: Db, id: string) => {
  const row =
    db.select().from(t.accounts).where(eq(t.accounts.id, id)).get() ?? notFound("category", id);
  if ((row.type !== "expense" && row.type !== "income") || row.system !== null)
    invalid(`${row.name} is not a category`);
};

/** The rule's actions with the input's category and notes set, cleared or kept. */
const actionsOf = (
  db: Db,
  input: ScheduleFieldsInput,
  current: ReadonlyArray<RuleAction>,
): Array<RuleAction> | undefined => {
  if (input.category === undefined && input.notes === undefined) return undefined;
  let actions = current.filter((action) => action.op !== "link-schedule");
  const replace = (field: "category" | "notes", value: string | null | undefined) => {
    if (value === undefined) return;
    actions = actions.filter((action) => !isPlainSet(action, field));
    if (value !== null && value !== "") actions.push({ op: "set", field, value });
  };
  if (input.category !== undefined && input.category !== null) checkCategory(db, input.category);
  replace("category", input.category);
  replace("notes", input.notes);
  return actions;
};

/** The conditions the input changes: payee, account, amount and date. */
const conditionsOf = (db: Db, input: ScheduleFieldsInput, current: LoadedSchedule | null) => {
  const conditions: Array<Condition> = [];
  if (input.payee !== undefined) {
    const payee = payeeIdFor(db, input.payee);
    if (payee !== null) conditions.push({ op: "is", field: "payee", value: payee });
  }
  if (input.account !== undefined && input.account !== null) {
    checkAccount(db, input.account);
    conditions.push({ op: "is", field: "account", value: input.account });
  }
  if (input.amount !== undefined || input.amountOp !== undefined || input.amountTo !== undefined) {
    const amount = amountCondition(input, current?.amount ?? null);
    if (amount !== null) conditions.push(amount);
  }
  if (touchesDate(input))
    conditions.push({
      op: input.dateOp ?? current?.dateOp ?? "isapprox",
      field: "date",
      value: dateValueOf(input, current?.date ?? null),
    });
  return conditions;
};

export const createSchedule = (
  book: Book,
  input: ScheduleFieldsInput & { readonly amount: number; readonly date: string },
): Schedule => {
  const id = createScheduleRow(book.db, {
    name: input.name ?? null,
    postsTransaction: input.postsTransaction ?? false,
    conditions: conditionsOf(book.db, input, null),
    actions: actionsOf(book.db, input, []) ?? [],
  });
  return toSchedule(book.db, loadById(book.db, id));
};

export const updateSchedule = (
  book: Book,
  input: ScheduleFieldsInput & {
    readonly id: string;
    readonly completed?: boolean;
    readonly resetNextDate?: boolean;
  },
): Schedule => {
  const { db } = book;
  const current = loadById(db, input.id);
  const conditions = conditionsOf(db, input, current);
  // A payee or account cleared takes its condition out of the rule.
  const removed = (field: string, cleared: boolean) => (cond: Condition) =>
    !(cleared && cond.field === field && cond.op === "is");
  const cleared = current.conditions
    .filter(removed("payee", input.payee === null))
    .filter(removed("account", input.account === null));
  if (cleared.length !== current.conditions.length)
    db.update(t.rules).set({ conditions: cleared }).where(eq(t.rules.id, current.row.ruleId)).run();
  updateScheduleRow(db, {
    id: input.id,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.postsTransaction !== undefined ? { postsTransaction: input.postsTransaction } : {}),
    ...(input.completed !== undefined ? { completed: input.completed } : {}),
    ...(conditions.length > 0 ? { conditions } : {}),
    ...(() => {
      const actions = actionsOf(db, input, current.actions);
      return actions === undefined ? {} : { actions };
    })(),
    ...(input.resetNextDate !== undefined ? { resetNextDate: input.resetNextDate } : {}),
  });
  return toSchedule(db, loadById(db, input.id));
};

export const skipScheduleDate = (book: Book, id: string): Schedule => {
  setNextDate(book.db, { id, advance: true });
  return toSchedule(book.db, loadById(book.db, id));
};

export const completeSchedule = (book: Book, id: string): Schedule => {
  updateScheduleRow(book.db, { id, completed: true });
  return toSchedule(book.db, loadById(book.db, id));
};

export const restoreSchedule = (book: Book, id: string): Schedule => {
  updateScheduleRow(book.db, { id, completed: false, resetNextDate: true });
  return toSchedule(book.db, loadById(book.db, id));
};

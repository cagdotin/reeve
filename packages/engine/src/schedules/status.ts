/**
 * A schedule's status, its rule's conditions and the transactions a register previews, as Actual's
 * `shared/schedules.ts`. Plain functions of their inputs; `today` is a parameter.
 */
import type { RuleAction, RuleCondition, ScheduleStatus } from "./types.ts";
import { addDays, daysBetween, lastDay, monthOf, today as currentDay } from "@reeve/contract/rules";
import { addMonths } from "date-fns";
import {
  dayOf,
  getOccurrencesBetween,
  isRecurrence,
  parseDay,
  type DateCondition,
  type DateValue,
} from "./recurrence.ts";

export const DEFAULT_UPCOMING_SCHEDULE_DAYS = "7";

export const UPCOMING_LENGTH_PRESET_VALUES = ["1", "7", "14", "oneMonth", "currentMonth"] as const;

export const UPCOMING_LENGTH_PRESET_LABELS: Record<
  (typeof UPCOMING_LENGTH_PRESET_VALUES)[number],
  string
> = {
  "1": "1 day",
  "7": "1 week",
  "14": "2 weeks",
  oneMonth: "1 month",
  currentMonth: "End of the current month",
};

export const isCustomUpcomingLength = (value: string | null | undefined): boolean =>
  value !== null &&
  value !== undefined &&
  !(UPCOMING_LENGTH_PRESET_VALUES as ReadonlyArray<string>).includes(value);

/** Whether `value` is an upcoming length: a preset, a number of days, or `N-day|week|month|year`. */
export const isUpcomingLength = (value: string): boolean =>
  value === "oneMonth" || value === "currentMonth" || /^\d+(-(day|week|month|year))?$/.test(value);

const firstOfMonthPlus = (day: string, months: number) =>
  `${dayOf(addMonths(parseDay(`${monthOf(day)}-01`), months)).slice(0, 7)}-01`;

/** How many days ahead count as upcoming, as of `today`. */
export const getUpcomingDays = (
  upcomingLength: string = DEFAULT_UPCOMING_SCHEDULE_DAYS,
  today: string = currentDay(),
): number => {
  const monthStart = `${monthOf(today)}-01`;
  switch (upcomingLength) {
    case "currentMonth":
      return Number(lastDay(monthOf(today)).slice(8)) - Number(today.slice(8));
    case "oneMonth":
      return daysBetween(monthStart, firstOfMonthPlus(today, 1));
    default: {
      if (!upcomingLength.includes("-")) return Number.parseInt(upcomingLength, 10);
      const [num, unit] = upcomingLength.split("-");
      const value = Math.max(1, Number.parseInt(num!, 10));
      switch (unit) {
        case "day":
          return value;
        case "week":
          return value * 7;
        case "month":
          return daysBetween(monthStart, firstOfMonthPlus(today, value)) + 1;
        case "year":
          return daysBetween(monthStart, firstOfMonthPlus(today, value * 12)) + 1;
        default:
          return 7;
      }
    }
  }
};

export const getStatus = (
  nextDate: string | null,
  completed: boolean,
  hasTrans: boolean,
  upcomingLength: string = DEFAULT_UPCOMING_SCHEDULE_DAYS,
  today: string = currentDay(),
): ScheduleStatus => {
  if (completed) return "completed";
  if (hasTrans) return "paid";
  if (nextDate === null) return "scheduled";
  if (nextDate === today) return "due";
  if (nextDate > today && nextDate <= addDays(today, getUpcomingDays(upcomingLength, today)))
    return "upcoming";
  if (nextDate < today) return "missed";
  return "scheduled";
};

export interface ScheduleOccurrenceMatchInput {
  readonly postsTransaction?: boolean;
  readonly conditions?: ReadonlyArray<{ readonly field: string; readonly op: string }>;
}

/**
 * The first day a transaction linked to a schedule counts for an occurrence: the day itself for an
 * exact date (`is`) or a schedule that posts its transactions, two days earlier otherwise.
 */
export const getScheduleOccurrenceMatchStartDate = (
  schedule: ScheduleOccurrenceMatchInput,
  occurrenceDate: string,
): string => {
  const dateCond = schedule.conditions?.find((cond) => cond.field === "date");
  if (dateCond?.op === "is" || schedule.postsTransaction === true) return occurrenceDate;
  return addDays(occurrenceDate, -2);
};

export interface PostedScheduleTransaction {
  readonly schedule?: string | null;
  readonly date: string;
}

export const indexPostedScheduleTransactions = (
  transactions: ReadonlyArray<PostedScheduleTransaction>,
): Map<string, Array<PostedScheduleTransaction>> => {
  const bySchedule = new Map<string, Array<PostedScheduleTransaction>>();
  for (const transaction of transactions) {
    if (!transaction.schedule) continue;
    const existing = bySchedule.get(transaction.schedule);
    if (existing === undefined) bySchedule.set(transaction.schedule, [transaction]);
    else existing.push(transaction);
  }
  return bySchedule;
};

/** Whether a transaction linked to the schedule is recorded for one occurrence. */
export const isScheduleOccurrencePosted = (input: {
  readonly schedule: ScheduleOccurrenceMatchInput;
  readonly scheduleId: string;
  readonly occurrenceDate: string;
  readonly postedTransactions: ReadonlyArray<PostedScheduleTransaction>;
}): boolean => {
  const start = getScheduleOccurrenceMatchStartDate(input.schedule, input.occurrenceDate);
  return input.postedTransactions.some(
    (tx) => tx.schedule === input.scheduleId && tx.date >= start && tx.date <= input.occurrenceDate,
  );
};

export const getScheduledAmount = (
  amount: number | { readonly num1: number; readonly num2: number } | null | undefined,
  inverse = false,
): number => {
  if (amount === null || amount === undefined) return 0;
  if (typeof amount === "number") return inverse ? -amount : amount;
  const avg = Math.round((amount.num1 + amount.num2) / 2);
  return inverse ? -avg : avg;
};

// ---------------------------------------------------------------------------------------------
// The schedule's rule
// ---------------------------------------------------------------------------------------------

/** A rule condition as stored; Actual's may carry a `type`, and older ones `description`/`acct`. */
export type Condition =
  | RuleCondition
  | { readonly field: string; readonly op: string; readonly value: unknown };

export interface ScheduleConditions {
  readonly payee: Condition | null;
  readonly account: Condition | null;
  readonly amount: Condition | null;
  readonly date: Condition | null;
}

export const extractScheduleConds = (conditions: ReadonlyArray<Condition>): ScheduleConditions => ({
  payee:
    conditions.find((cond) => cond.op === "is" && cond.field === "payee") ??
    conditions.find((cond) => cond.op === "is" && cond.field === "description") ??
    null,
  account:
    conditions.find((cond) => cond.op === "is" && cond.field === "account") ??
    conditions.find((cond) => cond.op === "is" && cond.field === "acct") ??
    null,
  amount:
    conditions.find(
      (cond) =>
        (cond.op === "is" || cond.op === "isapprox" || cond.op === "isbetween") &&
        cond.field === "amount",
    ) ?? null,
  date:
    conditions.find(
      (cond) => (cond.op === "is" || cond.op === "isapprox") && cond.field === "date",
    ) ?? null,
});

/** Deep equality of condition values, whatever the key order. */
export const areConditionValuesEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (left === null || left === undefined || right === null || right === undefined) return false;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => areConditionValuesEqual(value, right[index]))
    );
  if (typeof left === "object" && typeof right === "object") {
    const l = left as Record<string, unknown>;
    const r = right as Record<string, unknown>;
    const leftKeys = Object.keys(l).toSorted();
    const rightKeys = Object.keys(r).toSorted();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) => key === rightKeys[index] && areConditionValuesEqual(l[key], r[key]),
      )
    );
  }
  return false;
};

/** Two schedule conditions alike but for `type` and the spelling of `field` (`account`/`acct`). */
export const areScheduleConditionsEqual = (
  left: Condition | null | undefined,
  right: Condition | null | undefined,
): boolean => {
  if (left === null || left === undefined || right === null || right === undefined)
    return left === right;
  const { type: _lt, field: _lf, ...l } = left as Condition & { type?: unknown };
  const { type: _rt, field: _rf, ...r } = right as Condition & { type?: unknown };
  return areConditionValuesEqual(l, r);
};

/** A rule's conditions with the schedule's payee, account, amount and date replaced or added. */
export const updateConditions = (
  conditions: ReadonlyArray<Condition>,
  newConditions: ReadonlyArray<Condition>,
): Array<Condition> => {
  const old = Object.values(extractScheduleConds(conditions));
  const next = Object.values(extractScheduleConds(newConditions));
  const replacements = old.map((cond, index) => [cond, next[index] ?? null] as const);
  const updated = conditions.map((cond) => {
    const replacement = replacements.find(([from]) => from === cond);
    return replacement?.[1] ?? cond;
  });
  const added = replacements.flatMap(([from, to]) => (from === null && to !== null ? [to] : []));
  return [...updated, ...added];
};

/**
 * The rule's plain `set amount` actions set to the schedule's amount, so posting does not undo an
 * edited amount; null when nothing changes.
 */
export const updateActions = (
  conditions: ReadonlyArray<Condition>,
  actions: ReadonlyArray<RuleAction>,
): Array<RuleAction> | null => {
  const { amount: amountCond } = extractScheduleConds(conditions);
  if (amountCond === null) return null;
  const amount = getScheduledAmount(amountCond.value as number | { num1: number; num2: number });
  let changed = false;
  const updated = actions.map((action) => {
    if (
      action.op === "set" &&
      action.field === "amount" &&
      action.template === undefined &&
      action.formula === undefined &&
      action.value !== amount
    ) {
      changed = true;
      return { ...action, value: amount };
    }
    return action;
  });
  return changed ? updated : null;
};

export const scheduleIsRecurring = (dateCond: Condition | null): boolean =>
  dateCond !== null && isRecurrence(dateCond.value);

// ---------------------------------------------------------------------------------------------
// Register previews
// ---------------------------------------------------------------------------------------------

export interface PreviewSchedule {
  readonly id: string;
  readonly nextDate: string | null;
  readonly completed: boolean;
  readonly conditions: ReadonlyArray<Condition>;
  readonly amount: number;
}

export interface PreviewTransaction {
  readonly id: string;
  readonly schedule: string;
  readonly date: string;
  readonly amount: number;
  readonly forceUpcoming: boolean;
}

export const isForPreview = (
  schedule: PreviewSchedule,
  statuses: ReadonlyMap<string, ScheduleStatus>,
): boolean => {
  const status = statuses.get(schedule.id);
  return (
    !schedule.completed &&
    status !== undefined &&
    ["due", "upcoming", "missed", "paid"].includes(status)
  );
};

/**
 * Each previewed schedule's next date and its further occurrences up to the upcoming length (the
 * next date left out once paid), newest first, as Actual's `computeSchedulePreviewTransactions`.
 */
export const computeSchedulePreviewTransactions = (
  schedules: ReadonlyArray<PreviewSchedule>,
  statuses: ReadonlyMap<string, ScheduleStatus>,
  upcomingLength: string = DEFAULT_UPCOMING_SCHEDULE_DAYS,
  today: string = currentDay(),
): Array<PreviewTransaction> =>
  schedules
    .filter((schedule) => isForPreview(schedule, statuses) && schedule.nextDate !== null)
    .flatMap((schedule) => {
      const nextDate = schedule.nextDate!;
      const periodEnd = addDays(today, getUpcomingDays(upcomingLength, today));
      const { date: dateCond } = extractScheduleConds(schedule.conditions);
      const status = statuses.get(schedule.id);
      const dates = [nextDate];
      if (dateCond !== null && scheduleIsRecurring(dateCond)) {
        // The range's end is exclusive and the period's end inclusive.
        const occurrences = getOccurrencesBetween(
          dateCond as DateCondition,
          nextDate,
          addDays(periodEnd, 1),
        );
        for (const occurrence of occurrences)
          if (!dates.includes(occurrence)) dates.push(occurrence);
      }
      if (status === "paid") dates.shift();
      return dates.map((date) => ({
        id: `preview/${schedule.id}/${date}`,
        schedule: schedule.id,
        amount: schedule.amount,
        date,
        forceUpcoming: (date !== nextDate || status === "paid") && date >= today,
      }));
    })
    .toSorted((a, b) => b.date.localeCompare(a.date) || a.amount - b.amount);

export type { DateValue };

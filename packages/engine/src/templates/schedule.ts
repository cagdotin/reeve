/**
 * `schedule` templates, as Actual's `schedule-template.ts`: forecast what a category's schedules
 * take over the next five years and budget the least that keeps its balance from going negative,
 * or a `full` schedule's whole amount in the month it is due.
 */
import type { TemplateCategory, TemplateEnv } from "./context.ts";
import { amountToInteger, months, parse } from "./months.ts";
import {
  getDateWithSkippedWeekend,
  getNextDate,
  getOccurrencesBetween,
  isRecurrence,
  type DateCondition,
} from "./recur.ts";
import type { ScheduleTemplate, Template } from "./types.ts";

export interface StoredCondition {
  readonly field: string;
  readonly op: string;
  readonly value: unknown;
}

export interface StoredSchedule {
  readonly id: string;
  readonly name: string | null;
  readonly completed: boolean;
  /** The next date the schedule has stored, `YYYY-MM-DD`. */
  readonly nextDate: string | null;
  readonly conditions: ReadonlyArray<StoredCondition>;
  readonly actions: ReadonlyArray<unknown>;
}

/** A transaction as a category sees it: `amount` negative for spending. */
export interface ScheduledTransaction {
  readonly date: string;
  readonly amount: number;
  readonly schedule: string | null;
  readonly category: string | null;
}

/** Transactions on budget accounts; every given bound applies. */
export interface TransactionQuery {
  readonly category?: string;
  readonly schedules?: ReadonlyArray<string>;
  /** Only those linked to no schedule. */
  readonly unlinked?: boolean;
  /** date > after */
  readonly after?: string;
  /** date >= from */
  readonly from?: string;
  /** date < before */
  readonly before?: string;
}

export interface ScheduleStore {
  /** Schedules with a name that templates can refer to. */
  readonly active: () => ReadonlyArray<{ readonly id: string; readonly name: string | null }>;
  readonly find: (ref: {
    readonly scheduleId?: string | undefined;
    readonly name?: string | undefined;
  }) => StoredSchedule | undefined;
  readonly transactions: (query: TransactionQuery) => ReadonlyArray<ScheduledTransaction>;
}

export const extractScheduleConds = (conditions: ReadonlyArray<StoredCondition>) => ({
  payee: conditions.find((cond) => cond.op === "is" && cond.field === "payee") ?? null,
  account: conditions.find((cond) => cond.op === "is" && cond.field === "account") ?? null,
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

// ---------------------------------------------------------------------------------------------
// The schedule's rule actions: what a transaction of the schedule becomes
// ---------------------------------------------------------------------------------------------

interface LooseAction {
  readonly op?: string;
  readonly field?: string;
  readonly value?: unknown;
  readonly splitIndex?: number;
  readonly method?: string;
  readonly options?: { readonly splitIndex?: number; readonly method?: string };
}

const splitIndexOf = (action: LooseAction) => action.splitIndex ?? action.options?.splitIndex ?? 0;
const methodOf = (action: LooseAction) => action.method ?? action.options?.method;

/**
 * Actual's `execActions` for what templates read of it: the amount a `set amount` gives, and the
 * splits `set-split-amount` makes with the category each split is set to.
 */
export const execScheduleActions = (
  amount: number,
  actions: ReadonlyArray<unknown>,
): { amount: number; subtransactions?: Array<{ amount: number; category: string | null }> } => {
  const all = actions as ReadonlyArray<LooseAction>;
  let parentAmount = amount;
  for (const action of all.filter((action) => !splitIndexOf(action)))
    if (action.op === "set" && action.field === "amount" && typeof action.value === "number")
      parentAmount = action.value;
  const childActions = all.filter((action) => splitIndexOf(action) > 0);
  if (childActions.length === 0) return { amount: parentAmount };

  const children = new Map<number, { amount: number; category: string | null }>();
  const childAt = (index: number) => {
    let child = children.get(index);
    if (child === undefined) {
      child = { amount: 0, category: null };
      children.set(index, child);
    }
    return child;
  };
  for (const action of childActions) {
    const child = childAt(splitIndexOf(action));
    if (action.op === "set" && action.field === "category")
      child.category = typeof action.value === "string" ? action.value : null;
    else if (action.op === "set" && action.field === "amount" && typeof action.value === "number")
      child.amount = action.value;
    else if (
      action.op === "set-split-amount" &&
      methodOf(action) === "fixed-amount" &&
      typeof action.value === "number"
    )
      child.amount = action.value;
  }
  const remainder = () =>
    parentAmount - [...children.values()].reduce((sum, child) => sum + child.amount, 0);
  const splitAmounts = childActions.filter((action) => action.op === "set-split-amount");
  const afterFixed = remainder();
  for (const action of splitAmounts.filter((action) => methodOf(action) === "fixed-percent"))
    childAt(splitIndexOf(action)).amount = Math.round(
      afterFixed * (Number(action.value ?? 0) / 100),
    );
  const remainders = splitAmounts.filter((action) => methodOf(action) === "remainder");
  if (remainders.length > 0) {
    const each = Math.round(remainder() / remainders.length);
    let last = -1;
    for (const action of remainders) {
      childAt(splitIndexOf(action)).amount = each;
      last = Math.max(last, splitIndexOf(action));
    }
    childAt(last).amount += remainder();
  }
  return {
    amount: parentAmount,
    subtransactions: [...children.entries()].sort(([a], [b]) => a - b).map(([, child]) => child),
  };
};

// ---------------------------------------------------------------------------------------------
// The schedules of a category
// ---------------------------------------------------------------------------------------------

export interface ScheduleTemplateTarget {
  readonly template: ScheduleTemplate;
  readonly name: string;
  target: number;
  readonly perOccurrenceAmount: number;
  readonly nextDateString: string;
  readonly storedNextDate: string | null;
  readonly scheduleId: string;
  readonly targetInterval: number;
  readonly targetFrequency: string | undefined;
  readonly numMonths: number;
  readonly completed: boolean;
  readonly full: boolean;
  readonly repeat: boolean;
  readonly dateConditions: DateCondition;
  readonly isPastDue: boolean;
}

const nextDateOf = (date: DateCondition, from: string, noSkipWeekend = false) =>
  getNextDate(date, parse(from), noSkipWeekend) ?? from;

export const createScheduleList = (
  templates: ReadonlyArray<ScheduleTemplate>,
  currentMonth: string,
  category: TemplateCategory,
  env: TemplateEnv,
): { t: Array<ScheduleTemplateTarget> } => {
  const t: Array<ScheduleTemplateTarget> = [];
  for (const template of templates) {
    const stored = env.schedules.find({ scheduleId: template.scheduleId, name: template.name });
    if (stored === undefined)
      throw new Error(`Schedule ${template.name ?? template.scheduleId} does not exist`);
    const { date, amount: amountCondition } = extractScheduleConds(stored.conditions);
    if (date === null) throw new Error(`Schedule ${stored.name ?? stored.id} has no date`);
    const dateConditions = date as DateCondition;
    const raw = amountCondition?.value;
    let scheduleAmount =
      amountCondition?.op === "isbetween" && typeof raw === "object" && raw !== null
        ? Math.round(
            (raw as { num1: number; num2: number }).num1 +
              (raw as { num1: number; num2: number }).num2,
          ) / 2
        : typeof raw === "number"
          ? raw
          : 0;
    if (template.adjustment !== undefined && template.adjustmentType) {
      if (template.adjustmentType === "percent") scheduleAmount *= 1 + template.adjustment / 100;
      else scheduleAmount += (scheduleAmount < 0 ? -1 : 1) * amountToInteger(template.adjustment);
    }
    scheduleAmount = Math.round(scheduleAmount);

    const nextDateString = nextDateOf(dateConditions, currentMonth);
    const { amount: postRuleAmount, subtransactions } = execScheduleActions(
      scheduleAmount,
      stored.actions,
    );
    const categorySplits = subtransactions?.filter((split) => split.category === category.id);
    // Unless the schedule splits into this category, target the amount after its rule.
    const sign = category.isIncome ? 1 : -1;
    const target =
      sign *
      (categorySplits?.length
        ? categorySplits.reduce((sum, split) => sum + split.amount, 0)
        : postRuleAmount);

    const recurrence = isRecurrence(dateConditions.value) ? dateConditions.value : null;
    const numMonths = months.differenceInCalendarMonths(nextDateString, currentMonth);
    const entry: ScheduleTemplateTarget = {
      template,
      target,
      perOccurrenceAmount: target,
      nextDateString,
      storedNextDate: stored.nextDate,
      scheduleId: stored.id,
      targetInterval: recurrence?.interval ? recurrence.interval : 1,
      targetFrequency: recurrence?.frequency,
      numMonths,
      completed: stored.completed,
      full: template.full ?? false,
      repeat: recurrence !== null,
      name: stored.name ?? template.name ?? "",
      dateConditions,
      isPastDue: numMonths < 0,
    };
    t.push(entry);
    if (!entry.completed && recurrence !== null && !entry.isPastDue) {
      let monthlyTarget = 0;
      const nextMonth = months.addMonths(currentMonth, numMonths + 1);
      const adjust = (base: string) =>
        recurrence.skipWeekend
          ? months.dayFromDate(getDateWithSkippedWeekend(parse(base), recurrence.weekendSolveMode))
          : base;
      let nextBaseDate = nextDateOf(dateConditions, currentMonth, true);
      let nextDate = adjust(nextBaseDate);
      while (nextDate < nextMonth) {
        monthlyTarget += -target;
        const currentDate = nextBaseDate;
        nextBaseDate = nextDateOf(dateConditions, months.addDays(nextBaseDate, 1), true);
        nextDate = adjust(nextBaseDate);
        // A schedule that has ended answers the same date again.
        if (!months.differenceInCalendarDays(nextBaseDate, currentDate)) break;
      }
      entry.target = -monthlyTarget;
    }
  }
  return { t };
};

const FORECAST_MONTHS = 60;

// How far either side of a range to look for the occurrence nearest a linked payment.
const LINKED_PAYMENT_SEARCH_MONTHS = 25;

const linkedSearchStart = (rangeStart: string) =>
  `${months.subMonths(rangeStart, LINKED_PAYMENT_SEARCH_MONTHS)}-01`;
const linkedSearchEnd = (rangeEnd: string) =>
  `${months.addMonths(rangeEnd, LINKED_PAYMENT_SEARCH_MONTHS)}-01`;

const firstIndexFrom = (dates: ReadonlyArray<string>, day: string) => {
  let low = 0;
  let high = dates.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (dates[mid]! < day) low = mid + 1;
    else high = mid;
  }
  return low;
};

const monthsBetween = (month: string, day: string) =>
  (Number(day.slice(0, 4)) - Number(month.slice(0, 4))) * 12 +
  Number(day.slice(5, 7)) -
  Number(month.slice(5, 7));

type OccurrencesBetween = (startDay: string, endDay: string) => Array<string>;

/** A schedule's occurrences over every range given, generated once and sliced per request. */
const occurrenceLookup = (
  entry: ScheduleTemplateTarget,
  ranges: ReadonlyArray<readonly [string, string]>,
): OccurrencesBetween => {
  let [coveredStart, coveredEnd] = ranges[0]!;
  for (const [startDay, endDay] of ranges) {
    if (startDay < coveredStart) coveredStart = startDay;
    if (endDay > coveredEnd) coveredEnd = endDay;
  }
  const dates = getOccurrencesBetween(entry.dateConditions, coveredStart, coveredEnd);
  return (startDay, endDay) =>
    startDay < coveredStart || endDay > coveredEnd
      ? getOccurrencesBetween(entry.dateConditions, startDay, endDay)
      : dates.slice(firstIndexFrom(dates, startDay), firstIndexFrom(dates, endDay));
};

/**
 * The occurrences in [rangeStart, rangeEnd) this schedule's linked payments settle: each payment
 * settles its nearest occurrence (the later one on a tie), and an occurrence only once.
 */
const settledOccurrences = (
  entry: ScheduleTemplateTarget,
  transactions: ReadonlyArray<Pick<ScheduledTransaction, "date" | "schedule">>,
  rangeStart: string,
  rangeEnd: string,
  occurrencesBetween: OccurrencesBetween,
): Set<string> => {
  const settled = new Set<string>();
  const linked = transactions.filter((transaction) => transaction.schedule === entry.scheduleId);
  if (linked.length === 0) return settled;
  const nearby = occurrencesBetween(linkedSearchStart(rangeStart), linkedSearchEnd(rangeEnd));
  if (nearby.length === 0) return settled;
  for (const transaction of linked) {
    const low = firstIndexFrom(nearby, transaction.date);
    const distanceTo = (index: number) =>
      Math.abs(months.differenceInCalendarDays(transaction.date, nearby[index]!));
    const nearest =
      low === nearby.length || (low > 0 && distanceTo(low - 1) < distanceTo(low))
        ? nearby[low - 1]!
        : nearby[low]!;
    if (nearest >= rangeStart && nearest < rangeEnd) settled.add(nearest);
  }
  return settled;
};

/** What the category is expected to pay in each of the next 60 months. */
export const buildMonthlyOutflow = (
  smoothEntries: ReadonlyArray<ScheduleTemplateTarget>,
  currentMonth: string,
  category: TemplateCategory,
  env: TemplateEnv,
  fullEntries: ReadonlyArray<ScheduleTemplateTarget> = [],
): Array<number> => {
  const store = env.schedules;
  const fullScheduleIds = fullEntries.map((entry) => entry.scheduleId);
  const reservedEntries = [...smoothEntries, ...fullEntries];
  const monthlyOutflow = Array.from({ length: FORECAST_MONTHS }, () => 0);
  const windowStart = months.firstDayOfMonth(currentMonth);
  const windowEnd = `${months.addMonths(currentMonth, FORECAST_MONTHS)}-01`;
  const today = env.today;
  const currentMonthStart = months.firstDayOfMonth(today);
  const isBudgetingAhead = windowStart > currentMonthStart;

  // A completed schedule counts up to its stored next date, or its last payment here if later.
  const occurrenceCutoff = new Map<string, string>();
  const completedEntries = smoothEntries.filter((entry) => entry.completed);
  if (completedEntries.length > 0) {
    const nextDates = completedEntries.map((entry) => entry.storedNextDate);
    const earliestNextDate = nextDates.includes(null)
      ? null
      : (nextDates as Array<string>).reduce((earliest, date) =>
          date < earliest ? date : earliest,
        );
    const completedPayments = store.transactions({
      category: category.id,
      schedules: completedEntries.map((entry) => entry.scheduleId),
      ...(earliestNextDate ? { after: earliestNextDate } : {}),
    });
    const lastPayment = new Map<string, string>();
    for (const transaction of completedPayments) {
      if (transaction.schedule === null) continue;
      if (transaction.date > (lastPayment.get(transaction.schedule) ?? ""))
        lastPayment.set(transaction.schedule, transaction.date);
    }
    for (const entry of completedEntries) {
      const nextDate = entry.storedNextDate ?? "";
      const paid = lastPayment.get(entry.scheduleId) ?? "";
      occurrenceCutoff.set(entry.scheduleId, paid > nextDate ? paid : nextDate);
    }
  }
  const withinCutoff = (entry: ScheduleTemplateTarget, dates: Array<string>) => {
    const cutoff = occurrenceCutoff.get(entry.scheduleId);
    return cutoff === undefined ? dates : dates.filter((date) => date <= cutoff);
  };

  const linkedAnywhereBeforeWindow = store.transactions({
    schedules: reservedEntries.map((entry) => entry.scheduleId),
    from: `${months.subMonths(windowStart, LINKED_PAYMENT_SEARCH_MONTHS)}-01`,
    before: windowStart,
  });
  const linkedBeforeWindow = linkedAnywhereBeforeWindow.filter(
    (transaction) => transaction.category === category.id,
  );
  const tomorrow = months.addDays(today, 1);
  const budgetMonthEnd = months.firstDayOfMonth(months.addMonths(currentMonth, 1));
  const postedEnd = tomorrow < budgetMonthEnd ? tomorrow : budgetMonthEnd;
  const sign = category.isIncome ? 1 : -1;

  const postedTransactions = isBudgetingAhead
    ? []
    : store.transactions({ category: category.id, from: windowStart, before: postedEnd });

  const linkedSchedules = new Set(
    [...linkedAnywhereBeforeWindow, ...postedTransactions].map(
      (transaction) => transaction.schedule,
    ),
  );
  const lookups = new Map<ScheduleTemplateTarget, OccurrencesBetween>();
  for (const entry of reservedEntries) {
    const ranges: Array<readonly [string, string]> = [[windowStart, windowEnd]];
    if (isBudgetingAhead) ranges.push([currentMonthStart, windowStart]);
    if (linkedSchedules.has(entry.scheduleId)) {
      ranges.push([linkedSearchStart(windowStart), linkedSearchEnd(budgetMonthEnd)]);
      if (isBudgetingAhead)
        ranges.push([linkedSearchStart(currentMonthStart), linkedSearchEnd(windowStart)]);
    }
    lookups.set(entry, occurrenceLookup(entry, ranges));
  }

  // Budgeting ahead, the balance still owes what falls due between now and the budget month.
  if (isBudgetingAhead) {
    for (const entry of reservedEntries) {
      const occurrencesBetween = lookups.get(entry)!;
      const paidAnywhere = settledOccurrences(
        entry,
        linkedAnywhereBeforeWindow,
        currentMonthStart,
        windowStart,
        occurrencesBetween,
      );
      const settledHere = settledOccurrences(
        entry,
        linkedBeforeWindow,
        currentMonthStart,
        windowStart,
        occurrencesBetween,
      );
      const pending = withinCutoff(
        entry,
        occurrencesBetween(currentMonthStart, windowStart),
      ).filter(
        (date) =>
          !settledHere.has(date) &&
          ((entry.storedNextDate !== null && date >= entry.storedNextDate) ||
            paidAnywhere.has(date)),
      );
      monthlyOutflow[0]! += pending.length * entry.perOccurrenceAmount;
    }
  }

  let dueByToday = 0;
  for (const entry of smoothEntries) {
    const occurrencesBetween = lookups.get(entry)!;
    const occurrences = withinCutoff(entry, occurrencesBetween(windowStart, windowEnd));
    const settledEarly = settledOccurrences(
      entry,
      linkedBeforeWindow,
      windowStart,
      budgetMonthEnd,
      occurrencesBetween,
    );
    const paidThisMonth = isBudgetingAhead
      ? 0
      : [
          ...settledOccurrences(
            entry,
            postedTransactions,
            windowStart,
            budgetMonthEnd,
            occurrencesBetween,
          ),
        ].filter((date) => !settledEarly.has(date)).length;
    let indexInBudgetMonth = 0;
    for (const occurrenceDate of occurrences) {
      if (settledEarly.has(occurrenceDate)) continue;
      const monthIndex = monthsBetween(currentMonth, occurrenceDate);
      const isElapsed =
        !isBudgetingAhead &&
        monthIndex === 0 &&
        (occurrenceDate < postedEnd || indexInBudgetMonth < paidThisMonth);
      if (monthIndex === 0) indexInBudgetMonth++;
      if (isElapsed) dueByToday += entry.perOccurrenceAmount;
      else if (monthIndex >= 0 && monthIndex < FORECAST_MONTHS)
        monthlyOutflow[monthIndex]! += entry.perOccurrenceAmount;
    }
  }

  if (!isBudgetingAhead) {
    const spentByToday = postedTransactions
      .filter(
        (transaction) =>
          transaction.schedule === null || !fullScheduleIds.includes(transaction.schedule),
      )
      .reduce((sum, transaction) => sum + sign * transaction.amount, 0);
    monthlyOutflow[0]! += Math.max(dueByToday, spentByToday);
  }

  // Unlinked transactions not counted above count in their own month.
  const unlinkedStart = isBudgetingAhead ? windowStart : tomorrow;
  for (const transaction of store.transactions({
    category: category.id,
    unlinked: true,
    from: unlinkedStart,
    before: windowEnd,
  })) {
    const monthIndex = monthsBetween(currentMonth, transaction.date);
    if (monthIndex >= 0 && monthIndex < FORECAST_MONTHS)
      monthlyOutflow[monthIndex]! += sign * transaction.amount;
  }
  return monthlyOutflow;
};

const DAYS_PER_YEAR = 365.25;

/** What a schedule costs a month in the long run. */
const getMonthlyRate = (entry: ScheduleTemplateTarget) => {
  if (!entry.repeat || entry.completed) return 0;
  const interval = entry.targetInterval;
  switch (entry.targetFrequency) {
    case "daily":
      return (entry.perOccurrenceAmount * DAYS_PER_YEAR) / 12 / interval;
    case "weekly":
      return (entry.perOccurrenceAmount * DAYS_PER_YEAR) / 7 / 12 / interval;
    default: {
      const span = 12 * interval;
      const from = months.addMonths(entry.nextDateString, 1);
      const occurrences = getOccurrencesBetween(
        entry.dateConditions,
        `${from}-01`,
        `${months.addMonths(from, span)}-01`,
      ).length;
      return (entry.perOccurrenceAmount * occurrences) / span;
    }
  }
};

/**
 * This month's whole-cent contribution: the smaller of using up a surplus above what the bills
 * need at the steady rate, or catching up at a constant amount through some month and then
 * the steady rate, either keeping the projected balance non-negative.
 */
const solveForecast = (
  startingBalance: number,
  monthlyOutflow: ReadonlyArray<number>,
  steadyRate: number,
): { contribution: number; catchUpEnd: number } => {
  const count = monthlyOutflow.length;
  const cumsum: Array<number> = [];
  let total = 0;
  for (const outflow of monthlyOutflow) {
    total += outflow;
    cumsum.push(total);
  }
  const ahead = cumsum.map((sum, i) => sum - steadyRate * (i + 1));
  const requiredBalance = Math.max(0, ...ahead);
  const surplus = startingBalance - requiredBalance;
  const best = {
    contribution: surplus > 0 ? Math.max(0, steadyRate - surplus) : Infinity,
    catchUpEnd: 0,
  };
  const neededAfter = Array.from({ length: count }, () => 0);
  let laterAhead = -Infinity;
  for (let i = count - 1; i >= 0; i--) {
    neededAfter[i] = Math.max(0, laterAhead - ahead[i]!);
    laterAhead = Math.max(laterAhead, ahead[i]!);
  }
  const fallback = { contribution: Infinity, catchUpEnd: 0 };
  let coversSoFar = 0;
  for (let k = 0; k < count; k++) {
    coversSoFar = Math.max(coversSoFar, Math.ceil((cumsum[k]! - startingBalance) / (k + 1)));
    const contribution = Math.max(
      coversSoFar,
      Math.ceil((cumsum[k]! + neededAfter[k]! - startingBalance) / (k + 1)),
    );
    const option = monthlyOutflow[k]! >= steadyRate ? best : fallback;
    if (contribution < option.contribution) {
      option.contribution = contribution;
      option.catchUpEnd = k;
    }
  }
  return best.contribution < Infinity ? best : fallback;
};

export const solveMonthlyContribution = (
  startingBalance: number,
  monthlyOutflow: ReadonlyArray<number>,
  steadyRate: number,
): number => solveForecast(startingBalance, monthlyOutflow, steadyRate).contribution;

export const runScheduleForecast = (
  templateLines: ReadonlyArray<Template>,
  currentMonth: string,
  balance: number,
  toBudget: number,
  category: TemplateCategory,
  env: TemplateEnv,
): { toBudget: number; perScheduleMonthly: Map<ScheduleTemplate, number> } => {
  const scheduleTemplates = templateLines.filter(
    (template): template is ScheduleTemplate => template.type === "schedule",
  );
  const { t } = createScheduleList(scheduleTemplates, currentMonth, category, env);
  // A tracking budget saves nothing ahead: every schedule is budgeted in full when due.
  const fullEntries = t.filter(
    (entry) => (env.isTracking || entry.template.full) && !entry.isPastDue && !entry.completed,
  );
  const smoothEntries = env.isTracking
    ? []
    : t.filter((entry) => !entry.template.full || entry.completed);

  const perScheduleMonthly = new Map<ScheduleTemplate, number>();
  const fullContribution = fullEntries.reduce((sum, entry) => {
    const contribution = entry.numMonths === 0 ? entry.target : 0;
    perScheduleMonthly.set(
      entry.template,
      (perScheduleMonthly.get(entry.template) ?? 0) + contribution,
    );
    return sum + contribution;
  }, 0);
  if (smoothEntries.length === 0)
    return { toBudget: toBudget + fullContribution, perScheduleMonthly };

  const monthlyOutflow = buildMonthlyOutflow(
    smoothEntries,
    currentMonth,
    category,
    env,
    fullEntries,
  );
  const steadyRate = Math.max(
    0,
    Math.ceil(smoothEntries.reduce((sum, entry) => sum + getMonthlyRate(entry), 0)),
  );
  const { contribution: candidate, catchUpEnd } = solveForecast(
    balance,
    monthlyOutflow,
    steadyRate,
  );

  // Split the contribution across the smooth schedules, each from its monthly rate; a catch-up
  // goes to those behind.
  const upcoming = smoothEntries.filter((entry) => !entry.isPastDue && !entry.completed);
  const splitEntries = upcoming.length > 0 ? upcoming : smoothEntries;
  const weights = splitEntries.map(getMonthlyRate);
  const totalMonthlyWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const catchUp = candidate - totalMonthlyWeight;
  const catchUpMonths = catchUpEnd + 1;
  const catchUpEndDay = months.firstDayOfMonth(months.addMonths(currentMonth, catchUpMonths));
  const shortfalls = splitEntries.map((entry, i) =>
    catchUp > 0
      ? Math.max(
          0,
          getOccurrencesBetween(
            entry.dateConditions,
            months.firstDayOfMonth(currentMonth),
            catchUpEndDay,
          ).length *
            entry.perOccurrenceAmount -
            weights[i]! * catchUpMonths,
        )
      : 0,
  );
  const totalShortfall = shortfalls.reduce((sum, shortfall) => sum + shortfall, 0);
  splitEntries.forEach((entry, i) => {
    const share =
      totalShortfall > 0
        ? Math.round(weights[i]! + (catchUp * shortfalls[i]!) / totalShortfall)
        : totalMonthlyWeight === 0
          ? Math.round(candidate / splitEntries.length)
          : Math.round((weights[i]! / totalMonthlyWeight) * candidate) || 0;
    perScheduleMonthly.set(entry.template, (perScheduleMonthly.get(entry.template) ?? 0) + share);
  });
  return { toBudget: toBudget + fullContribution + candidate, perScheduleMonthly };
};

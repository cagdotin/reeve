/**
 * Budget targets as structured data: what a category's `#template`, `#goal` and `#cleanup` note
 * lines say, in the shape the target editor, the API and agents use (docs/rules/budget.md). Plain code the
 * browser imports too: the kinds, their plain-language sentences and Actual's editor validation
 * (`validateAutomation.ts`). Money is in cents.
 */

/** A balance the category stops at: Actual's `up to` limit. */
export interface TargetCap {
  readonly amount: number;
  readonly period: "monthly" | "weekly" | "daily";
  /** The first day of a weekly cap's weeks. */
  readonly start: string | null;
  /** Keep what is above the cap instead of giving it back. */
  readonly hold: boolean;
}

export interface TargetAdjustment {
  /** Positive raises, negative lowers. */
  readonly by: number;
  /** A percent, or cents. */
  readonly unit: "percent" | "fixed";
}

interface Prioritized {
  /** Lower runs first when To Budget is short; 0 is the plain `#template`. */
  readonly priority: number;
}

/** The same amount each month (`#template 50`), or only a cap to top up to (`#template up to 300`). */
export interface SimpleTarget extends Prioritized {
  readonly type: "simple";
  readonly monthly: number | null;
  readonly cap: TargetCap | null;
}

/** An amount every so many days, weeks, months or years from a day. */
export interface PeriodicTarget extends Prioritized {
  readonly type: "periodic";
  readonly amount: number;
  readonly period: "day" | "week" | "month" | "year";
  readonly every: number;
  readonly starting: string;
  readonly cap: TargetCap | null;
}

/** Save an amount by a month, maybe again every so many months or years; `spendFrom` spends early. */
export interface ByTarget extends Prioritized {
  readonly type: "by";
  readonly amount: number;
  readonly month: string;
  readonly repeat: { readonly unit: "month" | "year"; readonly every: number } | null;
  readonly spendFrom: string | null;
}

/** A share of income: an income category's id, `all income` or `available funds`. */
export interface PercentageTarget extends Prioritized {
  readonly type: "percentage";
  readonly percent: number;
  readonly of: string;
  /** Last month's income instead of this month's. */
  readonly previous: boolean;
}

/** What a schedule (by name) needs; `full` budgets the whole bill in the month it is due. */
export interface ScheduleTarget extends Prioritized {
  readonly type: "schedule";
  readonly schedule: string;
  readonly full: boolean;
  readonly adjustment: TargetAdjustment | null;
}

export interface AverageTarget extends Prioritized {
  readonly type: "average";
  readonly months: number;
  readonly adjustment: TargetAdjustment | null;
}

export interface CopyTarget extends Prioritized {
  readonly type: "copy";
  readonly monthsAgo: number;
}

/** A share, by weight, of what To Budget holds after every other target. */
export interface RemainderTarget {
  readonly type: "remainder";
  readonly weight: number;
  readonly cap: TargetCap | null;
}

/** A long-term balance to reach; it budgets nothing, the balance shows progress. */
export interface GoalTarget {
  readonly type: "goal";
  readonly amount: number;
}

export type Target =
  | SimpleTarget
  | PeriodicTarget
  | ByTarget
  | PercentageTarget
  | ScheduleTarget
  | AverageTarget
  | CopyTarget
  | RemainderTarget
  | GoalTarget;

/**
 * What a category does with its leftover money at the end of the month (`#cleanup` lines). A pool
 * is a named group: categories give into it, take from it by weight, or are covered by it.
 */
export type LeftoverRule =
  | { readonly kind: "give-back" }
  | { readonly kind: "send"; readonly to: string }
  | { readonly kind: "receive"; readonly weight: number }
  | { readonly kind: "pool-give"; readonly pool: string }
  | { readonly kind: "pool-receive"; readonly pool: string; readonly weight: number }
  | { readonly kind: "pool-cover"; readonly pool: string };

export const SPECIAL_INCOME_SOURCES = ["all income", "available funds"] as const;

// ---------------------------------------------------------------------------------------------
// The editor's kinds: how a person picks a target
// ---------------------------------------------------------------------------------------------

export const TARGET_KINDS = [
  "fixed",
  "save-by",
  "top-up",
  "goal",
  "schedule",
  "percentage",
  "history",
  "remainder",
] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

export const KIND_INFO: Record<
  TargetKind,
  { readonly label: string; readonly description: string; readonly common: boolean }
> = {
  fixed: {
    label: "Budget the same amount",
    description: "Put a set amount in every month, or every few weeks.",
    common: true,
  },
  "save-by": {
    label: "Save up by a date",
    description: "Spread an amount over the months until you need it. Good for yearly bills.",
    common: true,
  },
  "top-up": {
    label: "Top up to an amount",
    description: "Refill the balance to the same amount each month, so it never piles up.",
    common: true,
  },
  goal: {
    label: "Track a savings goal",
    description: "Set a balance to reach. Nothing is budgeted for you; you see your progress.",
    common: true,
  },
  schedule: {
    label: "Cover a scheduled bill",
    description: "Budget what one of your schedules will cost.",
    common: false,
  },
  percentage: {
    label: "A share of income",
    description: "Put a percent of what you earn into this category.",
    common: false,
  },
  history: {
    label: "Based on past months",
    description: "Use what you spent on average, or what you budgeted before.",
    common: false,
  },
  remainder: {
    label: "Whatever is left",
    description: "Share out what is still unbudgeted after every other target.",
    common: false,
  },
};

/** The editor kind a target shows as. */
export const kindOf = (target: Target): TargetKind => {
  switch (target.type) {
    case "simple":
      return target.monthly === null && target.cap !== null ? "top-up" : "fixed";
    case "periodic":
      return "fixed";
    case "by":
      return "save-by";
    case "percentage":
      return "percentage";
    case "schedule":
      return "schedule";
    case "average":
    case "copy":
      return "history";
    case "remainder":
      return "remainder";
    case "goal":
      return "goal";
  }
};

/** A month as `YYYY-MM`, `count` months from `month`. */
const shiftMonth = (month: string, count: number): string => {
  const [year, m] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + (m - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
};

/** A fresh target of a kind, as the editor offers it for `month`. */
export const defaultTarget = (kind: TargetKind, month: string, priority = 0): Target => {
  switch (kind) {
    case "fixed":
      return { type: "simple", priority, monthly: 10_000, cap: null };
    case "save-by":
      return {
        type: "by",
        priority,
        amount: 120_000,
        month: shiftMonth(month, 11),
        repeat: null,
        spendFrom: null,
      };
    case "top-up":
      return {
        type: "simple",
        priority,
        monthly: null,
        cap: { amount: 30_000, period: "monthly", start: null, hold: false },
      };
    case "goal":
      return { type: "goal", amount: 100_000 };
    case "schedule":
      return { type: "schedule", priority, schedule: "", full: false, adjustment: null };
    case "percentage":
      return { type: "percentage", priority, percent: 10, of: "all income", previous: false };
    case "history":
      return { type: "average", priority, months: 3, adjustment: null };
    case "remainder":
      return { type: "remainder", weight: 1, cap: null };
  }
};

// ---------------------------------------------------------------------------------------------
// Plain-language sentences
// ---------------------------------------------------------------------------------------------

export interface SentenceContext {
  readonly money: (cents: number) => string;
  /** A category id's name, for percentages and leftovers. */
  readonly categoryName: (id: string) => string | undefined;
  /** The name of the category the sentences are about. */
  readonly self?: string;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** `2027-02` as "February 2027". */
export const monthName = (month: string): string => {
  const [year, m] = month.split("-").map(Number) as [number, number];
  return `${MONTHS[m - 1] ?? month} ${year}`;
};

const dayName = (day: string): string => {
  const [year, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${MONTHS[m - 1]?.slice(0, 3) ?? ""} ${d}, ${year}`;
};

const plural = (count: number, unit: string) => (count === 1 ? unit : `${count} ${unit}s`);

const capPhrase = (cap: TargetCap, context: SentenceContext) => {
  const amount = context.money(cap.amount);
  const per =
    cap.period === "weekly"
      ? ` a week (weeks from ${cap.start ? dayName(cap.start) : "?"})`
      : cap.period === "daily"
        ? " a day"
        : "";
  return `${amount}${per}`;
};

const adjustmentPhrase = (adjustment: TargetAdjustment | null, context: SentenceContext) => {
  if (adjustment === null || adjustment.by === 0) return "";
  const amount =
    adjustment.unit === "percent"
      ? `${Math.abs(adjustment.by)}%`
      : context.money(Math.abs(adjustment.by));
  return `, ${adjustment.by > 0 ? "plus" : "minus"} ${amount}`;
};

const sourceName = (of: string, context: SentenceContext) =>
  of.toLowerCase() === "all income"
    ? "all income"
    : of.toLowerCase() === "available funds"
      ? "the money available to budget"
      : (context.categoryName(of) ?? of);

/** One target as a sentence: "Save 900.00 by February 2027". */
export const describeTarget = (target: Target, context: SentenceContext): string => {
  const money = context.money;
  switch (target.type) {
    case "simple": {
      if (target.monthly === null && target.cap !== null)
        return `Top up to ${capPhrase(target.cap, context)} each month`;
      const base = `Budget ${money(target.monthly ?? 0)} each month`;
      return target.cap
        ? `${base}, until the balance reaches ${capPhrase(target.cap, context)}`
        : base;
    }
    case "periodic": {
      const base = `Budget ${money(target.amount)} every ${plural(target.every, target.period)}, from ${dayName(target.starting)}`;
      return target.cap
        ? `${base}, until the balance reaches ${capPhrase(target.cap, context)}`
        : base;
    }
    case "by": {
      let sentence = `Save ${money(target.amount)} by ${monthName(target.month)}`;
      if (target.repeat)
        sentence += `, then again every ${plural(target.repeat.every, target.repeat.unit)}`;
      if (target.spendFrom) sentence += `, spending from ${monthName(target.spendFrom)}`;
      return sentence;
    }
    case "percentage":
      return `Budget ${target.percent}% of ${target.previous ? "last month's " : ""}${sourceName(target.of, context)}`;
    case "schedule":
      return `${target.full ? "Budget the whole of" : "Save up for"} the bill "${target.schedule}"${adjustmentPhrase(target.adjustment, context)}`;
    case "average":
      return `Budget the average spent over the last ${plural(target.months, "month")}${adjustmentPhrase(target.adjustment, context)}`;
    case "copy":
      return `Budget the same as ${plural(target.monthsAgo, "month")} ago`;
    case "remainder": {
      const base =
        target.weight === 1
          ? "Budget a share of whatever is left"
          : `Budget a share (weight ${target.weight}) of whatever is left`;
      return target.cap
        ? `${base}, until the balance reaches ${capPhrase(target.cap, context)}`
        : base;
    }
    case "goal":
      return `Reach a balance of ${money(target.amount)}`;
  }
};

/** Calendar months from `from` to `month`; negative when `month` is earlier. */
export const monthsUntil = (month: string, from: string): number => {
  const [ty, tm] = month.split("-").map(Number) as [number, number];
  const [fy, fm] = from.split("-").map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
};

/** One leftover rule as a sentence. */
export const describeLeftover = (rule: LeftoverRule, context: SentenceContext): string => {
  switch (rule.kind) {
    case "give-back":
      return "At month end, give leftover money back to To Budget";
    case "send":
      return `At month end, send leftover money to ${context.categoryName(rule.to) ?? "another category"}`;
    case "receive":
      return rule.weight === 1
        ? "At month end, collect money other categories give back"
        : `At month end, collect money other categories give back (share ${rule.weight})`;
    case "pool-give":
      return `At month end, put leftover money in the pool "${rule.pool}"`;
    case "pool-receive":
      // The pool a `send` names after its receiver.
      if (rule.pool.trim().toLowerCase() === context.self?.trim().toLowerCase())
        return "At month end, collect leftover money other categories send here";
      return rule.weight === 1
        ? `At month end, take money from the pool "${rule.pool}"`
        : `At month end, take money from the pool "${rule.pool}" (share ${rule.weight})`;
    case "pool-cover":
      return `At month end, cover overspending from the pool "${rule.pool}"`;
  }
};

// ---------------------------------------------------------------------------------------------
// Validation: Actual's validateAutomation, plus the rules its engine enforces per category
// ---------------------------------------------------------------------------------------------

export type TargetProblem =
  | { readonly kind: "schedule-not-found"; readonly name: string }
  | { readonly kind: "percentage-out-of-range"; readonly percent: number }
  | { readonly kind: "percentage-no-source" }
  | { readonly kind: "percentage-source-not-found"; readonly source: string }
  | { readonly kind: "by-no-month" }
  | { readonly kind: "by-target-past"; readonly month: string }
  | { readonly kind: "spend-no-from" }
  | { readonly kind: "spend-from-after-target" }
  | { readonly kind: "adjustment-out-of-range" }
  | { readonly kind: "amount-not-positive" }
  | { readonly kind: "count-not-positive" }
  | { readonly kind: "weekly-cap-no-start" };

export type TargetConflict =
  | { readonly kind: "percent-over-100"; readonly total: number }
  | { readonly kind: "schedule-priority-mismatch" }
  | { readonly kind: "more-than-one-cap" }
  | { readonly kind: "more-than-one-spend" }
  | { readonly kind: "more-than-one-goal" };

export interface ValidationContext {
  /** Schedules by name; a completed one cannot be covered. */
  readonly schedules: ReadonlyArray<{ readonly name: string; readonly completed: boolean }>;
  /** This month, `YYYY-MM`. */
  readonly month: string;
  /**
   * Income category ids, lower-cased names and the special sources. Left out, the source is not
   * checked (the engine still checks it when templates run).
   */
  readonly incomeSources?: ReadonlySet<string>;
}

const isValidMonth = (month: string | null | undefined): month is string =>
  typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);

const adjustmentOutOfRange = (adjustment: TargetAdjustment | null) =>
  adjustment !== null &&
  adjustment.unit === "percent" &&
  (adjustment.by <= -100 || adjustment.by > 1000);

const capOf = (target: Target): TargetCap | null =>
  target.type === "simple" || target.type === "periodic" || target.type === "remainder"
    ? target.cap
    : null;

/** What is wrong with one target, as Actual's `validateAutomation`; null when nothing. */
export const validateTarget = (
  target: Target,
  context: ValidationContext,
): TargetProblem | null => {
  const cap = capOf(target);
  if (cap !== null) {
    if (cap.amount <= 0) return { kind: "amount-not-positive" };
    if (cap.period === "weekly" && !cap.start) return { kind: "weekly-cap-no-start" };
  }
  switch (target.type) {
    case "schedule": {
      if (!target.schedule) return { kind: "schedule-not-found", name: "" };
      const match = context.schedules.find((schedule) => schedule.name === target.schedule);
      if (!match || match.completed) return { kind: "schedule-not-found", name: target.schedule };
      if (adjustmentOutOfRange(target.adjustment)) return { kind: "adjustment-out-of-range" };
      return null;
    }
    case "average":
      if (target.months < 1) return { kind: "count-not-positive" };
      if (adjustmentOutOfRange(target.adjustment)) return { kind: "adjustment-out-of-range" };
      return null;
    case "copy":
      return target.monthsAgo < 1 ? { kind: "count-not-positive" } : null;
    case "percentage": {
      if (!target.of) return { kind: "percentage-no-source" };
      if (target.percent <= 0 || target.percent > 100)
        return { kind: "percentage-out-of-range", percent: target.percent };
      const sources = context.incomeSources;
      if (sources && !sources.has(target.of) && !sources.has(target.of.toLowerCase()))
        return { kind: "percentage-source-not-found", source: target.of };
      return null;
    }
    case "by": {
      if (!isValidMonth(target.month)) return { kind: "by-no-month" };
      if (target.amount <= 0) return { kind: "amount-not-positive" };
      if (target.repeat !== null && target.repeat.every < 1) return { kind: "count-not-positive" };
      // A repeating target anchored on a past month rolls forward; only a one-off can be late.
      if (monthsUntil(target.month, context.month) < 0 && target.repeat === null)
        return { kind: "by-target-past", month: target.month };
      if (target.spendFrom !== null) {
        if (!isValidMonth(target.spendFrom)) return { kind: "spend-no-from" };
        if (monthsUntil(target.month, target.spendFrom) < 0)
          return { kind: "spend-from-after-target" };
      }
      return null;
    }
    case "simple":
      return target.monthly === null && target.cap === null
        ? { kind: "amount-not-positive" }
        : null;
    case "periodic":
      if (target.every < 1) return { kind: "count-not-positive" };
      return null;
    case "remainder":
      return target.weight < 1 ? { kind: "count-not-positive" } : null;
    case "goal":
      return target.amount <= 0 ? { kind: "amount-not-positive" } : null;
  }
};

/** Actual's check that one income source is not promised more than 100%. */
export const validatePercentageAllocation = (
  targets: ReadonlyArray<Target>,
): TargetConflict | null => {
  const bySource = new Map<string, number>();
  for (const target of targets) {
    if (target.type !== "percentage" || !target.of) continue;
    const key = `${target.previous}|${target.of.toLocaleLowerCase()}`;
    bySource.set(key, (bySource.get(key) ?? 0) + target.percent);
  }
  const max = Math.max(0, ...bySource.values());
  return max > 100 ? { kind: "percent-over-100", total: max } : null;
};

/**
 * Actual's engine needs every schedule and by-date target of a category at one priority, or none
 * of them budgets.
 */
export const validateSchedulePriorities = (
  targets: ReadonlyArray<Target>,
): TargetConflict | null => {
  const priorities = new Set<number>();
  for (const target of targets)
    if (target.type === "schedule" || (target.type === "by" && target.spendFrom === null))
      priorities.add(target.priority);
  return priorities.size > 1 ? { kind: "schedule-priority-mismatch" } : null;
};

/** The engine's one-per-category rules: one cap, one spend-from, one goal. */
export const validateCategoryRules = (targets: ReadonlyArray<Target>): TargetConflict | null => {
  if (targets.filter((target) => capOf(target) !== null).length > 1)
    return { kind: "more-than-one-cap" };
  if (targets.filter((target) => target.type === "by" && target.spendFrom !== null).length > 1)
    return { kind: "more-than-one-spend" };
  if (targets.filter((target) => target.type === "goal").length > 1)
    return { kind: "more-than-one-goal" };
  return null;
};

export const conflictsOf = (targets: ReadonlyArray<Target>): Array<TargetConflict> =>
  [
    validatePercentageAllocation(targets),
    validateSchedulePriorities(targets),
    validateCategoryRules(targets),
  ].filter((conflict) => conflict !== null);

export const problemMessage = (problem: TargetProblem | TargetConflict): string => {
  switch (problem.kind) {
    case "schedule-not-found":
      return problem.name
        ? `There is no active schedule called "${problem.name}".`
        : "Pick a schedule.";
    case "percentage-out-of-range":
      return "The percent must be more than 0 and at most 100.";
    case "percentage-no-source":
      return "Pick which income to take a share of.";
    case "percentage-source-not-found":
      return `There is no income category called "${problem.source}".`;
    case "by-no-month":
      return "Pick the month you need the money by.";
    case "by-target-past":
      return `${monthName(problem.month)} has passed. Pick a later month, or make it repeat.`;
    case "spend-no-from":
      return "Pick the month you start spending from.";
    case "spend-from-after-target":
      return "You can't start spending after the month you need the money by.";
    case "adjustment-out-of-range":
      return "A percent change must be above -100% and at most 1000%.";
    case "amount-not-positive":
      return "Enter an amount above zero.";
    case "count-not-positive":
      return "Enter a number of at least 1.";
    case "weekly-cap-no-start":
      return "Pick the day the weeks start on.";
    case "percent-over-100":
      return `These targets take ${problem.total}% of one income. Keep it at 100% or less.`;
    case "schedule-priority-mismatch":
      return "Bills and save-by-date targets in one category must share a priority.";
    case "more-than-one-cap":
      return "Only one target in a category can stop at a balance.";
    case "more-than-one-spend":
      return "Only one save-by-date target in a category can spend early.";
    case "more-than-one-goal":
      return "A category can have only one savings goal.";
  }
};

/** Every problem with a category's targets, as messages; empty when they can be saved. */
export const targetProblems = (
  targets: ReadonlyArray<Target>,
  context: ValidationContext,
): Array<string> => [
  ...targets.flatMap((target, index) => {
    const problem = validateTarget(target, context);
    return problem === null ? [] : [`Target ${index + 1}: ${problemMessage(problem)}`];
  }),
  ...conflictsOf(targets).map(problemMessage),
];

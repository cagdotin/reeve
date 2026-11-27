/**
 * Plain functions every client runs, the browser included: days and months, money, and the budget
 * arithmetic. No Effect, no Node modules (docs/rules/boundaries.md).
 */
import type { AccountScope, PlacementScope, ReportType } from "./catalog/reports.ts";
import type { RuleAction } from "./catalog/rules.ts";

export const BUDGET_TYPES = ["envelope", "tracking"] as const;
export type BudgetTypeName = (typeof BUDGET_TYPES)[number];

// ---------------------------------------------------------------------------------------------
// Report account scope (docs/rules/reports.md)
// ---------------------------------------------------------------------------------------------

/** The reports whose lines an account scope narrows without changing their arithmetic. */
export const SCOPED_REPORTS: ReadonlySet<ReportType> = new Set([
  "net-worth",
  "cash-flow",
  "spending",
  "summary",
  "calendar",
  "custom",
  "balance-forecast",
  "age-of-money",
]);

/** Whether a report follows an account scope; budget-wide and plan-wide ones do not. */
export const followsScope = (definition: {
  readonly type: ReportType;
  readonly settings: object;
}): boolean =>
  SCOPED_REPORTS.has(definition.type) &&
  !(definition.type === "custom" && "balanceType" in definition.settings
    ? definition.settings.balanceType === "Budgeted"
    : false);

export const ALL_ACCOUNTS: AccountScope = { mode: "all" };

/**
 * The accounts a report widget covers, the first that applies: what the full report explores, the
 * placement's fixed scope, the page it sits on, then its saved report's scope.
 */
export const effectiveScope = (sources: {
  readonly explored?: AccountScope | undefined;
  readonly placement?: PlacementScope["accounts"] | undefined;
  readonly host?: AccountScope | undefined;
  readonly saved?: AccountScope | undefined;
}): AccountScope =>
  sources.explored ??
  (sources.placement?.mode === "fixed" ? sources.placement.value : undefined) ??
  sources.host ??
  sources.saved ??
  ALL_ACCOUNTS;

/** The Accounts pages' scope (all, budgeted, offbudget or an account id) as a report's. */
export const pageScope = (scope: string): AccountScope =>
  scope === "all" || scope === "budgeted" || scope === "offbudget"
    ? { mode: scope }
    : { mode: "selected", ids: [scope] };

export const sameScope = (a: AccountScope, b: AccountScope): boolean =>
  a.mode === b.mode &&
  (a.mode !== "selected" ||
    (b.mode === "selected" &&
      a.ids.length === b.ids.length &&
      a.ids.every((id) => b.ids.includes(id))));

// ---------------------------------------------------------------------------------------------
// Days and months
// ---------------------------------------------------------------------------------------------

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `value` is a real calendar day written `YYYY-MM-DD`. */
export const isCalendarDay = (value: string): boolean => {
  const match = DAY.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return (
    month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
  );
};

/** `2026-11-05` as the integer the database stores, 20261105. */
export const dayToInt = (day: string): number => Number(day.replaceAll("-", ""));

export const intToDay = (value: number): string => {
  const text = String(value);
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
};

/** `2026-11` as the integer the database stores, 202611. */
export const monthToInt = (month: string): number => Number(month.replace("-", ""));

export const intToMonth = (value: number): string => {
  const text = String(value);
  return `${text.slice(0, 4)}-${text.slice(4, 6)}`;
};

export const monthOf = (day: string): string => day.slice(0, 7);

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/** Today in the local time zone, `YYYY-MM-DD`. */
export const today = (now: Date = new Date()): string =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

export const currentMonth = (now: Date = new Date()): string => monthOf(today(now));

export const addMonths = (month: string, count: number): string => {
  const [year, index] = [Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + count];
  const total = year * 12 + index;
  return `${pad(Math.floor(total / 12), 4)}-${pad((total % 12) + 1)}`;
};

export const prevMonth = (month: string): string => addMonths(month, -1);
export const nextMonth = (month: string): string => addMonths(month, 1);

/** Months from `start` to `end`, both included. */
export const monthRange = (start: string, end: string): Array<string> => {
  const months: Array<string> = [];
  for (let month = start; month <= end; month = nextMonth(month)) months.push(month);
  return months;
};

export const daysInMonth = (month: string): number =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

export const firstDay = (month: string): string => `${month}-01`;
export const lastDay = (month: string): string => `${month}-${pad(daysInMonth(month))}`;

const toUtc = (day: string) =>
  new Date(
    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))),
  );

const fromUtc = (date: Date) =>
  `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

export const addDays = (day: string, count: number): string => {
  const date = toUtc(day);
  date.setUTCDate(date.getUTCDate() + count);
  return fromUtc(date);
};

/** 0 is Sunday. */
export const weekday = (day: string): number => toUtc(day).getUTCDay();

export const daysBetween = (from: string, to: string): number =>
  Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);

/**
 * The months a budget offers: from three months before the earliest one needed to at least a year
 * after the latest, and up to three months past the latest month anything is budgeted in, capped
 * at five years, as Actual's `getBudgetRange`.
 */
export const budgetRange = (
  earliest: string,
  latest: string,
  latestAllocated: string | null,
): { readonly start: string; readonly end: string } => {
  const first = earliest > latest ? latest : earliest;
  const start = addMonths(first, -3);
  let end = addMonths(latest, 12);
  if (latestAllocated !== null) {
    const planned = addMonths(latestAllocated, 3);
    const cap = addMonths(latest, 60);
    if (planned > end) end = planned < cap ? planned : cap;
  }
  return { start, end };
};

// ---------------------------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------------------------

export type NumberFormatName =
  | "comma-dot"
  | "dot-comma"
  | "space-comma"
  | "apostrophe-dot"
  | "comma-dot-in";

const SEPARATORS: Record<NumberFormatName, { readonly group: string; readonly decimal: string }> = {
  "comma-dot": { group: ",", decimal: "." },
  "dot-comma": { group: ".", decimal: "," },
  "space-comma": { group: " ", decimal: "," },
  "apostrophe-dot": { group: "’", decimal: "." },
  "comma-dot-in": { group: ",", decimal: "." },
};

export interface MoneyFormat {
  readonly numberFormat: NumberFormatName;
  readonly hideFraction: boolean;
}

export const DEFAULT_MONEY_FORMAT: MoneyFormat = { numberFormat: "comma-dot", hideFraction: false };

const groupDigits = (digits: string, group: string, indian: boolean) => {
  if (!indian) return digits.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const last = digits.slice(-3);
  const rest = digits.slice(0, -3);
  return rest === "" ? last : `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, group)}${group}${last}`;
};

/** 123456 as `1,234.56` (or `1.234,56`, ... per the format); -123456 as `-1,234.56`. */
export const formatAmount = (
  amount: number,
  format: MoneyFormat = DEFAULT_MONEY_FORMAT,
): string => {
  const { group, decimal } = SEPARATORS[format.numberFormat];
  const negative = amount < 0;
  const absolute = Math.abs(amount);
  const units = format.hideFraction ? Math.round(absolute / 100) : Math.floor(absolute / 100);
  const whole = groupDigits(String(units), group, format.numberFormat === "comma-dot-in");
  const text = format.hideFraction ? whole : `${whole}${decimal}${pad(absolute % 100)}`;
  return negative ? `-${text}` : text;
};

/**
 * Text a person typed as an amount in minor units: `12.5` is 1250, `-3` is -300, `1,234.56` with
 * the comma-dot format is 123456. Arithmetic is allowed (`12+3.5*2`), as in Actual's amount
 * fields. Null when it does not read as an amount.
 */
export const parseAmount = (
  text: string,
  format: MoneyFormat = DEFAULT_MONEY_FORMAT,
): number | null => {
  const { group, decimal } = SEPARATORS[format.numberFormat];
  let normalized = text.trim().replaceAll(" ", "").replaceAll(" ", "");
  if (normalized === "") return null;
  if (group !== " ") normalized = normalized.replaceAll(group, "");
  if (decimal !== ".") normalized = normalized.replaceAll(decimal, ".");
  const value = evaluateArithmetic(normalized);
  return value === null || !Number.isFinite(value) ? null : Math.round(value * 100);
};

/** Evaluates `+ - * / ( )` over decimal numbers; null on anything else. */
export const evaluateArithmetic = (text: string): number | null => {
  let position = 0;
  const peek = () => text[position];
  const expression = (): number | null => {
    let left = term();
    while (left !== null && (peek() === "+" || peek() === "-")) {
      const op = text[position++];
      const right = term();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };
  const term = (): number | null => {
    let left = factor();
    while (left !== null && (peek() === "*" || peek() === "/")) {
      const op = text[position++];
      const right = factor();
      if (right === null) return null;
      left = op === "*" ? left * right : left / right;
    }
    return left;
  };
  const factor = (): number | null => {
    if (peek() === "-") {
      position++;
      const value = factor();
      return value === null ? null : -value;
    }
    if (peek() === "+") {
      position++;
      return factor();
    }
    if (peek() === "(") {
      position++;
      const value = expression();
      if (peek() !== ")") return null;
      position++;
      return value;
    }
    const match = /^\d*\.?\d+|^\d+\.?/.exec(text.slice(position));
    if (match === null) return null;
    position += match[0].length;
    return Number(match[0]);
  };
  const value = expression();
  return position === text.length ? value : null;
};

// ---------------------------------------------------------------------------------------------
// Budget arithmetic
// ---------------------------------------------------------------------------------------------

export interface BudgetCategoryInput {
  readonly id: string;
  readonly isIncome: boolean;
}

export interface BudgetGroupInput {
  readonly id: string;
  readonly isIncome: boolean;
  readonly categories: ReadonlyArray<BudgetCategoryInput>;
}

/** What a budget is computed from; every lookup answers 0 or false for what is not stored. */
export interface BudgetInputs {
  readonly type: BudgetTypeName;
  /** Consecutive months, first to last. The month before the first starts empty. */
  readonly months: ReadonlyArray<string>;
  readonly groups: ReadonlyArray<BudgetGroupInput>;
  /** A category's activity in a month: negative for spending, positive for income. */
  readonly activity: (month: string, category: string) => number;
  /** Money that came into the budget in a month without an income category: opening balances, transfers in from off-budget accounts (negative when out). */
  readonly otherIncome: (month: string) => number;
  readonly budgeted: (month: string, category: string) => number;
  readonly carryover: (month: string, category: string) => boolean;
  readonly hold: (month: string) => number;
}

export interface CategoryMonthResult {
  readonly id: string;
  readonly budgeted: number;
  readonly spent: number;
  readonly balance: number;
  readonly carryover: boolean;
}

export interface GroupMonthResult {
  readonly id: string;
  readonly budgeted: number;
  readonly spent: number;
  readonly balance: number;
}

export type BudgetSummaryResult =
  | {
      readonly type: "envelope";
      readonly income: number;
      readonly fromLastMonth: number;
      readonly lastMonthOverspent: number;
      readonly totalBudgeted: number;
      readonly hold: number;
      readonly toBudget: number;
      readonly totalSpent: number;
      readonly totalBalance: number;
    }
  | {
      readonly type: "tracking";
      readonly budgetedIncome: number;
      readonly income: number;
      readonly budgetedExpenses: number;
      readonly spent: number;
      readonly budgetedSaved: number;
      readonly saved: number;
    };

export interface MonthResult {
  readonly month: string;
  readonly categories: ReadonlyArray<CategoryMonthResult>;
  readonly groups: ReadonlyArray<GroupMonthResult>;
  readonly summary: BudgetSummaryResult;
}

const sum = (values: Iterable<number>) => {
  let total = 0;
  for (const value of values) total += value;
  return total;
};

/**
 * Every month of a budget, each from the one before, as Actual's envelope and tracking
 * spreadsheets compute them.
 *
 * Envelope: a category's balance is what it was given plus its activity plus last month's
 * balance; a negative balance carries over only when the category rolls overspending over,
 * otherwise it comes out of next month's To Budget. To Budget is income plus last month's To
 * Budget and hold, minus what is assigned, the overspending and this month's hold.
 *
 * Tracking: a category's balance is budgeted plus activity, plus last month's balance when it
 * rolls over; nothing carries between months otherwise.
 */
export const computeBudget = (inputs: BudgetInputs): ReadonlyArray<MonthResult> => {
  const categories = inputs.groups.flatMap((group) => group.categories);
  const expenses = categories.filter((category) => !category.isIncome);
  const incomes = categories.filter((category) => category.isIncome);
  const results: Array<MonthResult> = [];
  let previous: {
    readonly month: string | null;
    readonly balances: ReadonlyMap<string, number>;
    readonly toBudget: number;
    readonly held: number;
  } = { month: null, balances: new Map(), toBudget: 0, held: 0 };

  for (const month of inputs.months) {
    const prevBalance = (id: string) => previous.balances.get(id) ?? 0;
    const prevCarry = (id: string) =>
      previous.month === null ? false : inputs.carryover(previous.month, id);
    const rows = new Map<string, CategoryMonthResult>();

    for (const category of categories) {
      const spent = inputs.activity(month, category.id);
      const carryover = inputs.carryover(month, category.id);
      if (inputs.type === "envelope") {
        if (category.isIncome) {
          rows.set(category.id, { id: category.id, budgeted: 0, spent, balance: spent, carryover });
          continue;
        }
        const budgeted = inputs.budgeted(month, category.id);
        const carried = prevCarry(category.id)
          ? prevBalance(category.id)
          : Math.max(0, prevBalance(category.id));
        rows.set(category.id, {
          id: category.id,
          budgeted,
          spent,
          balance: budgeted + spent + carried,
          carryover,
        });
      } else {
        const budgeted = inputs.budgeted(month, category.id);
        const carried = prevCarry(category.id) ? prevBalance(category.id) : 0;
        const balance = category.isIncome ? budgeted - spent + carried : budgeted + spent + carried;
        rows.set(category.id, { id: category.id, budgeted, spent, balance, carryover });
      }
    }

    const groups = inputs.groups.map((group) => {
      const own = group.categories.map((category) => rows.get(category.id)!);
      return {
        id: group.id,
        budgeted: sum(own.map((row) => row.budgeted)),
        spent: sum(own.map((row) => row.spent)),
        balance: sum(own.map((row) => row.balance)),
      };
    });

    const expenseRows = expenses.map((category) => rows.get(category.id)!);
    const incomeRows = incomes.map((category) => rows.get(category.id)!);
    const categoryIncome = sum(incomeRows.map((row) => row.spent));
    const income = categoryIncome + inputs.otherIncome(month);
    const totalSpent = sum(expenseRows.map((row) => row.spent));
    let summary: BudgetSummaryResult;
    let toBudget = 0;
    let held = 0;

    if (inputs.type === "envelope") {
      const fromLastMonth = previous.toBudget + previous.held;
      const lastMonthOverspent = sum(
        expenses.map((category) =>
          prevCarry(category.id) ? 0 : Math.min(0, prevBalance(category.id)),
        ),
      );
      const totalBudgeted = -sum(expenseRows.map((row) => row.budgeted));
      const autoHold = sum(incomeRows.filter((row) => row.carryover).map((row) => row.spent));
      const manualHold = inputs.hold(month);
      held = manualHold !== 0 ? manualHold : autoHold;
      toBudget = income + fromLastMonth + lastMonthOverspent + totalBudgeted - held;
      summary = {
        type: "envelope",
        income,
        fromLastMonth,
        lastMonthOverspent,
        totalBudgeted,
        hold: held,
        toBudget,
        totalSpent,
        totalBalance: sum(expenseRows.map((row) => row.balance)),
      };
    } else {
      const budgetedIncome = sum(incomeRows.map((row) => row.budgeted));
      const budgetedExpenses = sum(expenseRows.map((row) => row.budgeted));
      summary = {
        type: "tracking",
        budgetedIncome,
        income,
        budgetedExpenses,
        spent: totalSpent,
        budgetedSaved: budgetedIncome - budgetedExpenses,
        saved: income + totalSpent,
      };
    }

    results.push({ month, categories: [...rows.values()], groups, summary });
    previous = {
      month,
      balances: new Map([...rows].map(([id, row]) => [id, row.balance])),
      toBudget,
      held,
    };
  }
  return results;
};

interface TreeNode {
  readonly id: string;
  readonly parentId: string | null;
}

/** How deep each category sits under its group: 0 at the top. */
export const categoryLevels = (categories: ReadonlyArray<TreeNode>): Map<string, number> => {
  const parents = new Map(categories.map((category) => [category.id, category.parentId]));
  const levels = new Map<string, number>();
  const level = (id: string): number => {
    const known = levels.get(id);
    if (known !== undefined) return known;
    const parent = parents.get(id);
    const value = parent == null || !parents.has(parent) ? 0 : level(parent) + 1;
    levels.set(id, value);
    return value;
  };
  for (const category of categories) level(category.id);
  return levels;
};

/** The categories a client shows as hidden: hidden themselves or under a hidden one. */
export const hiddenCategories = (
  categories: ReadonlyArray<TreeNode & { readonly hidden: boolean }>,
): Set<string> => {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const hidden = new Set<string>();
  for (const category of categories) {
    for (let at: (typeof categories)[number] | undefined = category; at;) {
      if (at.hidden) {
        hidden.add(category.id);
        break;
      }
      at = at.parentId === null ? undefined : byId.get(at.parentId);
    }
  }
  return hidden;
};

/** A category and every category under it. */
export const categorySubtree = (categories: ReadonlyArray<TreeNode>, id: string): Set<string> => {
  const children = Map.groupBy(categories, (category) => category.parentId);
  const ids = new Set<string>();
  const visit = (at: string) => {
    ids.add(at);
    for (const child of children.get(at) ?? []) visit(child.id);
  };
  visit(id);
  return ids;
};

export interface RolledUp {
  readonly budgeted: number;
  readonly spent: number;
  readonly balance: number;
}

/**
 * Each category's figures plus its subcategories', for display: a parent's total. Group totals
 * stay the sum of every category's own figures, never of these.
 */
export const rollUpCategories = (
  categories: ReadonlyArray<{ readonly id: string; readonly parentId: string | null }>,
  own: (id: string) => RolledUp | undefined,
): Map<string, RolledUp> => {
  const children = Map.groupBy(categories, (category) => category.parentId);
  const totals = new Map<string, RolledUp>();
  const visit = (id: string): RolledUp => {
    const known = totals.get(id);
    if (known !== undefined) return known;
    const base = own(id) ?? { budgeted: 0, spent: 0, balance: 0 };
    const total = (children.get(id) ?? [])
      .map((child) => visit(child.id))
      .reduce(
        (acc, row) => ({
          budgeted: acc.budgeted + row.budgeted,
          spent: acc.spent + row.spent,
          balance: acc.balance + row.balance,
        }),
        { budgeted: base.budgeted, spent: base.spent, balance: base.balance },
      );
    totals.set(id, total);
    return total;
  };
  for (const category of categories) visit(category.id);
  return totals;
};

/**
 * How much `hold_for_next_month` keeps when asked for `amount`: never more than To Budget gives
 * (what is held now counts as available), never less than nothing.
 */
export const heldAmount = (toBudget: number, held: number, amount: number): number =>
  Math.max(0, Math.min(amount, toBudget + held));

// ---------------------------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------------------------

/** Whether postings balance, as every transaction must. */
export const isBalanced = (amounts: ReadonlyArray<number>): boolean => sum(amounts) === 0;

/** `#tags` written in notes, without the hash, as Actual reads them; `##` escapes one. */
export const tagsIn = (notes: string | null): Array<string> =>
  notes === null ? [] : [...notes.matchAll(/(?<!#)#([^#\s]+)/g)].map((match) => match[1]!);

/**
 * The category a rule sets on a whole transaction, which saving the rule puts on the existing
 * transactions it matches (docs/rules/rules-and-payees.md): its last set-category action, when that names a
 * category outright. Null when it has none, computes it (template or formula), clears it, or the
 * rule splits transactions, whose lines carry the categories.
 */
export const ruleCategory = (actions: ReadonlyArray<RuleAction>): string | null => {
  if (actions.some((action) => "splitIndex" in action && (action.splitIndex ?? 0) > 0)) return null;
  const last = actions.findLast((action) => action.op === "set" && action.field === "category");
  if (last === undefined || last.op !== "set") return null;
  if (last.template !== undefined || last.formula !== undefined) return null;
  return typeof last.value === "string" && last.value !== "" ? last.value : null;
};

/**
 * The conditions that limit which accounts a rule acts on. With "or", another condition can match on
 * any account, so account conditions limit nothing unless every condition is one.
 */
export const accountLimits = <C extends { readonly field: string }>({
  conditions,
  conditionsOp,
}: {
  readonly conditions: ReadonlyArray<C>;
  readonly conditionsOp: string;
}): Array<C> => {
  const limits = conditions.filter((condition) => condition.field === "account");
  return conditionsOp === "and" || limits.length === conditions.length ? limits : [];
};

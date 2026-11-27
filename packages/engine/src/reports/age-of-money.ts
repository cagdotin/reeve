/**
 * Actual's age of money (`age-of-money-spreadsheet.ts`): every inflow to the budget accounts is a
 * lot, every outflow spends the oldest lots first (FIFO), and an outflow's age is the days since
 * the last lot it drew from. The age shown is the average of the last ten outflows.
 */
import type { AgeOfMoneyReport, TimeFrameMode } from "./types.ts";
import {
  addDays,
  daysBetween,
  dayToInt,
  firstDay,
  intToDay,
  lastDay,
  monthOf,
  monthRange,
  today as todayOf,
} from "@reeve/contract/rules";
import type { AccountScope } from "@reeve/contract/catalog";
import type { Book } from "../book.ts";
import { resolveTimeFrame, weekOf } from "./dates.ts";
import {
  allOf,
  inIds,
  queryLines,
  reportFilters,
  scopeIds,
  sqlOf,
  transactionBounds,
  type Condition,
  type ConditionsOp,
  type Where,
} from "./lines.ts";

export type Granularity = "daily" | "weekly" | "monthly";

export interface Flow {
  readonly date: string;
  readonly amount: number;
}

export interface Age {
  readonly date: string;
  readonly age: number;
}

/** Splits flows by sign: inflows (refunds too) add lots, outflows spend them. */
export const classifyFlows = <F extends Flow>(
  flows: ReadonlyArray<F>,
): { income: Array<F>; expenses: Array<F> } => ({
  income: flows.filter((flow) => flow.amount > 0),
  expenses: flows.filter((flow) => flow.amount <= 0),
});

/** Each outflow's age against the income lots it spends, oldest lot first. */
export const calculateAgeOfMoney = (
  income: ReadonlyArray<Flow>,
  expenses: ReadonlyArray<Flow>,
): { ages: Array<Age>; insufficientData: boolean } => {
  const byDate = (a: Flow, b: Flow) => a.date.localeCompare(b.date);
  const lots = income.toSorted(byDate).map((flow) => ({ date: flow.date, left: flow.amount }));
  const ages: Array<Age> = [];
  let lot = 0;
  let insufficientData = false;
  for (const expense of expenses.toSorted(byDate)) {
    let left = Math.abs(expense.amount);
    let lastLot: string | null = null;
    while (left > 0 && lot < lots.length) {
      const current = lots[lot]!;
      if (current.left > 0) {
        const taken = Math.min(current.left, left);
        current.left -= taken;
        left -= taken;
        lastLot = current.date;
      }
      if (current.left <= 0) lot++;
    }
    if (left > 0) insufficientData = true;
    if (lastLot !== null)
      ages.push({ date: expense.date, age: Math.max(0, daysBetween(lastLot, expense.date)) });
  }
  return { ages, insufficientData };
};

/** The rounded average of the last `count` ages, or null without any. */
export const calculateAverageAge = (ages: ReadonlyArray<Age>, count = 10): number | null => {
  if (ages.length === 0) return null;
  const last = ages.slice(-count);
  return Math.round(last.reduce((sum, each) => sum + each.age, 0) / last.length);
};

/** The period a day falls in: the day, its week's Monday, or its month. */
export const periodKey = (day: string, granularity: Granularity): string =>
  granularity === "daily" ? day : granularity === "weekly" ? weekOf(day, 1) : monthOf(day);

export const generatePeriods = (
  start: string,
  end: string,
  granularity: Granularity,
): Array<string> => {
  if (granularity === "monthly") return monthRange(monthOf(start), monthOf(end));
  const periods: Array<string> = [];
  const step = granularity === "daily" ? 1 : 7;
  for (let day = granularity === "daily" ? start : weekOf(start, 1); day <= end;) {
    periods.push(day);
    day = addDays(day, step);
  }
  return periods;
};

/**
 * The average of the last ten ages up to each period, from the first period with an age. Daily and
 * weekly periods stop at today; monthly ones keep the current month.
 */
export const calculateGraphData = (
  ages: ReadonlyArray<Age>,
  startMonth: string,
  endMonth: string,
  granularity: Granularity = "monthly",
  today: string = todayOf(),
): Array<{ date: string; ageOfMoney: number }> => {
  let end = lastDay(endMonth);
  if (granularity !== "monthly" && end > today) end = today;
  const byPeriod = Map.groupBy(ages, (each) => periodKey(each.date, granularity));
  const points: Array<{ date: string; ageOfMoney: number }> = [];
  let upTo: Array<number> = [];
  for (const period of generatePeriods(firstDay(startMonth), end, granularity)) {
    upTo = upTo.concat((byPeriod.get(period) ?? []).map((each) => each.age));
    if (upTo.length > 0) {
      const last = upTo.slice(-10);
      points.push({
        date: period,
        ageOfMoney: Math.round(last.reduce((sum, age) => sum + age, 0) / last.length),
      });
    }
  }
  return points;
};

/** Up or down when the last point moved more than two days from the one before. */
export const calculateTrend = (
  points: ReadonlyArray<{ ageOfMoney: number }>,
): "up" | "down" | "stable" => {
  if (points.length < 2) return "stable";
  const diff = points.at(-1)!.ageOfMoney - points.at(-2)!.ageOfMoney;
  return diff > 2 ? "up" : diff < -2 ? "down" : "stable";
};

const INVERSE: Record<string, string | undefined> = {
  is: "isNot",
  isNot: "is",
  oneOf: "notOneOf",
  notOneOf: "oneOf",
  onBudget: "offBudget",
  offBudget: "onBudget",
  contains: "doesNotContain",
  doesNotContain: "contains",
};

const TRANSFER_ON_BUDGET = "(SELECT on_budget FROM accounts WHERE id = l.transfer_account)";

/** An (inverted) account condition, matched against the transfer's other account. */
const transferAccountSql = (op: string, value: unknown): Where | null => {
  const id = "l.transfer_account";
  switch (op) {
    case "is":
      return sqlOf(`${id} = ?`, String(value));
    case "isNot":
      return sqlOf(`${id} IS NOT ?`, String(value));
    case "oneOf": {
      if (!Array.isArray(value)) return null;
      if (value.length === 0) return sqlOf("0");
      return sqlOf(`${id} IN (${value.map(() => "?").join(", ")})`, ...value.map(String));
    }
    case "notOneOf": {
      if (!Array.isArray(value)) return null;
      if (value.length === 0) return sqlOf(`${id} IS NOT NULL`);
      return sqlOf(`${id} NOT IN (${value.map(() => "?").join(", ")})`, ...value.map(String));
    }
    case "onBudget":
      return sqlOf(`${TRANSFER_ON_BUDGET} = 1`);
    case "offBudget":
      return sqlOf(`${TRANSFER_ON_BUDGET} = 0`);
    case "contains":
      return typeof value === "string"
        ? sqlOf("lower(l.transfer_name) LIKE ?", `%${value.toLowerCase()}%`)
        : null;
    case "doesNotContain":
      return typeof value === "string"
        ? sqlOf("lower(l.transfer_name) NOT LIKE ?", `%${value.toLowerCase()}%`)
        : null;
    default:
      return null;
  }
};

/**
 * Which transfers count, as Actual's `buildTransferInclusionFilter`: those with an off-budget
 * account, and, when the filters pick accounts, those with a budget account the filters leave out
 * (money leaving or entering the filtered accounts).
 */
export const transferInclusion = (
  conditions: ReadonlyArray<Condition>,
  op: ConditionsOp = "and",
): Where => {
  const base = `(l.transfer_account IS NULL OR ${TRANSFER_ON_BUDGET} = 0)`;
  const accounts = conditions.filter((condition) => condition.field === "account");
  if (accounts.length === 0) return sqlOf(base);
  const negations: Array<Where> = [];
  for (const condition of accounts) {
    const inverse = INVERSE[condition.op];
    const clause = inverse === undefined ? null : transferAccountSql(inverse, condition.value);
    if (clause === null) return sqlOf(base);
    negations.push(clause);
  }
  // De Morgan: outside every condition's set (and) means failing any of them, and vice versa.
  const outside = negations.map((each) => `(${each.sql})`).join(op === "and" ? " OR " : " AND ");
  return {
    sql: `(${base} OR (${TRANSFER_ON_BUDGET} = 1 AND (${outside})))`,
    params: negations.flatMap((each) => each.params),
  };
};

export interface AgeOfMoneyInput {
  readonly start?: string;
  readonly end?: string;
  readonly mode?: TimeFrameMode;
  readonly granularity?: Granularity;
  readonly conditions?: ReadonlyArray<Condition>;
  readonly conditionsOp?: ConditionsOp;
  readonly scope?: AccountScope;
}

/**
 * Transfers that cross the scope's edge count as the filters' do: money entering or leaving the
 * accounts the report covers.
 */
const scopedTransfers = (book: Book, input: AgeOfMoneyInput): Where => {
  const inclusion = transferInclusion(input.conditions ?? [], input.conditionsOp);
  const ids = scopeIds(book, input.scope);
  if (ids === undefined) return inclusion;
  const outside = inIds("l.transfer_account", ids);
  return {
    sql: `(${inclusion.sql} OR (${TRANSFER_ON_BUDGET} = 1 AND NOT ${outside.sql}))`,
    params: [...inclusion.params, ...outside.params],
  };
};

export const ageOfMoneyReport = (book: Book, input: AgeOfMoneyInput): AgeOfMoneyReport => {
  const granularity = input.granularity ?? "monthly";
  const { latest } = transactionBounds(book);
  const range = resolveTimeFrame(
    input.start,
    input.end,
    input.mode ?? "static",
    latest === null ? null : intToDay(latest),
  );
  const start = monthOf(range.start);
  const end = monthOf(range.end);
  const day = todayOf();
  const fixedEnd = lastDay(end) > day ? day : lastDay(end);

  // Every flow up to the end: the lots need the whole history.
  const flows = queryLines<{ date: number; amount: number }>(
    book,
    "l.date, l.amount",
    allOf(
      reportFilters(book, input),
      sqlOf("l.date <= ? AND l.on_budget = 1 AND l.amount != 0", dayToInt(fixedEnd)),
      scopedTransfers(book, input),
    ),
    // Actual's order within a day: opening balances last, then the newest first.
    `ORDER BY l.date, (l.category_id IS NULL AND l.category_income = 1),
       (SELECT created_at FROM transactions WHERE id = l.tid) DESC, l.tid`,
  ).map((row) => ({ date: intToDay(row.date), amount: row.amount }));

  const { income, expenses } = classifyFlows(flows);
  const { ages, insufficientData } = calculateAgeOfMoney(income, expenses);
  const shown = ages.filter((each) => each.date >= firstDay(start));
  const points = calculateGraphData(shown, start, end, granularity, day);
  return {
    start: firstDay(start),
    end: lastDay(end),
    granularity,
    points,
    currentAge: calculateAverageAge(shown, 10),
    trend: calculateTrend(points),
    insufficientData,
  };
};

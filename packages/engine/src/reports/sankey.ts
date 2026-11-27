/** Actual's Sankey report: where money came from and went, spent or budgeted, over a range. */
import type { SankeyReport, TimeFrameMode } from "./types.ts";
import type { MonthResult } from "@reeve/contract/rules";
import {
  dayToInt,
  firstDay,
  intToDay,
  lastDay,
  monthOf,
  monthRange,
  nextMonth,
  prevMonth,
  today,
} from "@reeve/contract/rules";
import type { Book } from "../book.ts";
import { computeMonths } from "../budget/view.ts";
import { categoryRows, type CategoryRow } from "./context.ts";
import { resolveTimeFrame } from "./dates.ts";
import {
  allOf,
  queryLines,
  sqlOf,
  transactionBounds,
  whereOf,
  type Condition,
  type ConditionsOp,
} from "./lines.ts";
import {
  aggregateTransferPairs,
  buildSankeyData,
  createBudgetGraph,
  createTransactionsGraph,
  SpecialNodeKeys,
  type CategoryEntry,
  type CategoryGroupOrder,
  type GraphLayer,
  type SortMode,
} from "./sankey-graph.ts";

export type SankeyView = "spent" | "budgeted";

/** Where opening balances flow from in the spent view, as Actual's "Starting Balances" category. */
const STARTING_BALANCES = "starting_balances";
/** Money the budget counts as income without an income category, in the budgeted view. */
const OTHER_INCOME = "other_income";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (month: string) =>
  `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** A month range moved inside the months that have transactions (Actual's `boundMonthRange`). */
export const boundMonthRange = (
  earliest: string,
  latest: string,
  start: string,
  end: string,
): [string, string] => {
  const bound = (month: string) => (month < earliest ? earliest : month > latest ? latest : month);
  const from = bound(start);
  const to = bound(end);
  return [from, to < from ? from : to];
};

/** The layers each view offers: the budget column only when budgeted, payees only when spent. */
export const availableLayers = (view: SankeyView): Array<GraphLayer> =>
  (["payee", "income_category", "account", "budget", "category_group", "category"] as const).filter(
    (layer) => (view === "budgeted" ? layer !== "payee" : layer !== "budget"),
  );

export const defaultLayerRange = (view: SankeyView): { from: GraphLayer; to: GraphLayer } => ({
  from: view === "budgeted" ? "income_category" : "payee",
  to: "category",
});

interface BudgetCategory {
  readonly id: string;
  readonly name: string;
}

interface BudgetGroup {
  readonly id: string;
  readonly name: string;
  readonly isIncome: boolean;
  readonly categories: ReadonlyArray<BudgetCategory>;
}

const matchesString = (id: string, name: string, condition: Condition): boolean => {
  const { op, value } = condition;
  switch (op) {
    case "is":
      return id === value;
    case "isNot":
      return id !== value;
    case "oneOf":
      return Array.isArray(value) && value.includes(id);
    case "notOneOf":
      return !Array.isArray(value) || !value.includes(id);
    case "contains":
      return typeof value === "string" && name.toLowerCase().includes(value.toLowerCase());
    case "doesNotContain":
      return typeof value === "string" && !name.toLowerCase().includes(value.toLowerCase());
    case "matches": {
      if (typeof value !== "string" || value.length > 256) return false;
      try {
        const regex =
          value.startsWith("/") && value.lastIndexOf("/") > 0
            ? new RegExp(value.slice(1, value.lastIndexOf("/")), "i")
            : new RegExp(value, "i");
        return regex.test(name);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
};

/**
 * The budget's groups and categories the category conditions keep (Actual's
 * `filterCategoryGroups`); the budgeted view reads no transactions, so other conditions do not apply.
 */
export const filterCategoryGroups = <G extends BudgetGroup>(
  groups: ReadonlyArray<G>,
  conditions: ReadonlyArray<Condition>,
  op: ConditionsOp,
): Array<G> => {
  const byCategory = conditions.filter((condition) => condition.field === "category");
  const byGroup = conditions.filter((condition) => condition.field === "category_group");
  if (byCategory.length === 0 && byGroup.length === 0) return [...groups];
  const keeps = (category: BudgetCategory, group: G) => {
    const cat = (condition: Condition) => matchesString(category.id, category.name, condition);
    const grp = (condition: Condition) => matchesString(group.id, group.name, condition);
    if (op === "or") return byCategory.some(cat) || byGroup.some(grp);
    return byCategory.every(cat) && byGroup.every(grp);
  };
  return groups
    .map((group) => ({
      ...group,
      categories: group.categories.filter((category) => keeps(category, group)),
    }))
    .filter((group) => group.categories.length > 0);
};

const groupsOf = (rows: ReadonlyArray<CategoryRow>): Array<BudgetGroup> =>
  [...Map.groupBy(rows, (row) => row.group_id).values()].map((own) => ({
    id: own[0]!.group_id,
    name: own[0]!.group_name,
    isIncome: own[0]!.is_income === 1,
    categories: own.map((row) => ({ id: row.id, name: row.name })),
  }));

const budgetedEntries = (
  book: Book,
  start: string,
  end: string,
  rows: ReadonlyArray<CategoryRow>,
  conditions: ReadonlyArray<Condition>,
  op: ConditionsOp,
) => {
  const computed = computeMonths(book, nextMonth(end));
  const months = monthRange(start, end).map((month) => computed.months.get(month));
  const envelope = (result: MonthResult | undefined) =>
    result?.summary.type === "envelope" ? result.summary : undefined;

  const totals = new Map<string, { budgeted: number; spent: number }>();
  let otherIncome = 0;
  const incomeIds = new Set(rows.filter((row) => row.is_income === 1).map((row) => row.id));
  for (const result of months) {
    if (result === undefined) continue;
    let categoryIncome = 0;
    for (const row of result.categories) {
      const total = totals.get(row.id) ?? { budgeted: 0, spent: 0 };
      totals.set(row.id, {
        budgeted: total.budgeted + row.budgeted,
        spent: total.spent + row.spent,
      });
      if (incomeIds.has(row.id)) categoryIncome += row.spent;
    }
    otherIncome += result.summary.income - categoryIncome;
  }

  const filtered = filterCategoryGroups(groupsOf(rows), conditions, op);
  const data: Array<CategoryEntry> = filtered
    .flatMap((group) =>
      group.categories.map((category) => {
        const total = totals.get(category.id) ?? { budgeted: 0, spent: 0 };
        const value = group.isIncome ? total.spent : total.budgeted;
        return {
          categoryGroup: group.name,
          categoryGroupId: group.id,
          category: category.name,
          categoryId: category.id,
          isIncome: group.isIncome,
          isNegative: value < 0,
          value,
        };
      }),
    )
    .filter((entry) => entry.value !== 0);
  const categoryFilters = conditions.some(
    (condition) => condition.field === "category" || condition.field === "category_group",
  );
  if (otherIncome !== 0 && !categoryFilters)
    data.push({
      categoryGroup: "Income",
      categoryGroupId: OTHER_INCOME,
      category: "Other income",
      categoryId: OTHER_INCOME,
      isIncome: true,
      isNegative: otherIncome < 0,
      value: otherIncome,
    });

  const toBudget = envelope(months.at(-1))?.toBudget ?? 0;
  const next = envelope(computed.months.get(nextMonth(end)));
  return {
    data,
    aggregated: {
      toBudget,
      fromPreviousMonth: envelope(months[0])?.fromLastMonth ?? 0,
      lastMonthOverspent: months.reduce(
        (sum, result) => sum + (envelope(result)?.lastMonthOverspent ?? 0),
        0,
      ),
      forNextMonth: (next?.fromLastMonth ?? 0) - toBudget,
      previousMonthLabel: monthLabel(prevMonth(start)),
      nextMonthLabel: monthLabel(nextMonth(end)),
    },
  };
};

const spentEntries = (
  book: Book,
  start: string,
  end: string,
  rows: ReadonlyArray<CategoryRow>,
  conditions: ReadonlyArray<Condition>,
  op: ConditionsOp,
  groupAccounts: boolean,
): Array<CategoryEntry> => {
  const filters = whereOf(conditions, op);
  const inRange = sqlOf(
    "l.date >= ? AND l.date <= ?",
    dayToInt(firstDay(start)),
    dayToInt(lastDay(end)),
  );
  const amounts = queryLines<{
    category_id: string | null;
    account_id: string;
    account_name: string;
    payee_id: string | null;
    payee_name: string | null;
    amount: number;
  }>(
    book,
    `CASE WHEN l.category_id IS NULL THEN '${STARTING_BALANCES}' ELSE l.category_id END AS category_id,
     l.account_id, l.account_name, l.payee_id, l.payee_name, sum(l.amount) AS amount`,
    allOf(
      filters,
      inRange,
      sqlOf(
        "(l.category_id IS NOT NULL OR (l.category_income = 1 AND l.transfer_account IS NULL AND l.on_budget = 1))",
      ),
    ),
    "GROUP BY 1, l.account_id, l.payee_id",
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const sums = new Map<
    string,
    { row: (typeof amounts)[number]; category: CategoryRow | undefined; amount: number }
  >();
  for (const row of amounts) {
    const category = byId.get(row.category_id ?? "");
    if (category === undefined && row.category_id !== STARTING_BALANCES) continue;
    const isIncome = category === undefined || category.is_income === 1;
    // Actual groups expense categories by account alone, income ones by account and payee.
    const key = [row.category_id, row.account_id, isIncome ? (row.payee_id ?? "") : ""].join("|");
    const sum = sums.get(key);
    if (sum === undefined) sums.set(key, { row, category, amount: row.amount });
    else sum.amount += row.amount;
  }
  const entries = [...sums.values()].map(({ row, category, amount }): CategoryEntry => {
    const opening = category === undefined;
    return {
      categoryGroup: category?.group_name ?? "Income",
      categoryGroupId: category?.group_id ?? STARTING_BALANCES,
      category: category?.name ?? "Starting Balances",
      categoryId: row.category_id!,
      value: Math.abs(amount),
      isIncome: opening || category.is_income === 1,
      isNegative: amount < 0,
      accountId: groupAccounts ? SpecialNodeKeys.AllAccounts : row.account_id,
      accountName: groupAccounts ? SpecialNodeKeys.AllAccounts : row.account_name,
      payeeId: row.payee_id ?? (opening ? "starting_balance" : ""),
      payeeName: row.payee_name ?? (opening ? "Starting Balance" : ""),
    };
  });
  // Actual walks the budget's categories in order, each with its rows.
  const order = new Map([...rows.map((row) => row.id), STARTING_BALANCES].map((id, i) => [id, i]));
  return entries.toSorted(
    (a, b) => (order.get(a.categoryId) ?? 0) - (order.get(b.categoryId) ?? 0),
  );
};

const transfers = (
  book: Book,
  start: string,
  end: string,
  conditions: ReadonlyArray<Condition>,
  op: ConditionsOp,
) =>
  aggregateTransferPairs(
    queryLines<{
      tid: string;
      account_id: string;
      account_name: string;
      transfer_account: string;
      amount: number;
    }>(
      book,
      "l.tid, l.account_id, l.account_name, l.transfer_account, l.amount",
      allOf(
        whereOf(conditions, op),
        sqlOf(
          "l.date >= ? AND l.date <= ? AND l.transfer_account IS NOT NULL AND l.on_budget = 1",
          dayToInt(firstDay(start)),
          dayToInt(lastDay(end)),
        ),
      ),
    ).map((row) => ({
      id: `${row.tid}:${row.account_id}`,
      transferId: `${row.tid}:${row.transfer_account}`,
      accountId: row.account_id,
      accountName: row.account_name,
      amount: row.amount,
    })),
  );

export interface SankeyInput {
  readonly start?: string;
  readonly end?: string;
  readonly mode?: TimeFrameMode;
  readonly view?: SankeyView;
  readonly topN?: number;
  readonly categorySort?: SortMode;
  readonly groupAccounts?: boolean;
  readonly showTransfers?: boolean;
  readonly layerFrom?: GraphLayer;
  readonly layerTo?: GraphLayer;
  readonly conditions?: ReadonlyArray<Condition>;
  readonly conditionsOp?: ConditionsOp;
}

export const sankeyReport = (book: Book, input: SankeyInput): SankeyReport => {
  const view = input.view ?? "spent";
  const { earliest, latest } = transactionBounds(book);
  const range = resolveTimeFrame(
    input.start,
    input.end,
    input.mode ?? "static",
    latest === null ? null : intToDay(latest),
  );
  const [start, end] = boundMonthRange(
    monthOf(earliest === null ? today() : intToDay(earliest)),
    monthOf(latest === null ? today() : intToDay(latest)),
    monthOf(range.start),
    monthOf(range.end),
  );
  const conditions = input.conditions ?? [];
  const op = input.conditionsOp ?? "and";
  const groupAccounts = input.groupAccounts ?? false;
  const rows = categoryRows(book);

  const graph =
    view === "budgeted"
      ? (({ data, aggregated }) => createBudgetGraph(data, aggregated))(
          budgetedEntries(book, start, end, rows, conditions, op),
        )
      : createTransactionsGraph(
          spentEntries(book, start, end, rows, conditions, op, groupAccounts),
          input.showTransfers ? transfers(book, start, end, conditions, op) : [],
          groupAccounts,
        );

  const layers = availableLayers(view);
  const fallback = defaultLayerRange(view);
  const from =
    input.layerFrom !== undefined && layers.includes(input.layerFrom)
      ? input.layerFrom
      : fallback.from;
  const to =
    input.layerTo !== undefined && layers.includes(input.layerTo) ? input.layerTo : fallback.to;
  const [layerFrom, layerTo] =
    layers.indexOf(from) < layers.indexOf(to) ? [from, to] : [fallback.from, fallback.to];

  const order: Array<CategoryGroupOrder> = groupsOf(rows);
  const data = buildSankeyData(
    graph,
    Math.max(1, input.topN ?? 15),
    order,
    input.categorySort ?? "per-group",
    layerFrom,
    layerTo,
  );
  return { start, end, view, layerFrom, layerTo, ...data };
};

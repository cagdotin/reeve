/** Actual's custom report engine (`custom-spreadsheet`, `grouped-spreadsheet` and helpers). */
import type { CustomReport, CustomReportResult } from "./types.ts";
import type { AccountScope } from "@reeve/contract/catalog";
import {
  ALL_ACCOUNTS,
  addDays,
  addMonths,
  dayToInt,
  intToDay,
  monthOf,
  monthToInt,
  today,
} from "@reeve/contract/rules";
import { invalid, type Book } from "../book.ts";
import {
  budgetedRows,
  categoryRows,
  filterCategoriesByConditions,
  firstDayOfWeek,
  groupRows,
} from "./context.ts";
import { intervalKey, intervalRange, keyStart, liveRange, quarterOf } from "./dates.ts";
import { allOf, queryLines, reportFilters, sqlOf, transactionBounds } from "./lines.ts";
import { extractTags } from "./tags.ts";

/** A custom report's definition; `run_custom_report` fills what is left out from Actual's default. */
export type Definition = Omit<CustomReport, "id" | "name">;

export const DEFAULT_DEFINITION = (): Definition => ({
  startDate: `${addMonths(monthOf(today()), -5)}-01`,
  endDate: today(),
  isDateStatic: false,
  dateRange: "Last 6 months",
  includeCurrentInterval: true,
  mode: "total",
  groupBy: "Category",
  interval: "Monthly",
  balanceType: "Payment",
  sortBy: "desc",
  showEmpty: false,
  showOffBudget: false,
  showHiddenCategories: true,
  showUncategorized: true,
  trimIntervals: false,
  showTrendLines: false,
  graphType: "BarGraph",
  conditions: [],
  conditionsOp: "and",
});

type BalanceKey = "totalAssets" | "totalDebts" | "totalTotals" | "netAssets" | "netDebts";

const BALANCE: Record<Definition["balanceType"], BalanceKey> = {
  Payment: "totalDebts",
  Deposit: "totalAssets",
  Net: "totalTotals",
  "Net Payment": "netDebts",
  "Net Deposit": "netAssets",
  Budgeted: "totalTotals",
};

type Uncategorized = "other" | "transfer" | "off_budget" | "all";

/** A row of the report: one group's line totals in one interval, as Actual's `QueryDataEntity`. */
interface Row {
  date: string;
  category: string | null;
  categoryHidden: boolean;
  categoryGroup: string | null;
  categoryGroupHidden: boolean;
  account: string;
  accountOffBudget: boolean;
  payee: string | null;
  transferAccount: string | null;
  notes: string | null;
  tagBucket?: string;
  amount: number;
}

interface Item {
  readonly id: string;
  readonly name: string;
  readonly uncategorized?: Uncategorized;
  readonly tagNames?: ReadonlyArray<string>;
  readonly categories?: ReadonlyArray<Item>;
}

type Label = "category" | "categoryGroup" | "payee" | "account" | "tagBucket";

const UNCATEGORIZED: Item = { id: "", name: "Uncategorized", uncategorized: "other" };
const TRANSFERS: Item = { id: "", name: "Transfers", uncategorized: "transfer" };
const OFF_BUDGET: Item = { id: "", name: "Off budget", uncategorized: "off_budget" };

/** Rows that the show options keep, as Actual's `filterReportTransactions`. */
const visible = (rows: ReadonlyArray<Row>, definition: Definition) =>
  rows.filter(
    (row) =>
      (definition.showHiddenCategories || (!row.categoryHidden && !row.categoryGroupHidden)) &&
      (definition.showOffBudget || !row.accountOffBudget) &&
      (definition.showUncategorized || row.category !== null || row.accountOffBudget),
  );

/** The rows an item covers, as Actual's `filterHiddenItems` plus its id match. */
const rowsOf = (
  item: Item,
  rows: ReadonlyArray<Row>,
  label: Label,
  byCategory: boolean,
): Array<Row> =>
  rows.filter((row) => {
    if (byCategory) {
      const offBudget = row.accountOffBudget;
      const transfer = row.transferAccount !== null;
      if (row.category !== null && !offBudget) {
        if (item.uncategorized !== undefined) return false;
      } else {
        switch (item.uncategorized) {
          case "off_budget":
            if (!offBudget) return false;
            break;
          case "transfer":
            if (!(transfer && !offBudget)) return false;
            break;
          case "other":
            if (offBudget || transfer) return false;
            break;
          case "all":
            break;
          default:
            return false;
        }
      }
      if (item.uncategorized !== undefined) return true;
    }
    return row[label] === (item.id === "" ? null : item.id);
  });

interface Totals {
  totalAssets: number;
  totalDebts: number;
  netAssets: number;
  netDebts: number;
  totalTotals: number;
}

type Group = CustomReportResult["groups"][number];
type GroupInterval = Group["intervals"][number];

const net = (total: number) => ({
  netAssets: total > 0 ? total : 0,
  netDebts: total < 0 ? total : 0,
});

/** One item's totals per interval, as Actual's `recalculate`. */
const recalculate = (
  item: Item,
  rows: ReadonlyArray<Row>,
  label: Label,
  byCategory: boolean,
  intervals: ReadonlyArray<string>,
  bounds: (index: number) => { intervalStartDate: string; intervalEndDate: string },
): Group => {
  const mine = rowsOf(item, rows, label, byCategory);
  const assets = new Map<string, number>();
  const debts = new Map<string, number>();
  for (const row of mine) {
    const target = row.amount > 0 ? assets : debts;
    target.set(row.date, (target.get(row.date) ?? 0) + row.amount);
  }
  let totalAssets = 0;
  let totalDebts = 0;
  let last: GroupInterval | null = null;
  const perInterval = intervals.map((date, index): GroupInterval => {
    const intervalAssets = assets.get(date) ?? 0;
    const intervalDebts = debts.get(date) ?? 0;
    totalAssets += intervalAssets;
    totalDebts += intervalDebts;
    const total = intervalAssets + intervalDebts;
    const entry = {
      date,
      totalAssets: intervalAssets,
      totalDebts: intervalDebts,
      ...net(total),
      totalTotals: total,
      change: last === null ? 0 : total - last.totalTotals,
      ...bounds(index),
    };
    last = entry;
    return entry;
  });
  const totalTotals = totalAssets + totalDebts;
  return {
    id: item.id,
    name: item.name,
    uncategorizedId: item.uncategorized ?? null,
    ...(item.tagNames === undefined ? {} : { tagNames: [...item.tagNames] }),
    totalAssets,
    totalDebts,
    ...net(totalTotals),
    totalTotals,
    intervals: perInterval,
  };
};

const shows = (group: Totals, definition: Definition) => {
  if (definition.showEmpty) return true;
  const key = BALANCE[definition.balanceType];
  return key === "totalTotals"
    ? group.totalDebts !== 0 || group.totalAssets !== 0 || group.totalTotals !== 0
    : group[key] !== 0;
};

const comparator = (definition: Definition) => {
  const key = BALANCE[definition.balanceType];
  let sort = definition.sortBy;
  if (key === "totalDebts" || key === "netDebts")
    sort = sort === "asc" ? "desc" : sort === "desc" ? "asc" : sort;
  return (a: Group, b: Group) =>
    sort === "asc"
      ? a[key] - b[key]
      : sort === "desc"
        ? b[key] - a[key]
        : sort === "name"
          ? a.name.localeCompare(b.name)
          : 0;
};

/** The first and last interval with something to show, as Actual's `determineIntervalRange`. */
const intervalBounds = (
  series: ReadonlyArray<ReadonlyArray<Totals>>,
  length: number,
  definition: Definition,
): { start: number; end: number } => {
  if (!definition.trimIntervals || length === 0) return { start: 0, end: length - 1 };
  const key = BALANCE[definition.balanceType];
  let start = length;
  let end = -1;
  for (const intervals of series) {
    const first = intervals.findIndex((interval) => interval[key] !== 0);
    if (first === -1) continue;
    start = Math.min(start, first);
    let last = intervals.length - 1;
    while (last >= 0 && intervals[last]![key] === 0) last--;
    end = Math.max(end, last);
  }
  return start === length || end === -1 ? { start: 0, end: -1 } : { start, end };
};

const tagCollator = new Intl.Collator("en", { numeric: true, sensitivity: "variant" });

/** Puts each row in the bucket of the scope's tags its notes name, as Actual's `tagGroups`. */
const bucketByTags = (
  rows: Array<Row>,
  tags: ReadonlyArray<{ id: string; tag: string }>,
  showEmpty: boolean,
): Array<Item> => {
  const byName = new Map(tags.map((tag) => [tag.tag, tag]));
  const buckets = new Map<string, Item>();
  const bucketOf = (matching: ReadonlyArray<{ id: string; tag: string }>): Item => {
    if (matching.length === 0) return { id: "tag-group:untagged", name: "Untagged", tagNames: [] };
    const sorted = [...matching].sort(
      (a, b) => tagCollator.compare(a.tag, b.tag) || a.id.localeCompare(b.id),
    );
    return {
      id: `tag-group:${sorted.map((tag) => tag.id).join(":")}`,
      name: sorted.map((tag) => `#${tag.tag}`).join(" + "),
      tagNames: sorted.map((tag) => tag.tag),
    };
  };
  if (showEmpty) {
    for (const tag of tags) buckets.set(bucketOf([tag]).id, bucketOf([tag]));
    buckets.set("tag-group:untagged", bucketOf([]));
  }
  for (const row of rows) {
    const bucket = bucketOf(
      extractTags(row.notes ?? "").flatMap((name) => {
        const tag = byName.get(name);
        return tag === undefined ? [] : [tag];
      }),
    );
    buckets.set(bucket.id, bucket);
    row.tagBucket = bucket.id;
  }
  return [...buckets.values()];
};

/** The days a definition covers: its own, or its live range from now. */
export const reportRange = (book: Book, definition: Definition) => {
  if (definition.isDateStatic) return { start: definition.startDate, end: definition.endDate };
  const bounds = transactionBounds(book);
  const earliest = bounds.earliest === null ? today() : intToDay(bounds.earliest);
  const latest = bounds.latest === null ? today() : intToDay(bounds.latest);
  return liveRange(
    definition.dateRange,
    earliest,
    latest,
    definition.includeCurrentInterval,
    firstDayOfWeek(book),
  );
};

/** Runs a custom report definition. */
export const runCustomReport = (
  book: Book,
  definition: Definition,
  scope: AccountScope = ALL_ACCOUNTS,
): CustomReportResult => {
  if (definition.groupBy === "Tag" && definition.balanceType === "Budgeted")
    return invalid("Budgeted reports cannot be split by tags.");
  if (definition.balanceType === "Budgeted" && scope.mode !== "all")
    return invalid("A budgeted report is budget-wide and cannot follow an account scope.");
  const { start, end } = reportRange(book, definition);
  const interval = definition.interval;
  const weekStart = firstDayOfWeek(book);
  const categories = categoryRows(book);
  const groups = groupRows(book);

  // The rows, keyed by interval.
  let rows: Array<Row>;
  if (definition.balanceType === "Budgeted") {
    const kept = filterCategoriesByConditions(
      categories,
      definition.conditions,
      definition.conditionsOp,
    ).filter((category) => category.is_income === 0);
    const byId = new Map(kept.map((category) => [category.id, category]));
    rows = budgetedRows(book, monthToInt(monthOf(start)), monthToInt(monthOf(end))).flatMap(
      (row) => {
        const category = byId.get(row.category_id);
        if (category === undefined) return [];
        const month = `${String(row.month).slice(0, 4)}-${String(row.month).slice(4)}`;
        return [
          {
            date:
              interval === "Yearly"
                ? month.slice(0, 4)
                : interval === "Quarterly"
                  ? quarterOf(month)
                  : month,
            category: category.id,
            categoryHidden: category.hidden === 1,
            categoryGroup: category.group_id,
            categoryGroupHidden: category.group_hidden === 1,
            account: "",
            accountOffBudget: false,
            payee: null,
            transferAccount: null,
            notes: null,
            amount: row.amount,
          },
        ];
      },
    );
  } else {
    // Monthly, quarterly and yearly reports take whole months or years, as Actual's date transform.
    const [from, to] =
      interval === "Yearly"
        ? [`${start.slice(0, 4)}0000`, `${end.slice(0, 4)}9999`]
        : interval === "Monthly" || interval === "Quarterly"
          ? [`${monthOf(start).replace("-", "")}00`, `${monthOf(end).replace("-", "")}99`]
          : [String(dayToInt(start)), String(dayToInt(end))];
    const lines = queryLines<{
      date: number;
      category_id: string | null;
      category_hidden: number;
      group_id: string | null;
      group_hidden: number;
      account_id: string;
      on_budget: number;
      payee_id: string | null;
      transfer_account: string | null;
      notes: string | null;
      assets: number;
      debts: number;
    }>(
      book,
      `l.date, l.category_id, l.category_hidden, l.group_id, l.group_hidden, l.account_id,
       l.on_budget, l.payee_id, l.transfer_account, l.notes,
       sum(CASE WHEN l.amount > 0 THEN l.amount ELSE 0 END) AS assets,
       sum(CASE WHEN l.amount < 0 THEN l.amount ELSE 0 END) AS debts`,
      allOf(
        sqlOf("l.date >= ? AND l.date <= ?", Number(from), Number(to)),
        reportFilters(book, { ...definition, scope }),
      ),
      `GROUP BY l.date, l.account_id, l.payee_id, l.category_id, l.transfer_account${
        definition.groupBy === "Tag" ? ", l.notes" : ""
      }`,
    );
    rows = lines.flatMap((line) => {
      const base = {
        date: intervalKey(intToDay(line.date), interval, weekStart),
        category: line.category_id,
        categoryHidden: line.category_hidden === 1,
        categoryGroup: line.group_id,
        categoryGroupHidden: line.group_hidden === 1,
        account: line.account_id,
        accountOffBudget: line.on_budget === 0,
        // A transfer's payee is the account on the other side, as Actual's transfer payees.
        payee: line.transfer_account !== null ? `transfer:${line.transfer_account}` : line.payee_id,
        transferAccount: line.transfer_account,
        notes: line.notes,
      };
      return [
        ...(line.assets !== 0 ? [{ ...base, amount: line.assets }] : []),
        ...(line.debts !== 0 ? [{ ...base, amount: line.debts }] : []),
      ];
    });
  }

  // What to group by.
  const categoryList: Array<Item> = [
    ...categories.map((category) => ({ id: category.id, name: category.name })),
    UNCATEGORIZED,
    OFF_BUDGET,
    TRANSFERS,
  ];
  const groupList: Array<Item> = [
    ...groups.map((group) => ({
      id: group.id,
      name: group.name,
      categories: categories
        .filter((category) => category.group_id === group.id)
        .map((category) => ({ id: category.id, name: category.name })),
    })),
    {
      id: "uncategorized",
      name: "Uncategorized & Off budget",
      uncategorized: "all",
      categories: [UNCATEGORIZED, TRANSFERS, OFF_BUDGET],
    },
  ];
  let items: Array<Item>;
  let label: Label;
  switch (definition.groupBy) {
    case "Category":
    case "Interval":
      [items, label] = [categoryList, "category"];
      break;
    case "Group":
    case "CategoryGroup":
      [items, label] = [groupList, "categoryGroup"];
      break;
    case "Payee": {
      const payees = book.client
        .prepare("SELECT id, name FROM payees ORDER BY name COLLATE NOCASE")
        .all() as Array<{ id: string; name: string }>;
      const accounts = book.client
        .prepare(
          "SELECT id, name FROM accounts WHERE type IN ('asset', 'liability') ORDER BY sort_order, name",
        )
        .all() as Array<{ id: string; name: string }>;
      items = [
        ...payees,
        ...accounts.map((account) => ({ id: `transfer:${account.id}`, name: account.name })),
      ];
      label = "payee";
      break;
    }
    case "Account":
      items = book.client
        .prepare(
          "SELECT id, name FROM accounts WHERE type IN ('asset', 'liability') ORDER BY sort_order, name",
        )
        .all() as Array<{ id: string; name: string }>;
      label = "account";
      break;
    case "Tag": {
      const tags = book.client.prepare("SELECT id, tag FROM tags").all() as Array<{
        id: string;
        tag: string;
      }>;
      const scope = definition.tagScope;
      const inScope =
        scope === undefined || scope.mode === "all" || scope.tagIds.length === 0
          ? tags
          : scope.tagIds.flatMap((id) => tags.filter((tag) => tag.id === id));
      rows = visible(rows, definition);
      items = bucketByTags(rows, inScope, definition.showEmpty);
      label = "tagBucket";
      break;
    }
  }

  const intervals = intervalRange(start, end, interval, weekStart);
  const bounds = (index: number) => ({
    intervalStartDate: index === 0 ? start : keyStart(intervals[index]!),
    intervalEndDate:
      index + 1 === intervals.length ? end : addDays(keyStart(intervals[index + 1]!), -1),
  });
  const byCategory = label === "category" || label === "categoryGroup";
  const shown = visible(rows, definition);
  const key = BALANCE[definition.balanceType];

  const calculated = items.map((item) =>
    recalculate(item, shown, label, byCategory, intervals, bounds),
  );

  // Every group summed per interval.
  const intervalData = intervals.map((date, index) => {
    let totalAssets = 0;
    let totalDebts = 0;
    let totalTotals = 0;
    const stacked: Record<string, number> = {};
    calculated.forEach((group, i) => {
      const entry = group.intervals[index]!;
      totalAssets += entry.totalAssets;
      totalDebts += entry.totalDebts;
      totalTotals += entry.totalTotals;
      const amount =
        key === "totalAssets"
          ? entry.totalAssets
          : key === "totalDebts"
            ? Math.abs(entry.totalDebts)
            : key === "netAssets"
              ? Math.max(entry.totalTotals, 0)
              : key === "netDebts"
                ? Math.abs(Math.min(entry.totalTotals, 0))
                : entry.totalTotals;
      stacked[items[i]!.id || items[i]!.name] = amount;
    });
    return {
      date,
      totalAssets,
      totalDebts,
      ...net(totalTotals),
      totalTotals,
      ...bounds(index),
      stacked,
    };
  });

  const filtered = calculated.filter((group) => shows(group, definition));
  const range = intervalBounds(
    [...filtered.map((group) => group.intervals), intervalData],
    intervalData.length,
    definition,
  );
  const trim = <T>(list: ReadonlyArray<T>): Array<T> =>
    definition.trimIntervals ? list.slice(range.start, range.end + 1) : [...list];
  const sort = comparator(definition);

  const groupedData: Array<Group> = byCategory
    ? groupList
        .map((item) => ({
          ...recalculate(item, shown, "categoryGroup", true, intervals, bounds),
          categories: (item.categories ?? [])
            .map((category) => recalculate(category, shown, "category", true, intervals, bounds))
            .filter((group) => shows(group, definition)),
        }))
        .filter((group) => shows(group, definition))
    : [];
  const groupedRange = intervalBounds(
    groupedData.flatMap((group) => [
      group.intervals,
      ...(group.categories ?? []).map((category) => category.intervals),
    ]),
    groupedData[0]?.intervals.length ?? 0,
    definition,
  );
  const trimGrouped = <T>(list: ReadonlyArray<T>): Array<T> =>
    definition.trimIntervals ? list.slice(groupedRange.start, groupedRange.end + 1) : [...list];

  const totalAssets = intervalData.reduce((sum, each) => sum + each.totalAssets, 0);
  const totalDebts = intervalData.reduce((sum, each) => sum + each.totalDebts, 0);
  return {
    start,
    end,
    groups: filtered.map((group) => ({ ...group, intervals: trim(group.intervals) })).sort(sort),
    intervals: trim(intervalData),
    groupedData: groupedData
      .map((group) => ({
        ...group,
        intervals: trimGrouped(group.intervals),
        categories: (group.categories ?? [])
          .map((category) => ({ ...category, intervals: trimGrouped(category.intervals) }))
          .sort(sort),
      }))
      .sort(sort),
    totalAssets,
    totalDebts,
    netAssets: intervalData.reduce((sum, each) => sum + each.netAssets, 0),
    netDebts: intervalData.reduce((sum, each) => sum + each.netDebts, 0),
    totalTotals: totalAssets + totalDebts,
  };
};

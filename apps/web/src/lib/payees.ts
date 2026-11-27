import type { PayeeActivity, PayeeOverview } from "@reeve/contract";
import { chosen, type FacetGroup, type FacetValue } from "./facets.ts";
import type { Sort } from "./insights.ts";

export const DEFAULT_MONTHS = 1;

/** How many transactions make a payee a repeat one, as learning needs before it makes a rule. */
const REPEAT = 3;

export type PayeeSortKey = "name" | "category" | "rules" | "transactions" | "spent" | "last";

export type PayeeSort = Sort<PayeeSortKey>;

export const DEFAULT_SORT: PayeeSort = { key: "last", descending: true };

export const DESCENDING_FIRST: ReadonlySet<PayeeSortKey> = new Set([
  "rules",
  "transactions",
  "spent",
  "last",
]);

const byName = (a: PayeeActivity, b: PayeeActivity) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** The value a column sorts on; null has nothing to show and goes last in either direction. */
const SORT_VALUE: Record<PayeeSortKey, (row: PayeeActivity) => string | number | null> = {
  name: (row) => row.name,
  category: (row) => categorySummary(row.categories)?.label ?? null,
  rules: (row) => row.ruleCount,
  transactions: (row) => row.rangeTransactions,
  spent: (row) => row.rangeSpent,
  last: (row) => row.lastTransaction,
};

const compareValues = (a: string | number, b: string | number) =>
  typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b), undefined, { sensitivity: "base" });

export const sortPayees = (rows: ReadonlyArray<PayeeActivity>, { key, descending }: PayeeSort) =>
  rows.toSorted((a, b) => {
    const [left, right] = [SORT_VALUE[key](a), SORT_VALUE[key](b)];
    if (left === null || right === null)
      return Number(left === null) - Number(right === null) || byName(a, b);
    return (descending ? -1 : 1) * compareValues(left, right) || byName(a, b);
  });

/**
 * The category to show for a payee: its only one, or the one most of its transactions use with how
 * many others there are. With no such majority it reads as mixed.
 */
export const categorySummary = (categories: PayeeActivity["categories"]) => {
  const [top] = categories;
  if (top === undefined) return null;
  const total = categories.reduce((sum, each) => sum + each.transactions, 0);
  if (categories.length > 1 && top.transactions * 2 <= total)
    return { label: "Mixed", others: 0, mixed: true };
  return { label: top.name, others: categories.length - 1, mixed: false };
};

const RULE_OPTIONS = [
  { value: "none", label: "No rule", passes: (row: PayeeActivity) => row.ruleCount === 0 },
  { value: "one", label: "One rule", passes: (row: PayeeActivity) => row.ruleCount === 1 },
  { value: "several", label: "Several rules", passes: (row: PayeeActivity) => row.ruleCount > 1 },
  {
    value: "duplicates",
    label: "Duplicate rules",
    passes: (row: PayeeActivity) => row.duplicateRules,
  },
  {
    value: "disagrees",
    label: "Rule disagrees with recent use",
    passes: (row: PayeeActivity) => row.ruleDisagrees,
  },
];

const ACTIVITY_OPTIONS = [
  {
    value: "unused",
    label: "Never used",
    passes: (row: PayeeActivity) => row.transactionCount === 0,
  },
  { value: "once", label: "Used once", passes: (row: PayeeActivity) => row.transactionCount === 1 },
  {
    value: "few",
    label: "Used twice",
    passes: (row: PayeeActivity) => row.transactionCount === 2,
  },
  {
    value: "repeat",
    label: `Used ${REPEAT}+ times`,
    passes: (row: PayeeActivity) => row.transactionCount >= REPEAT,
  },
];

const DETAIL_OPTIONS = [
  { value: "new", label: "New in this range", passes: (row: PayeeActivity) => row.newInRange },
  { value: "favorite", label: "Favorite", passes: (row: PayeeActivity) => row.favorite },
  { value: "scheduled", label: "On a schedule", passes: (row: PayeeActivity) => row.scheduled },
  {
    value: "described",
    label: "Has a description",
    passes: (row: PayeeActivity) => row.description !== null,
  },
  {
    value: "undescribed",
    label: "No description",
    passes: (row: PayeeActivity) => row.description === null,
  },
  {
    value: "not-learning",
    label: "Not learning",
    passes: (row: PayeeActivity) => !row.learnCategories,
  },
];

const STATIC_GROUPS = [
  { id: "rules", label: "Rules", options: RULE_OPTIONS },
  { id: "activity", label: "Use, all time", options: ACTIVITY_OPTIONS },
  { id: "details", label: "Details", options: DETAIL_OPTIONS },
];

/** The filters over the rows at hand, each option with how many rows it would keep. */
export const payeeFilterGroups = (rows: ReadonlyArray<PayeeActivity>): Array<FacetGroup> => {
  const categories = new Map<string, { label: string; count: number }>();
  for (const row of rows)
    for (const { id, name } of row.categories)
      categories.set(id, { label: name, count: (categories.get(id)?.count ?? 0) + 1 });
  return [
    ...STATIC_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      options: group.options
        .map(({ value, label, passes }) => ({
          value,
          label,
          count: rows.filter(passes).length,
        }))
        .filter((option) => option.count > 0),
    })),
    {
      id: "category",
      label: "Category",
      options: [...categories]
        .map(([value, { label, count }]) => ({ value, label, count }))
        .toSorted((a, b) => a.label.localeCompare(b.label)),
    },
  ].filter((group) => group.options.length > 0);
};

/** Whether a row passes the filters: within a group any chosen value, across groups all. */
export const passesFilters = (row: PayeeActivity, filters: FacetValue) => {
  const categories = new Set(chosen(filters, "category"));
  if (categories.size > 0 && !row.categories.some((each) => categories.has(each.id))) return false;
  return STATIC_GROUPS.every(({ id, options }) => {
    const values = new Set(chosen(filters, id));
    return values.size === 0 || options.some((o) => values.has(o.value) && o.passes(row));
  });
};

export const matchesSearch = (row: PayeeActivity, query: string) => {
  const q = query.trim().toLowerCase();
  return (
    q === "" ||
    row.name.toLowerCase().includes(q) ||
    (row.description ?? "").toLowerCase().includes(q)
  );
};

/**
 * The checklist: each check is done while its count is zero, and otherwise carries the filters that
 * list exactly those payees over all time.
 */
export const attentionItems = (attention: PayeeOverview["attention"]) => [
  {
    id: "unused",
    open: "never used",
    done: "No unused payees",
    count: attention.unused,
    filters: { activity: ["unused"] },
  },
  {
    id: "repeat",
    open: `used ${REPEAT}+ times without a rule`,
    done: "Every repeat payee has a rule",
    count: attention.repeatWithoutRule,
    filters: { activity: ["repeat"], rules: ["none"] },
  },
  {
    id: "duplicates",
    open: "with duplicate rules",
    done: "No duplicate rules",
    count: attention.duplicateRules,
    filters: { rules: ["duplicates"] },
  },
  {
    id: "disagrees",
    open: "whose rule disagrees with recent use",
    done: "Rules match recent use",
    count: attention.ruleDisagrees,
    filters: { rules: ["disagrees"] },
  },
];

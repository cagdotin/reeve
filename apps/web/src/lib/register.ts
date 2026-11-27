import type { Account, RegisterRow } from "@reeve/contract";
import type { Rule } from "@reeve/contract/catalog";
import { addDays, daysBetween } from "@reeve/contract/rules";
import type { Output } from "@/lib/api";
import { categoryOptions } from "./categories.ts";
import { chosen, facetCount, type FacetGroup, type FacetValue } from "./facets.ts";
import { monthDays } from "./months.ts";

export type Activity = Output<"account_activity">;

export const PAGE = 200;

/** The register's views besides one account: every account, budget ones, off-budget ones, uncategorized. */
export const VIEWS = {
  all: { title: "All accounts", filter: {} },
  budgeted: { title: "All budget accounts", filter: { onBudget: true } },
  offbudget: { title: "All off-budget accounts", filter: { onBudget: false } },
  uncategorized: { title: "Uncategorized", filter: { uncategorized: true } },
} as const;

export type ViewName = keyof typeof VIEWS;
export const isView = (value: string): value is ViewName => value in VIEWS;

const FILTERS = ["accounts", "categories", "payees", "status"] as const;

/** What a page check can narrow the register to that the Filter menu has no words for. */
export const CHECKS = {
  uncategorized: "Uncategorized",
  stale: "Not cleared for over 30 days",
} as const;
export type Check = keyof typeof CHECKS;

/** Must match `STALE_DAYS` in the engine's `account-activity.ts`. */
const STALE_DAYS = 30;

const isCheck = (value: unknown): value is Check => typeof value === "string" && value in CHECKS;

/** The register's filters, in the address so other pages can link to a filtered register. */
export type RegisterSearch = {
  readonly [Key in (typeof FILTERS)[number]]?: ReadonlyArray<string>;
} & { readonly month?: string; readonly check?: Check };

export const filtersFrom = (source: Readonly<Record<string, unknown>>) => {
  const valid: { [Key in (typeof FILTERS)[number]]?: ReadonlyArray<string> } = {};
  for (const key of FILTERS) {
    const value = source[key];
    if (!Array.isArray(value)) continue;
    const strings = value.filter((each): each is string => typeof each === "string");
    if (strings.length > 0) valid[key] = strings;
  }
  return valid;
};

export const validateRegisterSearch = (search: Record<string, unknown>): RegisterSearch => {
  const month = search["month"];
  const check = search["check"];
  return {
    ...filtersFrom(search),
    ...(typeof month === "string" && /^\d{4}-\d{2}$/.test(month) ? { month } : {}),
    ...(isCheck(check) ? { check } : {}),
  };
};

export const searchFrom = (
  filters: FacetValue,
  month: string | undefined,
  check: Check | undefined,
): RegisterSearch => ({
  ...filtersFrom(filters),
  ...(month === undefined ? {} : { month }),
  ...(check === undefined ? {} : { check }),
});

export const isFiltered = (
  query: string,
  filters: FacetValue,
  month: string | undefined,
  check?: Check,
) => query.trim() !== "" || facetCount(filters) > 0 || month !== undefined || check !== undefined;

export const STATUSES = [
  { value: "uncleared", label: "Not cleared" },
  { value: "cleared", label: "Cleared" },
  { value: "reconciled", label: "Reconciled" },
] as const;

type Status = (typeof STATUSES)[number]["value"];
const isStatus = (value: string): value is Status => STATUSES.some((each) => each.value === value);

const filterInput = (filters: FacetValue) => {
  const accounts = chosen(filters, "accounts");
  const categories = chosen(filters, "categories");
  const payees = chosen(filters, "payees");
  const status = chosen(filters, "status")?.filter(isStatus);
  return {
    ...(accounts === undefined ? {} : { accounts }),
    ...(categories === undefined ? {} : { categories }),
    ...(payees === undefined ? {} : { payees }),
    ...(status === undefined ? {} : { status }),
  };
};

/** What the register lists: the page's account or view, narrowed by the search and filters. */
export const registerInput = (
  param: string,
  query: string,
  filters: FacetValue,
  month: string | undefined,
  check: Check | undefined,
  today: string,
) => {
  const days = month === undefined ? undefined : monthDays(month);
  const staleTo = addDays(today, -(STALE_DAYS + 1));
  return {
    ...(isView(param) ? VIEWS[param].filter : { account: param }),
    ...(query.trim() === "" ? {} : { query: query.trim() }),
    ...(days ?? {}),
    ...filterInput(filters),
    ...(check === "uncategorized" ? { uncategorized: true } : {}),
    ...(check === "stale"
      ? {
          status: ["uncleared" as const],
          to: days !== undefined && days.to < staleTo ? days.to : staleTo,
        }
      : {}),
  };
};

/** The accounts whose balances the page sums: its account, or a view's open accounts. */
export const summedAccounts = (
  view: ViewName | null,
  accounts: ReadonlyArray<Account>,
  account: Account | undefined,
) => {
  if (view === null) return account === undefined ? [] : [account];
  return accounts.filter(
    (each) =>
      !each.closed &&
      (view === "budgeted" ? each.onBudget : view === "offbudget" ? !each.onBudget : true),
  );
};

/** The Filter menu's groups: accounts in a view of several, categories and status. */
export const filterGroups = (
  accounts: ReadonlyArray<Account> | undefined,
  categories: Parameters<typeof categoryOptions>[0],
): Array<FacetGroup> => [
  ...(accounts === undefined
    ? []
    : [
        {
          id: "accounts",
          label: "Account",
          options: accounts.map((each) => ({ value: each.id, label: each.name })),
        },
      ]),
  {
    id: "categories",
    label: "Category",
    options: categoryOptions(categories).map((each) => ({ ...each, hint: each.group })),
  },
  { id: "status", label: "Status", options: STATUSES },
];

/** Whether a filter is on exactly this one value, as a ranked row or a checklist item sets it. */
export const isOnly = (filters: FacetValue, group: string, value: string) => {
  const values = filters[group];
  return values?.length === 1 && values[0] === value;
};

/** Sets a filter to one value, or clears it when that is what it already is. */
export const toggleOnly = (filters: FacetValue, group: string, value: string): FacetValue => {
  const { [group]: _, ...rest } = filters;
  return isOnly(filters, group, value) ? rest : { ...rest, [group]: [value] };
};

export type RegisterLine =
  | { readonly kind: "month"; readonly month: string; readonly rows: ReadonlyArray<RegisterRow> }
  | { readonly kind: "row"; readonly row: RegisterRow };

/** Rows with a divider at each month, newest first; rows of a single month need none. */
export const withMonths = (rows: ReadonlyArray<RegisterRow>): Array<RegisterLine> => {
  const first = rows[0]?.date.slice(0, 7);
  const several = rows.some((row) => row.date.slice(0, 7) !== first);
  const lines: Array<RegisterLine> = [];
  let current: Array<RegisterRow> = [];
  for (const row of rows) {
    const month = row.date.slice(0, 7);
    if (several && month !== current[0]?.date.slice(0, 7)) {
      current = [];
      lines.push({ kind: "month", month, rows: current });
    }
    current.push(row);
    lines.push({ kind: "row", row });
  }
  return lines;
};

/** What the table says with no rows. */
export const emptyWords = (view: ViewName | null, filtered: boolean) =>
  filtered
    ? "No transaction matches."
    : view === "uncategorized"
      ? "Nothing to categorize."
      : "No transactions.";

/** Selected transactions and the account each was picked on: a filter can hide a selected row. */
export type Selection = ReadonlyMap<string, string>;

export const toggleSelected = (selection: Selection, row: RegisterRow): Selection => {
  const next = new Map(selection);
  if (!next.delete(row.transactionId)) next.set(row.transactionId, row.accountId);
  return next;
};

/** These rows added to the selection, or taken out of it when all of them are in it already. */
export const toggleRows = (selection: Selection, rows: ReadonlyArray<RegisterRow>): Selection => {
  const next = new Map(selection);
  if (rows.every((row) => selection.has(row.transactionId)))
    for (const row of rows) next.delete(row.transactionId);
  else
    for (const row of rows)
      if (!next.has(row.transactionId)) next.set(row.transactionId, row.accountId);
  return next;
};

/** All these rows; a transfer shows twice but is one transaction, seen from its first row. */
export const selectRows = (rows: ReadonlyArray<RegisterRow>): Selection => {
  const next = new Map<string, string>();
  for (const row of rows)
    if (!next.has(row.transactionId)) next.set(row.transactionId, row.accountId);
  return next;
};

/** One bulk write, so one undo: a category is a register field, seen from each row's account. */
export const selectionInput = (selection: Selection) => ({
  ids: [...selection.keys()],
  accountOf: [...selection].map(([id, account]) => ({ id, account })),
});

/** What the page's checks ask of `account_activity`; the table's filters do not change it. */
export const activityInput = (param: string, months: number | null, month: string | undefined) => ({
  ...(isView(param) ? VIEWS[param].filter : { account: param }),
  ...(months === null ? {} : { months }),
  ...(month === undefined ? {} : { month }),
});

const RECONCILE_AFTER_DAYS = 45;

/** What an attention item does to the table below it. */
export type AttentionAction =
  | { readonly kind: "check"; readonly check: Check }
  | { readonly kind: "status"; readonly status: "cleared" }
  | { readonly kind: "missed" };

export interface AttentionItem {
  readonly id: string;
  readonly count: number;
  readonly open: string;
  readonly done: string;
  readonly title?: string;
  readonly action: AttentionAction;
}

/**
 * The checks that can apply to this page. Reconciling is checked only for an account that has been
 * reconciled before: someone who never does it should not be nagged for ever. Off budget, nothing
 * needs a category.
 */
export const attentionItems = (
  attention: Activity["attention"],
  scope: {
    readonly view: ViewName | null;
    readonly account: Account | undefined;
    readonly today: string;
    readonly formatDay: (day: string) => string;
  },
): Array<AttentionItem> => {
  const { view, account, today, formatDay } = scope;
  if (view === "uncategorized") return [];
  const budgeted = view === "offbudget" ? false : view !== null || account?.onBudget === true;
  const items: Array<AttentionItem> = [];
  if (budgeted)
    items.push({
      id: "uncategorized",
      count: attention.uncategorized,
      open: "uncategorized",
      done: "Every transaction has a category",
      action: { kind: "check", check: "uncategorized" },
    });
  items.push({
    id: "stale",
    count: attention.oldUncleared,
    open: "not cleared for over 30 days",
    done: "Nothing old is waiting to clear",
    action: { kind: "check", check: "stale" },
  });
  if (view === null && attention.lastReconciled !== null) {
    const days = daysBetween(attention.lastReconciled, today);
    items.push({
      id: "reconcile",
      count: days >= RECONCILE_AFTER_DAYS && attention.toReconcile > 0 ? days : 0,
      open: "days since the last reconciled transaction",
      done: "Reconciled recently",
      title: `Reconciled through ${formatDay(attention.lastReconciled)}. ${attention.toReconcile} cleared since then.`,
      action: { kind: "status", status: "cleared" },
    });
  }
  items.push({
    id: "missed",
    count: attention.missedSchedules,
    open: attention.missedSchedules === 1 ? "missed schedule" : "missed schedules",
    done: "No schedule was missed",
    action: { kind: "missed" },
  });
  return items;
};

/**
 * What the panel shows: a new transaction, a row's as it was when opened, a rule opened from a row,
 * or the category of every selected row.
 */
export type Editing =
  | { readonly kind: "new" }
  | { readonly kind: "selection" }
  | { readonly kind: "row"; readonly row: RegisterRow }
  | { readonly kind: "rule"; readonly rule: Partial<Rule>; readonly back: Editing };

/** The row's current state, or how it was opened once a filter or a change elsewhere drops it from the list. */
export const editedRow = (editing: Editing | null, rows: ReadonlyArray<RegisterRow>) =>
  editing?.kind === "row"
    ? (rows.find((row) => row.postingId === editing.row.postingId) ?? editing.row)
    : undefined;

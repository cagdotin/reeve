import type {
  ItemCategory,
  PricePoint,
  ProductActivity,
  ProductOverview,
} from "@reeve/contract/catalog";
import { dimensionOf, normalizeText, type Unit } from "@reeve/contract/receipts";
import { daysBetween } from "@reeve/contract/rules";
import { chosen, type FacetGroup, type FacetValue } from "./facets.ts";
import type { Sort } from "./insights.ts";
import { displayUnit, UNIT_LABELS } from "./receipts.ts";

export const DEFAULT_MONTHS = 3;

const RANKED = 5;
/** A store's price older than this is history, not where to buy next. */
export const FRESH_DAYS = 180;
/** Past this many stores a chart has no slots left, so the rest draw as one. */
const CHART_STORES = 7;
export const OTHER_STORES = "other";
const NO_STORE = "none";

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

// ---- The table ------------------------------------------------------------------------------

export type ProductSortKey =
  | "name"
  | "category"
  | "price"
  | "change"
  | "purchases"
  | "spent"
  | "last";

export type ProductSort = Sort<ProductSortKey>;

export const DEFAULT_SORT: ProductSort = { key: "spent", descending: true };
export const CHANGE_SORT: ProductSort = { key: "change", descending: true };

export const DESCENDING_FIRST: ReadonlySet<ProductSortKey> = new Set([
  "price",
  "change",
  "purchases",
  "spent",
  "last",
]);

/** The product's latest price per its unit, its kinds' too. */
export const latestPrice = (row: ProductActivity) => row.prices.at(-1)?.price ?? null;

/** The value a column sorts on; null has nothing to show and goes last in either direction. */
const sortValue = (
  row: ProductActivity,
  key: ProductSortKey,
  names: ReadonlyMap<string, string>,
): string | number | null => {
  switch (key) {
    case "name":
      return row.name;
    case "category":
      return row.itemCategoryId === null ? null : (names.get(row.itemCategoryId) ?? null);
    case "price":
      return latestPrice(row);
    case "change":
      return row.change?.changePct ?? null;
    case "purchases":
      return row.rollup.purchases;
    case "spent":
      return row.rollup.spent;
    case "last":
      return row.rollup.lastBought;
  }
};

const compareValues = (a: string | number, b: string | number) =>
  typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b), undefined, { sensitivity: "base" });

export const sortProducts = (
  rows: ReadonlyArray<ProductActivity>,
  { key, descending }: ProductSort,
  categoryNames: ReadonlyMap<string, string> = new Map(),
) =>
  rows.toSorted((a, b) => {
    const [left, right] = [sortValue(a, key, categoryNames), sortValue(b, key, categoryNames)];
    if (left === null || right === null)
      return Number(left === null) - Number(right === null) || byName(a, b);
    return (descending ? -1 : 1) * compareValues(left, right) || byName(a, b);
  });

const PRICE_OPTIONS = [
  {
    value: "dearer",
    label: "Got dearer",
    passes: (row: ProductActivity) => (row.change?.changePct ?? 0) > 0,
  },
  {
    value: "cheaper",
    label: "Got cheaper",
    passes: (row: ProductActivity) => (row.change?.changePct ?? 0) < 0,
  },
  {
    value: "unmeasured",
    label: "Has lines with no unit price",
    passes: (row: ProductActivity) => row.unmeasured > 0,
  },
];

const STATUS_OPTIONS = [
  {
    value: "uncategorized",
    label: "No item category",
    passes: (row: ProductActivity) => row.itemCategoryId === null && row.totalPurchases > 0,
  },
  {
    value: "duplicate",
    label: "Likely duplicate",
    passes: (row: ProductActivity) => row.duplicates.length > 0,
  },
  {
    value: "never",
    label: "Never bought",
    passes: (row: ProductActivity) => row.rollup.totalPurchases === 0,
  },
  { value: "archived", label: "Archived", passes: (row: ProductActivity) => row.archived },
];

const STATIC_GROUPS = [
  { id: "price", label: "Price", options: PRICE_OPTIONS },
  { id: "status", label: "Status", options: STATUS_OPTIONS },
];

export const NO_CATEGORY = "none";

/** The filters over the products at hand, each option with how many it would keep. */
export const productFilterGroups = (
  rows: ReadonlyArray<ProductActivity>,
  categories: ReadonlyArray<ItemCategory>,
): Array<FacetGroup> => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.itemCategoryId ?? NO_CATEGORY;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [
    {
      id: "category",
      label: "Item category",
      options: [
        ...categories.map((each) => ({
          value: each.id,
          label: each.name,
          depth: each.depth,
          count: counts.get(each.id) ?? 0,
        })),
        ...(counts.has(NO_CATEGORY)
          ? [{ value: NO_CATEGORY, label: "No item category", count: counts.get(NO_CATEGORY)! }]
          : []),
      ],
    },
    ...STATIC_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      options: group.options
        .map(({ value, label, passes }) => ({ value, label, count: rows.filter(passes).length }))
        .filter((option) => option.count > 0),
    })),
  ].filter((group) => group.options.length > 0);
};

/** An item category with every one under it, as a filter on it means. */
export const categorySubtree = (
  categories: ReadonlyArray<ItemCategory>,
  id: string,
): ReadonlySet<string> => {
  const ids = new Set([id]);
  for (const category of categories)
    if (category.parentId !== null && ids.has(category.parentId)) ids.add(category.id);
  return ids;
};

/** Whether a product passes: within a group any chosen value, across groups all. */
export const passesFilters = (
  row: ProductActivity,
  filters: FacetValue,
  categories: ReadonlyArray<ItemCategory>,
) => {
  const picked = chosen(filters, "category");
  if (
    picked !== undefined &&
    !picked.some((id) =>
      id === NO_CATEGORY
        ? row.itemCategoryId === null
        : row.itemCategoryId !== null && categorySubtree(categories, id).has(row.itemCategoryId),
    )
  )
    return false;
  return STATIC_GROUPS.every(({ id, options }) => {
    const values = new Set(chosen(filters, id));
    return values.size === 0 || options.some((o) => values.has(o.value) && o.passes(row));
  });
};

export const matchesSearch = (row: ProductActivity, query: string) => {
  const q = normalizeText(query);
  return (
    q === "" || normalizeText(row.name).includes(q) || row.aliases.some((key) => key.includes(q))
  );
};

/** Filters that list archived products as well; otherwise they stay out of the table. */
const showsArchived = (filters: FacetValue) =>
  chosen(filters, "status")?.includes("archived") === true;

export interface TableRow {
  readonly row: ProductActivity;
  readonly depth: number;
  /** It has kinds to fold away; narrowed, the matching ones simply show. */
  readonly folds: boolean;
  readonly open: boolean;
  /** It is here only because a kind of it matched. */
  readonly context: boolean;
}

export interface ProductTable {
  readonly rows: ReadonlyArray<TableRow>;
  /** How many products match, whichever are folded away. */
  readonly matched: number;
}

/**
 * The rows as a tree, sorted within each level. Unnarrowed, a product shows if it or a kind was
 * bought in the range. Narrowed by a search or filter, it shows whenever it matches, in range or
 * not, with what it is a kind of for context and those kinds unfolded.
 */
export const productTable = (
  all: ReadonlyArray<ProductActivity>,
  options: {
    readonly query: string;
    readonly filters: FacetValue;
    readonly categories: ReadonlyArray<ItemCategory>;
    readonly sort: ProductSort;
    readonly open: ReadonlySet<string>;
    /** Whether a range is chosen, rather than all time. */
    readonly ranged: boolean;
    /** Only products whose price moved. */
    readonly moved?: boolean;
  },
): ProductTable => {
  const { query, filters, categories, sort, open, ranged, moved = false } = options;
  const narrowed =
    query.trim() !== "" || Object.values(filters).some((each) => each.length > 0) || moved;
  const archivedToo = showsArchived(filters);
  const names = new Map(categories.map((each) => [each.id, each.name]));
  const ids = new Set(all.map((row) => row.id));
  const kinds = Map.groupBy(all, (row) =>
    row.parentId !== null && ids.has(row.parentId) ? row.parentId : "",
  );
  const passes = (row: ProductActivity) =>
    (archivedToo || !row.archived) &&
    (!moved || row.change !== null) &&
    passesFilters(row, filters, categories) &&
    matchesSearch(row, query) &&
    (narrowed || !ranged || row.rollup.purchases > 0);
  const shows = new Map<string, boolean>();
  const visible = (row: ProductActivity): boolean => {
    const known = shows.get(row.id);
    if (known !== undefined) return known;
    const own = passes(row);
    const result = (kinds.get(row.id) ?? []).map(visible).some(Boolean) || own;
    shows.set(row.id, result);
    return result;
  };
  const rows: Array<TableRow> = [];
  let matched = 0;
  const visit = (level: ReadonlyArray<ProductActivity>, depth: number) => {
    for (const row of sortProducts(level.filter(visible), sort, names)) {
      const under = (kinds.get(row.id) ?? []).filter(visible);
      const isOpen = under.length > 0 && (open.has(row.id) || narrowed);
      rows.push({
        row,
        depth,
        folds: under.length > 0 && !narrowed,
        open: isOpen,
        context: !passes(row),
      });
      if (isOpen) visit(under, depth + 1);
    }
  };
  visit(kinds.get("") ?? [], 0);
  for (const row of all) if (passes(row)) matched += 1;
  return { rows, matched };
};

// ---- Above the table ------------------------------------------------------------------------

/** The range's top products with their kinds in, so no money shows twice; archived ones stay out. */
export const topProducts = (rows: ReadonlyArray<ProductActivity>) => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const hasActiveAbove = (row: ProductActivity) => {
    const seen = new Set([row.id]);
    for (
      let at = row.parentId === null ? undefined : byId.get(row.parentId);
      at !== undefined && !seen.has(at.id);
      at = at.parentId === null ? undefined : byId.get(at.parentId)
    ) {
      if (!at.archived) return true;
      seen.add(at.id);
    }
    return false;
  };
  return rows
    .filter((row) => !row.archived && row.rollup.spent > 0 && !hasActiveAbove(row))
    .toSorted((a, b) => b.rollup.spent - a.rollup.spent || byName(a, b))
    .slice(0, RANKED);
};

/** Products the range hides: bought, themselves or through a kind, only before it. */
export const boughtEarlier = (rows: ReadonlyArray<ProductActivity>) =>
  rows.filter((row) => !row.archived && row.rollup.totalPurchases > 0 && row.rollup.purchases === 0)
    .length;

/** The selected products an Archive or Unarchive changes. */
export const archiveTargets = <Row extends { readonly archived: boolean }>(
  rows: ReadonlyArray<Row>,
  archive: boolean,
) => rows.filter((row) => row.archived !== archive);

export const topCategories = (categories: ProductOverview["categories"]) =>
  categories.filter((each) => each.spent > 0).slice(0, RANKED);

export const CATEGORY_FILTER = (id: string | null): FacetValue => ({
  category: [id ?? NO_CATEGORY],
});

export type AttentionView = "unassigned" | "named";

export interface ProductCheck {
  readonly id: string;
  readonly count: number;
  readonly open: string;
  readonly done: string;
  readonly title?: string;
  /** It opens the unassigned lines; otherwise it filters the table. */
  readonly view?: AttentionView;
  readonly filters?: FacetValue;
}

/** The checklist: each is done at zero, and otherwise says where its products or lines are. */
export const attentionItems = (attention: ProductOverview["attention"]): Array<ProductCheck> => [
  {
    id: "unassigned",
    open: attention.unassigned === 1 ? "line without a product" : "lines without a product",
    done: "Every receipt line has a product",
    count: attention.unassigned,
    view: "unassigned",
  },
  {
    id: "named",
    open:
      attention.named === 1 ? "of them matches a name or alias" : "of them match a name or alias",
    done: "No unassigned line matches a known name or alias",
    title:
      "The line's text is exactly a product's name or alias for its store: one click assigns it.",
    count: attention.named,
    view: "named",
  },
  {
    id: "uncategorized",
    open:
      attention.uncategorized === 1
        ? "bought with no item category"
        : "bought with no item category",
    done: "Every bought product has an item category",
    title: "Their spending lands in “No item category”.",
    count: attention.uncategorized,
    filters: { status: ["uncategorized"] },
  },
  {
    id: "duplicates",
    open: attention.duplicates === 1 ? "likely duplicate" : "likely duplicates",
    done: "No likely duplicates",
    title:
      "Products with the same name, or an alias that names both. An alias naming two products fills in neither.",
    count: attention.duplicates,
    filters: { status: ["duplicate"] },
  },
  {
    id: "unmeasured",
    open:
      attention.unmeasured === 1
        ? "with lines that have no unit price"
        : "with lines that have no unit price",
    done: "Every purchase has a unit price",
    title:
      "A line counted in pieces needs the product's size, and a line in another kind of unit cannot be compared.",
    count: attention.unmeasured,
    filters: { price: ["unmeasured"] },
  },
];

/** A percentage as the page writes it: `+12.4%`. */
export const signedPercent = (percent: number) =>
  `${percent > 0 ? "+" : "−"}${Math.abs(percent).toFixed(Math.abs(percent) < 10 ? 1 : 0)}%`;

/** What a price per the unit reads as, for titles: `2.49 / kg`. */
export const priceText = (
  price: number,
  unit: Unit,
  format: (amount: number) => string,
): string => {
  const shown = displayUnit(unit);
  return `${format(Math.round(price * shown.factor))} / ${shown.label}`;
};

// ---- A sparkline ----------------------------------------------------------------------------

/** The polyline of a price series in a box, its lowest and highest touching the edges. */
export const sparkPoints = (
  prices: ReadonlyArray<number>,
  width: number,
  height: number,
  inset = 2,
): ReadonlyArray<readonly [number, number]> => {
  if (prices.length === 0) return [];
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const step = prices.length === 1 ? 0 : (width - 2 * inset) / (prices.length - 1);
  return prices.map((price, index) => [
    prices.length === 1 ? width - inset : inset + index * step,
    high === low ? height / 2 : inset + ((high - price) / (high - low)) * (height - 2 * inset),
  ]);
};

// ---- Unassigned lines -----------------------------------------------------------------------

export interface LineLike {
  readonly id: string;
  readonly text: string;
  readonly code: string | null;
  readonly date: string;
  readonly lineTotal: number;
  readonly payeeId: string | null;
  readonly payee: string | null;
  readonly suggestions: ReadonlyArray<{ readonly score: number }>;
}

export interface LineGroup<Line extends LineLike> {
  readonly key: string;
  /** The newest line of the group, which assigning acts on; "other lines like it" go with it. */
  readonly line: Line;
  readonly lines: number;
  readonly total: number;
}

/** Lines printed alike at one store as one row, as assigning treats them; the newest first. */
export const groupLines = <Line extends LineLike>(
  lines: ReadonlyArray<Line>,
): Array<LineGroup<Line>> => {
  const groups = new Map<string, { key: string; line: Line; lines: number; total: number }>();
  for (const line of lines) {
    const key = `${line.payeeId}|${normalizeText(line.text)}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { key, line, lines: 1, total: line.lineTotal });
    else {
      group.lines += 1;
      group.total += line.lineTotal;
    }
  }
  return [...groups.values()];
};

export const matchesLine = (line: LineLike, query: string) => {
  const q = query.trim().toLowerCase();
  return (
    q === "" ||
    line.text.toLowerCase().includes(q) ||
    (line.payee ?? "").toLowerCase().includes(q) ||
    (line.code ?? "").toLowerCase().includes(q)
  );
};

// ---- The detail page ------------------------------------------------------------------------

export interface PriceMove {
  readonly latest: PricePoint & { readonly pricePerBase: number };
  /** The purchase before it. */
  readonly previous: number | null;
  /** Every earlier purchase on average. */
  readonly average: number | null;
}

const priced = (points: ReadonlyArray<PricePoint>) =>
  points.filter(
    (point): point is PricePoint & { pricePerBase: number } => (point.pricePerBase ?? 0) > 0,
  );

/**
 * The latest price against the purchase before it and all before it; null with no price yet. Only
 * purchases of the same product count: one kind's price against another's is no price change.
 */
export const priceMove = (points: ReadonlyArray<PricePoint>): PriceMove | null => {
  const all = priced(points);
  const latest = all.at(-1);
  if (latest === undefined) return null;
  const earlier = all.slice(0, -1).filter((point) => point.productId === latest.productId);
  return {
    latest,
    previous: earlier.at(-1)?.pricePerBase ?? null,
    average:
      earlier.length === 0
        ? null
        : earlier.reduce((sum, point) => sum + point.pricePerBase, 0) / earlier.length,
  };
};

/** The latest priced purchase at a store, for which kind a store's latest price is. */
export const latestAt = (points: ReadonlyArray<PricePoint>, payeeId: string | null) =>
  priced(points).findLast((point) => point.payeeId === payeeId);

export const percentFrom = (before: number, now: number) => ((now - before) / before) * 100;

export interface StoreLike {
  readonly payeeId: string | null;
  readonly payee: string | null;
  readonly latest: number;
  readonly latestDate: string;
  readonly average: number;
  readonly purchases: number;
}

export interface BuyAdvice<Store extends StoreLike> {
  /** Where to buy next: the cheapest price seen lately, else the cheapest seen at all. */
  readonly store: Store;
  /** No store has a recent price, so this is the last that is known. */
  readonly stale: boolean;
  /** The next store's latest price among those compared. */
  readonly next: Store | null;
  /** A store cheaper still, whose price is too old to go by. */
  readonly older: Store | null;
  /** No other store has a price at all. */
  readonly only: boolean;
}

/**
 * Where to buy next, from `cheapest_stores` (cheapest latest first). A price from a year ago says
 * little about today, so a recent price wins over an older, lower one, which is still named.
 */
export const buyAdvice = <Store extends StoreLike>(
  stores: ReadonlyArray<Store>,
  today: string,
): BuyAdvice<Store> | null => {
  const [first] = stores;
  if (first === undefined) return null;
  const fresh = (store: Store) => daysBetween(store.latestDate, today) <= FRESH_DAYS;
  const recent = stores.filter(fresh);
  const store = recent[0] ?? first;
  const pool = recent.length > 0 ? recent : stores;
  return {
    store,
    stale: recent.length === 0,
    next: pool[1] ?? null,
    older: first !== store && first.latest < store.latest ? first : null,
    only: stores.length === 1,
  };
};

export interface StoreSeries {
  readonly key: string;
  readonly name: string;
}

/**
 * One row per day with each store's price in the shown unit, for a line per store. Stores keep
 * their order by use so each keeps its colour; those past the slots draw as one line.
 */
export const priceSeries = (points: ReadonlyArray<PricePoint>, unit: Unit) => {
  const { factor } = displayUnit(unit);
  const all = priced(points);
  const uses = new Map<string, { key: string; name: string; count: number }>();
  for (const point of all) {
    const key = point.payeeId ?? NO_STORE;
    const use = uses.get(key) ?? { key, name: point.payee ?? "No store", count: 0 };
    use.count += 1;
    uses.set(key, use);
  }
  const ranked = [...uses.values()].toSorted(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
  const drawn = new Set(ranked.slice(0, CHART_STORES).map((each) => each.key));
  const stores: Array<StoreSeries> = ranked
    .filter((each) => drawn.has(each.key))
    .map(({ key, name }) => ({ key, name }));
  if (ranked.length > CHART_STORES) stores.push({ key: OTHER_STORES, name: "Other stores" });
  const rows = new Map<string, Record<string, number | string>>();
  for (const point of all) {
    const own = point.payeeId ?? NO_STORE;
    const row: Record<string, number | string> = rows.get(point.date) ?? { date: point.date };
    row[drawn.has(own) ? own : OTHER_STORES] = Math.round(point.pricePerBase * factor);
    rows.set(point.date, row);
  }
  return { stores, rows: [...rows.values()] };
};

export type PurchaseSortKey = "date" | "store" | "quantity" | "paid" | "per";
export type PurchaseSort = Sort<PurchaseSortKey>;
export const PURCHASE_SORT: PurchaseSort = { key: "date", descending: true };
export const PURCHASE_DESCENDING: ReadonlySet<PurchaseSortKey> = new Set([
  "date",
  "quantity",
  "paid",
  "per",
]);

const purchaseValue = (point: PricePoint, key: PurchaseSortKey): string | number | null => {
  switch (key) {
    case "date":
      return point.date;
    case "store":
      return point.payee;
    case "quantity":
      return point.quantity;
    case "paid":
      return point.lineTotal;
    case "per":
      return point.pricePerBase;
  }
};

/** Newest last on ties, as they were bought; no price sorts last in either direction. */
export const sortPurchases = (
  points: ReadonlyArray<PricePoint>,
  { key, descending }: PurchaseSort,
) =>
  points.toReversed().toSorted((a, b) => {
    const [left, right] = [purchaseValue(a, key), purchaseValue(b, key)];
    if (left === null || right === null) return Number(left === null) - Number(right === null);
    return (descending ? -1 : 1) * compareValues(left, right);
  });

export const matchesPurchase = (point: PricePoint, query: string) => {
  const q = query.trim().toLowerCase();
  return q === "" || (point.payee ?? "No store").toLowerCase().includes(q);
};

/** How much was bought, in the unit prices read in: `12.5 L`, `24 pc`. */
export const quantityText = (quantity: number, unit: Unit) => {
  const shown = displayUnit(unit);
  const amount = quantity / shown.factor;
  const rounded = Math.round(amount * 10) / 10;
  return `${rounded.toLocaleString()} ${dimensionOf(unit) === "count" ? UNIT_LABELS[unit] : shown.label}`;
};

export interface DeleteRow {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  /** Its own item category, else a parent's. */
  readonly itemCategoryId: string | null;
  /** Its own lines, ever. */
  readonly totalPurchases: number;
}

export interface DeleteFacts {
  readonly count: number;
  /** The lines of the products going. */
  readonly purchases: number;
  /** The lines of the products under them that stay. */
  readonly kindLines: number;
  /** Products that stay and move up. */
  readonly kinds: number;
  readonly parent: string | null;
  /** The lines whose item category changes through a product going. */
  readonly changes: ReadonlyArray<{
    readonly lines: number;
    readonly from: string;
    readonly to: string | null;
  }>;
}

/**
 * What `delete_product` does to the products under those going: each moves up to what is above,
 * and what it inherited goes with them. A product whose category differs from its parent's has
 * its own; one that repeats its parent's reads as inheriting, which the words allow for.
 */
export const deleteFacts = (
  rows: ReadonlyArray<DeleteRow>,
  ids: ReadonlyArray<string>,
  names: ReadonlyMap<string, string>,
): DeleteFacts => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const going = new Set(ids);
  const above = (row: DeleteRow) => {
    const chain: Array<DeleteRow> = [];
    const seen = new Set([row.id]);
    for (
      let at = row.parentId === null ? undefined : byId.get(row.parentId);
      at !== undefined && !seen.has(at.id);
      at = at.parentId === null ? undefined : byId.get(at.parentId)
    ) {
      seen.add(at.id);
      chain.push(at);
    }
    return chain;
  };
  const own = (row: DeleteRow) => {
    const parent = row.parentId === null ? undefined : byId.get(row.parentId);
    return row.itemCategoryId === (parent?.itemCategoryId ?? null) ? null : row.itemCategoryId;
  };
  const changes = new Map<string, { lines: number; from: string; to: string | null }>();
  let kindLines = 0;
  for (const row of rows) {
    if (going.has(row.id) || row.totalPurchases === 0) continue;
    const chain = above(row);
    if (!chain.some((each) => going.has(each.id))) continue;
    kindLines += row.totalPurchases;
    const after =
      [row, ...chain].filter((each) => !going.has(each.id)).find((each) => own(each) !== null)
        ?.itemCategoryId ?? null;
    if (row.itemCategoryId === null || row.itemCategoryId === after) continue;
    const key = `${row.itemCategoryId}|${after}`;
    const change = changes.get(key) ?? {
      lines: 0,
      from: names.get(row.itemCategoryId) ?? "",
      to: after === null ? null : (names.get(after) ?? ""),
    };
    change.lines += row.totalPurchases;
    changes.set(key, change);
  }
  const chosen = rows.filter((row) => going.has(row.id));
  const [only] = chosen;
  return {
    count: chosen.length,
    purchases: chosen.reduce((sum, row) => sum + row.totalPurchases, 0),
    kindLines,
    kinds: rows.filter(
      (row) => !going.has(row.id) && row.parentId !== null && going.has(row.parentId),
    ).length,
    parent:
      chosen.length === 1 && only?.parentId != null
        ? (byId.get(only.parentId)?.name ?? null)
        : null,
    changes: [...changes.values()],
  };
};

const kindLinesSay = (
  { count, kindLines, changes }: DeleteFacts,
  autoApply: boolean,
): Array<string> => {
  if (kindLines === 0) return [];
  const lines = [
    `${plural(kindLines, "purchase line")} on ${count === 1 ? "its" : "their"} kinds ${kindLines === 1 ? "stays on its kind" : "stay on those kinds"}.`,
  ];
  const [first] = changes;
  if (first === undefined) return lines;
  const reach = "Any without an item category of its own";
  if (changes.length > 1) lines.push(`${reach} changes category or loses it.`);
  else if (first.to === null) lines.push(`${reach} loses ${first.from}.`);
  else lines.push(`${reach} changes from ${first.from} to ${first.to}.`);
  if (changes.some((each) => each.to !== null))
    lines.push(
      autoApply
        ? "Auto-apply is on, so where a budget category changes with it, a receipt that was applied, or that this makes ready, is applied again and its transaction's split changes to match."
        : "Where a budget category changes with it, a receipt already applied stops counting as applied until you apply it again. Its transaction stays as it is.",
    );
  if (changes.some((each) => each.to === null))
    lines.push(
      "Where a line is left with no budget category, its receipt stops counting as categorized and applied, and its transaction stays as it is.",
    );
  return lines;
};

/** What deleting products does, every word of it what the engine tests hold `delete_product` to. */
export const deleteConsequences = (
  facts: DeleteFacts & { readonly aliases: number; readonly autoApply: boolean },
): Array<string> => {
  const them = facts.count === 1 ? "it" : "them";
  const lines: Array<string> = [];
  if (facts.purchases > 0)
    lines.push(
      `${plural(facts.purchases, "purchase line")} ${facts.purchases === 1 ? "stays on its receipt with its amount, and goes" : "stay on their receipts with their amounts, and go"} back to the unassigned lines, so ${facts.count === 1 ? "its" : "their"} price history goes.`,
      "A line that took its budget category through the product loses it, unless it has its own. Its receipt then stops counting as categorized and applied, and its transaction stays as it is.",
    );
  else if (facts.kindLines === 0) lines.push(`No receipt line uses ${them}.`);
  lines.push(...kindLinesSay(facts, facts.autoApply));
  if (facts.aliases > 0)
    lines.push(
      `${plural(facts.aliases, "alias", "aliases")} ${facts.aliases === 1 ? "is" : "are"} deleted.`,
    );
  if (facts.kinds > 0) {
    const go = facts.kinds === 1 ? "moves" : "move";
    lines.push(
      facts.count === 1 && facts.parent !== null
        ? `${plural(facts.kinds, "kind")} under it ${go} up to ${facts.parent}.`
        : `${plural(facts.kinds, "kind")} under ${them} ${go} up a level.`,
    );
  }
  lines.push("You can undo this.");
  return lines;
};

/** The ids of the products above this one. */
export const parentsOf = (
  products: ReadonlyArray<{ readonly id: string; readonly parentId: string | null }>,
  id: string,
): ReadonlySet<string> => {
  const parents = new Map(products.map((each) => [each.id, each.parentId]));
  const above = new Set<string>();
  for (
    let at = parents.get(id) ?? null;
    at !== null && !above.has(at);
    at = parents.get(at) ?? null
  )
    above.add(at);
  return above;
};

/** The ids of a product and everything under it, which it cannot merge into. */
export const withKinds = (
  products: ReadonlyArray<{ readonly id: string; readonly parentId: string | null }>,
  id: string,
): ReadonlySet<string> => {
  const ids = new Set([id]);
  const children = Map.groupBy(products, (each) => each.parentId);
  const visit = (at: string) => {
    for (const child of children.get(at) ?? [])
      if (!ids.has(child.id)) {
        ids.add(child.id);
        visit(child.id);
      }
  };
  visit(id);
  return ids;
};

/** Whether merging into `target` leaves lines that its unit cannot measure. */
export const mergeClash = (units: ReadonlyArray<Unit>, target: Unit) =>
  units.some((unit) => dimensionOf(unit) !== dimensionOf(target));

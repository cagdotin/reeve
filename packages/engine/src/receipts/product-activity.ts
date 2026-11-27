/**
 * What products cost: the products page's overview and one product's summary (docs/rules/purchases.md). A
 * line's price is `pricePerBase` as in `prices.ts`, and its share of what its receipt paid is
 * `allocate` as in `item_spending`, so the numbers here add up to that report's.
 */
import {
  allocate,
  baseQuantity,
  isUnit,
  nearestInTree,
  normalizeText,
  pricePerBase,
  words,
  type PricedLine,
  type ProductMeasure,
  type Unit,
} from "@reeve/contract/receipts";
import { addDays, addMonths, daysBetween, intToDay, monthOf } from "@reeve/contract/rules";
import { notFound, type Book } from "../book.ts";
import { currentDay } from "../rules/dates.ts";
import {
  effectiveItemCategory,
  inList,
  loadContext,
  productItemCategory,
  productSubtree,
  type Context,
} from "./context.ts";
import { priceChanges } from "./prices.ts";
import * as r from "./schema.ts";
import type { ReceiptUnit } from "./types.ts";

const TREND_MONTHS = 12;
const RECENT_PRICES = 16;
const LISTED_MOVERS = 5;

const unitOf = (value: string | null): Unit | null =>
  value !== null && isUnit(value) ? value : null;

interface LineRow {
  readonly id: string;
  readonly receipt_id: string;
  readonly total: number;
  readonly date: number;
  readonly payee_id: string | null;
  readonly text: string;
  readonly code: string | null;
  readonly quantity: number;
  readonly unit: string | null;
  readonly line_total: number;
  readonly pack_size: number | null;
  readonly product_id: string | null;
  readonly item_category_id: string | null;
  readonly budget_category_id: string | null;
}

const LINE_COLUMNS = `l.id, l.receipt_id, r.total, r.date, r.payee_id, l.text, l.code, l.quantity,
  l.unit, l.line_total, l.pack_size, l.product_id, l.item_category_id, l.budget_category_id`;
const LINE_ORDER = "ORDER BY r.date, r.created_at, r.id, l.position";

/** Each line's share of what its receipt paid: `lines` holds every line of its receipts. */
const sharesOf = (lines: ReadonlyArray<LineRow>) => {
  const shares = new Map<string, number>();
  for (const own of Map.groupBy(lines, (line) => line.receipt_id).values()) {
    const split = allocate(
      own[0]!.total,
      own.map((line) => line.line_total),
    );
    own.forEach((line, index) => shares.set(line.id, split[index]!));
  }
  return shares;
};

/** How a line of `lineProduct` measures in `productId`'s unit, as `prices.ts` measures it. */
const measureIn = (context: Context, productId: string, lineProduct: string): ProductMeasure => {
  const sized = nearestInTree(
    lineProduct,
    (id) => context.products.get(id)?.parentId,
    (id) => {
      const row = context.products.get(id);
      return row?.size != null && row.sizeUnit != null ? row : null;
    },
  );
  return {
    unit: unitOf(context.products.get(productId)?.unit ?? null) ?? "piece",
    size: sized?.size ?? null,
    sizeUnit: unitOf(sized?.sizeUnit ?? null),
  };
};

const pricedLine = (line: LineRow): PricedLine => ({
  quantity: line.quantity,
  unit: unitOf(line.unit),
  lineTotal: line.line_total,
  packSize: line.pack_size,
});

/** A product and every product above it. */
const lineage = (context: Context, id: string): Array<string> => {
  const ids = [id];
  for (
    let at = context.products.get(id)?.parentId ?? null;
    at !== null && !ids.includes(at);
    at = context.products.get(at)?.parentId ?? null
  )
    ids.push(at);
  return ids;
};

const trendMonths = (today: string) =>
  Array.from({ length: TREND_MONTHS }, (_, index) =>
    addMonths(monthOf(today), index + 1 - TREND_MONTHS),
  );

const addTo = <Key, Value>(map: Map<Key, Set<Value>>, key: Key, value: Value) =>
  map.set(key, (map.get(key) ?? new Set<Value>()).add(value));

type AliasRow = typeof r.productAliases.$inferSelect;

/** Active products likely the same thing: one name once only its words count, or one alias. */
const duplicatesOf = (context: Context, aliases: ReadonlyArray<AliasRow>) => {
  const active = [...context.products.values()].filter((row) => !row.archived);
  const activeIds = new Set(active.map((row) => row.id));
  const groups = new Map<string, Set<string>>();
  for (const row of active) {
    const name = words(row.name).join(" ");
    if (name !== "") addTo(groups, `name|${name}`, row.id);
  }
  for (const alias of aliases)
    if (!alias.rejected && activeIds.has(alias.productId))
      addTo(groups, `alias|${alias.payeeId}|${alias.key}|${alias.code}`, alias.productId);
  const duplicates = new Map<string, Set<string>>();
  for (const ids of groups.values()) {
    if (ids.size < 2) continue;
    for (const id of ids) {
      const above = lineage(context, id);
      // A kind may well share its name with what it is a kind of.
      for (const other of ids)
        if (!above.includes(other) && !lineage(context, other).includes(id))
          addTo(duplicates, id, other);
    }
  }
  return duplicates;
};

/** Tells whether a line's text or code is exactly an active product's name or alias at its store. */
export const namedBy = (context: Context, aliases: ReadonlyArray<AliasRow>) => {
  const names = new Map<string, Set<string>>();
  for (const row of context.products.values())
    if (!row.archived) addTo(names, normalizeText(row.name), row.id);
  const byKey = Map.groupBy(aliases, (alias) => alias.key);
  const byCode = Map.groupBy(
    aliases.filter((alias) => alias.code !== null),
    (alias) => alias.code,
  );
  const seen = new Map<string, boolean>();
  return (line: Pick<LineRow, "text" | "code" | "payee_id">) => {
    const key = normalizeText(line.text);
    const scope = `${line.payee_id}|${key}|${line.code}`;
    const known = seen.get(scope);
    if (known !== undefined) return known;
    const scoped = [
      ...(byKey.get(key) ?? []),
      ...(line.code === null ? [] : (byCode.get(line.code) ?? [])),
    ].filter((alias) => alias.payeeId === null || alias.payeeId === line.payee_id);
    const rejected = new Set(scoped.filter((a) => a.rejected).map((a) => a.productId));
    const named = [
      ...(names.get(key) ?? []),
      ...scoped.filter((a) => !a.rejected).map((a) => a.productId),
    ].some((id) => context.products.get(id)?.archived === false && !rejected.has(id));
    seen.set(scope, named);
    return named;
  };
};

interface Tally {
  spent: number;
  previousSpent: number;
  purchases: number;
  totalPurchases: number;
  lastBought: string | null;
}

const newTally = (): Tally => ({
  spent: 0,
  previousSpent: 0,
  purchases: 0,
  totalPurchases: 0,
  lastBought: null,
});

interface ActivityInput {
  readonly since?: string;
  readonly compareTo?: "previous" | "average";
}

/** `price_changes` itself, without prices that say nothing: a free item or a discount line. */
const moversOf = (book: Book, context: Context, input: ActivityInput, today: string) => {
  const changes = priceChanges(book, {
    ...(input.since === undefined ? {} : { from: input.since }),
    to: today,
    compareTo: input.compareTo ?? "average",
  }).map((change) => ({
    id: change.productId,
    name: change.product,
    unit: change.unit as ReceiptUnit,
    before: change.before,
    latest: change.latest.pricePerBase!,
    changePct: change.changePct,
    date: change.latest.date,
    payee: change.latest.payee,
  }));
  const active = changes.filter((each) => context.products.get(each.id)?.archived === false);
  const dearer = active.filter((each) => each.changePct > 0);
  const cheaper = active.filter((each) => each.changePct < 0);
  return {
    changes: new Map(changes.map((each) => [each.id, each])),
    movers: {
      dearer: dearer.slice(0, LISTED_MOVERS),
      cheaper: cheaper.slice(0, LISTED_MOVERS),
      dearerCount: dearer.length,
      cheaperCount: cheaper.length,
    },
  };
};

export const productActivity = (book: Book, input: ActivityInput) => {
  const today = currentDay();
  const { since } = input;
  const context = loadContext(book);
  const lines = book.client
    .prepare(
      `SELECT ${LINE_COLUMNS} FROM receipts r JOIN receipt_lines l ON l.receipt_id = r.id ${LINE_ORDER}`,
    )
    .all() as unknown as Array<LineRow>;
  const shares = sharesOf(lines);
  const inRange = (day: string) => since === undefined || day >= since;
  const previousSince =
    since === undefined ? null : addDays(since, -(daysBetween(since, today) + 1));
  const inPrevious = (day: string) =>
    previousSince !== null && since !== undefined && day >= previousSince && day < since;

  const own = new Map([...context.products.keys()].map((id) => [id, newTally()]));
  const rolled = new Map([...context.products.keys()].map((id) => [id, newTally()]));
  const prices = new Map<string, Array<{ date: string; price: number }>>();
  const unmeasured = new Map<string, number>();
  const lineages = new Map<string, Array<string>>();
  const measures = new Map<string, ProductMeasure>();

  const months = new Map(
    trendMonths(today).map((month) => [
      month,
      { products: new Set<string>(), spent: 0, purchases: 0, unassigned: 0 },
    ]),
  );
  const totals = { products: new Set<string>(), spent: 0, purchases: 0 };
  const previous = { products: new Set<string>(), spent: 0, purchases: 0 };
  const archived = { products: new Set<string>(), spent: 0 };
  const categories = new Map<
    string,
    { id: string | null; name: string; spent: number; previousSpent: number; lines: number }
  >();
  const unassigned: Array<LineRow> = [];
  let unassignedSpent = 0;

  const count = (tally: Tally, share: number, day: string) => {
    tally.totalPurchases += 1;
    tally.lastBought = day;
    if (inRange(day)) {
      tally.spent += share;
      tally.purchases += 1;
    } else if (inPrevious(day)) tally.previousSpent += share;
  };

  for (const line of lines) {
    const day = intToDay(line.date);
    const share = shares.get(line.id)!;
    const productId = line.product_id;
    const isIn = inRange(day);
    const wasIn = inPrevious(day);
    const month = months.get(monthOf(day));
    if (month !== undefined) {
      month.spent += share;
      month.purchases += 1;
      if (productId !== null) month.products.add(productId);
      else month.unassigned += 1;
    }
    const period = isIn ? totals : wasIn ? previous : null;
    if (period !== null) {
      period.spent += share;
      period.purchases += 1;
      if (productId !== null) period.products.add(productId);
      const category = effectiveItemCategory(context, {
        itemCategoryId: line.item_category_id,
        budgetCategoryId: line.budget_category_id,
        productId,
      });
      const group = categories.get(category ?? "") ?? {
        id: category,
        name:
          category === null
            ? "No item category"
            : (context.itemCategories.get(category)?.name ?? ""),
        spent: 0,
        previousSpent: 0,
        lines: 0,
      };
      if (isIn) {
        group.spent += share;
        group.lines += 1;
      } else group.previousSpent += share;
      categories.set(category ?? "", group);
    }
    if (productId === null) {
      unassigned.push(line);
      if (isIn) unassignedSpent += share;
      continue;
    }
    if (isIn && context.products.get(productId)?.archived === true) {
      archived.products.add(productId);
      archived.spent += share;
    }
    count(own.get(productId)!, share, day);
    const above = lineages.get(productId) ?? lineage(context, productId);
    lineages.set(productId, above);
    for (const id of above) {
      count(rolled.get(id)!, share, day);
      const key = `${id}|${productId}`;
      const measure = measures.get(key) ?? measureIn(context, id, productId);
      measures.set(key, measure);
      const price = pricePerBase(pricedLine(line), measure);
      if (price !== null && price > 0) {
        const series = prices.get(id) ?? [];
        series.push({ date: day, price });
        prices.set(id, series);
      } else if (id === productId && price === null && line.quantity > 0 && line.line_total > 0)
        unmeasured.set(id, (unmeasured.get(id) ?? 0) + 1);
    }
  }

  const { changes, movers } = moversOf(book, context, input, today);
  const aliases = book.db.select().from(r.productAliases).all();
  const duplicates = duplicatesOf(context, aliases);
  const kinds = Map.groupBy(context.products.values(), (row) => row.parentId);
  const aliasKeys = Map.groupBy(
    aliases.filter((alias) => !alias.rejected),
    (alias) => alias.productId,
  );
  const products = [...context.products.values()]
    .toSorted((a, b) => a.name.localeCompare(b.name))
    .map((row) => {
      const tally = own.get(row.id)!;
      const change = changes.get(row.id);
      return {
        id: row.id,
        name: row.name,
        parentId: row.parentId,
        itemCategoryId: productItemCategory(context, row.id),
        unit: (unitOf(row.unit) ?? "piece") as ReceiptUnit,
        size: row.size,
        sizeUnit: unitOf(row.sizeUnit) as ReceiptUnit | null,
        archived: row.archived,
        kinds: kinds.get(row.id)?.length ?? 0,
        spent: tally.spent,
        previousSpent: tally.previousSpent,
        purchases: tally.purchases,
        totalPurchases: tally.totalPurchases,
        rollup: rolled.get(row.id)!,
        prices: (prices.get(row.id) ?? []).slice(-RECENT_PRICES),
        change:
          change === undefined
            ? null
            : {
                before: change.before,
                latest: change.latest,
                changePct: change.changePct,
                date: change.date,
                payee: change.payee,
              },
        unmeasured: unmeasured.get(row.id) ?? 0,
        duplicates: [...(duplicates.get(row.id) ?? [])],
        aliases: (aliasKeys.get(row.id) ?? []).map((alias) => alias.key),
      };
    });

  const isNamed = namedBy(context, aliases);
  const active = products.filter((row) => !row.archived);
  return {
    products,
    earliest: lines[0] === undefined ? null : intToDay(lines[0].date),
    summary: {
      products: totals.products.size,
      spent: totals.spent,
      purchases: totals.purchases,
      unassignedSpent,
      archivedSpent: archived.spent,
      archivedProducts: archived.products.size,
      previous:
        since === undefined
          ? null
          : {
              products: previous.products.size,
              spent: previous.spent,
              purchases: previous.purchases,
            },
    },
    months: [...months].map(([month, sums]) => ({
      month,
      products: sums.products.size,
      spent: sums.spent,
      purchases: sums.purchases,
      unassigned: sums.unassigned,
    })),
    movers,
    categories: [...categories.values()]
      .filter((group) => group.lines > 0)
      .toSorted((a, b) => b.spent - a.spent || a.name.localeCompare(b.name)),
    attention: {
      unassigned: unassigned.length,
      named: unassigned.filter(isNamed).length,
      uncategorized: active.filter((row) => row.itemCategoryId === null && row.totalPurchases > 0)
        .length,
      duplicates: active.filter((row) => row.duplicates.length > 0).length,
      unmeasured: active.filter((row) => row.unmeasured > 0).length,
    },
  };
};

export const productSummary = (book: Book, id: string) => {
  const context = loadContext(book);
  const product = context.products.get(id) ?? notFound("product", id);
  const ids = [...productSubtree(context, id)];
  const lines = book.client
    .prepare(
      `SELECT ${LINE_COLUMNS} FROM receipts r JOIN receipt_lines l ON l.receipt_id = r.id
       WHERE r.id IN (SELECT receipt_id FROM receipt_lines WHERE product_id IN (${inList(ids)}))
       ${LINE_ORDER}`,
    )
    .all(...ids) as unknown as Array<LineRow>;
  const shares = sharesOf(lines);
  const subtree = new Set(ids);
  const mine = lines.filter((line) => line.product_id !== null && subtree.has(line.product_id));
  const children = [...context.products.values()]
    .filter((row) => row.parentId === id)
    .toSorted((a, b) => a.name.localeCompare(b.name));
  const branchOf = new Map(
    children.flatMap((child) =>
      [...productSubtree(context, child.id)].map((each) => [each, child.id] as const),
    ),
  );
  const branches = new Map(children.map((child) => [child.id, newTally()]));
  const months = new Map(
    trendMonths(currentDay()).map((month) => [
      month,
      { month, spent: 0, purchases: 0, quantity: 0 },
    ]),
  );
  let spent = 0;
  let quantity = 0;
  let unmeasured = 0;
  for (const line of mine) {
    const day = intToDay(line.date);
    const share = shares.get(line.id)!;
    const amount = baseQuantity(pricedLine(line), measureIn(context, id, line.product_id!));
    spent += share;
    if (amount === null) unmeasured += 1;
    else quantity += amount;
    const month = months.get(monthOf(day));
    if (month !== undefined) {
      month.spent += share;
      month.purchases += 1;
      month.quantity += amount ?? 0;
    }
    const branch = branches.get(branchOf.get(line.product_id!) ?? "");
    if (branch !== undefined) {
      branch.spent += share;
      branch.purchases += 1;
      branch.lastBought = day;
    }
  }
  const days = [...new Set(mine.map((line) => intToDay(line.date)))];
  const first = days[0] ?? null;
  const last = days.at(-1) ?? null;
  return {
    unit: (unitOf(product.unit) ?? "piece") as ReceiptUnit,
    spent,
    purchases: mine.length,
    firstBought: first,
    lastBought: last,
    intervalDays:
      days.length < 3
        ? null
        : Math.round((daysBetween(first!, last!) / (days.length - 1)) * 10) / 10,
    quantity: Math.round(quantity * 1000) / 1000,
    unmeasured,
    months: [...months.values()].map((month) => ({
      ...month,
      quantity: Math.round(month.quantity * 1000) / 1000,
    })),
    kinds: children.map((child) => {
      const tally = branches.get(child.id)!;
      return {
        id: child.id,
        name: child.name,
        archived: child.archived,
        spent: tally.spent,
        purchases: tally.purchases,
        lastBought: tally.lastBought,
      };
    }),
  };
};

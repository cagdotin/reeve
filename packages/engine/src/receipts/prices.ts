/**
 * Prices over time: each purchase of a product normalised to one of its unit (`pricePerBase` in
 * `contract/src/receipts.ts` says how), price changes, the cheapest store, and item spending.
 */
import {
  allocate,
  isUnit,
  nearestInTree,
  pricePerBase,
  type ProductMeasure,
  type Unit,
} from "@reeve/contract/receipts";
import { addDays, daysBetween, dayToInt, intToDay } from "@reeve/contract/rules";
import type { SQLInputValue } from "node:sqlite";
import { notFound, type Book } from "../book.ts";
import {
  effectiveItemCategory,
  inList,
  itemSubtree,
  loadContext,
  productSubtree,
  type Context,
  type ProductRow,
} from "./context.ts";
import type { PricePoint, ReceiptUnit } from "./types.ts";

interface PurchaseRow {
  readonly line_id: string;
  readonly receipt_id: string;
  readonly product_id: string;
  readonly date: number;
  readonly payee_id: string | null;
  readonly payee: string | null;
  readonly quantity: number;
  readonly unit: string | null;
  readonly unit_price: number | null;
  readonly line_total: number;
  readonly pack_size: number | null;
  readonly created_at: number;
  readonly position: number;
}

const unitOf = (value: string | null): Unit | null =>
  value !== null && isUnit(value) ? value : null;

/** The lines of these products in a range, oldest first. */
const purchases = (
  book: Book,
  productIds: ReadonlyArray<string> | null,
  range: { readonly from?: string; readonly to?: string },
): Array<PurchaseRow> => {
  const where = ["l.product_id IS NOT NULL"];
  const params: Array<SQLInputValue> = [];
  if (productIds !== null) {
    where.push(`l.product_id IN (${inList(productIds)})`);
    params.push(...productIds);
  }
  if (range.from !== undefined) {
    where.push("r.date >= ?");
    params.push(dayToInt(range.from));
  }
  if (range.to !== undefined) {
    where.push("r.date <= ?");
    params.push(dayToInt(range.to));
  }
  return book.client
    .prepare(
      `SELECT l.id AS line_id, r.id AS receipt_id, l.product_id, r.date, r.payee_id, p.name AS payee,
         l.quantity, l.unit, l.unit_price, l.line_total, l.pack_size, r.created_at, l.position
       FROM receipt_lines l JOIN receipts r ON r.id = l.receipt_id
       LEFT JOIN payees p ON p.id = r.payee_id
       WHERE ${where.join(" AND ")}
       ORDER BY r.date, r.created_at, l.position`,
    )
    .all(...params) as unknown as Array<PurchaseRow>;
};

/**
 * How a line of `lineProduct` measures in `product`'s unit: the unit is the product asked about;
 * the size is the line's product's, else the nearest parent product's that has one.
 */
const measure = (context: Context, product: ProductRow, lineProductId: string): ProductMeasure => {
  const sized = nearestInTree(
    lineProductId,
    (id) => context.products.get(id)?.parentId,
    (id) => {
      const row = context.products.get(id);
      return row?.size != null && row.sizeUnit != null ? row : null;
    },
  );
  return {
    unit: unitOf(product.unit) ?? "piece",
    size: sized?.size ?? null,
    sizeUnit: unitOf(sized?.sizeUnit ?? null),
  };
};

const point = (context: Context, product: ProductRow, row: PurchaseRow): PricePoint => ({
  lineId: row.line_id,
  receiptId: row.receipt_id,
  productId: row.product_id,
  date: intToDay(row.date),
  payeeId: row.payee_id,
  payee: row.payee,
  quantity: row.quantity,
  unit: unitOf(row.unit),
  lineTotal: row.line_total,
  unitPrice: row.unit_price,
  pricePerBase: pricePerBase(
    {
      quantity: row.quantity,
      unit: unitOf(row.unit),
      lineTotal: row.line_total,
      packSize: row.pack_size,
    },
    measure(context, product, row.product_id),
  ),
});

const productOf = (context: Context, id: string): ProductRow =>
  context.products.get(id) ?? notFound("product", id);

export const priceHistory = (
  book: Book,
  input: {
    readonly id: string;
    readonly includeChildren?: boolean;
    readonly from?: string;
    readonly to?: string;
  },
) => {
  const context = loadContext(book);
  const product = productOf(context, input.id);
  const ids =
    input.includeChildren === true ? [...productSubtree(context, product.id)] : [product.id];
  return {
    unit: (unitOf(product.unit) ?? "piece") as ReceiptUnit,
    points: purchases(book, ids, input).map((row) => point(context, product, row)),
  };
};

/** Each product's last purchase and how many there are, for product lists. */
export const lastPurchases = (book: Book, context: Context) => {
  const counts = new Map<string, number>();
  const last = new Map<string, PricePoint>();
  for (const row of purchases(book, null, {})) {
    counts.set(row.product_id, (counts.get(row.product_id) ?? 0) + 1);
    const product = context.products.get(row.product_id);
    if (product !== undefined) last.set(row.product_id, point(context, product, row));
  }
  return { counts, last };
};

const average = (values: ReadonlyArray<number>) =>
  values.reduce((total, value) => total + value, 0) / values.length;

const round = (value: number, places = 4) => Math.round(value * 10 ** places) / 10 ** places;

export const priceChanges = (
  book: Book,
  input: {
    readonly from?: string;
    readonly to?: string;
    readonly minChangePct?: number;
    readonly compareTo?: "previous" | "average";
  },
) => {
  const context = loadContext(book);
  const minimum = input.minChangePct ?? 1;
  const byProduct = Map.groupBy(
    purchases(book, null, input.to === undefined ? {} : { to: input.to }),
    (row) => row.product_id,
  );
  return [...byProduct]
    .flatMap(([productId, rows]) => {
      const product = context.products.get(productId);
      if (product === undefined) return [];
      const points = rows
        .map((row) => point(context, product, row))
        .filter((each) => (each.pricePerBase ?? 0) > 0);
      const latest = points.at(-1);
      if (latest === undefined || (input.from !== undefined && latest.date < input.from)) return [];
      const earlier = points.slice(0, -1);
      let before: number | undefined;
      if (input.compareTo === "average") {
        const windowStart =
          input.from === undefined
            ? undefined
            : addDays(input.from, -(daysBetween(input.from, input.to ?? latest.date) + 1));
        const prior = earlier.filter(
          (each) =>
            (input.from === undefined || each.date < input.from) &&
            (windowStart === undefined || each.date >= windowStart),
        );
        before = prior.length === 0 ? undefined : average(prior.map((each) => each.pricePerBase!));
      } else before = earlier.at(-1)?.pricePerBase ?? undefined;
      if (before === undefined) return [];
      const changePct = round(((latest.pricePerBase! - before) / before) * 100, 2);
      if (Math.abs(changePct) < minimum) return [];
      return [
        {
          productId,
          product: product.name,
          unit: (unitOf(product.unit) ?? "piece") as ReceiptUnit,
          latest,
          before: round(before),
          changePct,
        },
      ];
    })
    .toSorted((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
};

export const cheapestStores = (book: Book, id: string) => {
  const context = loadContext(book);
  const product = productOf(context, id);
  const points = purchases(book, [...productSubtree(context, product.id)], {})
    .map((row) => point(context, product, row))
    .filter((each) => (each.pricePerBase ?? 0) > 0);
  return [...Map.groupBy(points, (each) => each.payeeId ?? "")]
    .map(([, group]) => {
      const latest = group.at(-1)!;
      return {
        payeeId: latest.payeeId,
        payee: latest.payee,
        latest: latest.pricePerBase!,
        latestDate: latest.date,
        average: round(average(group.map((each) => each.pricePerBase!))),
        purchases: group.length,
      };
    })
    .toSorted((a, b) => a.latest - b.latest || a.average - b.average);
};

interface SpendingLine {
  readonly receipt_id: string;
  readonly total: number;
  readonly payee_id: string | null;
  readonly payee: string | null;
  readonly line_id: string;
  readonly line_total: number;
  readonly product_id: string | null;
  readonly item_category_id: string | null;
  readonly budget_category_id: string | null;
}

/**
 * Line totals in a range grouped by item category, product or store. With `allocate` each
 * receipt's total (what was paid) is spread over its lines by their totals, so the adjustments
 * travel with the items and the groups add up to what was paid.
 */
export const itemSpending = (
  book: Book,
  input: {
    readonly from?: string;
    readonly to?: string;
    readonly groupBy: "item_category" | "product" | "store";
    readonly allocate?: boolean;
    readonly payeeId?: string;
    readonly itemCategoryId?: string;
  },
) => {
  const context = loadContext(book);
  const where = ["1 = 1"];
  const params: Array<SQLInputValue> = [];
  if (input.from !== undefined) {
    where.push("r.date >= ?");
    params.push(dayToInt(input.from));
  }
  if (input.to !== undefined) {
    where.push("r.date <= ?");
    params.push(dayToInt(input.to));
  }
  if (input.payeeId !== undefined) {
    where.push("r.payee_id = ?");
    params.push(input.payeeId);
  }
  const rows = book.client
    .prepare(
      `SELECT r.id AS receipt_id, r.total, r.payee_id, p.name AS payee, l.id AS line_id,
         l.line_total, l.product_id, l.item_category_id, l.budget_category_id
       FROM receipts r JOIN receipt_lines l ON l.receipt_id = r.id
       LEFT JOIN payees p ON p.id = r.payee_id
       WHERE ${where.join(" AND ")} ORDER BY r.date, r.id, l.position`,
    )
    .all(...params) as unknown as Array<SpendingLine>;
  const amounts = new Map<string, number>();
  for (const lines of Map.groupBy(rows, (row) => row.receipt_id).values()) {
    const shares =
      input.allocate === false
        ? lines.map((line) => line.line_total)
        : allocate(
            lines[0]!.total,
            lines.map((line) => line.line_total),
          );
    lines.forEach((line, index) => amounts.set(line.line_id, shares[index]!));
  }
  const subtree =
    input.itemCategoryId === undefined ? null : itemSubtree(context, input.itemCategoryId);
  const groups = new Map<
    string,
    { id: string | null; name: string; amount: number; lines: number }
  >();
  let total = 0;
  for (const row of rows) {
    const itemCategory = effectiveItemCategory(context, {
      itemCategoryId: row.item_category_id,
      budgetCategoryId: row.budget_category_id,
      productId: row.product_id,
    });
    if (subtree !== null && (itemCategory === null || !subtree.has(itemCategory))) continue;
    const [id, name] =
      input.groupBy === "store"
        ? [row.payee_id, row.payee ?? "No store"]
        : input.groupBy === "product"
          ? [
              row.product_id,
              row.product_id === null
                ? "No product"
                : (context.products.get(row.product_id)?.name ?? ""),
            ]
          : [
              itemCategory,
              itemCategory === null
                ? "No item category"
                : (context.itemCategories.get(itemCategory)?.name ?? ""),
            ];
    const amount = amounts.get(row.line_id) ?? 0;
    const group = groups.get(id ?? "") ?? { id, name, amount: 0, lines: 0 };
    group.amount += amount;
    group.lines += 1;
    groups.set(id ?? "", group);
    total += amount;
  }
  return {
    groups: [...groups.values()].toSorted(
      (a, b) => b.amount - a.amount || a.name.localeCompare(b.name),
    ),
    total,
  };
};

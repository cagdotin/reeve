/**
 * The receipts module's tables (docs/rules/purchases.md). They point at the ledger (`transactions`,
 * `payees`, category `accounts`) by id; the ledger's tables never point back. Money is minor units,
 * a day the integer YYYYMMDD, as in the ledger.
 */
import {
  type AnySQLiteColumn,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { accounts, payees, transactions } from "../db/schema.ts";

const id = () => text("id").primaryKey();
const flag = (name: string) => integer(name, { mode: "boolean" }).notNull().default(false);

/**
 * What an item is (Dairy, Produce, Cleaning): a tree of any depth, apart from the budget's
 * categories. `budget_category_id` is where an item's money goes by default.
 */
export const itemCategories = sqliteTable(
  "item_categories",
  {
    id: id(),
    name: text("name").notNull(),
    parentId: text("parent_id").references((): AnySQLiteColumn => itemCategories.id),
    budgetCategoryId: text("budget_category_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    hidden: flag("hidden"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("item_categories_parent").on(table.parentId)],
);

/**
 * A thing bought, apart from how any receipt prints it. `unit` is what its prices are normalised
 * to; `size` and `size_unit` say what one piece of a packaged product holds.
 */
export const products = sqliteTable(
  "products",
  {
    id: id(),
    name: text("name").notNull(),
    /** A more generic product: "Milk" above "Brand X Organic 1L". */
    parentId: text("parent_id").references((): AnySQLiteColumn => products.id),
    itemCategoryId: text("item_category_id").references(() => itemCategories.id, {
      onDelete: "set null",
    }),
    unit: text("unit").notNull().default("piece"),
    size: real("size"),
    sizeUnit: text("size_unit"),
    notes: text("notes"),
    archived: flag("archived"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("products_parent").on(table.parentId)],
);

/**
 * Receipt text as a store prints it, naming a product. `payee_id` null means any store. A
 * `rejected` alias remembers that this text is not that product, so it is never suggested again.
 */
export const productAliases = sqliteTable(
  "product_aliases",
  {
    id: id(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    payeeId: text("payee_id").references(() => payees.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    /** `text` trimmed, spaces collapsed, lower case: what lines match by. */
    key: text("key").notNull(),
    code: text("code"),
    packSize: real("pack_size"),
    rejected: flag("rejected"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("product_aliases_key").on(table.key),
    index("product_aliases_code").on(table.code),
    index("product_aliases_product").on(table.productId),
  ],
);

export const receipts = sqliteTable(
  "receipts",
  {
    id: id(),
    payeeId: text("payee_id").references(() => payees.id, { onDelete: "set null" }),
    date: integer("date").notNull(),
    /** `HH:MM` as printed. */
    time: text("time"),
    /** What was paid, in minor units; negative for a refund. */
    total: integer("total").notNull(),
    notes: text("notes"),
    /** An agent's idempotency key: creating with a known one returns that receipt. */
    externalId: text("external_id"),
    /** Its last apply came from the autoApplyReceipts setting, not from a person. */
    autoApplied: flag("auto_applied"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("receipts_date").on(table.date),
    index("receipts_payee").on(table.payeeId),
    uniqueIndex("receipts_external_id").on(table.externalId),
  ],
);

/** One printed line: a permanent purchase fact with a stable id. */
export const receiptLines = sqliteTable(
  "receipt_lines",
  {
    id: id(),
    receiptId: text("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    text: text("text").notNull(),
    code: text("code"),
    quantity: real("quantity").notNull().default(1),
    unit: text("unit"),
    /** Minor units per unit; may hold fractions of a cent (3.459 a litre is 345.9). */
    unitPrice: real("unit_price"),
    /** Signed minor units: negative for a returned item or a line discount. */
    lineTotal: integer("line_total").notNull(),
    /** Product units one counted item holds, from the alias that named the product. */
    packSize: real("pack_size"),
    productId: text("product_id").references(() => products.id, { onDelete: "set null" }),
    itemCategoryId: text("item_category_id").references(() => itemCategories.id, {
      onDelete: "set null",
    }),
    /** Overrides the budget category the item category gives. */
    budgetCategoryId: text("budget_category_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
  },
  (table) => [
    index("receipt_lines_receipt").on(table.receiptId),
    index("receipt_lines_product").on(table.productId),
  ],
);

/** Tax, discounts, coupons, tips, deposits, fees and rounding: signed amounts on the receipt. */
export const receiptAdjustments = sqliteTable(
  "receipt_adjustments",
  {
    id: id(),
    receiptId: text("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: text("kind").notNull(),
    amount: integer("amount").notNull(),
    description: text("description"),
  },
  (table) => [index("receipt_adjustments_receipt").on(table.receiptId)],
);

/** How much of a receipt a ledger transaction pays; many to many. */
export const receiptPayments = sqliteTable(
  "receipt_payments",
  {
    id: id(),
    receiptId: text("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("receipt_payments_pair").on(table.receiptId, table.transactionId),
    index("receipt_payments_transaction").on(table.transactionId),
  ],
);

/** A photo's file in `<home>/receipts/<book>/<receipt>/`, and what it was when attached. */
export const receiptPhotos = sqliteTable(
  "receipt_photos",
  {
    id: id(),
    receiptId: text("receipt_id")
      .notNull()
      .references(() => receipts.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("receipt_photos_receipt").on(table.receiptId)],
);

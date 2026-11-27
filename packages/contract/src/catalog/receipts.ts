/**
 * Receipts (docs/rules/purchases.md): itemized receipts that reconcile with bank transactions, products and
 * their prices over time, and item categories. Agents add receipts through these operations; reeve
 * reads no image and calls no model.
 */
import { Schema } from "effect";
import { Amount, Day, Id, Transaction } from "../domain.ts";
import { BookField, IdField, cli, inBook, type Operation } from "../operation.ts";
import { RECEIPT_STAGES, UNITS } from "../receipts.ts";

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

/** A unit of the fixed set: counts (`pack` is a piece), masses and volumes. */
export const ReceiptUnit = Schema.Literals(UNITS).annotate({
  description: "piece, pack, g, kg, ml, l, oz, lb or fl_oz",
});
export type ReceiptUnit = typeof ReceiptUnit.Type;

export const AdjustmentKind = Schema.Literals([
  "tax",
  "discount",
  "coupon",
  "tip",
  "deposit",
  "fee",
  "rounding",
  "other",
]);
export type AdjustmentKind = typeof AdjustmentKind.Type;

const Time = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "Use a time such as 14:05" }),
  ),
);

const nullable = <S extends Schema.Top>(schema: S, description: string) =>
  Schema.optionalKey(Schema.NullOr(schema)).annotate({ description });
const optional = <S extends Schema.Top>(schema: S, description: string) =>
  Schema.optionalKey(schema).annotate({ description });

export const ReceiptLine = Schema.Struct({
  id: Id,
  receiptId: Id,
  position: Schema.Int,
  /** As printed. */
  text: Schema.String,
  code: Schema.NullOr(Schema.String),
  quantity: Schema.Number,
  unit: Schema.NullOr(ReceiptUnit),
  /** Minor units per unit, fractions allowed. */
  unitPrice: Schema.NullOr(Schema.Number),
  lineTotal: Amount,
  /** quantity × unitPrice rounded half away from zero; null without a unit price. */
  computedTotal: Schema.NullOr(Amount),
  packSize: Schema.NullOr(Schema.Number),
  productId: Schema.NullOr(Id),
  product: Schema.NullOr(Schema.String),
  itemCategoryId: Schema.NullOr(Id),
  budgetCategoryId: Schema.NullOr(Id),
  notes: Schema.NullOr(Schema.String),
  /** The line's item category, else its product's (or a parent product's). */
  effectiveItemCategoryId: Schema.NullOr(Id),
  /** The line's budget category, else the nearest item category's up the tree; null: unresolved. */
  effectiveBudgetCategoryId: Schema.NullOr(Id),
  effectiveBudgetCategory: Schema.NullOr(Schema.String),
});
export type ReceiptLine = typeof ReceiptLine.Type;

export const ReceiptAdjustment = Schema.Struct({
  id: Id,
  position: Schema.Int,
  kind: AdjustmentKind,
  amount: Amount,
  description: Schema.NullOr(Schema.String),
});
export type ReceiptAdjustment = typeof ReceiptAdjustment.Type;

export const ReceiptPayment = Schema.Struct({
  transactionId: Id,
  /** How much of the receipt this transaction pays. */
  amount: Amount,
  date: Day,
  /** The account it is paid from; null if the transaction became a transfer between two. */
  accountId: Schema.NullOr(Id),
  account: Schema.NullOr(Schema.String),
  payee: Schema.NullOr(Schema.String),
  /** The transaction's register amount: negative for a payment. */
  transactionAmount: Amount,
  /** The transaction's postings carry this receipt's split. */
  applied: Schema.Boolean,
});
export type ReceiptPayment = typeof ReceiptPayment.Type;

export const ReceiptPhoto = Schema.Struct({
  id: Id,
  receiptId: Id,
  position: Schema.Int,
  fileName: Schema.String,
  mimeType: Schema.String,
  size: Schema.Int,
  sha256: Schema.String,
  /** The file on this computer. */
  path: Schema.String,
  /** False when the file is gone from the receipts folder. */
  exists: Schema.Boolean,
});
export type ReceiptPhoto = typeof ReceiptPhoto.Type;

/** Computed on every read, never stored. */
export const ReceiptStatus = Schema.Struct({
  itemsTotal: Amount,
  adjustmentsTotal: Amount,
  expectedTotal: Amount,
  /** total − expectedTotal. */
  difference: Amount,
  /** |difference| ≤ 1 cent. */
  balanced: Schema.Boolean,
  paidAmount: Amount,
  /** Linked payments add up to the total. */
  matched: Schema.Boolean,
  /** Every line resolves to a budget category (and there is a line). */
  categorized: Schema.Boolean,
  /** Every linked transaction carries the receipt's split. */
  applied: Schema.Boolean,
  lineCount: Schema.Int,
  unassignedLines: Schema.Int,
  uncategorizedLines: Schema.Int,
});
export type ReceiptStatus = typeof ReceiptStatus.Type;

/** The open problems `receipt_activity` counts and `list_receipts` lists, one to one. */
export const RECEIPT_CHECKS = [
  "off",
  "no_lines",
  "no_payment",
  "uncategorized_lines",
  "unapplied",
  "line_mismatch",
  "old",
] as const;
export type ReceiptCheck = (typeof RECEIPT_CHECKS)[number];

export const RECEIPT_SORTS = ["date", "store", "lines", "total", "progress"] as const;
export type ReceiptSort = (typeof RECEIPT_SORTS)[number];

export const ReceiptWarning = Schema.Struct({
  code: Schema.Literals(["line_total_mismatch", "unbalanced", "unpaid", "overpaid"]),
  message: Schema.String,
  lineId: Schema.NullOr(Id),
});
export type ReceiptWarning = typeof ReceiptWarning.Type;

const ReceiptHeader = {
  id: Id,
  payeeId: Schema.NullOr(Id),
  payee: Schema.NullOr(Schema.String),
  date: Day,
  time: Schema.NullOr(Schema.String),
  total: Amount,
  notes: Schema.NullOr(Schema.String),
  externalId: Schema.NullOr(Schema.String),
  /** Milliseconds since the epoch. */
  createdAt: Schema.Int,
};

export const Receipt = Schema.Struct({
  ...ReceiptHeader,
  lines: Schema.Array(ReceiptLine),
  adjustments: Schema.Array(ReceiptAdjustment),
  payments: Schema.Array(ReceiptPayment),
  photos: Schema.Array(ReceiptPhoto),
  status: ReceiptStatus,
  /** It is applied, and the autoApplyReceipts setting applied it rather than a person. */
  autoApplied: Schema.Boolean,
  warnings: Schema.Array(ReceiptWarning),
});
export type Receipt = typeof Receipt.Type;

export const ReceiptSummary = Schema.Struct({
  ...ReceiptHeader,
  photoCount: Schema.Int,
  transactionIds: Schema.Array(Id),
  status: ReceiptStatus,
});
export type ReceiptSummary = typeof ReceiptSummary.Type;

export const MatchCandidate = Schema.Struct({
  transactionId: Id,
  date: Day,
  accountId: Id,
  account: Schema.String,
  payeeId: Schema.NullOr(Id),
  payee: Schema.NullOr(Schema.String),
  /** Register amount: negative for a payment. */
  amount: Amount,
  /** What other receipts already claim of it, as money paid out. */
  claimed: Amount,
  /** Days from the receipt to the transaction; negative before. */
  days: Schema.Int,
  /** 0 to 1; amount weighs half, date and payee a quarter each. */
  score: Schema.Number,
  amountMatch: Schema.Literals(["exact", "tip"]),
  /** Whether auto_match_receipts would link it: exact, within 3 days, same or similar payee. */
  sure: Schema.Boolean,
  reasons: Schema.Array(Schema.String),
});
export type MatchCandidate = typeof MatchCandidate.Type;

export const ItemCategory = Schema.Struct({
  id: Id,
  name: Schema.String,
  parentId: Schema.NullOr(Id),
  budgetCategoryId: Schema.NullOr(Id),
  /** Its own budget category, else the nearest ancestor's. */
  effectiveBudgetCategoryId: Schema.NullOr(Id),
  hidden: Schema.Boolean,
  sortOrder: Schema.Int,
  /** 0 at the top. */
  depth: Schema.Int,
});
export type ItemCategory = typeof ItemCategory.Type;

export const LastPrice = Schema.Struct({
  date: Day,
  payeeId: Schema.NullOr(Id),
  payee: Schema.NullOr(Schema.String),
  lineTotal: Amount,
  quantity: Schema.Number,
  unit: Schema.NullOr(ReceiptUnit),
  /** Minor units per one of the product's unit; null when the line cannot be measured in it. */
  pricePerBase: Schema.NullOr(Schema.Number),
});

export const Product = Schema.Struct({
  id: Id,
  name: Schema.String,
  parentId: Schema.NullOr(Id),
  itemCategoryId: Schema.NullOr(Id),
  /** Its own item category, else a parent product's. */
  effectiveItemCategoryId: Schema.NullOr(Id),
  unit: ReceiptUnit,
  size: Schema.NullOr(Schema.Number),
  sizeUnit: Schema.NullOr(ReceiptUnit),
  notes: Schema.NullOr(Schema.String),
  archived: Schema.Boolean,
  purchaseCount: Schema.Int,
  lastPrice: Schema.NullOr(LastPrice),
});
export type Product = typeof Product.Type;

export const ProductAlias = Schema.Struct({
  id: Id,
  productId: Id,
  product: Schema.String,
  /** The store; null for any store. */
  payeeId: Schema.NullOr(Id),
  payee: Schema.NullOr(Schema.String),
  /** As printed. */
  text: Schema.String,
  /** What lines match by: trimmed, spaces collapsed, lower case. */
  key: Schema.String,
  code: Schema.NullOr(Schema.String),
  packSize: Schema.NullOr(Schema.Number),
  rejected: Schema.Boolean,
});
export type ProductAlias = typeof ProductAlias.Type;

export const ProductSuggestion = Schema.Struct({
  productId: Id,
  product: Schema.String,
  /** 0 to 1; 1 for an exact alias. */
  score: Schema.Number,
  reason: Schema.Literals(["alias", "store-alias", "code", "name", "alias-text"]),
  /** The name or alias text that matched. */
  matched: Schema.String,
});
export type ProductSuggestion = typeof ProductSuggestion.Type;

export const PricePoint = Schema.Struct({
  lineId: Id,
  receiptId: Id,
  productId: Id,
  date: Day,
  payeeId: Schema.NullOr(Id),
  payee: Schema.NullOr(Schema.String),
  quantity: Schema.Number,
  unit: Schema.NullOr(ReceiptUnit),
  lineTotal: Amount,
  unitPrice: Schema.NullOr(Schema.Number),
  /** Minor units per one of the product's unit; null when the line cannot be measured in it. */
  pricePerBase: Schema.NullOr(Schema.Number),
});
export type PricePoint = typeof PricePoint.Type;

/** A product in a range: its own lines, and with the products under it in `rollup`. */
export const ProductActivity = Schema.Struct({
  id: Id,
  name: Schema.String,
  parentId: Schema.NullOr(Id),
  /** Its own item category, else a parent product's. */
  itemCategoryId: Schema.NullOr(Id),
  unit: ReceiptUnit,
  size: Schema.NullOr(Schema.Number),
  sizeUnit: Schema.NullOr(ReceiptUnit),
  archived: Schema.Boolean,
  /** Products directly under it. */
  kinds: Schema.Int,
  /** Its own lines' share of what their receipts paid, as item_spending allocates it. */
  spent: Amount,
  previousSpent: Amount,
  /** Its own lines in the range. */
  purchases: Schema.Int,
  /** Its own lines, ever. */
  totalPurchases: Schema.Int,
  /** The product and those under it, so a parent's row counts its kinds once. */
  rollup: Schema.Struct({
    spent: Amount,
    previousSpent: Amount,
    purchases: Schema.Int,
    totalPurchases: Schema.Int,
    lastBought: Schema.NullOr(Day),
  }),
  /** Recent prices per its unit, its kinds' too, oldest first; unmeasurable lines are left out. */
  prices: Schema.Array(Schema.Struct({ date: Day, price: Schema.Number })),
  /** Its own latest price against the reference, as price_changes reads it; null if unmoved. */
  change: Schema.NullOr(
    Schema.Struct({
      before: Schema.Number,
      latest: Schema.Number,
      changePct: Schema.Number,
      date: Day,
      payee: Schema.NullOr(Schema.String),
    }),
  ),
  /** Its own lines that cannot be measured in its unit, so have no price. */
  unmeasured: Schema.Int,
  /** Active products that are likely the same thing: the same name, or an alias naming both. */
  duplicates: Schema.Array(Id),
  /** Its aliases that are not rejected, normalized, so a search can find it by them. */
  aliases: Schema.Array(Schema.String),
});
export type ProductActivity = typeof ProductActivity.Type;

export const ProductMover = Schema.Struct({
  id: Id,
  name: Schema.String,
  unit: ReceiptUnit,
  before: Schema.Number,
  latest: Schema.Number,
  changePct: Schema.Number,
  date: Day,
  payee: Schema.NullOr(Schema.String),
});
export type ProductMover = typeof ProductMover.Type;

const ProductActivityTotals = Schema.Struct({
  /** Distinct products with a line in the range. */
  products: Schema.Int,
  /** Every line, assigned or not: item_spending's total for the same days. */
  spent: Amount,
  /** Lines in the range. */
  purchases: Schema.Int,
});

export const ProductOverview = Schema.Struct({
  /** Every product, bought or not, with its figures for the range. */
  products: Schema.Array(ProductActivity),
  /** First day with a line, assigned or not. */
  earliest: Schema.NullOr(Day),
  summary: Schema.Struct({
    ...ProductActivityTotals.fields,
    /** Of `spent`, what lines without a product took. */
    unassignedSpent: Amount,
    /** Of `spent`, what archived products took, and how many of `products` they are. */
    archivedSpent: Amount,
    archivedProducts: Schema.Int,
    /** The same days before the range; null over all time. */
    previous: Schema.NullOr(ProductActivityTotals),
  }),
  months: Schema.Array(
    Schema.Struct({
      ...ProductActivityTotals.fields,
      month: Schema.String,
      unassigned: Schema.Int,
    }),
  ),
  /** Active products whose latest price rose or fell: the largest five and how many in all. */
  movers: Schema.Struct({
    dearer: Schema.Array(ProductMover),
    cheaper: Schema.Array(ProductMover),
    dearerCount: Schema.Int,
    cheaperCount: Schema.Int,
  }),
  /** Spending in the range by each line's effective item category; null id is none. */
  categories: Schema.Array(
    Schema.Struct({
      id: Schema.NullOr(Id),
      name: Schema.String,
      spent: Amount,
      previousSpent: Amount,
      lines: Schema.Int,
    }),
  ),
  /** Open problems across the book, whatever the range. */
  attention: Schema.Struct({
    /** Lines without a product. */
    unassigned: Schema.Int,
    /** Of those, lines whose text or code is exactly a product's name or an alias. */
    named: Schema.Int,
    /** Active products with lines and no item category. */
    uncategorized: Schema.Int,
    /** Active products in a likely duplicate. */
    duplicates: Schema.Int,
    /** Active products with lines that cannot be measured in their unit. */
    unmeasured: Schema.Int,
  }),
});
export type ProductOverview = typeof ProductOverview.Type;

export const ProductSummary = Schema.Struct({
  unit: ReceiptUnit,
  /** All these are the product with those under it, ever. */
  spent: Amount,
  purchases: Schema.Int,
  firstBought: Schema.NullOr(Day),
  lastBought: Schema.NullOr(Day),
  /** Average days between days bought; null with fewer than three such days. */
  intervalDays: Schema.NullOr(Schema.Number),
  /** How much was bought, in `unit`, over lines that can be measured in it. */
  quantity: Schema.Number,
  unmeasured: Schema.Int,
  months: Schema.Array(
    Schema.Struct({
      month: Schema.String,
      spent: Amount,
      purchases: Schema.Int,
      quantity: Schema.Number,
    }),
  ),
  /** Each product directly under it, with those under that. */
  kinds: Schema.Array(
    Schema.Struct({
      id: Id,
      name: Schema.String,
      archived: Schema.Boolean,
      spent: Amount,
      purchases: Schema.Int,
      lastBought: Schema.NullOr(Day),
    }),
  ),
});
export type ProductSummary = typeof ProductSummary.Type;

export const SplitPreview = Schema.Struct({
  transactionId: Id,
  accountId: Id,
  /** The transaction's register amount, which the splits add up to. */
  amount: Amount,
  receiptIds: Schema.Array(Id),
  /** As the register enters them: negative for money going out. */
  splits: Schema.Array(
    Schema.Struct({ categoryId: Schema.NullOr(Id), category: Schema.String, amount: Amount }),
  ),
  /** Money on no receipt and the category it stays on (null: Uncategorized); in splits too. */
  remainder: Schema.NullOr(Schema.Struct({ amount: Amount, categoryId: Schema.NullOr(Id) })),
  /** Money on no receipt (a tip, a fee) was spread over the receipt's categories. */
  spread: Schema.Boolean,
  /** The transaction carries these splits already. */
  applied: Schema.Boolean,
});
export type SplitPreview = typeof SplitPreview.Type;

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

export const ReceiptLineInput = Schema.Struct({
  text: Schema.String.annotate({ description: "The line as printed" }),
  code: nullable(Schema.String, "Article code or barcode as printed"),
  quantity: optional(Schema.Number, "How many, or how much in unit; 1 by default"),
  unit: nullable(ReceiptUnit, "The unit the receipt writes, if any"),
  unitPrice: nullable(Schema.Number, "Minor units per unit; fractions of a cent allowed"),
  lineTotal: optional(
    Amount,
    "Signed minor units (negative for a return); computed from quantity × unitPrice when left out",
  ),
  productId: nullable(Id, "Product id; left out, an exact alias for the store and text fills it"),
  itemCategoryId: nullable(Id, "Item category id; the product's applies when left out"),
  budgetCategoryId: nullable(Id, "Budget category id, overriding the item category's"),
  packSize: nullable(Schema.Number, "Product units one counted item holds (6 for a 6-pack)"),
  notes: nullable(Schema.String, "Notes"),
});
export type ReceiptLineInput = typeof ReceiptLineInput.Type;

export const ReceiptAdjustmentInput = Schema.Struct({
  kind: AdjustmentKind,
  amount: Amount.annotate({ description: "Signed: tax and tips add, discounts are negative" }),
  description: nullable(Schema.String, "As printed"),
});

export const ReceiptPaymentInput = Schema.Struct({
  transactionId: Id,
  amount: optional(
    Amount,
    "How much of the receipt it pays; by default what is left of the receipt, at most what the transaction has unclaimed",
  ),
});

const HeaderFields = {
  payee: nullable(Schema.String, "The store's name; a new name creates the payee"),
  payeeId: nullable(Id, "The store's payee id, instead of payee"),
  time: nullable(Time, "Time of day as printed, HH:MM"),
  notes: nullable(Schema.String, "Notes"),
};

/** create_receipt's fields, which import_receipts reads from a JSON file too. */
export const ReceiptInputFields = {
  ...HeaderFields,
  date: Day,
  total: Amount.annotate({
    description: "What was paid, in minor units; negative for a refund, never zero",
  }),
  externalId: nullable(
    Schema.String,
    "Your idempotency key: creating again with it returns the existing receipt",
  ),
  lines: optional(Schema.Array(ReceiptLineInput), "The printed lines, in order"),
  adjustments: optional(
    Schema.Array(ReceiptAdjustmentInput),
    "Tax, discounts, coupons, tips, deposits, fees, rounding",
  ),
  payments: optional(Schema.Array(ReceiptPaymentInput), "Transactions that pay it"),
};
export const ReceiptInput = Schema.Struct(ReceiptInputFields);
export type ReceiptInput = typeof ReceiptInput.Type;

const ReceiptId = IdField("Receipt id");
const receiptField = Schema.String.annotate({ description: "Receipt id", ...cli({ alias: "r" }) });
const Ids = (description: string) => Schema.Array(Schema.String).annotate({ description });
const Paging = {
  limit: optional(Schema.Int, "At most this many; 100 by default"),
  offset: optional(Schema.Int, "Skip this many"),
};
const Range = {
  from: optional(Day, "First day included"),
  to: optional(Day, "Last day included"),
};

const CreateResult = Schema.Struct({
  receipt: Receipt,
  /** False when externalId named a receipt that already existed, which is returned as it is. */
  created: Schema.Boolean,
  /** Transactions that may pay it, best first; empty once matched. */
  suggestions: Schema.Array(MatchCandidate),
});

const ProductFields = {
  parentId: nullable(Id, "A more generic product it is a kind of"),
  itemCategoryId: nullable(Id, "Item category id"),
  unit: optional(ReceiptUnit, "What its prices are normalised to (piece by default)"),
  size: nullable(Schema.Number, "What one piece holds, in sizeUnit (1 for a 1 l bottle)"),
  sizeUnit: nullable(ReceiptUnit, "The unit of size"),
  notes: nullable(Schema.String, "Notes"),
};

const ReceiptPeriod = Schema.Struct({
  receipts: Schema.Int,
  /** What was paid on the receipts, tax and tips included, refunds taken off. */
  spent: Amount,
  /** What the refunds among them gave back, as a positive amount. */
  refunds: Amount,
  /** The receipts with a total above zero. */
  purchases: Schema.Int,
  /** What a purchase comes to on average, refunds left out. */
  average: Amount,
});

export const ReceiptOverview = Schema.Struct({
  /** Every receipt in the book, whatever the range. */
  total: Schema.Int,
  earliest: Schema.NullOr(Day),
  summary: Schema.Struct({ ...ReceiptPeriod.fields, previous: Schema.NullOr(ReceiptPeriod) }),
  /** Twelve months up to this one. `unfinished`: its receipts not finished as they stand today. */
  months: Schema.Array(
    Schema.Struct({
      month: Schema.String,
      receipts: Schema.Int,
      spent: Amount,
      average: Amount,
      unfinished: Schema.Int,
      categories: Schema.Array(
        Schema.Struct({ id: Schema.NullOr(Id), name: Schema.String, spent: Amount }),
      ),
    }),
  ),
  /** The range's receipts by the first step each has not done; these add up to its receipts. */
  pipeline: Schema.Struct({
    balance: Schema.Int,
    match: Schema.Int,
    categorize: Schema.Int,
    apply: Schema.Int,
    finished: Schema.Int,
  }),
  /** Receipts not finished across the book, whatever the range. */
  unfinished: Schema.Int,
  /** The stores in the range or the period before, most spent first. */
  stores: Schema.Array(
    Schema.Struct({
      id: Schema.NullOr(Id),
      name: Schema.String,
      spent: Amount,
      previous: Amount,
      receipts: Schema.Int,
      /** What the ledger records as spent at this payee in the range. */
      recorded: Amount,
    }),
  ),
  /** Every store that has a receipt, for filtering. */
  storeChoices: Schema.Array(Schema.Struct({ id: Id, name: Schema.String })),
  /**
   * Top-level item categories, most spent first. Each receipt's total is spread over its lines,
   * so tax and discounts travel with the items.
   */
  categories: Schema.Array(
    Schema.Struct({
      id: Schema.NullOr(Id),
      name: Schema.String,
      spent: Amount,
      previous: Amount,
      lines: Schema.Int,
    }),
  ),
  /** What the range's receipts without lines come to: it is in no category. */
  unitemized: Amount,
  /** All by the transaction's day, except `unlinked`, which goes by the receipt's. */
  coverage: Schema.Struct({
    /** Spending the ledger records on expense categories in the range. */
    recorded: Amount,
    /** The part of it that receipts' payments account for. */
    covered: Amount,
    /** What the range's receipts still have no payment for; it may be cash. */
    unlinked: Amount,
  }),
  /** Across the book, whatever the range; `list_receipts` with `check` lists each. */
  attention: Schema.Struct({
    off: Schema.Int,
    /** How far those receipts are off, added up by size. */
    offAmount: Amount,
    noLines: Schema.Int,
    noPayment: Schema.Int,
    uncategorizedLines: Schema.Int,
    /** How many lines those receipts have without a budget category. */
    uncategorizedLineCount: Schema.Int,
    unapplied: Schema.Int,
    lineMismatch: Schema.Int,
    old: Schema.Int,
    /** A receipt is old when it is unfinished and dated more than this many days ago. */
    oldDays: Schema.Int,
  }),
});
export type ReceiptOverview = typeof ReceiptOverview.Type;

const book = BookField;

export const receipts = {
  // ---- Receipts ------------------------------------------------------------------------------
  create_receipt: {
    description:
      "Add an itemized receipt in one call: header (store, date, total paid), lines, adjustments (tax, discounts, tips…) and optional payments (transaction ids). A line without productId takes the product of an exact alias for the store and text. A line's total is computed from quantity × unitPrice when left out; a given total that differs by more than a cent is a warning. With externalId, calling again returns the existing receipt (created: false). Returns the receipt with its computed status and transactions that may pay it.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({ book, ...ReceiptInputFields }),
    success: CreateResult,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/receipts" },
    cli: {
      command: ["receipts", "add"],
      description: "Add a receipt's header (add lines with receipts import or MCP)",
    },
  },
  import_receipts: {
    description:
      "Create receipts from a JSON file (or its text): one receipt or an array, each shaped as create_receipt's input. Each is created as create_receipt would, idempotent by externalId, all in one step.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book,
      path: optional(Schema.String, "A JSON file on this computer").annotate(
        cli({ positional: true }),
      ),
      content: optional(Schema.String, "The JSON text, instead of a path"),
    }),
    success: Schema.Array(CreateResult),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/receipts/import" },
    cli: {
      command: ["receipts", "import"],
      description: "Create receipts from a JSON file",
      examples: [
        {
          command: "reeve receipts import receipt.json",
          description: "Add a receipt with its lines from JSON",
        },
      ],
    },
  },
  get_receipt: {
    description:
      "Read a receipt with its lines (each with its effective item and budget category), adjustments, payments, photos, computed status and warnings.",
    readonly: true,
    input: Schema.Struct({ book, id: ReceiptId }),
    success: Receipt,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/receipts/:id" },
    cli: { command: ["receipts", "show"], description: "Show a receipt" },
  },
  list_receipts: {
    description:
      "List receipts, newest first unless sort says otherwise, with their computed status. Filters combine: a date range, stores, status flags, the step a receipt is at, an open check, an item category and text found in lines, notes or the store.",
    readonly: true,
    input: Schema.Struct({
      book,
      ...Range,
      payeeIds: optional(Ids("Only these stores (payee ids)"), "Only these stores (payee ids)"),
      unmatched: optional(
        Schema.Boolean,
        "Only receipts whose payments do not add up to the total",
      ),
      unbalanced: optional(
        Schema.Boolean,
        "Only receipts whose lines and adjustments miss the total",
      ),
      uncategorized: optional(Schema.Boolean, "Only receipts with lines without a budget category"),
      unapplied: optional(
        Schema.Boolean,
        "Only matched receipts whose split is not on the transaction",
      ),
      query: optional(Schema.String, "Text in a line, the notes or the store").annotate(
        cli({ alias: "q" }),
      ),
      noStore: optional(Schema.Boolean, "Receipts without a store, as well as any in payeeIds"),
      stage: optional(
        Schema.Literals([...RECEIPT_STAGES, "unfinished"]),
        "Only receipts at this step: the first of balance, match, categorize, apply they have not done, finished when all are; unfinished is any but finished",
      ),
      check: optional(
        Schema.Literals(RECEIPT_CHECKS),
        "Only receipts failing this check of receipt_activity's attention",
      ),
      itemCategoryId: optional(Id, "Only receipts with a line in this item category or under it"),
      noItemCategory: optional(Schema.Boolean, "Only receipts with a line without item category"),
      sort: optional(Schema.Literals(RECEIPT_SORTS), "Sort by this; the default is date"),
      descending: optional(Schema.Boolean, "Sort from high to low; the default for date"),
      ...Paging,
    }),
    success: Schema.Struct({ receipts: Schema.Array(ReceiptSummary), total: Schema.Int }),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/receipts" },
    cli: { command: ["receipts", "list"], aliases: ["ls"], description: "List receipts" },
  },
  receipt_activity: {
    description:
      "What receipts say for a range and the period before it: counts and spending (what was paid, tax and tips included, refunds taken off; average over purchases only), twelve months of them, the pipeline (each receipt at the first step it has not done), top stores and item categories, how much of the spending the ledger records has receipts behind it, and open checks across the whole book.",
    readonly: true,
    input: Schema.Struct({
      book,
      since: optional(Day, "First day of the range; all time when left out"),
      until: optional(Day, "Last day of the range; open-ended when left out"),
    }),
    success: ReceiptOverview,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/receipts/activity" },
    cli: { command: ["receipts", "activity"], description: "Receipt activity for a range" },
  },
  update_receipt: {
    description: "Change a receipt's header: store, date, time, total, notes or externalId.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book,
      id: ReceiptId,
      ...HeaderFields,
      date: optional(Day, "Day of the purchase"),
      total: optional(Amount, "What was paid; negative for a refund, never zero"),
      externalId: nullable(Schema.String, "Idempotency key"),
    }),
    success: Receipt,
    error: inBook(),
    http: { method: "PATCH", path: "/books/:book/receipts/:id" },
    cli: { command: ["receipts", "update"], description: "Change a receipt's header" },
  },
  delete_receipt: {
    description:
      "Delete a receipt with its lines, adjustments, payment links and photos (its folder). Its transactions stay as they are.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({ book, id: ReceiptId }),
    success: Schema.Struct({ deleted: Id }),
    error: inBook(),
    http: { method: "DELETE", path: "/books/:book/receipts/:id" },
    cli: { command: ["receipts", "delete"], description: "Delete a receipt" },
  },
  add_receipt_lines: {
    description:
      "Add lines to a receipt, at the end or before another line, as create_receipt takes them (aliases fill products).",
    readonly: false,
    input: Schema.Struct({
      book,
      receipt: receiptField,
      lines: Schema.Array(ReceiptLineInput),
      before: nullable(Id, "The line to insert before; last when left out"),
    }),
    success: Receipt,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/receipts/:receipt/lines" },
  },
  update_receipt_line: {
    description:
      "Change a receipt line. Changing quantity or unitPrice without lineTotal computes the total again.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book,
      id: IdField("Line id"),
      text: optional(Schema.String, "The line as printed"),
      code: ReceiptLineInput.fields.code,
      quantity: ReceiptLineInput.fields.quantity,
      unit: ReceiptLineInput.fields.unit,
      unitPrice: ReceiptLineInput.fields.unitPrice,
      lineTotal: optional(Amount, "Signed minor units"),
      productId: nullable(Id, "Product id"),
      itemCategoryId: ReceiptLineInput.fields.itemCategoryId,
      budgetCategoryId: ReceiptLineInput.fields.budgetCategoryId,
      packSize: ReceiptLineInput.fields.packSize,
      notes: ReceiptLineInput.fields.notes,
    }),
    success: Receipt,
    error: inBook(),
    http: { method: "PATCH", path: "/books/:book/receipt-lines/:id" },
    cli: { command: ["receipts", "update-line"], description: "Change a receipt line" },
  },
  delete_receipt_lines: {
    description: "Delete lines of one receipt.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({ book, receipt: receiptField, ids: Ids("Line ids") }),
    success: Receipt,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/receipts/:receipt/lines/delete" },
    cli: { command: ["receipts", "delete-lines"], description: "Delete receipt lines" },
  },
  reorder_receipt_lines: {
    description: "Put a receipt's lines in this order; lines left out follow in their order.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({ book, receipt: receiptField, ids: Ids("Line ids in order") }),
    success: Receipt,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/receipts/:receipt/lines/reorder" },
  },
  add_receipt_adjustment: {
    description: "Add tax, a discount, a coupon, a tip, a deposit, a fee or rounding to a receipt.",
    readonly: false,
    input: Schema.Struct({ book, receipt: receiptField, ...ReceiptAdjustmentInput.fields }),
    success: Receipt,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/receipts/:receipt/adjustments" },
    cli: { command: ["receipts", "adjust"], description: "Add an adjustment (tax, discount…)" },
  },
  update_receipt_adjustment: {
    description: "Change a receipt adjustment.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book,
      id: IdField("Adjustment id"),
      kind: optional(AdjustmentKind, "Kind"),
      amount: optional(Amount, "Signed amount"),
      description: nullable(Schema.String, "As printed"),
    }),
    success: Receipt,
    error: inBook(),
    http: { method: "PATCH", path: "/books/:book/receipt-adjustments/:id" },
  },
  delete_receipt_adjustment: {
    description: "Delete a receipt adjustment.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({ book, id: IdField("Adjustment id") }),
    success: Receipt,
    error: inBook(),
    http: { method: "DELETE", path: "/books/:book/receipt-adjustments/:id" },
  },

  // ---- Matching and payments -----------------------------------------------------------------
  suggest_receipt_matches: {
    description:
      "Transactions that may pay a receipt, best first: on asset or liability accounts, dated 3 days before to 10 days after it, for what the receipt still needs paid (exactly, or up to 30% more: a tip), not fully claimed by other receipts, scored by amount, date distance and payee similarity, with reasons.",
    readonly: true,
    input: Schema.Struct({
      book,
      id: ReceiptId,
      limit: optional(Schema.Int, "At most this many; 10 by default"),
    }),
    success: Schema.Array(MatchCandidate),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/receipts/:id/matches" },
    cli: {
      command: ["receipts", "matches"],
      description: "Suggest transactions that pay a receipt",
    },
  },
  link_receipt_payment: {
    description:
      "Record that a transaction pays a receipt, or change how much. amount defaults to what is left of the receipt, at most what the transaction has unclaimed; with nothing left it is refused rather than made up.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book,
      receipt: receiptField,
      transaction: Schema.String.annotate({
        description: "Transaction id",
        ...cli({ alias: "t" }),
      }),
      amount: ReceiptPaymentInput.fields.amount,
    }),
    success: Receipt,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/receipts/:receipt/payments" },
    cli: { command: ["receipts", "link"], description: "Link a transaction that pays a receipt" },
  },
  unlink_receipt_payment: {
    description: "Remove a transaction from a receipt's payments; the transaction is not changed.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book,
      receipt: receiptField,
      transaction: Schema.String.annotate({
        description: "Transaction id",
        ...cli({ alias: "t" }),
      }),
    }),
    success: Receipt,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/receipts/:receipt/payments/unlink" },
    cli: { command: ["receipts", "unlink"], description: "Unlink a transaction from a receipt" },
  },
  auto_match_receipts: {
    description:
      "Link every receipt without payments to its transaction when exactly one candidate is sure (same amount, within 3 days, same or similar payee) and no other receipt wants it. Reports what it linked and what is ambiguous.",
    readonly: false,
    input: Schema.Struct({ book, ...Range }),
    success: Schema.Struct({
      linked: Schema.Array(Schema.Struct({ receiptId: Id, transactionId: Id, amount: Amount })),
      ambiguous: Schema.Array(Schema.Struct({ receiptId: Id, transactionIds: Schema.Array(Id) })),
      /** Receipts without payments and without a sure candidate. */
      unmatched: Schema.Array(Id),
    }),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/receipts/auto-match" },
    cli: { command: ["receipts", "auto-match"], description: "Link receipts to sure transactions" },
  },
  list_transaction_receipts: {
    description: "The receipts a transaction pays, with how much of each.",
    readonly: true,
    input: Schema.Struct({ book, transaction: IdField("Transaction id") }),
    success: Schema.Array(Schema.Struct({ ...ReceiptSummary.fields, paidByTransaction: Amount })),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/transactions/:transaction/receipts" },
    cli: { command: ["receipts", "of"], description: "The receipts a transaction pays" },
  },
  transactions_with_receipts: {
    description:
      "Which transactions have receipts, for a register to mark: each transaction id with its receipt ids and whether its split is applied. Filter by account and date range.",
    readonly: true,
    input: Schema.Struct({
      book,
      account: optional(Id, "Only transactions with a posting in this account"),
      ...Range,
    }),
    success: Schema.Array(
      Schema.Struct({ transactionId: Id, receiptIds: Schema.Array(Id), applied: Schema.Boolean }),
    ),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/receipts/transactions" },
  },

  // ---- Applying to the ledger ----------------------------------------------------------------
  receipt_split_preview: {
    description:
      "The split apply_receipt_to_transaction would write on a linked transaction, without writing: one line per budget category, each its line totals plus a proportional share of adjustments, scaled so they add up to the bank's amount.",
    readonly: true,
    input: Schema.Struct({
      book,
      id: ReceiptId,
      transaction: optional(Id, "The linked transaction; required when there are several"),
      remainderCategory: nullable(Id, "Where money on no receipt goes"),
    }),
    success: SplitPreview,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/receipts/:id/split" },
    cli: { command: ["receipts", "preview"], description: "Preview a receipt's split" },
  },
  apply_receipt_to_transaction: {
    description:
      "Rewrite the category side of the receipt's transactions as one split line per budget category (see receipt_split_preview). With transaction, only that one, linked first if it is not. Money on no receipt: up to 30% on a single receipt is spread over its categories (a tip, a fee); otherwise it stays on the transaction's current single category, or remainderCategory. Refuses when a line has no budget category.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book,
      id: ReceiptId,
      transaction: optional(Id, "One linked transaction; all of them when left out"),
      remainderCategory: nullable(Id, "Where money on no receipt goes"),
    }),
    success: Schema.Struct({ receipt: Receipt, transactions: Schema.Array(Transaction) }),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/receipts/:id/apply" },
    cli: {
      command: ["receipts", "apply"],
      description: "Split a receipt's transaction by category",
    },
  },

  // ---- Photos --------------------------------------------------------------------------------
  attach_receipt_photo: {
    description:
      "Attach a photo (or PDF) of a receipt: a file on this computer by path, or base64 content with a fileName. It is copied into the receipts folder.",
    readonly: false,
    input: Schema.Struct({
      book,
      receipt: receiptField,
      path: optional(Schema.String, "A file on this computer").annotate(cli({ positional: true })),
      content: optional(Schema.String, "The file's bytes as base64, instead of path"),
      fileName: optional(Schema.String, "The file's name, with content"),
      mimeType: optional(Schema.String, "By default from the file's extension"),
    }),
    success: ReceiptPhoto,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/receipts/:receipt/photos" },
    cli: { command: ["receipts", "attach"], description: "Attach a photo to a receipt" },
  },
  list_receipt_photos: {
    description: "A receipt's photos with their files' paths.",
    readonly: true,
    input: Schema.Struct({ book, receipt: IdField("Receipt id") }),
    success: Schema.Array(ReceiptPhoto),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/receipts/:receipt/photos" },
    cli: { command: ["receipts", "photos"], description: "List a receipt's photos" },
  },
  get_receipt_photo: {
    description:
      "A receipt photo's file path, and with content its bytes as base64 (files up to 5 MB). The server streams the bytes at GET /api/books/:book/receipt-photos/:id/file.",
    readonly: true,
    input: Schema.Struct({
      book,
      id: IdField("Photo id"),
      content: optional(Schema.Boolean, "Include the bytes as base64"),
    }),
    success: Schema.Struct({ ...ReceiptPhoto.fields, content: Schema.NullOr(Schema.String) }),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/receipt-photos/:id" },
  },
  delete_receipt_photo: {
    description: "Remove a photo from a receipt and its file from the receipts folder.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({ book, id: IdField("Photo id") }),
    success: Schema.Struct({ deleted: Id }),
    error: inBook(),
    http: { method: "DELETE", path: "/books/:book/receipt-photos/:id" },
    cli: { command: ["receipts", "delete-photo"], description: "Delete a receipt photo" },
  },

  // ---- Item categories -----------------------------------------------------------------------
  list_item_categories: {
    description:
      "The item categories (what things are: Dairy, Produce…) in tree order, each with its default budget category and the one it gets from its ancestors.",
    readonly: true,
    input: Schema.Struct({ book }),
    success: Schema.Array(ItemCategory),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/item-categories" },
    cli: { command: ["items", "categories"], description: "List item categories" },
  },
  create_item_category: {
    description:
      "Create an item category, under parentId or at the top, before a sibling or last, with an optional default budget category.",
    readonly: false,
    input: Schema.Struct({
      book,
      name: Schema.NonEmptyString.annotate(cli({ positional: true })),
      parentId: nullable(Id, "Parent item category"),
      budgetCategoryId: nullable(Id, "Where its items' money goes by default"),
      before: nullable(Id, "The sibling to go before; last when left out"),
    }),
    success: ItemCategory,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/item-categories" },
    cli: { command: ["items", "add-category"], description: "Create an item category" },
  },
  update_item_category: {
    description: "Rename, hide or change the default budget category of an item category.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book,
      id: IdField("Item category id"),
      name: optional(Schema.NonEmptyString, "Name"),
      hidden: optional(Schema.Boolean, "Hidden"),
      budgetCategoryId: nullable(Id, "Default budget category"),
    }),
    success: ItemCategory,
    error: inBook(),
    http: { method: "PATCH", path: "/books/:book/item-categories/:id" },
    cli: { command: ["items", "update-category"], description: "Change an item category" },
  },
  move_item_category: {
    description:
      "Move an item category with its subtree under parentId (null: the top), before a sibling or last.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book,
      id: IdField("Item category id"),
      parentId: nullable(Id, "New parent; the top when null"),
      before: nullable(Id, "The sibling to go before"),
    }),
    success: Schema.Array(ItemCategory),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/item-categories/:id/move" },
  },
  delete_item_category: {
    description:
      "Delete an item category. Its children move up to its parent, in its place; its products and lines take its parent (or none).",
    readonly: false,
    destructive: true,
    input: Schema.Struct({ book, id: IdField("Item category id") }),
    success: Schema.Struct({ deleted: Id }),
    error: inBook(),
    http: { method: "DELETE", path: "/books/:book/item-categories/:id" },
    cli: { command: ["items", "delete-category"], description: "Delete an item category" },
  },

  // ---- Products and aliases ------------------------------------------------------------------
  list_products: {
    description:
      "List products by name with their last price and purchase count. Filters: text in the name or an alias, an item category (with its subtree), a store they were bought at.",
    readonly: true,
    input: Schema.Struct({
      book,
      query: optional(Schema.String, "Text in the name or an alias").annotate(cli({ alias: "q" })),
      itemCategoryId: optional(Id, "Only this item category and those under it"),
      payeeId: optional(Id, "Only products bought at this store"),
      archived: optional(Schema.Boolean, "Include archived products"),
      ...Paging,
    }),
    success: Schema.Struct({ products: Schema.Array(Product), total: Schema.Int }),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/products" },
    cli: { command: ["products", "list"], aliases: ["ls"], description: "List products" },
  },
  get_product: {
    description: "Read a product with its aliases and the products under it.",
    readonly: true,
    input: Schema.Struct({ book, id: IdField("Product id") }),
    success: Schema.Struct({
      ...Product.fields,
      aliases: Schema.Array(ProductAlias),
      children: Schema.Array(Product),
    }),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/products/:id" },
    cli: { command: ["products", "show"], description: "Show a product" },
  },
  create_product: {
    description: "Create a product: a thing bought, apart from how receipts print it.",
    readonly: false,
    input: Schema.Struct({
      book,
      name: Schema.NonEmptyString.annotate(cli({ positional: true })),
      ...ProductFields,
    }),
    success: Product,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/products" },
    cli: { command: ["products", "add"], description: "Create a product" },
  },
  update_product: {
    description: "Change a product.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book,
      id: IdField("Product id"),
      name: optional(Schema.NonEmptyString, "Name"),
      ...ProductFields,
      archived: optional(Schema.Boolean, "Archived products are not suggested"),
    }),
    success: Product,
    error: inBook(),
    http: { method: "PATCH", path: "/books/:book/products/:id" },
    cli: { command: ["products", "update"], description: "Change a product" },
  },
  delete_product: {
    description:
      "Delete a product. Its lines keep their text without a product, its aliases go, and products under it move up to its parent.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({ book, id: IdField("Product id") }),
    success: Schema.Struct({ deleted: Id }),
    error: inBook(),
    http: { method: "DELETE", path: "/books/:book/products/:id" },
    cli: { command: ["products", "delete"], description: "Delete a product" },
  },
  merge_products: {
    description:
      "Merge products into target: their lines, aliases and child products move to it, and they are deleted.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({
      book,
      target: Schema.String.annotate({ description: "The product to keep" }),
      merge: Ids("The products to merge into target"),
    }),
    success: Product,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/products/merge" },
    cli: { command: ["products", "merge"], description: "Merge products" },
  },
  list_aliases: {
    description: "List product aliases: receipt text that names a product, per store or for any.",
    readonly: true,
    input: Schema.Struct({
      book,
      productId: optional(Id, "Only this product's"),
      payeeId: optional(Id, "Only this store's (and those for any store)"),
      rejected: optional(Schema.Boolean, "Only rejected ones (true) or only accepted ones (false)"),
    }),
    success: Schema.Array(ProductAlias),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/product-aliases" },
    cli: { command: ["products", "aliases"], description: "List product aliases" },
  },
  create_alias: {
    description:
      "Say that receipt text (and code) at a store, or any store, names a product. Lines with it get the product from now on.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book,
      productId: Id,
      text: Schema.String.annotate({ description: "As printed" }),
      payeeId: nullable(Id, "The store; any store when null"),
      code: nullable(Schema.String, "Article code as printed"),
      packSize: nullable(Schema.Number, "Product units one printed item holds"),
    }),
    success: ProductAlias,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/product-aliases" },
    cli: { command: ["products", "alias"], description: "Add a product alias" },
  },
  delete_alias: {
    description: "Delete a product alias.",
    readonly: false,
    destructive: true,
    input: Schema.Struct({ book, id: IdField("Alias id") }),
    success: Schema.Struct({ deleted: Id }),
    error: inBook(),
    http: { method: "DELETE", path: "/books/:book/product-aliases/:id" },
    cli: { command: ["products", "delete-alias"], description: "Delete a product alias" },
  },
  reject_alias: {
    description:
      "Remember that receipt text at a store (or any) is not a product, so it is never suggested or filled in for that text again. Turns an existing alias for that text and product into a rejected one.",
    readonly: false,
    idempotent: true,
    input: Schema.Struct({
      book,
      productId: Id,
      text: Schema.String.annotate({ description: "As printed" }),
      payeeId: nullable(Id, "The store; any store when null"),
      code: nullable(Schema.String, "Article code as printed"),
    }),
    success: ProductAlias,
    error: inBook(),
    http: { method: "POST", path: "/books/:book/product-aliases/reject" },
  },
  assign_line_product: {
    description:
      "Set (or clear) a receipt line's product. remember makes an alias for the receipt's store and the line's text so later lines get it; applyToSimilar also sets it on other lines without a product with the same store and text.",
    readonly: false,
    input: Schema.Struct({
      book,
      line: Schema.String.annotate({ description: "Line id", ...cli({ positional: true }) }),
      productId: Schema.NullOr(Id).annotate({ description: "Product id; null clears it" }),
      remember: optional(Schema.Boolean, "Make a store alias for the line's text"),
      applyToSimilar: optional(
        Schema.Boolean,
        "Also set it on other unassigned lines with the same store and text",
      ),
    }),
    success: Schema.Struct({
      receipt: Receipt,
      alias: Schema.NullOr(ProductAlias),
      /** Other lines that got the product. */
      updatedLines: Schema.Array(Id),
    }),
    error: inBook(),
    http: { method: "POST", path: "/books/:book/receipt-lines/:line/product" },
    cli: { command: ["receipts", "assign"], description: "Set a receipt line's product" },
  },
  suggest_products: {
    description:
      "Products that receipt text may name, best first: an exact alias (store, then any store, or the code), then names and alias texts sharing words with it. Rejected aliases are never suggested. Suggestions are never assigned by themselves.",
    readonly: true,
    input: Schema.Struct({
      book,
      text: Schema.String.annotate({ description: "As printed", ...cli({ positional: true }) }),
      payeeId: optional(Id, "The store"),
      code: optional(Schema.String, "Article code"),
      limit: optional(Schema.Int, "At most this many; 5 by default"),
    }),
    success: Schema.Array(ProductSuggestion),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/products/suggest" },
    cli: { command: ["products", "suggest"], description: "Suggest products for receipt text" },
  },
  list_unassigned_lines: {
    description:
      "Receipt lines without a product, newest first, each with its receipt's day and store and product suggestions: the list an agent works through with assign_line_product.",
    readonly: true,
    input: Schema.Struct({
      book,
      payeeId: optional(Id, "Only this store's"),
      named: optional(
        Schema.Boolean,
        "Only those whose text or code is exactly an active product's name or alias at their store",
      ),
      ...Paging,
    }),
    success: Schema.Struct({
      lines: Schema.Array(
        Schema.Struct({
          ...ReceiptLine.fields,
          date: Day,
          payeeId: Schema.NullOr(Id),
          payee: Schema.NullOr(Schema.String),
          suggestions: Schema.Array(ProductSuggestion),
        }),
      ),
      total: Schema.Int,
    }),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/receipt-lines/unassigned" },
    cli: { command: ["products", "unassigned"], description: "Receipt lines without a product" },
  },

  // ---- Prices and spending -------------------------------------------------------------------
  product_price_history: {
    description:
      "Every purchase of a product, oldest first, with its price per one of the product's unit (pricePerBase: grams and litres converted, pieces times the product's size). includeChildren adds the products under it.",
    readonly: true,
    input: Schema.Struct({
      book,
      id: IdField("Product id"),
      includeChildren: optional(Schema.Boolean, "Add the purchases of products under it"),
      ...Range,
    }),
    success: Schema.Struct({ unit: ReceiptUnit, points: Schema.Array(PricePoint) }),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/products/:id/prices" },
    cli: { command: ["products", "prices"], description: "A product's price history" },
  },
  price_changes: {
    description:
      "Products whose latest price in the range (per their unit) differs from the purchase before it, or from their average before the range, by at least minChangePct; biggest change first.",
    readonly: true,
    input: Schema.Struct({
      book,
      ...Range,
      minChangePct: optional(Schema.Number, "Smallest change in percent; 1 by default"),
      compareTo: optional(
        Schema.Literals(["previous", "average"]),
        "previous (default) or average",
      ),
    }),
    success: Schema.Array(
      Schema.Struct({
        productId: Id,
        product: Schema.String,
        unit: ReceiptUnit,
        latest: PricePoint,
        /** The previous price or the average it is compared with, per unit. */
        before: Schema.Number,
        changePct: Schema.Number,
      }),
    ),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/products/price-changes" },
    cli: { command: ["products", "price-changes"], description: "Products whose price changed" },
  },
  cheapest_stores: {
    description:
      "Where a product (with the products under it) costs least: per store, the latest and average price per the product's unit, cheapest latest first.",
    readonly: true,
    input: Schema.Struct({ book, id: IdField("Product id") }),
    success: Schema.Array(
      Schema.Struct({
        payeeId: Schema.NullOr(Id),
        payee: Schema.NullOr(Schema.String),
        latest: Schema.Number,
        latestDate: Day,
        average: Schema.Number,
        purchases: Schema.Int,
      }),
    ),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/products/:id/stores" },
    cli: { command: ["products", "stores"], description: "Where a product is cheapest" },
  },
  item_spending: {
    description:
      "Money spent on items in a range, grouped by item category, product or store. With allocate (the default) each receipt's tax and adjustments are spread over its lines (largest remainder) so the groups add up to what was paid; without it, line totals only.",
    readonly: true,
    input: Schema.Struct({
      book,
      ...Range,
      groupBy: Schema.Literals(["item_category", "product", "store"]),
      allocate: optional(Schema.Boolean, "Spread adjustments over lines (default true)"),
      payeeId: optional(Id, "Only this store"),
      itemCategoryId: optional(Id, "Only this item category and those under it"),
    }),
    success: Schema.Struct({
      groups: Schema.Array(
        Schema.Struct({
          id: Schema.NullOr(Id),
          name: Schema.String,
          amount: Amount,
          lines: Schema.Int,
        }),
      ),
      total: Amount,
    }),
    error: inBook(),
    http: { method: "GET", path: "/books/:book/receipts/spending" },
    cli: {
      command: ["items", "spending"],
      description: "Spending by item category, product or store",
    },
  },
  product_activity: {
    description:
      "What is bought and what it costs: every product's spending, purchases, recent prices per its unit and how its latest price moved in a range, against the same days before. Also twelve months of totals, the largest price movers, spending by item category and what needs attention across the book. A product's own figures never count the products under it; its rollup does. Leave out since for all time.",
    readonly: true,
    input: Schema.Struct({
      book,
      since: optional(Day, "First day of the range"),
      compareTo: optional(
        Schema.Literals(["previous", "average"]),
        "What a latest price is held against: its average in the same days before the range (default) or the purchase before it",
      ),
    }),
    success: ProductOverview,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/products/activity" },
    cli: {
      command: ["products", "activity"],
      description: "Show what is bought and what it costs",
    },
  },
  product_summary: {
    description:
      "One product with the products under it, over all time: what was spent, how often and how much was bought, twelve months of that, and each kind's part.",
    readonly: true,
    input: Schema.Struct({ book, id: IdField("Product id") }),
    success: ProductSummary,
    error: inBook(),
    http: { method: "GET", path: "/books/:book/products/:id/summary" },
    cli: { command: ["products", "summary"], description: "Show what a product has cost" },
  },
} satisfies Record<string, Operation>;

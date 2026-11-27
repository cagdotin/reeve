/**
 * Plain functions for receipts that the engine and the browser both run: line arithmetic, the
 * receipt's computed status, units and price normalisation, proportional allocation, text
 * matching and the split a receipt makes of its transaction (docs/rules/purchases.md). No Effect, no Node
 * modules, no engine.
 */

// ---------------------------------------------------------------------------------------------
// Rounding and line arithmetic
// ---------------------------------------------------------------------------------------------

/** One cent: the tolerance of a balanced receipt and of a line total against its price. */
export const RECEIPT_TOLERANCE = 1;

/** Rounds to a whole number, a midpoint away from zero: 0.5 is 1 and -0.5 is -1. */
export const roundHalfAwayFromZero = (value: number): number =>
  Math.sign(value) * Math.round(Math.abs(value));

/** A finite number as an integer and a power of ten, read from its shortest decimal text. */
const decimal = (value: number): { readonly digits: bigint; readonly scale: number } => {
  const [mantissa = "0", exponent = "0"] = String(value).toLowerCase().split("e");
  const [whole = "0", fraction = ""] = mantissa.split(".");
  const scale = fraction.length - Number(exponent);
  const digits = BigInt(`${whole}${fraction}`);
  return scale >= 0 ? { digits, scale } : { digits: digits * 10n ** BigInt(-scale), scale: 0 };
};

/**
 * `quantity × unitPrice` rounded to a whole minor unit, a midpoint away from zero, as Receipts'
 * arithmetic: the operands multiply as decimals, so 0.5 × 201 is exactly 100.5 and rounds to 101.
 */
export const lineAmount = (quantity: number, unitPrice: number): number => {
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) return Number.NaN;
  const a = decimal(quantity);
  const b = decimal(unitPrice);
  const product = a.digits * b.digits;
  const scale = 10n ** BigInt(a.scale + b.scale);
  const negative = product < 0n;
  const magnitude = negative ? -product : product;
  const rounded = (magnitude * 2n + scale) / (scale * 2n);
  return Number(negative ? -rounded : rounded);
};

export interface LineAmounts {
  readonly quantity: number;
  readonly unitPrice: number | null;
  readonly lineTotal: number;
}

/** What quantity × unit price comes to, when the line has a unit price. */
export const computedLineTotal = (line: Omit<LineAmounts, "lineTotal">): number | null =>
  line.unitPrice === null ? null : lineAmount(line.quantity, line.unitPrice);

/** Whether a line's given total differs from quantity × unit price by more than a cent. */
export const lineMismatch = (line: LineAmounts): number | null => {
  const computed = computedLineTotal(line);
  if (computed === null) return null;
  const difference = line.lineTotal - computed;
  return Math.abs(difference) > RECEIPT_TOLERANCE ? difference : null;
};

const sum = (values: ReadonlyArray<number>) => values.reduce((total, value) => total + value, 0);

export interface ReceiptTotalsInput {
  readonly lines: ReadonlyArray<{ readonly lineTotal: number }>;
  readonly adjustments: ReadonlyArray<{ readonly amount: number }>;
  readonly payments: ReadonlyArray<{ readonly amount: number }>;
  /** What was paid, as printed on the receipt. */
  readonly total: number;
}

export interface ReceiptTotals {
  readonly itemsTotal: number;
  readonly adjustmentsTotal: number;
  readonly expectedTotal: number;
  /** The total minus the expected total: what a reconciling adjustment would add. */
  readonly difference: number;
  /** The expected total is within a cent of the total. */
  readonly balanced: boolean;
  readonly paidAmount: number;
  /** The linked payments add up to the total. */
  readonly matched: boolean;
}

/** A receipt's sums and the flags they decide; nothing of it is stored. */
export const receiptTotals = (input: ReceiptTotalsInput): ReceiptTotals => {
  const itemsTotal = sum(input.lines.map((line) => line.lineTotal));
  const adjustmentsTotal = sum(input.adjustments.map((adjustment) => adjustment.amount));
  const expectedTotal = itemsTotal + adjustmentsTotal;
  const paidAmount = sum(input.payments.map((payment) => payment.amount));
  const difference = input.total - expectedTotal;
  return {
    itemsTotal,
    adjustmentsTotal,
    expectedTotal,
    difference,
    balanced: Math.abs(difference) <= RECEIPT_TOLERANCE,
    paidAmount,
    matched: input.payments.length > 0 && paidAmount === input.total,
  };
};

/** The steps of finishing a receipt, in order, and where a finished one ends up. */
export const RECEIPT_STAGES = ["balance", "match", "categorize", "apply", "finished"] as const;
export type ReceiptStage = (typeof RECEIPT_STAGES)[number];

/** The first step a receipt has not done, whichever order the others were done in. */
export const receiptStage = (status: {
  readonly balanced: boolean;
  readonly matched: boolean;
  readonly categorized: boolean;
  readonly applied: boolean;
}): ReceiptStage => {
  if (!status.balanced) return "balance";
  if (!status.matched) return "match";
  if (!status.categorized) return "categorize";
  return status.applied ? "finished" : "apply";
};

// ---------------------------------------------------------------------------------------------
// Allocation
// ---------------------------------------------------------------------------------------------

/**
 * `total` split in proportion to `weights` by the largest-remainder method: whole minor units
 * that add up to exactly `total`. Weights may be negative (a returned item); when they sum to
 * zero, their sizes are the weights instead, and with no weight at all the first takes it all.
 */
export const allocate = (total: number, weights: ReadonlyArray<number>): Array<number> => {
  if (weights.length === 0) return [];
  let basis = weights;
  if (sum(basis) === 0) basis = weights.map(Math.abs);
  const whole = sum(basis);
  if (whole === 0) return weights.map((_, index) => (index === 0 ? total : 0));
  const exact = basis.map((weight) => (total * weight) / whole);
  const shares = exact.map(Math.floor);
  let left = total - sum(shares);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .toSorted((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let at = 0; left > 0; at = (at + 1) % order.length, left--) shares[order[at]!.index]! += 1;
  return shares;
};

// ---------------------------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------------------------

export const UNITS = ["piece", "pack", "g", "kg", "ml", "l", "oz", "lb", "fl_oz"] as const;
export type Unit = (typeof UNITS)[number];

export type Dimension = "count" | "mass" | "volume";

/** Each unit's dimension and its size in the dimension's base: a piece, a gram, a millilitre. */
export const UNIT_INFO: Readonly<
  Record<Unit, { readonly dimension: Dimension; readonly factor: number }>
> = {
  piece: { dimension: "count", factor: 1 },
  // A pack counts as one piece: what it holds is the alias's or the line's pack size.
  pack: { dimension: "count", factor: 1 },
  g: { dimension: "mass", factor: 1 },
  kg: { dimension: "mass", factor: 1000 },
  oz: { dimension: "mass", factor: 28.349523125 },
  lb: { dimension: "mass", factor: 453.59237 },
  ml: { dimension: "volume", factor: 1 },
  l: { dimension: "volume", factor: 1000 },
  fl_oz: { dimension: "volume", factor: 29.5735295625 },
};

export const isUnit = (value: string): value is Unit => Object.hasOwn(UNIT_INFO, value);

export const dimensionOf = (unit: Unit): Dimension => UNIT_INFO[unit].dimension;

/** `quantity` of `from` in `to`; null across dimensions (grams are not litres). */
export const convertQuantity = (quantity: number, from: Unit, to: Unit): number | null => {
  const a = UNIT_INFO[from];
  const b = UNIT_INFO[to];
  return a.dimension === b.dimension ? (quantity * a.factor) / b.factor : null;
};

export interface PricedLine {
  readonly quantity: number;
  /** The unit the receipt wrote, if any. */
  readonly unit: Unit | null;
  readonly lineTotal: number;
  /** Product units one counted item holds (a 6-pack is 6); 1 when not given. */
  readonly packSize: number | null;
}

export interface ProductMeasure {
  /** The unit prices are normalised to. */
  readonly unit: Unit;
  /** What one piece of a packaged product holds, as `1` `l` for a litre of milk. */
  readonly size: number | null;
  readonly sizeUnit: Unit | null;
}

/**
 * How much of `product.unit` a line bought:
 * - a line weighed or measured in the product's dimension converts directly (500 g is 0.5 kg);
 * - a line counted in pieces (or with no unit) is quantity × pack size pieces, which for a count
 *   product is the amount, and for a mass or volume product is pieces × the product's size
 *   (2 × 1 l bottles is 2 l); without a size there is no amount;
 * - anything else (kilograms of a product sold per litre) has no amount.
 */
export const baseQuantity = (line: PricedLine, product: ProductMeasure): number | null => {
  const productDimension = dimensionOf(product.unit);
  const lineUnit = line.unit ?? "piece";
  const pieces = (dimensionOf(lineUnit) === "count" ? line.quantity : 0) * (line.packSize ?? 1);
  if (dimensionOf(lineUnit) !== "count")
    return convertQuantity(line.quantity, lineUnit, product.unit);
  if (productDimension === "count") return pieces;
  if (product.size === null || product.sizeUnit === null) return null;
  const perPiece = convertQuantity(product.size, product.sizeUnit, product.unit);
  return perPiece === null ? null : pieces * perPiece;
};

/**
 * The line's price per one `product.unit`, in minor units (fractions kept to 4 places), as
 * `baseQuantity` measures the line; null when the line cannot be measured in that unit.
 */
export const pricePerBase = (line: PricedLine, product: ProductMeasure): number | null => {
  const quantity = baseQuantity(line, product);
  if (quantity === null || quantity <= 0) return null;
  return Math.round((line.lineTotal / quantity) * 10_000) / 10_000;
};

// ---------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------

/** The key raw receipt text matches by: trimmed, spaces collapsed, lower case. */
export const normalizeText = (text: string): string =>
  text.normalize("NFKC").trim().replaceAll(/\s+/g, " ").toLowerCase();

/** The words of a text for fuzzy matching: letters and digits, lower case. */
export const words = (text: string): Array<string> =>
  normalizeText(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");

/** How many of the words two texts share, over the larger word count: 0 to 1. */
export const wordOverlap = (a: string, b: string): number => {
  const left = new Set(words(a));
  const right = new Set(words(b));
  if (left.size === 0 || right.size === 0) return 0;
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / Math.max(left.size, right.size);
};

const trigrams = (text: string): Set<string> => {
  const padded = `  ${words(text).join(" ")} `;
  const grams = new Set<string>();
  for (let at = 0; at + 3 <= padded.length; at++) grams.add(padded.slice(at, at + 3));
  return grams;
};

/**
 * How alike two names are, 0 to 1: 1 when equal once normalised, 0.8 when one contains the other
 * (at least three letters), else the Dice coefficient of their letter trigrams.
 */
export const nameSimilarity = (a: string, b: string): number => {
  const left = words(a).join(" ");
  const right = words(b).join(" ");
  if (left === "" || right === "") return 0;
  if (left === right) return 1;
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  if (short.length >= 3 && ` ${long} `.includes(` ${short} `)) return 0.8;
  if (short.length >= 3 && long.replaceAll(" ", "").includes(short.replaceAll(" ", ""))) return 0.8;
  const x = trigrams(left);
  const y = trigrams(right);
  const shared = [...x].filter((gram) => y.has(gram)).length;
  return Math.round(((2 * shared) / (x.size + y.size)) * 1000) / 1000;
};

// ---------------------------------------------------------------------------------------------
// Matching payments
// ---------------------------------------------------------------------------------------------

/** How far from the receipt's day a bank transaction may fall: banks post days later. */
export const MATCH_WINDOW = { before: 3, after: 10 } as const;
/** Auto-match links only a transaction this close to the receipt's day. */
export const AUTO_MATCH_DAYS = 3;
/** A payment up to this share above the receipt's total may hold a tip. */
export const TIP_RATIO = 0.3;
/** A payee at least this similar to the store counts as the store. */
export const SIMILAR_PAYEE = 0.5;

export interface MatchInput {
  /** What the receipt still needs paid. */
  readonly amount: number;
  readonly date: string;
  readonly payeeId: string | null;
  readonly payeeName: string | null;
}

export interface MatchCandidateInput {
  /** The transaction's amount as money paid out: the negated register amount. */
  readonly amount: number;
  /** What other receipts already claim of it. */
  readonly claimed: number;
  /** Days from the receipt's day to the transaction's, negative before. */
  readonly days: number;
  readonly payeeId: string | null;
  readonly payeeNames: ReadonlyArray<string>;
}

export interface MatchScore {
  readonly score: number;
  readonly amount: "exact" | "tip";
  readonly payee: number;
  readonly reasons: Array<string>;
}

/**
 * How well a transaction pays a receipt, or null when it cannot: outside the date window, fully
 * claimed by other receipts, or an amount that is neither the receipt's (what is left of it) nor
 * that plus a tip of up to 30%. Amount weighs half, the date and the payee a quarter each.
 */
export const scoreMatch = (
  receipt: MatchInput,
  candidate: MatchCandidateInput,
): MatchScore | null => {
  if (candidate.days < -MATCH_WINDOW.before || candidate.days > MATCH_WINDOW.after) return null;
  const free = candidate.amount - candidate.claimed;
  if (receipt.amount === 0 || Math.sign(free) !== Math.sign(receipt.amount)) return null;
  const reasons: Array<string> = [];
  let amountScore: number;
  let amount: MatchScore["amount"];
  if (free === receipt.amount) {
    amount = "exact";
    amountScore = 1;
    reasons.push(
      candidate.claimed === 0 ? "same amount" : "same amount as what other receipts leave",
    );
  } else {
    const over = (free - receipt.amount) / receipt.amount;
    if (over <= 0 || over > TIP_RATIO) return null;
    amount = "tip";
    amountScore = 0.6 - over;
    reasons.push(`${Math.round(over * 100)}% more than the receipt: a tip?`);
  }
  const distance = Math.abs(candidate.days);
  const dateScore =
    candidate.days < 0
      ? 1 - distance / (MATCH_WINDOW.before + 1)
      : 1 - distance / (MATCH_WINDOW.after + 1);
  reasons.push(
    distance === 0
      ? "same day"
      : `${distance} day${distance === 1 ? "" : "s"} ${candidate.days < 0 ? "before" : "after"}`,
  );
  let payee = 0;
  if (receipt.payeeId !== null && candidate.payeeId === receipt.payeeId) {
    payee = 1;
    reasons.push("same payee");
  } else if (receipt.payeeName !== null) {
    payee = Math.max(
      0,
      ...candidate.payeeNames.map((name) => nameSimilarity(receipt.payeeName!, name)),
    );
    if (payee >= SIMILAR_PAYEE) reasons.push("similar payee");
  }
  const score = Math.round((0.5 * amountScore + 0.25 * dateScore + 0.25 * payee) * 1000) / 1000;
  return { score, amount, payee, reasons };
};

/** Whether auto-match may link a candidate without asking: exact, near in time, same store. */
export const isSureMatch = (match: MatchScore, days: number): boolean =>
  match.amount === "exact" && Math.abs(days) <= AUTO_MATCH_DAYS && match.payee >= SIMILAR_PAYEE;

// ---------------------------------------------------------------------------------------------
// Splitting a transaction by budget category
// ---------------------------------------------------------------------------------------------

export interface SplitReceipt {
  readonly id: string;
  /** What this receipt's payment takes of the transaction, as money paid out. */
  readonly amount: number;
  /** Line totals by budget category; null for a line that resolves to none. */
  readonly lines: ReadonlyArray<{
    readonly budgetCategoryId: string | null;
    readonly lineTotal: number;
  }>;
}

export interface SplitPlanInput {
  /** The transaction's amount as money paid out: the negated register amount. */
  readonly amount: number;
  readonly receipts: ReadonlyArray<SplitReceipt>;
  /** Where money no receipt claims goes; when null, the rules of `planSplit` decide. */
  readonly remainderCategory: string | null;
  /** The transaction's single category now (null for Uncategorized), or undefined when it has none. */
  readonly currentCategory: string | null | undefined;
}

export type SplitPlan =
  | {
      readonly ok: true;
      /** Money paid out per budget category, in the order categories first appear. */
      readonly splits: ReadonlyArray<{ readonly categoryId: string; readonly amount: number }>;
      /** Money no receipt claims and where it goes (null: Uncategorized). */
      readonly remainder: { readonly amount: number; readonly categoryId: string | null } | null;
      /** Whether the unclaimed money was spread over the receipt's categories. */
      readonly spread: boolean;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * The split a transaction gets from the receipts it pays. Each receipt's share (its payment
 * amount) is spread over its budget categories in proportion to their line totals, which carries
 * tax, discounts and the other adjustments along (largest remainder, exact to the cent). What no
 * receipt claims:
 * - goes to `remainderCategory` when given;
 * - else, with one receipt and at most 30% of its share (a tip, a card fee), is spread over its
 *   categories too, so the bank's amount wins;
 * - else stays on the transaction's current single category (or Uncategorized);
 * - else (the transaction is already a split) cannot be placed and the plan says so.
 */
export const planSplit = (input: SplitPlanInput): SplitPlan => {
  const claimed = sum(input.receipts.map((receipt) => receipt.amount));
  const unclaimed = input.amount - claimed;
  const [only] = input.receipts;
  const spread =
    input.remainderCategory === null &&
    unclaimed !== 0 &&
    input.receipts.length === 1 &&
    only !== undefined &&
    Math.sign(unclaimed) === Math.sign(only.amount) &&
    Math.abs(unclaimed) <= Math.abs(only.amount) * TIP_RATIO;
  const totals = new Map<string, number>();
  for (const receipt of input.receipts) {
    const unresolved = receipt.lines.filter((line) => line.budgetCategoryId === null).length;
    if (unresolved > 0)
      return {
        ok: false,
        reason: `Receipt ${receipt.id} has ${unresolved} line(s) without a budget category`,
      };
    if (receipt.lines.length === 0)
      return { ok: false, reason: `Receipt ${receipt.id} has no lines` };
    const byCategory = new Map<string, number>();
    for (const line of receipt.lines)
      byCategory.set(
        line.budgetCategoryId!,
        (byCategory.get(line.budgetCategoryId!) ?? 0) + line.lineTotal,
      );
    const share = spread ? input.amount : receipt.amount;
    const ids = [...byCategory.keys()];
    allocate(share, [...byCategory.values()]).forEach((amount, index) =>
      totals.set(ids[index]!, (totals.get(ids[index]!) ?? 0) + amount),
    );
  }
  let remainder: { readonly amount: number; readonly categoryId: string | null } | null = null;
  if (unclaimed !== 0 && !spread) {
    const categoryId = input.remainderCategory ?? input.currentCategory;
    if (categoryId === undefined)
      return {
        ok: false,
        reason: `${unclaimed} of the transaction is on no receipt and it has no single category to keep it on: give remainderCategory`,
      };
    remainder = { amount: unclaimed, categoryId };
  }
  return {
    ok: true,
    splits: [...totals].map(([categoryId, amount]) => ({ categoryId, amount })),
    remainder,
    spread,
  };
};

/**
 * Whether a transaction's postings already carry a plan: its money paid out per category (null
 * for Uncategorized) equals the plan's splits, plus the remainder on whichever one category it
 * was put.
 */
export const isPlanApplied = (
  plan: Extract<SplitPlan, { ok: true }>,
  current: ReadonlyMap<string | null, number>,
): boolean => {
  const expected = new Map<string | null, number>(
    plan.splits.map((split) => [split.categoryId, split.amount]),
  );
  const keys = new Set([...expected.keys(), ...current.keys()]);
  const differences = [...keys]
    .map((key) => (current.get(key) ?? 0) - (expected.get(key) ?? 0))
    .filter((difference) => difference !== 0);
  return plan.remainder === null
    ? differences.length === 0
    : differences.length === 1 && differences[0] === plan.remainder.amount;
};

// ---------------------------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------------------------

/**
 * The first value found walking up a tree from `id` (itself included): `value` of each node, then
 * of its parent. Stops at a cycle.
 */
export const nearestInTree = <A>(
  id: string | null,
  parentOf: (id: string) => string | null | undefined,
  value: (id: string) => A | null | undefined,
): A | null => {
  const seen = new Set<string>();
  for (
    let at: string | null | undefined = id;
    at !== null && at !== undefined && !seen.has(at);
    at = parentOf(at)
  ) {
    seen.add(at);
    const found = value(at);
    if (found !== null && found !== undefined) return found;
  }
  return null;
};

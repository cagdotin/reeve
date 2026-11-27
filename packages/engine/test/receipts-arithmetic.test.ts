import {
  allocate,
  baseQuantity,
  convertQuantity,
  lineAmount,
  nameSimilarity,
  normalizeText,
  planSplit,
  pricePerBase,
  receiptTotals,
  roundHalfAwayFromZero,
  scoreMatch,
  wordOverlap,
} from "@reeve/contract/receipts";
import { vi, afterEach, beforeEach, describe, expect, it } from "vitest";

// Frozen behavior stays covered without enabling purchases in the product.
vi.mock("@reeve/contract/features", () => ({ FEATURES: { purchases: true } }));
import { scratch } from "./helpers.ts";

/**
 * Receipts' (mggarofalo/Receipts) test-data/receipt-arithmetic.json, in dollars as there. Tax is
 * an adjustment in reeve, and the payments are what the receipt's total says was paid.
 */
const FIXTURE = [
  {
    id: "two-positive-midpoint-lines",
    lines: [
      [0.5, 2.01, 1.01],
      [0.5, 2.01, 1.01],
    ],
    tax: 0,
    adjustments: [],
    payments: [2.02],
    subtotal: 2.02,
    adjustmentTotal: 0,
    expectedTotal: 2.02,
    difference: 0,
    tolerated: true,
  },
  {
    id: "round-each-small-line-before-summing",
    lines: [
      [0.5, 0.01, 0.01],
      [0.5, 0.01, 0.01],
    ],
    tax: 0,
    adjustments: [],
    payments: [0.02],
    subtotal: 0.02,
    adjustmentTotal: 0,
    expectedTotal: 0.02,
    difference: 0,
    tolerated: true,
  },
  {
    id: "four-place-operands",
    lines: [
      [1.2345, 7.8912, 9.74],
      [0.0001, 99.9999, 0.01],
    ],
    tax: 0.23,
    adjustments: [-0.05, 0.02],
    payments: [3.3, 3.3, 3.35],
    subtotal: 9.75,
    adjustmentTotal: -0.03,
    expectedTotal: 9.95,
    difference: 0,
    tolerated: true,
  },
  {
    id: "repeated-fractional-payments",
    lines: [[1, 0.3, 0.3]],
    tax: 0,
    adjustments: [],
    payments: [0.1, 0.1, 0.1],
    subtotal: 0.3,
    adjustmentTotal: 0,
    expectedTotal: 0.3,
    difference: 0,
    tolerated: true,
  },
  {
    id: "tax-and-signed-adjustments",
    lines: [[1, 12.34, 12.34]],
    tax: 1.23,
    adjustments: [-0.57, 0.1],
    payments: [10, 3.1],
    subtotal: 12.34,
    adjustmentTotal: -0.47,
    expectedTotal: 13.1,
    difference: 0,
    tolerated: true,
  },
  {
    id: "exact-balance",
    lines: [[1, 1, 1]],
    tax: 0,
    adjustments: [],
    payments: [1],
    subtotal: 1,
    adjustmentTotal: 0,
    expectedTotal: 1,
    difference: 0,
    tolerated: true,
  },
  {
    id: "one-cent-less-payment",
    lines: [[1, 1, 1]],
    tax: 0,
    adjustments: [],
    payments: [0.99],
    subtotal: 1,
    adjustmentTotal: 0,
    expectedTotal: 1,
    difference: -0.01,
    tolerated: true,
  },
  {
    id: "one-cent-more-payment",
    lines: [[1, 1, 1]],
    tax: 0,
    adjustments: [],
    payments: [1.01],
    subtotal: 1,
    adjustmentTotal: 0,
    expectedTotal: 1,
    difference: 0.01,
    tolerated: true,
  },
  {
    id: "two-cents-less-payment",
    lines: [[1, 1, 1]],
    tax: 0,
    adjustments: [],
    payments: [0.98],
    subtotal: 1,
    adjustmentTotal: 0,
    expectedTotal: 1,
    difference: -0.02,
    tolerated: false,
  },
  {
    id: "two-cents-more-payment",
    lines: [[1, 1, 1]],
    tax: 0,
    adjustments: [],
    payments: [1.02],
    subtotal: 1,
    adjustmentTotal: 0,
    expectedTotal: 1,
    difference: 0.02,
    tolerated: false,
  },
] as const;

/** Dollars as minor units, by decimal text so 7.8912 is 789.12 and not 789.1199999. */
const cents = (dollars: number) => Number((dollars * 100).toFixed(6));

describe("the receipt arithmetic fixture", () => {
  it.each(FIXTURE)("$id", (fixture) => {
    const lines = fixture.lines.map(([quantity, unitPrice]) => ({
      lineTotal: lineAmount(quantity, cents(unitPrice)),
    }));
    expect(lines.map((line) => line.lineTotal)).toEqual(
      fixture.lines.map(([, , total]) => cents(total)),
    );
    const adjustments = [fixture.tax, ...fixture.adjustments]
      .filter((amount) => amount !== 0)
      .map((amount) => ({ amount: cents(amount) }));
    const total = fixture.payments.map(cents).reduce((a, b) => a + b, 0);
    const totals = receiptTotals({ lines, adjustments, payments: [{ amount: total }], total });
    expect(totals.itemsTotal).toBe(cents(fixture.subtotal));
    expect(totals.adjustmentsTotal).toBe(cents(fixture.tax) + cents(fixture.adjustmentTotal));
    expect(totals.expectedTotal).toBe(cents(fixture.expectedTotal));
    expect(totals.difference).toBe(cents(fixture.difference));
    expect(totals.balanced).toBe(fixture.tolerated);
  });

  describe("through create_receipt", () => {
    let s: ReturnType<typeof scratch>;
    beforeEach(() => {
      s = scratch();
    });
    afterEach(() => s.dispose());

    it.each(FIXTURE)("$id", async (fixture) => {
      const { receipt } = await s.call("create_receipt", {
        date: "2026-10-10",
        total: fixture.payments.map(cents).reduce((a, b) => a + b, 0),
        lines: fixture.lines.map(([quantity, unitPrice], index) => ({
          text: `line ${index}`,
          quantity,
          unitPrice: cents(unitPrice),
        })),
        adjustments: [
          ...(fixture.tax === 0 ? [] : [{ kind: "tax", amount: cents(fixture.tax) }]),
          ...fixture.adjustments.map((amount) => ({ kind: "other", amount: cents(amount) })),
        ],
      });
      expect(receipt.status).toMatchObject({
        itemsTotal: cents(fixture.subtotal),
        expectedTotal: cents(fixture.expectedTotal),
        difference: cents(fixture.difference),
        balanced: fixture.tolerated,
      });
    });
  });
});

describe("rounding", () => {
  it("rounds midpoints away from zero", () => {
    expect([0.5, 1.5, 2.5, -0.5, -1.5, 0.49].map(roundHalfAwayFromZero)).toEqual([
      1, 2, 3, -1, -2, 0,
    ]);
  });

  it("multiplies as decimals before rounding", () => {
    expect(lineAmount(0.5, 201)).toBe(101);
    expect(lineAmount(3, 33.335)).toBe(100);
    expect(lineAmount(1.005, 100)).toBe(101);
    expect(lineAmount(-0.5, 201)).toBe(-101);
    expect(lineAmount(1.5e-7, 1e7)).toBe(2);
  });
});

describe("allocation", () => {
  it("splits by largest remainder, exact to the cent", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1000, [333, 333, 334])).toEqual([333, 333, 334]);
    expect(allocate(10, [])).toEqual([]);
    expect(allocate(7, [0, 0])).toEqual([7, 0]);
  });

  it("handles negative weights and negative totals", () => {
    const shares = allocate(950, [1000, -100]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(950);
    expect(shares).toEqual([1056, -106]);
    expect(allocate(-100, [1, 2]).reduce((a, b) => a + b, 0)).toBe(-100);
    expect(allocate(5, [100, -100]).reduce((a, b) => a + b, 0)).toBe(5);
  });
});

describe("units and price normalisation", () => {
  it("converts within a dimension only", () => {
    expect(convertQuantity(500, "g", "kg")).toBe(0.5);
    expect(convertQuantity(1, "lb", "g")).toBeCloseTo(453.59237);
    expect(convertQuantity(1, "l", "ml")).toBe(1000);
    expect(convertQuantity(1, "kg", "l")).toBeNull();
  });

  const line = (
    quantity: number,
    unit: any,
    lineTotal: number,
    packSize: number | null = null,
  ) => ({
    quantity,
    unit,
    lineTotal,
    packSize,
  });

  it("measures weighed lines, counted lines with a size, and packs", () => {
    const perKg = { unit: "kg" as const, size: null, sizeUnit: null };
    expect(pricePerBase(line(0.5, "kg", 150), perKg)).toBe(300);
    expect(pricePerBase(line(250, "g", 100), perKg)).toBe(400);
    expect(pricePerBase(line(1, "lb", 453.59237), perKg)).toBe(1000);
    expect(pricePerBase(line(2, null, 300), perKg)).toBeNull();
    const milk = { unit: "l" as const, size: 500, sizeUnit: "ml" as const };
    expect(baseQuantity(line(2, null, 0), milk)).toBe(1);
    expect(pricePerBase(line(2, null, 150), milk)).toBe(150);
    expect(pricePerBase(line(1, "pack", 450, 6), milk)).toBe(150);
    expect(
      pricePerBase(line(1, "pack", 450, 6), { unit: "piece", size: null, sizeUnit: null }),
    ).toBe(75);
    expect(pricePerBase(line(1, "kg", 100), milk)).toBeNull();
  });
});

describe("text", () => {
  it("normalises receipt text for matching", () => {
    expect(normalizeText("  ORG   Milk\t1L ")).toBe("org milk 1l");
  });

  it("scores word overlap and name similarity", () => {
    expect(wordOverlap("Organic Milk 1L", "milk organic")).toBeCloseTo(2 / 3);
    expect(nameSimilarity("REWE Markt GmbH", "rewe markt gmbh")).toBe(1);
    expect(nameSimilarity("REWE", "REWE Markt 123")).toBe(0.8);
    expect(nameSimilarity("Whole Foods", "WHOLEFDS MKT 10234")).toBeGreaterThan(0.3);
    expect(nameSimilarity("Shell", "Aldi")).toBeLessThan(0.2);
  });
});

describe("match scores", () => {
  const receipt = { amount: 5000, date: "2026-10-10", payeeId: "p1", payeeName: "Grocer" };
  const candidate = { amount: 5000, claimed: 0, days: 0, payeeId: "p1", payeeNames: ["Grocer"] };

  it("prefers exact amounts, near days and the same payee", () => {
    expect(scoreMatch(receipt, candidate)).toMatchObject({ score: 1, amount: "exact", payee: 1 });
    expect(scoreMatch(receipt, { ...candidate, days: 5 })!.score).toBeLessThan(1);
    expect(scoreMatch(receipt, { ...candidate, payeeId: null, payeeNames: [] })!.score).toBe(0.75);
  });

  it("allows a tip of up to 30% and nothing else", () => {
    expect(scoreMatch(receipt, { ...candidate, amount: 6000 })).toMatchObject({ amount: "tip" });
    expect(scoreMatch(receipt, { ...candidate, amount: 6600 })).toBeNull();
    expect(scoreMatch(receipt, { ...candidate, amount: 4000 })).toBeNull();
  });

  it("keeps to the window and skips what other receipts claim", () => {
    expect(scoreMatch(receipt, { ...candidate, days: -4 })).toBeNull();
    expect(scoreMatch(receipt, { ...candidate, days: 11 })).toBeNull();
    expect(scoreMatch(receipt, { ...candidate, claimed: 5000 })).toBeNull();
    expect(scoreMatch(receipt, { ...candidate, amount: 8000, claimed: 3000 })).toMatchObject({
      amount: "exact",
    });
  });
});

describe("split plans", () => {
  const lines = (...pairs: Array<[string | null, number]>) =>
    pairs.map(([budgetCategoryId, lineTotal]) => ({ budgetCategoryId, lineTotal }));

  it("spreads adjustments and a tip over categories, exact to the bank's amount", () => {
    const plan = planSplit({
      amount: 1200,
      receipts: [
        { id: "r", amount: 1000, lines: lines(["food", 600], ["home", 300], ["food", 33]) },
      ],
      remainderCategory: null,
      currentCategory: undefined,
    });
    expect(plan).toMatchObject({ ok: true, spread: true, remainder: null });
    if (!plan.ok) return;
    expect(plan.splits).toEqual([
      { categoryId: "food", amount: 814 },
      { categoryId: "home", amount: 386 },
    ]);
  });

  it("keeps money beyond a tip on the current category, else asks", () => {
    const receipts = [{ id: "r", amount: 500, lines: lines(["food", 500]) }];
    expect(
      planSplit({ amount: 1000, receipts, remainderCategory: null, currentCategory: "misc" }),
    ).toMatchObject({
      ok: true,
      remainder: { amount: 500, categoryId: "misc" },
    });
    expect(
      planSplit({ amount: 1000, receipts, remainderCategory: null, currentCategory: undefined }).ok,
    ).toBe(false);
    expect(
      planSplit({ amount: 1000, receipts, remainderCategory: "x", currentCategory: undefined }),
    ).toMatchObject({
      remainder: { categoryId: "x" },
    });
  });

  it("refuses lines without a budget category", () => {
    const plan = planSplit({
      amount: 100,
      receipts: [{ id: "r", amount: 100, lines: lines([null, 100]) }],
      remainderCategory: null,
      currentCategory: null,
    });
    expect(plan.ok).toBe(false);
  });
});

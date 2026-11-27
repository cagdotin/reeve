import {
  allocate,
  isPlanApplied,
  lineAmount,
  planSplit,
  receiptTotals,
  type SplitPlanInput,
} from "@reeve/contract/receipts";
import fc from "fast-check";
import { vi, afterAll, beforeAll, describe, expect, it } from "vitest";

// Frozen behavior stays covered without enabling purchases in the product.
vi.mock("@reeve/contract/features", () => ({ FEATURES: { purchases: true } }));
import { runsOr, SEED } from "./budget.ts";
import { freezeClock, isRefusal, openWorld, thawClock } from "./world.ts";

const DAY = "2026-06-10";
const NEVER = 3_600_000;
const pure = { numRuns: runsOr(600), seed: SEED, includeErrorInReport: true };
const throughOperations = { numRuns: runsOr(25), seed: SEED, includeErrorInReport: true };

const sum = (values: ReadonlyArray<number>) => values.reduce((total, each) => total + each, 0);

const cents = fc.integer({ min: -2_000_000_000, max: 2_000_000_000 });
const smallCents = fc.integer({ min: -100_000, max: 100_000 });
const weights = fc.array(fc.oneof(cents, smallCents, fc.constant(0)), {
  minLength: 1,
  maxLength: 12,
});
const category = fc.constantFrom("a", "b", "c", "d");

const receipt = (id: string) =>
  fc.record({
    id: fc.constant(id),
    amount: smallCents,
    lines: fc.array(fc.record({ budgetCategoryId: category, lineTotal: smallCents }), {
      minLength: 1,
      maxLength: 6,
    }),
  });

const plan: fc.Arbitrary<SplitPlanInput> = fc.record({
  amount: smallCents,
  receipts: fc.oneof(fc.tuple(receipt("r1")), fc.tuple(receipt("r1"), receipt("r2"))),
  remainderCategory: fc.option(category, { nil: null }),
  currentCategory: fc.option(fc.option(category, { nil: null }), { nil: undefined }),
});

beforeAll(freezeClock);
afterAll(thawClock);

describe("receipt arithmetic", () => {
  it("allocate hands out exactly the total, in whole cents", () =>
    fc.assert(
      fc.property(cents, weights, (total, each) => {
        const shares = allocate(total, each);
        expect(shares).toHaveLength(each.length);
        expect(shares.every(Number.isSafeInteger)).toBe(true);
        expect(sum(shares)).toBe(total);
      }),
      pure,
    ));

  it("allocate gives each share within a cent of its exact part", () =>
    fc.assert(
      fc.property(
        cents,
        fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 12 }),
        (total, each) => {
          const whole = BigInt(sum(each));
          allocate(total, each).forEach((share, index) => {
            const off = BigInt(share) * whole - BigInt(total) * BigInt(each[index]!);
            expect((off < 0n ? -off : off) <= whole).toBe(true);
          });
        },
      ),
      pure,
    ));

  it("lineAmount is the product of two decimals, rounded half away from zero", () =>
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: 0, max: 3 }),
        (quantityDigits, quantityScale, priceDigits, priceScale) => {
          const scale = 10n ** BigInt(quantityScale + priceScale);
          const product = BigInt(quantityDigits) * BigInt(priceDigits);
          const size = product < 0n ? -product : product;
          const rounded = (size * 2n + scale) / (scale * 2n);
          const expected = Number(product < 0n ? -rounded : rounded);
          const [quantity, price] = [
            quantityDigits / 10 ** quantityScale,
            priceDigits / 10 ** priceScale,
          ];
          expect(lineAmount(quantity, price) + 0).toBe(expected + 0);
          expect(lineAmount(price, quantity) + 0).toBe(expected + 0);
        },
      ),
      pure,
    ));

  it("lineAmount rounds an exact midpoint away from zero, where floats fall short of it", () =>
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000 }),
        fc.integer({ min: 1, max: 1_000 }),
        fc.boolean(),
        (thousandths, hundreds, negative) => {
          // Five thousandths of an odd count times a multiple of 100 ends in exactly .5.
          const digits = (2 * thousandths + 1) * 5;
          const price = (2 * hundreds - 1) * 100;
          const exactTimesTwo = (digits * price) / 500;
          const expected = (exactTimesTwo + 1) / 2;
          const sign = negative ? -1 : 1;
          expect(lineAmount((sign * digits) / 1000, price)).toBe(sign * expected);
        },
      ),
      pure,
    ));

  it("a receipt's difference is what an adjustment needs to balance it", () =>
    fc.assert(
      fc.property(
        fc.array(smallCents, { maxLength: 8 }),
        fc.array(smallCents, { maxLength: 4 }),
        smallCents,
        (lines, adjustments, total) => {
          const input = {
            lines: lines.map((lineTotal) => ({ lineTotal })),
            adjustments: adjustments.map((amount) => ({ amount })),
            payments: [],
            total,
          };
          const { expectedTotal, difference } = receiptTotals(input);
          expect(expectedTotal + difference).toBe(total);
          const fixed = receiptTotals({
            ...input,
            adjustments: [...input.adjustments, { amount: difference }],
          });
          expect(fixed.difference).toBe(0);
          expect(fixed.balanced).toBe(true);
        },
      ),
      pure,
    ));

  it("a split plan places every cent of the transaction, and reads back as applied", () =>
    fc.assert(
      fc.property(plan, (input) => {
        const result = planSplit(input);
        if (!result.ok) {
          if (input.currentCategory !== undefined) throw new Error(result.reason);
          return;
        }
        const placed = sum(result.splits.map((split) => split.amount));
        expect(placed + (result.remainder?.amount ?? 0)).toBe(input.amount);
        expect(result.splits.every((split) => Number.isSafeInteger(split.amount))).toBe(true);
        const current = new Map<string | null, number>();
        for (const split of result.splits) current.set(split.categoryId, split.amount);
        if (result.remainder !== null) {
          const on = result.remainder.categoryId;
          current.set(on, (current.get(on) ?? 0) + result.remainder.amount);
        }
        expect(isPlanApplied(result, current)).toBe(true);
      }),
      pure,
    ));
});

const lineDraw = fc.record({
  price: fc.integer({ min: -30_000, max: 30_000 }),
  quantity: fc.constantFrom(1, 2, 3, 0.5, 0.25, 1.337),
  category: fc.nat({ max: 99 }),
});

const adjustmentDraw = fc.record({
  kind: fc.constantFrom("tax", "discount", "tip", "fee", "deposit", "rounding", "coupon"),
  amount: fc.integer({ min: -2_000, max: 2_000 }),
});

const purchase = fc.record({
  lines: fc.array(lineDraw, { minLength: 1, maxLength: 6 }),
  adjustments: fc.array(adjustmentDraw, { maxLength: 3 }),
  /** What the bank took beyond the receipt: a tip, a card fee, or something else. */
  extra: fc.oneof(fc.constant(0), fc.integer({ min: -50_000, max: 50_000 })),
  remainderCategory: fc.option(fc.nat({ max: 99 }), { nil: null, freq: 2 }),
});

describe("a receipt applied to its transaction", () => {
  it(
    "keeps the transaction's amount, puts each category's share on it, and reads as applied",
    { timeout: NEVER },
    () =>
      fc.assert(
        fc.asyncProperty(purchase, async (drawn) => {
          const world = await openWorld();
          try {
            const account = (await world.call("create_account", { name: "Checking" })).id;
            const groups = await world.call<Array<any>>("list_categories");
            const categories: Array<string> = groups
              .filter((group) => !group.isIncome)
              .flatMap((group) => group.categories.map((each: any) => each.id));
            const categoryOf = (index: number) => categories[index % categories.length]!;
            const lines = drawn.lines.map((line, index) => ({
              text: `Line ${index}`,
              quantity: line.quantity,
              unitPrice: line.price,
              budgetCategoryId: categoryOf(line.category),
            }));
            const made = await world.call("create_receipt", {
              date: DAY,
              total: 1,
              lines,
              adjustments: drawn.adjustments,
            });
            const expected = made.receipt.status.expectedTotal;
            if (expected === 0) return;
            await world.call("update_receipt", { id: made.receipt.id, total: expected });
            const paid = expected + drawn.extra;
            if (Math.sign(paid) !== Math.sign(expected)) return;
            const { id } = await world.call("create_transaction", {
              date: DAY,
              account,
              amount: -paid,
            });
            await world.call("link_receipt_payment", {
              receipt: made.receipt.id,
              transaction: id,
              amount: Math.abs(paid) < Math.abs(expected) ? paid : expected,
            });
            const remainder =
              drawn.remainderCategory === null
                ? {}
                : { remainderCategory: categoryOf(drawn.remainderCategory) };
            const receipt = made.receipt.id;
            const planned = await world.call("receipt_split_preview", {
              id: receipt,
              ...remainder,
            });
            const applied = await world.call("apply_receipt_to_transaction", {
              id: receipt,
              ...remainder,
            });
            const tx = await world.call("get_transaction", { id });
            const own = tx.postings.find((posting: any) => posting.accountId === account);
            expect(own.amount, "the bank's amount").toBe(-paid);
            expect(applied.receipt.status.applied, "reads as applied").toBe(true);
            const others = tx.postings.filter((posting: any) => posting !== own);
            expect(sum(others.map((posting: any) => posting.amount)), "every cent").toBe(paid);
            const ledger = await world.call<Array<any>>("list_ledger_accounts");
            const uncategorized = ledger.find((each) => each.system === "uncategorized")?.id;
            expect(
              others.map((posting: any) => ({
                categoryId: posting.accountId === uncategorized ? null : posting.accountId,
                amount: -posting.amount,
              })),
              "what the preview said",
            ).toEqual(
              planned.splits.map((split: any) => ({
                categoryId: split.categoryId,
                amount: split.amount,
              })),
            );
            await world.call("apply_receipt_to_transaction", { id: receipt, ...remainder });
            expect(await world.call("get_transaction", { id }), "applying it again").toEqual(tx);
          } catch (error) {
            if (!isRefusal(error)) throw error;
            throw new Error(`refused: ${(error as Error).message}`);
          } finally {
            await world.close();
          }
        }),
        throughOperations,
      ),
  );
});

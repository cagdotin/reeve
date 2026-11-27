import { today } from "@reeve/contract/rules";
import { vi, afterEach, beforeEach, describe, expect, it } from "vitest";

// Frozen behavior stays covered without enabling purchases in the product.
vi.mock("@reeve/contract/features", () => ({ FEATURES: { purchases: true } }));
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
let book: string;
beforeEach(async () => {
  s = scratch();
  book = (await s.call("create_book", { name: "Test" })).id;
});
afterEach(() => s.dispose());

const dayBefore = (days: number) => {
  const date = new Date(`${today()}T12:00:00`);
  date.setDate(date.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const product = (name: string, input: Record<string, unknown> = {}) =>
  s.call("create_product", { book, name, ...input });

const archivedProduct = async (name: string) => {
  const { id } = await product(name);
  await s.call("update_product", { book, id, archived: true });
  return { id };
};

const buy = (
  date: string,
  payee: string,
  lines: ReadonlyArray<Record<string, unknown>>,
  input: Record<string, unknown> = {},
) =>
  s
    .call("create_receipt", {
      book,
      date,
      payee,
      total: lines.reduce((sum, line: any) => sum + (line.lineTotal ?? 0), 0),
      lines,
      ...input,
    })
    .then((result: any) => result.receipt);

const activity = (input: Record<string, unknown> = {}) =>
  s.call("product_activity", { book, ...input });

const rowOf = (overview: any, id: string) => overview.products.find((row: any) => row.id === id);

describe("product_activity", () => {
  it("adds up to item_spending, spreading a receipt's tax over its lines", async () => {
    const milk = await product("Milk");
    await buy(
      dayBefore(5),
      "Hofer",
      [
        { text: "Milk", productId: milk.id, lineTotal: 300 },
        { text: "Mystery", lineTotal: 100 },
      ],
      { total: 440, adjustments: [{ kind: "tax", amount: 40 }] },
    );
    const since = dayBefore(30);
    const overview = await activity({ since });
    const report = await s.call("item_spending", { book, from: since, groupBy: "product" });
    expect(overview.summary.spent).toBe(report.total);
    expect(overview.summary.spent).toBe(440);
    expect(rowOf(overview, milk.id).spent).toBe(
      report.groups.find((group: any) => group.id === milk.id).amount,
    );
    expect(overview.summary.unassignedSpent).toBe(
      report.groups.find((group: any) => group.id === null).amount,
    );
    const categories = await s.call("item_spending", {
      book,
      from: since,
      groupBy: "item_category",
    });
    expect(overview.categories.map((each: any) => [each.id, each.spent])).toEqual(
      categories.groups.map((each: any) => [each.id, each.amount]),
    );
  });

  it("compares the range with the same days before it", async () => {
    const milk = await product("Milk");
    await buy(dayBefore(50), "Hofer", [{ text: "Milk", productId: milk.id, lineTotal: 200 }]);
    await buy(dayBefore(5), "Hofer", [{ text: "Milk", productId: milk.id, lineTotal: 300 }]);
    await buy(dayBefore(200), "Hofer", [{ text: "Milk", productId: milk.id, lineTotal: 999 }]);
    const overview = await activity({ since: dayBefore(30) });
    expect(overview.summary.spent).toBe(300);
    expect(overview.summary.previous).toEqual({ products: 1, spent: 200, purchases: 1 });
    const wider = await activity({ since: dayBefore(60) });
    expect(wider.summary.spent).toBe(500);
    expect(wider.summary.previous.spent).toBe(0);
    const row = rowOf(await activity({ since: dayBefore(10) }), milk.id);
    expect(row.spent).toBe(300);
    expect(row.totalPurchases).toBe(3);
    expect(row.rollup.lastBought).toBe(dayBefore(5));
    expect((await activity()).summary.previous).toBeNull();
    expect((await activity()).earliest).toBe(dayBefore(200));
  });

  it("counts a kind once: on its own row and in its parent's rollup", async () => {
    const milk = await product("Milk", { unit: "l" });
    const organic = await product("Organic", { unit: "l", parentId: milk.id });
    const oat = await product("Oat", { unit: "l", parentId: milk.id });
    await buy(dayBefore(3), "Hofer", [
      { text: "Milk", productId: milk.id, quantity: 1, unit: "l", lineTotal: 100 },
      { text: "Organic", productId: organic.id, quantity: 1, unit: "l", lineTotal: 200 },
      { text: "Oat", productId: oat.id, quantity: 2, unit: "l", lineTotal: 500 },
    ]);
    const overview = await activity();
    const parent = rowOf(overview, milk.id);
    expect(parent.kinds).toBe(2);
    expect(parent.spent).toBe(100);
    expect(parent.rollup.spent).toBe(800);
    expect(parent.rollup.purchases).toBe(3);
    expect(overview.summary.spent).toBe(800);
    expect(overview.summary.products).toBe(3);
    const roots = overview.products.filter((row: any) => row.parentId === null);
    expect(roots.reduce((sum: number, row: any) => sum + row.rollup.spent, 0)).toBe(800);
    expect(overview.products.reduce((sum: number, row: any) => sum + row.spent, 0)).toBe(800);
    expect(parent.prices.map((each: any) => each.price)).toEqual([100, 200, 250]);
    expect(rowOf(overview, oat.id).prices.map((each: any) => each.price)).toEqual([250]);
  });

  it("says how much of the total is on archived products", async () => {
    const old = await archivedProduct("Old soap");
    const milk = await product("Milk");
    await buy(dayBefore(3), "Hofer", [
      { text: "Soap", productId: old.id, lineTotal: 150 },
      { text: "Milk", productId: milk.id, lineTotal: 250 },
    ]);
    const { summary, products } = await activity();
    expect(summary.spent).toBe(400);
    expect(summary.archivedSpent).toBe(150);
    expect(summary.archivedProducts).toBe(1);
    expect(products.find((row: any) => row.id === old.id).archived).toBe(true);
  });

  it("reads price changes as price_changes does, per unit, in both directions", async () => {
    const milk = await product("Milk", { unit: "l", size: 1, sizeUnit: "l" });
    const rice = await product("Rice", { unit: "kg" });
    const since = dayBefore(30);
    await buy(dayBefore(40), "Hofer", [
      { text: "Milk 2x", productId: milk.id, quantity: 2, lineTotal: 200 },
      { text: "Rice", productId: rice.id, quantity: 1000, unit: "g", lineTotal: 400 },
    ]);
    await buy(dayBefore(5), "Hofer", [
      { text: "Milk", productId: milk.id, quantity: 1, lineTotal: 150 },
      { text: "Rice", productId: rice.id, quantity: 2, unit: "kg", lineTotal: 600 },
    ]);
    const overview = await activity({ since });
    const changes = await s.call("price_changes", { book, from: since, compareTo: "average" });
    expect(overview.movers.dearerCount).toBe(1);
    expect(overview.movers.cheaperCount).toBe(1);
    expect(overview.movers.dearer[0]).toMatchObject({
      id: milk.id,
      before: 100,
      latest: 150,
      changePct: 50,
    });
    expect(overview.movers.cheaper[0]).toMatchObject({ id: rice.id, changePct: -25 });
    expect(rowOf(overview, milk.id).change.changePct).toBe(
      changes.find((each: any) => each.productId === milk.id).changePct,
    );
  });

  it("never prices across units: a line that cannot be measured has no price and is counted", async () => {
    const milk = await product("Milk", { unit: "l" });
    await buy(dayBefore(20), "Hofer", [
      { text: "Milk", productId: milk.id, quantity: 1, unit: "l", lineTotal: 100 },
    ]);
    await buy(dayBefore(5), "Hofer", [
      { text: "Milk bottle", productId: milk.id, quantity: 1, lineTotal: 500 },
      { text: "Milk powder", productId: milk.id, quantity: 1, unit: "kg", lineTotal: 900 },
    ]);
    const overview = await activity({ since: dayBefore(10), compareTo: "previous" });
    const row = rowOf(overview, milk.id);
    expect(row.prices.map((each: any) => each.price)).toEqual([100]);
    expect(row.unmeasured).toBe(2);
    expect(row.change).toBeNull();
    expect(overview.attention.unmeasured).toBe(1);
  });

  it("leaves a kind in another unit out of its parent's prices", async () => {
    const milk = await product("Milk", { unit: "l" });
    const powder = await product("Powder", { unit: "kg", parentId: milk.id });
    await buy(dayBefore(5), "Hofer", [
      { text: "Powder", productId: powder.id, quantity: 1, unit: "kg", lineTotal: 900 },
    ]);
    const overview = await activity();
    expect(rowOf(overview, milk.id).prices).toEqual([]);
    expect(rowOf(overview, milk.id).rollup.spent).toBe(900);
    expect(rowOf(overview, powder.id).prices).toEqual([{ date: dayBefore(5), price: 900 }]);
  });

  it("keeps a free line and a discount line out of prices and movers", async () => {
    const milk = await product("Milk");
    await buy(dayBefore(20), "Hofer", [{ text: "Milk", productId: milk.id, lineTotal: 100 }]);
    await buy(dayBefore(10), "Hofer", [
      { text: "Milk", productId: milk.id, lineTotal: 100 },
      { text: "Milk free", productId: milk.id, lineTotal: 0 },
    ]);
    await buy(dayBefore(5), "Hofer", [
      { text: "Milk", productId: milk.id, lineTotal: -40 },
      { text: "Bread", lineTotal: 100 },
    ]);
    const overview = await activity({ compareTo: "previous" });
    expect(rowOf(overview, milk.id).prices.map((each: any) => each.price)).toEqual([100, 100]);
    expect(overview.movers.dearerCount + overview.movers.cheaperCount).toBe(0);
  });

  describe("attention", () => {
    it("counts unassigned lines and those a known name or alias already names", async () => {
      await product("Milk");
      const eggs = await product("Eggs");
      await s.call("create_alias", { book, productId: eggs.id, text: "EIER 10ER" });
      const store = (await s.call("create_payee", { book, name: "Hofer" })).id;
      await s.call("reject_alias", { book, productId: eggs.id, text: "EIER 6ER" });
      await buy(dayBefore(3), "Hofer", [
        { text: "Unknown thing", lineTotal: 100 },
        { text: "EIER 6ER", lineTotal: 100 },
      ]);
      // Lines that came before the name or the alias.
      const late = await buy(dayBefore(2), "Billa", [{ text: "Butter", lineTotal: 100 }]);
      await product("Butter");
      const receipt = await buy(dayBefore(1), "Hofer", [{ text: "Tofu", lineTotal: 50 }]);
      const tofu = await product("Tofu block");
      await s.call("create_alias", {
        book,
        productId: tofu.id,
        text: "Tofu",
        payeeId: store,
      });
      await buy(dayBefore(1), "Billa", [{ text: "Tofu", lineTotal: 50 }]);
      expect(late.lines[0].productId).toBeNull();
      expect(receipt.lines[0].productId).toBeNull();
      const { attention, summary } = await activity();
      expect(attention.unassigned).toBe(5);
      // Butter by name and Tofu at Hofer; not the rejected text, and not Tofu at another store.
      expect(attention.named).toBe(2);
      expect(summary.unassignedSpent).toBe(400);
    });

    it("finds products with lines but no item category, ignoring archived and unbought", async () => {
      const dairy = await s.call("create_item_category", { book, name: "Dairy" });
      const milk = await product("Milk", { itemCategoryId: dairy.id });
      const kind = await product("Oat milk", { parentId: milk.id });
      const bare = await product("Bare");
      await product("Never bought");
      const gone = await archivedProduct("Gone");
      await buy(dayBefore(3), "Hofer", [
        { text: "a", productId: kind.id, lineTotal: 1 },
        { text: "b", productId: bare.id, lineTotal: 1 },
        { text: "c", productId: gone.id, lineTotal: 1 },
      ]);
      const overview = await activity();
      expect(overview.attention.uncategorized).toBe(1);
      expect(rowOf(overview, kind.id).itemCategoryId).toBe(dairy.id);
    });

    it("calls products duplicates only on the same name or an alias naming both", async () => {
      const a = await product("Whole Milk");
      const b = await product("whole-milk");
      const near = await product("Whole Milk Organic");
      const parent = await product("Tea");
      await product("TEA", { parentId: parent.id });
      await archivedProduct("Whole milk");
      const x = await product("Soap bar");
      const y = await product("Hand soap");
      await s.call("create_alias", { book, productId: x.id, text: "SEIFE" });
      await s.call("create_alias", { book, productId: y.id, text: "seife" });
      const overview = await activity();
      expect(rowOf(overview, a.id).duplicates).toEqual([b.id]);
      expect(rowOf(overview, near.id).duplicates).toEqual([]);
      expect(rowOf(overview, parent.id).duplicates).toEqual([]);
      expect(rowOf(overview, x.id).duplicates).toEqual([y.id]);
      expect(overview.attention.duplicates).toBe(4);
    });
  });

  it("gives twelve months, the current one last", async () => {
    const milk = await product("Milk");
    await buy(today(), "Hofer", [
      { text: "Milk", productId: milk.id, lineTotal: 300 },
      { text: "Mystery", lineTotal: 100 },
    ]);
    const { months } = await activity();
    expect(months).toHaveLength(12);
    expect(months.at(-1)).toMatchObject({
      month: today().slice(0, 7),
      products: 1,
      spent: 400,
      purchases: 2,
      unassigned: 1,
    });
  });
});

describe("product_summary", () => {
  it("totals a product with its kinds, in its unit, with what each kind took", async () => {
    const milk = await product("Milk", { unit: "l", size: 1, sizeUnit: "l" });
    const oat = await product("Oat", { unit: "l", parentId: milk.id });
    await buy(dayBefore(30), "Hofer", [
      { text: "Milk", productId: milk.id, quantity: 2, lineTotal: 200 },
      { text: "Bread", lineTotal: 100 },
    ]);
    await buy(dayBefore(20), "Hofer", [
      { text: "Oat", productId: oat.id, quantity: 500, unit: "ml", lineTotal: 150 },
    ]);
    await buy(dayBefore(10), "Billa", [
      { text: "Milk", productId: milk.id, quantity: 1, unit: "kg", lineTotal: 90 },
    ]);
    const summary = await s.call("product_summary", { book, id: milk.id });
    expect(summary.spent).toBe(440);
    expect(summary.purchases).toBe(3);
    expect(summary.quantity).toBe(2.5);
    expect(summary.unmeasured).toBe(1);
    expect(summary.firstBought).toBe(dayBefore(30));
    expect(summary.lastBought).toBe(dayBefore(10));
    expect(summary.intervalDays).toBe(10);
    expect(summary.kinds).toEqual([
      {
        id: oat.id,
        name: "Oat",
        archived: false,
        spent: 150,
        purchases: 1,
        lastBought: dayBefore(20),
      },
    ]);
    const oats = await s.call("product_summary", { book, id: oat.id });
    expect(oats.spent).toBe(150);
    expect(oats.intervalDays).toBeNull();
  });

  it("agrees with product_activity on what the product took of a receipt with tax", async () => {
    const milk = await product("Milk");
    await buy(
      dayBefore(5),
      "Hofer",
      [
        { text: "Milk", productId: milk.id, lineTotal: 300 },
        { text: "Bread", lineTotal: 100 },
      ],
      { total: 440, adjustments: [{ kind: "tax", amount: 40 }] },
    );
    const summary = await s.call("product_summary", { book, id: milk.id });
    expect(summary.spent).toBe(rowOf(await activity(), milk.id).rollup.spent);
    expect(summary.spent).toBe(330);
  });

  it("needs three days bought for an interval, and has none for a product never bought", async () => {
    const milk = await product("Milk");
    expect(await s.call("product_summary", { book, id: milk.id })).toMatchObject({
      spent: 0,
      purchases: 0,
      firstBought: null,
      lastBought: null,
      intervalDays: null,
      quantity: 0,
      kinds: [],
    });
    await buy(dayBefore(9), "Hofer", [{ text: "m", productId: milk.id, lineTotal: 1 }]);
    await buy(dayBefore(9), "Billa", [{ text: "m", productId: milk.id, lineTotal: 1 }]);
    await buy(dayBefore(3), "Hofer", [{ text: "m", productId: milk.id, lineTotal: 1 }]);
    expect((await s.call("product_summary", { book, id: milk.id })).intervalDays).toBeNull();
  });
});

describe("delete_product", () => {
  it("leaves its lines unassigned, drops its aliases, lifts its kinds, and undoes", async () => {
    const top = await product("Dairy things");
    const milk = await product("Milk", { parentId: top.id });
    const oat = await product("Oat", { parentId: milk.id });
    await s.call("create_alias", { book, productId: milk.id, text: "MILCH" });
    await buy(dayBefore(2), "Hofer", [{ text: "MILCH", lineTotal: 120 }]);
    const before = await activity();
    expect(rowOf(before, milk.id).totalPurchases).toBe(1);

    await s.call("delete_product", { book, id: milk.id });
    const after = await activity();
    expect(after.attention.unassigned).toBe(1);
    expect(after.summary.spent).toBe(120);
    expect(rowOf(after, oat.id).parentId).toBe(top.id);
    expect(await s.call("list_aliases", { book })).toEqual([]);

    await s.call("undo", { book });
    const restored = await activity();
    expect(rowOf(restored, milk.id).totalPurchases).toBe(1);
    expect(restored.attention.unassigned).toBe(0);
    expect(rowOf(restored, oat.id).parentId).toBe(milk.id);
    expect((await s.call("list_aliases", { book })).map((each: any) => each.text)).toEqual([
      "MILCH",
    ]);
  });
});

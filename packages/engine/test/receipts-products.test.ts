import { vi, afterEach, beforeEach, describe, expect, it } from "vitest";

// Frozen behavior stays covered without enabling purchases in the product.
vi.mock("@reeve/contract/features", () => ({ FEATURES: { purchases: true } }));
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
let book: string;
let food: string;
let general: string;
beforeEach(async () => {
  s = scratch();
  book = (await s.call("create_book", { name: "Test" })).id;
  const groups = await s.call("list_categories", { book });
  food = groups[0].categories.find((c: any) => c.name === "Food").id;
  general = groups[0].categories.find((c: any) => c.name === "General").id;
});
afterEach(() => s.dispose());

const product = (name: string, input: Record<string, unknown> = {}) =>
  s.call("create_product", { book, name, ...input });

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
      total: lines.reduce(
        (sum, line: any) =>
          sum + (line.lineTotal ?? Math.round((line.quantity ?? 1) * (line.unitPrice ?? 0))),
        0,
      ),
      lines,
      ...input,
    })
    .then((result: any) => result.receipt);

describe("item categories", () => {
  it("nest, move, inherit their budget category and re-parent on delete", async () => {
    const groceries = await s.call("create_item_category", {
      book,
      name: "Groceries",
      budgetCategoryId: food,
    });
    const dairy = await s.call("create_item_category", {
      book,
      name: "Dairy",
      parentId: groceries.id,
    });
    const cheese = await s.call("create_item_category", {
      book,
      name: "Cheese",
      parentId: dairy.id,
    });
    const produce = await s.call("create_item_category", {
      book,
      name: "Produce",
      parentId: groceries.id,
      before: dairy.id,
    });
    const cleaning = await s.call("create_item_category", {
      book,
      name: "Cleaning",
      budgetCategoryId: general,
    });
    let tree = await s.call("list_item_categories", { book });
    expect(
      tree.map((each: any) => [each.name, each.depth, each.effectiveBudgetCategoryId]),
    ).toEqual([
      ["Groceries", 0, food],
      ["Produce", 1, food],
      ["Dairy", 1, food],
      ["Cheese", 2, food],
      ["Cleaning", 0, general],
    ]);
    expect(
      (await s.fails("move_item_category", { book, id: groceries.id, parentId: cheese.id }))._tag,
    ).toBe("InvalidRequest");
    tree = await s.call("move_item_category", { book, id: dairy.id, parentId: cleaning.id });
    expect(tree.find((each: any) => each.id === cheese.id).effectiveBudgetCategoryId).toBe(general);
    const brie = await product("Brie", { itemCategoryId: dairy.id });
    await s.call("delete_item_category", { book, id: dairy.id });
    tree = await s.call("list_item_categories", { book });
    expect(tree.map((each: any) => [each.name, each.parentId])).toEqual([
      ["Groceries", null],
      ["Produce", groceries.id],
      ["Cleaning", null],
      ["Cheese", cleaning.id],
    ]);
    expect((await s.call("get_product", { book, id: brie.id })).itemCategoryId).toBe(cleaning.id);
    expect(produce.parentId).toBe(groceries.id);
    const updated = await s.call("update_item_category", {
      book,
      id: cleaning.id,
      budgetCategoryId: null,
      hidden: true,
    });
    expect(updated).toMatchObject({ hidden: true, effectiveBudgetCategoryId: null });
  });

  it("lose a deleted budget category, or follow its transfer", async () => {
    const snacks = await s.call("create_item_category", {
      book,
      name: "Snacks",
      budgetCategoryId: general,
    });
    await s.call("delete_category", { book, id: general, transferCategory: food });
    expect((await s.call("list_item_categories", { book }))[0].budgetCategoryId).toBe(food);
    const bills = (await s.call("list_categories", { book }))[0].categories.find(
      (c: any) => c.name === "Bills",
    ).id;
    await s.call("update_item_category", { book, id: snacks.id, budgetCategoryId: bills });
    await s.call("delete_category", { book, id: bills });
    expect((await s.call("list_item_categories", { book }))[0].budgetCategoryId).toBeNull();
  });
});

describe("aliases", () => {
  it("fill a line's product from an exact alias, store first, and rejected ones never", async () => {
    const milk = await product("Milk");
    const oat = await product("Oat milk");
    const store = await s.call("create_payee", { book, name: "Grocer" });
    await s.call("create_alias", { book, productId: milk.id, text: "MILK 1L" });
    await s.call("create_alias", {
      book,
      productId: oat.id,
      text: "milk  1l",
      payeeId: store.id,
      packSize: 2,
    });
    let receipt = await buy("2026-10-01", "Grocer", [{ text: " Milk 1L ", lineTotal: 100 }]);
    expect(receipt.lines[0]).toMatchObject({
      productId: oat.id,
      product: "Oat milk",
      packSize: 2,
      text: " Milk 1L ",
    });
    receipt = await buy("2026-10-01", "Elsewhere", [{ text: "MILK 1L", lineTotal: 100 }]);
    expect(receipt.lines[0].productId).toBe(milk.id);
    await s.call("reject_alias", { book, productId: oat.id, text: "MILK 1L", payeeId: store.id });
    receipt = await buy("2026-10-02", "Grocer", [{ text: "MILK 1L", lineTotal: 100 }]);
    expect(receipt.lines[0].productId).toBe(milk.id);
    const suggestions = await s.call("suggest_products", {
      book,
      text: "MILK 1L",
      payeeId: store.id,
    });
    expect(suggestions.map((each: any) => each.productId)).not.toContain(oat.id);
    const rejected = await s.call("list_aliases", { book, rejected: true });
    expect(rejected).toEqual([
      expect.objectContaining({ productId: oat.id, payee: "Grocer", key: "milk 1l" }),
    ]);
    receipt = await buy("2026-10-02", "Grocer", [
      { text: "MILK 1L", lineTotal: 100, productId: null },
    ]);
    expect(receipt.lines[0].productId).toBeNull();
  });

  it("match by code and stay out when two products share a text", async () => {
    const a = await product("A");
    const b = await product("B");
    await s.call("create_alias", { book, productId: a.id, text: "THING", code: "4011" });
    await s.call("create_alias", { book, productId: b.id, text: "THING" });
    let receipt = await buy("2026-10-01", "Grocer", [
      { text: "something else", code: "4011", lineTotal: 1 },
    ]);
    expect(receipt.lines[0].productId).toBe(a.id);
    receipt = await buy("2026-10-01", "Grocer", [{ text: "THING", lineTotal: 1 }]);
    expect(receipt.lines[0].productId).toBeNull();
  });
});

describe("assigning products", () => {
  it("remembers a store alias and applies it to similar lines", async () => {
    const milk = await product("Milk");
    const first = await buy("2026-10-01", "Grocer", [{ text: "MLK", lineTotal: 100 }]);
    const second = await buy("2026-10-02", "Grocer", [{ text: "mlk", lineTotal: 110 }]);
    await buy("2026-10-02", "Other", [{ text: "MLK", lineTotal: 120 }]);
    let unassigned = await s.call("list_unassigned_lines", { book });
    expect(unassigned.total).toBe(3);
    const result = await s.call("assign_line_product", {
      book,
      line: first.lines[0].id,
      productId: milk.id,
      remember: true,
      applyToSimilar: true,
    });
    expect(result.alias).toMatchObject({ productId: milk.id, payee: "Grocer", text: "MLK" });
    expect(result.updatedLines).toEqual([second.lines[0].id]);
    expect(result.receipt.lines[0].productId).toBe(milk.id);
    unassigned = await s.call("list_unassigned_lines", { book });
    expect(unassigned.lines.map((line: any) => line.payee)).toEqual(["Other"]);
    const later = await buy("2026-10-05", "Grocer", [{ text: "MLK", lineTotal: 100 }]);
    expect(later.lines[0].productId).toBe(milk.id);
  });

  it("suggests by alias, then by words in names and alias texts", async () => {
    const organic = await product("Organic Whole Milk");
    await product("Whole Wheat Bread");
    await product("Dish soap");
    await s.call("create_alias", { book, productId: organic.id, text: "ORG WH MLK" });
    const byWords = await s.call("suggest_products", { book, text: "WHOLE MILK ORGANIC 1L" });
    expect(byWords[0]).toMatchObject({ productId: organic.id, reason: "name" });
    expect(byWords.map((each: any) => each.product)).not.toContain("Dish soap");
    const byAlias = await s.call("suggest_products", { book, text: "org wh mlk" });
    expect(byAlias[0]).toMatchObject({ productId: organic.id, score: 1, reason: "alias" });
    const lines = await buy("2026-10-01", "Grocer", [{ text: "WHOLE MILK", lineTotal: 1 }]);
    expect(lines.lines[0].productId).toBeNull();
  });
});

describe("products", () => {
  it("list with filters and last price, merge and delete", async () => {
    const dairy = await s.call("create_item_category", { book, name: "Dairy" });
    const milk = await product("Milk", { itemCategoryId: dairy.id, unit: "l" });
    const oat = await product("Oat milk 1L", {
      parentId: milk.id,
      unit: "l",
      size: 1,
      sizeUnit: "l",
    });
    const dup = await product("Oat Milk", { unit: "l" });
    await s.call("create_alias", { book, productId: dup.id, text: "OATLY" });
    await buy("2026-10-01", "Grocer", [
      { text: "OAT", lineTotal: 200, quantity: 2, productId: oat.id },
    ]);
    await buy("2026-10-03", "Baker", [{ text: "OATLY", lineTotal: 150 }]);
    let list = await s.call("list_products", { book, itemCategoryId: dairy.id });
    expect(list.products.map((each: any) => each.name)).toEqual(["Milk", "Oat milk 1L"]);
    expect(list.products[1]).toMatchObject({
      effectiveItemCategoryId: dairy.id,
      purchaseCount: 1,
      lastPrice: { payee: "Grocer", lineTotal: 200, pricePerBase: 100 },
    });
    list = await s.call("list_products", { book, query: "oatly" });
    expect(list.products.map((each: any) => each.name)).toEqual(["Oat Milk"]);
    list = await s.call("list_products", {
      book,
      payeeId: (await s.call("list_payees", { book })).find((p: any) => p.name === "Grocer").id,
    });
    expect(list.products.map((each: any) => each.name)).toEqual(["Oat milk 1L"]);
    const merged = await s.call("merge_products", { book, target: oat.id, merge: [dup.id] });
    expect(merged.purchaseCount).toBe(2);
    const read = await s.call("get_product", { book, id: oat.id });
    expect(read.aliases.map((alias: any) => alias.text)).toEqual(["OATLY"]);
    expect((await s.fails("merge_products", { book, target: oat.id, merge: [milk.id] }))._tag).toBe(
      "InvalidRequest",
    );
    await s.call("delete_product", { book, id: milk.id });
    expect((await s.call("get_product", { book, id: oat.id })).parentId).toBeNull();
    expect((await s.fails("create_product", { book, name: "X", size: 1 }))._tag).toBe(
      "InvalidRequest",
    );
  });
});

describe("prices", () => {
  it("normalise across units and sizes, with children", async () => {
    const milk = await product("Milk", { unit: "l" });
    const bottle = await product("Milk 500ml", {
      parentId: milk.id,
      unit: "l",
      size: 500,
      sizeUnit: "ml",
    });
    const jug = await product("Milk 1 gallon-ish", {
      parentId: milk.id,
      unit: "l",
      size: 128,
      sizeUnit: "fl_oz",
    });
    await buy("2026-09-01", "Grocer", [
      { text: "MILK 0.5", quantity: 2, unitPrice: 75, productId: bottle.id },
    ]);
    await buy("2026-09-05", "Grocer", [
      { text: "MILK LOOSE", quantity: 1500, unit: "ml", lineTotal: 300, productId: milk.id },
    ]);
    await buy("2026-09-09", "Grocer", [{ text: "MILK JUG", lineTotal: 757, productId: jug.id }]);
    await buy("2026-09-10", "Grocer", [
      { text: "MILK KG?", quantity: 1, unit: "kg", lineTotal: 100, productId: milk.id },
    ]);
    const own = await s.call("product_price_history", { book, id: milk.id });
    expect(own.unit).toBe("l");
    expect(own.points.map((each: any) => each.pricePerBase)).toEqual([200, null]);
    const all = await s.call("product_price_history", { book, id: milk.id, includeChildren: true });
    expect(all.points.map((each: any) => [each.date, each.pricePerBase])).toEqual([
      ["2026-09-01", 150],
      ["2026-09-05", 200],
      ["2026-09-09", 199.9782],
      ["2026-09-10", null],
    ]);
    const stores = await s.call("cheapest_stores", { book, id: milk.id });
    expect(stores).toEqual([
      expect.objectContaining({
        payee: "Grocer",
        latest: 199.9782,
        purchases: 3,
        latestDate: "2026-09-09",
      }),
    ]);
  });

  it("find price changes against the previous purchase or the average before", async () => {
    const eggs = await product("Eggs", { unit: "piece" });
    const rice = await product("Rice", { unit: "kg" });
    await buy("2026-08-01", "Grocer", [
      {
        text: "EGGS 6",
        quantity: 1,
        unit: "pack",
        packSize: 6,
        lineTotal: 180,
        productId: eggs.id,
      },
    ]);
    await buy("2026-08-15", "Grocer", [
      {
        text: "EGGS 12",
        quantity: 1,
        unit: "pack",
        packSize: 12,
        lineTotal: 300,
        productId: eggs.id,
      },
    ]);
    await buy("2026-10-01", "Grocer", [
      {
        text: "EGGS 6",
        quantity: 1,
        unit: "pack",
        packSize: 6,
        lineTotal: 210,
        productId: eggs.id,
      },
    ]);
    await buy("2026-10-02", "Grocer", [
      { text: "RICE", quantity: 1, unit: "kg", lineTotal: 200, productId: rice.id },
    ]);
    await buy("2026-10-03", "Baker", [
      { text: "RICE", quantity: 2, unit: "kg", lineTotal: 402, productId: rice.id },
    ]);
    const changes = await s.call("price_changes", { book, from: "2026-10-01", to: "2026-10-31" });
    expect(changes.map((each: any) => [each.product, each.before, each.changePct])).toEqual([
      ["Eggs", 25, 40],
    ]);
    const all = await s.call("price_changes", { book, from: "2026-10-01", minChangePct: 0.1 });
    expect(all.map((each: any) => each.product)).toEqual(["Eggs", "Rice"]);
    // The window before the range is as long as the range: 2026-07-30 to 2026-09-14.
    const average = await s.call("price_changes", {
      book,
      from: "2026-09-15",
      to: "2026-10-31",
      compareTo: "average",
    });
    expect(average).toEqual([
      expect.objectContaining({ product: "Eggs", before: 27.5, changePct: 27.27 }),
    ]);
  });
});

describe("item spending", () => {
  it("allocates adjustments so groups add up to what was paid", async () => {
    const produce = await s.call("create_item_category", { book, name: "Produce" });
    const cleaning = await s.call("create_item_category", { book, name: "Cleaning" });
    const apples = await product("Apples", { itemCategoryId: produce.id });
    await s.call("create_receipt", {
      book,
      date: "2026-10-01",
      payee: "Grocer",
      total: 1000,
      lines: [
        { text: "Apples", lineTotal: 333, productId: apples.id },
        { text: "Pears", lineTotal: 333, itemCategoryId: produce.id },
        { text: "Soap", lineTotal: 334, itemCategoryId: cleaning.id },
      ],
      adjustments: [
        { kind: "tax", amount: 80 },
        { kind: "coupon", amount: -80 },
      ],
    });
    await s.call("create_receipt", {
      book,
      date: "2026-10-02",
      payee: "Baker",
      total: 1001,
      lines: [
        { text: "Rolls", lineTotal: 500, itemCategoryId: produce.id },
        { text: "Mystery", lineTotal: 400 },
      ],
      adjustments: [{ kind: "tax", amount: 101 }],
    });
    const byCategory = await s.call("item_spending", { book, groupBy: "item_category" });
    expect(byCategory.total).toBe(2001);
    expect(byCategory.groups.map((each: any) => [each.name, each.amount, each.lines])).toEqual([
      ["Produce", 1222, 3],
      ["No item category", 445, 1],
      ["Cleaning", 334, 1],
    ]);
    const raw = await s.call("item_spending", { book, groupBy: "store", allocate: false });
    expect(raw.groups.map((each: any) => [each.name, each.amount])).toEqual([
      ["Grocer", 1000],
      ["Baker", 900],
    ]);
    const products = await s.call("item_spending", {
      book,
      groupBy: "product",
      from: "2026-10-01",
      to: "2026-10-01",
    });
    expect(products.groups.map((each: any) => each.name)).toEqual(["No product", "Apples"]);
    const filtered = await s.call("item_spending", {
      book,
      groupBy: "store",
      itemCategoryId: produce.id,
    });
    expect(filtered.total).toBe(1222);
  });
});

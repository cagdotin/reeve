import { today } from "@reeve/contract/rules";
import { vi, afterEach, beforeEach, describe, expect, it } from "vitest";

// Frozen behavior stays covered without enabling purchases in the product.
vi.mock("@reeve/contract/features", () => ({ FEATURES: { purchases: true } }));
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
let book: string;
let checking: string;
let food: string;
let general: string;
beforeEach(async () => {
  s = scratch();
  book = (await s.call("create_book", { name: "Test" })).id;
  checking = (await s.call("create_account", { book, name: "Checking" })).id;
  const groups = await s.call("list_categories", { book });
  const named = (name: string) => groups[0].categories.find((c: any) => c.name === name).id;
  food = named("Food");
  general = named("General");
});
afterEach(() => s.dispose());

const dayBefore = (days: number, from = today()) => {
  const date = new Date(`${from}T12:00:00`);
  date.setDate(date.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const product = (name: string, input: Record<string, unknown> = {}) =>
  s.call("create_product", { book, name, ...input });

const buy = (
  date: string,
  payee: string,
  productId: string | null,
  lineTotal: number,
  text = "Line",
) =>
  s
    .call("create_receipt", {
      book,
      date,
      payee,
      // A free line comes on a receipt for something else: a total is never zero.
      total: lineTotal === 0 ? 100 : lineTotal,
      lines: [{ text, lineTotal, ...(productId === null ? {} : { productId }) }],
    })
    .then((result: any) => result.receipt);

const activity = (input: Record<string, unknown> = {}) =>
  s.call("product_activity", { book, ...input });

const rowOf = (overview: any, id: string) => overview.products.find((row: any) => row.id === id);

describe("what deleting a product does to its kinds' lines, as the dialog says it", () => {
  const DAY = "2026-10-10";
  const spent = async (category: string) => {
    const view = await s.call("get_budget", { book, month: "2026-10" });
    return Math.abs(view.months[0].categories.find((c: any) => c.id === category).spent);
  };
  const get = (id: string) => s.call("get_receipt", { book, id });

  /** Mid (Food) with Kind under it, optionally under Grand (General), a line on `on`, applied. */
  const applied = async (options: { grand: boolean; on: "kind" | "mid"; auto: boolean }) => {
    if (options.auto) await s.call("update_book", { book, autoApplyReceipts: true });
    const foodItems = await s.call("create_item_category", {
      book,
      name: "Food items",
      budgetCategoryId: food,
    });
    const generalItems = await s.call("create_item_category", {
      book,
      name: "General items",
      budgetCategoryId: general,
    });
    const grand = options.grand
      ? await product("Grand", { itemCategoryId: generalItems.id })
      : null;
    const mid = await product("Mid", {
      itemCategoryId: foodItems.id,
      ...(grand === null ? {} : { parentId: grand.id }),
    });
    const kind = await product("Kind", { parentId: mid.id });
    const tx = await s.call("create_transaction", {
      book,
      account: checking,
      date: DAY,
      amount: -1000,
      payee: "Grocer",
    });
    const { receipt } = await s.call("create_receipt", {
      book,
      date: DAY,
      payee: "Grocer",
      total: 1000,
      lines: [
        { text: "Thing", lineTotal: 1000, productId: options.on === "kind" ? kind.id : mid.id },
      ],
      payments: [{ transactionId: tx.id }],
    });
    if (!options.auto) await s.call("apply_receipt_to_transaction", { book, id: receipt.id });
    expect((await get(receipt.id)).status.applied).toBe(true);
    expect(await spent(food)).toBe(1000);
    return { mid, kind, receipt };
  };

  it("with auto-apply on, a kind's category changes and the split follows", async () => {
    const { mid, receipt } = await applied({ grand: true, on: "kind", auto: true });
    await s.call("delete_product", { book, id: mid.id });
    expect(await spent(food)).toBe(0);
    expect(await spent(general)).toBe(1000);
    expect((await get(receipt.id)).status.applied).toBe(true);
  });

  it("with auto-apply off, the split stays and the receipt stops counting as applied", async () => {
    const { mid, receipt } = await applied({ grand: true, on: "kind", auto: false });
    await s.call("delete_product", { book, id: mid.id });
    expect(await spent(food)).toBe(1000);
    const { status } = await get(receipt.id);
    expect(status.categorized).toBe(true);
    expect(status.applied).toBe(false);
  });

  it.each([true, false])(
    "with nothing above, a kind loses its category and the split stays (auto %s)",
    async (auto) => {
      const { mid, receipt } = await applied({ grand: false, on: "kind", auto });
      await s.call("delete_product", { book, id: mid.id });
      expect(await spent(food)).toBe(1000);
      const { status } = await get(receipt.id);
      expect(status.categorized).toBe(false);
      expect(status.applied).toBe(false);
    },
  );

  it("with auto-apply on, a receipt this makes ready is applied", async () => {
    await s.call("update_book", { book, autoApplyReceipts: true });
    const noBudget = await s.call("create_item_category", { book, name: "No budget" });
    const generalItems = await s.call("create_item_category", {
      book,
      name: "General items",
      budgetCategoryId: general,
    });
    const grand = await product("Grand", { itemCategoryId: generalItems.id });
    const mid = await product("Mid", { itemCategoryId: noBudget.id, parentId: grand.id });
    const kind = await product("Kind", { parentId: mid.id });
    const tx = await s.call("create_transaction", {
      book,
      account: checking,
      date: DAY,
      amount: -1000,
      payee: "Grocer",
    });
    const { receipt } = await s.call("create_receipt", {
      book,
      date: DAY,
      payee: "Grocer",
      total: 1000,
      lines: [{ text: "Thing", lineTotal: 1000, productId: kind.id }],
      payments: [{ transactionId: tx.id }],
    });
    expect(receipt.status.applied).toBe(false);
    await s.call("delete_product", { book, id: mid.id });
    expect((await get(receipt.id)).status.applied).toBe(true);
    expect(await spent(general)).toBe(1000);
  });

  it.each([true, false])(
    "its own lines lose the category and the split stays (auto %s)",
    async (auto) => {
      const { mid, receipt } = await applied({ grand: true, on: "mid", auto });
      await s.call("delete_product", { book, id: mid.id });
      expect(await spent(food)).toBe(1000);
      const view = await get(receipt.id);
      expect(view.lines[0].productId).toBeNull();
      expect(view.status.categorized).toBe(false);
      expect(view.status.applied).toBe(false);
    },
  );
});

describe("cheapest_stores", () => {
  it("leaves out free lines and coupons, and a store with nothing else", async () => {
    const tea = await product("Tea");
    await buy(dayBefore(5), "Shop", tea.id, 200);
    await buy(dayBefore(4), "Freebie", tea.id, 0);
    await buy(dayBefore(3), "Couponer", tea.id, -100);
    await buy(dayBefore(2), "Mixed", tea.id, 300);
    await buy(dayBefore(1), "Mixed", tea.id, 0);
    const stores = await s.call("cheapest_stores", { book, id: tea.id });
    expect(stores.map((each: any) => each.payee)).toEqual(["Shop", "Mixed"]);
    expect(stores[1].latest).toBe(300);
    expect(stores[1].average).toBe(300);
    expect(stores[1].purchases).toBe(1);
  });
});

describe("price changes skip free and discount lines", () => {
  const seedTea = async () => {
    const tea = await product("Tea");
    await buy(dayBefore(30), "Shop", tea.id, 200);
    await buy(dayBefore(20), "Shop", tea.id, 0);
    await buy(dayBefore(10), "Shop", tea.id, 200);
    return tea;
  };
  const seedSoap = async () => {
    const soap = await product("Soap");
    await buy(dayBefore(30), "Shop", soap.id, 300);
    await buy(dayBefore(20), "Shop", soap.id, 400);
    await buy(dayBefore(10), "Shop", soap.id, -50);
    return soap;
  };

  it("a free line in the history does not lower the average or read as the one before", async () => {
    const tea = await seedTea();
    expect(rowOf(await activity(), tea.id).change).toBeNull();
    expect(rowOf(await activity({ compareTo: "previous" }), tea.id).change).toBeNull();
    expect(await s.call("price_changes", { book, compareTo: "average" })).toEqual([]);
    expect(await s.call("price_changes", { book })).toEqual([]);
  });

  it("a discount line is not the latest price, so the last real move still shows", async () => {
    const soap = await seedSoap();
    const { change } = rowOf(await activity({ compareTo: "previous" }), soap.id);
    expect(change).toMatchObject({ before: 300, latest: 400 });
    const [old] = await s.call("price_changes", { book });
    expect(old).toMatchObject({ before: 300, changePct: 33.33 });
    expect(old.latest.pricePerBase).toBe(400);
  });
});

describe("the range's windows", () => {
  it("compares with the days before the range however long ago the last purchase", async () => {
    const butter = await product("Butter");
    const since = dayBefore(30);
    await buy(dayBefore(20, since), "Shop", butter.id, 100);
    await buy(dayBefore(-3, since), "Shop", butter.id, 150);
    const { change } = rowOf(await activity({ since }), butter.id);
    expect(change).toMatchObject({ before: 100, latest: 150, changePct: 50 });
  });

  it("counts as many days before the range as in it", async () => {
    const milk = await product("Milk");
    const since = dayBefore(9);
    await buy(dayBefore(19), "Shop", milk.id, 700);
    await buy(dayBefore(20), "Shop", milk.id, 900);
    const { summary } = await activity({ since });
    expect(summary.previous.spent).toBe(700);
  });
});

describe("what is searched and what counts as named", () => {
  it("sends the texts of a product's aliases, but not the rejected ones", async () => {
    const milk = await product("Milk");
    await s.call("create_alias", { book, productId: milk.id, text: "HMILCH 1L" });
    await s.call("reject_alias", { book, productId: milk.id, text: "OAT DRINK" });
    expect(rowOf(await activity(), milk.id).aliases).toEqual(["hmilch 1l"]);
  });

  it("agrees between the check and the list of lines it opens", async () => {
    await product("Whole milk");
    await buy(dayBefore(3), "Shop", null, 100, "Whole milk");
    await buy(dayBefore(2), "Shop", null, 100, "Whole milk 1L");
    await buy(dayBefore(1), "Shop", null, 100, "Milk whole fresh");
    const { attention } = await activity();
    expect(attention.named).toBe(1);
    const named = await s.call("list_unassigned_lines", { book, named: true });
    expect(named.total).toBe(1);
    expect(named.lines.map((line: any) => line.text)).toEqual(["Whole milk"]);
    expect((await s.call("list_unassigned_lines", { book })).total).toBe(3);
  });
});

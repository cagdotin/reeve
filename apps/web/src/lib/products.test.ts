import type { ItemCategory, PricePoint, ProductActivity } from "@reeve/contract/catalog";
import { describe, expect, it } from "vitest";
import {
  attentionItems,
  archiveTargets,
  boughtEarlier,
  buyAdvice,
  categorySubtree,
  deleteConsequences,
  deleteFacts,
  DEFAULT_SORT,
  groupLines,
  latestAt,
  matchesLine,
  matchesSearch,
  mergeClash,
  passesFilters,
  priceMove,
  priceSeries,
  productFilterGroups,
  productTable,
  quantityText,
  signedPercent,
  sortProducts,
  sortPurchases,
  sparkPoints,
  topCategories,
  topProducts,
  withKinds,
} from "./products.ts";

const product = (name: string, fields: Partial<ProductActivity> = {}): ProductActivity => ({
  id: name,
  name,
  parentId: null,
  itemCategoryId: null,
  unit: "piece",
  size: null,
  sizeUnit: null,
  archived: false,
  kinds: 0,
  spent: 0,
  previousSpent: 0,
  purchases: 0,
  totalPurchases: 0,
  rollup: { spent: 0, previousSpent: 0, purchases: 0, totalPurchases: 0, lastBought: null },
  prices: [],
  change: null,
  unmeasured: 0,
  duplicates: [],
  aliases: [],
  ...fields,
});

const rollup = (spent: number, fields: Partial<ProductActivity["rollup"]> = {}) => ({
  spent,
  previousSpent: 0,
  purchases: spent > 0 ? 1 : 0,
  totalPurchases: spent > 0 ? 1 : 0,
  lastBought: null,
  ...fields,
});

const bought = (spent: number, purchases = 1, lastBought = "2026-10-01") => ({
  spent,
  purchases,
  totalPurchases: purchases,
  rollup: { spent, previousSpent: 0, purchases, totalPurchases: purchases, lastBought },
});

const category = (id: string, parentId: string | null = null, depth = 0): ItemCategory =>
  ({
    id,
    name: id,
    parentId,
    budgetCategoryId: null,
    hidden: false,
    sortOrder: 0,
    depth,
  }) as ItemCategory;

const table = (
  rows: ReadonlyArray<ProductActivity>,
  options: Partial<Parameters<typeof productTable>[1]> = {},
) =>
  productTable(rows, {
    query: "",
    filters: {},
    categories: [],
    sort: DEFAULT_SORT,
    open: new Set(),
    ranged: true,
    ...options,
  });

const names = (result: ReturnType<typeof table>) => result.rows.map((each) => each.row.name);

describe("productTable", () => {
  const milk = product("Milk", bought(300, 3));
  const oat = product("Oat", { parentId: "Milk", ...bought(100) });
  const soy = product("Soy", { parentId: "Milk" });
  const rice = product("Rice", bought(200));
  const old = product("Old", {
    totalPurchases: 2,
    rollup: { ...product("x").rollup, totalPurchases: 2 },
  });
  const rows = [milk, oat, soy, rice, old];

  it("shows what was bought in the range, folded, spent first", () => {
    const result = table(rows);
    expect(names(result)).toEqual(["Milk", "Rice"]);
    expect(result.rows[0]).toMatchObject({ folds: true, open: false, depth: 0 });
  });

  it("unfolds a product's kinds bought in the range, a level in", () => {
    const result = table(rows, { open: new Set(["Milk"]) });
    expect(names(result)).toEqual(["Milk", "Oat", "Rice"]);
    expect(result.rows[1]).toMatchObject({ depth: 1, folds: false });
  });

  it("shows all of them over all time, except archived", () => {
    const gone = product("Gone", { archived: true, ...bought(5) });
    const result = table([...rows, gone], { ranged: false, open: new Set(["Milk"]) });
    expect(names(result)).toContain("Soy");
    expect(names(result)).toContain("Old");
    expect(names(result)).not.toContain("Gone");
  });

  it("shows archived ones when asked for them", () => {
    const gone = product("Gone", { archived: true, ...bought(5) });
    expect(names(table([...rows, gone], { filters: { status: ["archived"] } }))).toEqual(["Gone"]);
  });

  it("a search reaches outside the range and keeps a matching kind under its parent", () => {
    expect(names(table(rows, { query: "old" }))).toEqual(["Old"]);
    const result = table(rows, { query: "soy" });
    expect(names(result)).toEqual(["Milk", "Soy"]);
    expect(result.rows[0]).toMatchObject({ context: true, open: true });
    expect(result.matched).toBe(1);
  });

  it("narrows to products whose price moved", () => {
    const moved = product("Moved", {
      ...bought(1),
      change: { before: 100, latest: 110, changePct: 10, date: "2026-10-01", payee: null },
    });
    expect(names(table([...rows, moved], { moved: true }))).toEqual(["Moved"]);
  });

  it("counts only matches: a fold or a parent for context does not add one", () => {
    expect(table(rows).matched).toBe(3);
  });
});

describe("sortProducts", () => {
  it("puts nothing to show last, whichever way", () => {
    const a = product("A", { prices: [{ date: "2026-01-01", price: 5 }] });
    const b = product("B");
    const c = product("C", { prices: [{ date: "2026-01-01", price: 9 }] });
    const up = sortProducts([a, b, c], { key: "price", descending: false });
    const down = sortProducts([a, b, c], { key: "price", descending: true });
    expect(up.map((row) => row.name)).toEqual(["A", "C", "B"]);
    expect(down.map((row) => row.name)).toEqual(["C", "A", "B"]);
  });

  it("sorts by category name, by change, and by rolled-up spending", () => {
    const names = new Map([
      ["x", "Zed"],
      ["y", "Alpha"],
    ]);
    const rows = [product("A", { itemCategoryId: "x" }), product("B", { itemCategoryId: "y" })];
    expect(sortProducts(rows, { key: "category", descending: false }, names)[0]!.name).toBe("B");
    const parent = product("P", { spent: 1, rollup: { ...product("x").rollup, spent: 90 } });
    const other = product("Q", { spent: 50, rollup: { ...product("x").rollup, spent: 50 } });
    expect(sortProducts([other, parent], { key: "spent", descending: true })[0]!.name).toBe("P");
  });
});

describe("filters", () => {
  const categories = [category("Food"), category("Dairy", "Food", 1), category("Home")];

  it("a category takes in those under it", () => {
    expect([...categorySubtree(categories, "Food")]).toEqual(["Food", "Dairy"]);
    const row = product("Milk", { itemCategoryId: "Dairy" });
    expect(passesFilters(row, { category: ["Food"] }, categories)).toBe(true);
    expect(passesFilters(row, { category: ["Home"] }, categories)).toBe(false);
    expect(passesFilters(row, { category: ["none"] }, categories)).toBe(false);
    expect(passesFilters(product("Bare"), { category: ["none"] }, categories)).toBe(true);
  });

  it("price and status need any chosen value within, and all across", () => {
    const dearer = product("A", {
      change: { before: 1, latest: 2, changePct: 100, date: "2026-01-01", payee: null },
    });
    expect(passesFilters(dearer, { price: ["dearer"] }, [])).toBe(true);
    expect(passesFilters(dearer, { price: ["cheaper"] }, [])).toBe(false);
    expect(passesFilters(dearer, { price: ["cheaper", "dearer"] }, [])).toBe(true);
    expect(passesFilters(dearer, { price: ["dearer"], status: ["duplicate"] }, [])).toBe(false);
  });

  it("offers only options some product has, and categories as a tree", () => {
    const groups = productFilterGroups(
      [product("Milk", { itemCategoryId: "Dairy", ...bought(1) }), product("Bare", bought(1))],
      categories,
    );
    expect(groups.map((group) => group.id)).toEqual(["category", "status"]);
    expect(groups[0]!.options.find((each) => each.value === "Dairy")).toMatchObject({
      count: 1,
      depth: 1,
    });
    expect(groups[0]!.options.at(-1)).toMatchObject({ value: "none", count: 1 });
    expect(groups[1]!.options.map((each) => each.value)).toEqual(["uncategorized"]);
  });
});

describe("top lists", () => {
  it("ranks products with their kinds in, once, without archived ones", () => {
    const rows = [
      product("Milk", { rollup: { ...product("x").rollup, spent: 90 } }),
      product("Oat", { parentId: "Milk", rollup: { ...product("x").rollup, spent: 60 } }),
      product("Rice", { rollup: { ...product("x").rollup, spent: 70 } }),
      product("Gone", { archived: true, rollup: { ...product("x").rollup, spent: 500 } }),
      product("Unbought"),
    ];
    expect(topProducts(rows).map((row) => row.name)).toEqual(["Milk", "Rice"]);
  });

  it("leaves categories spending nothing out", () => {
    const row = { id: "a", name: "A", spent: 5, previousSpent: 0, lines: 1 };
    expect(topCategories([row, { ...row, id: "b", spent: -1 }])).toEqual([row]);
  });
});

describe("attentionItems", () => {
  it("says where each check leads", () => {
    const items = attentionItems({
      unassigned: 4,
      named: 1,
      uncategorized: 2,
      duplicates: 0,
      unmeasured: 1,
    });
    expect(items.find((each) => each.id === "unassigned")).toMatchObject({
      count: 4,
      view: "unassigned",
    });
    expect(items.find((each) => each.id === "named")!.open).toBe("of them matches a name or alias");
    expect(items.find((each) => each.id === "uncategorized")!.filters).toEqual({
      status: ["uncategorized"],
    });
    expect(items.find((each) => each.id === "duplicates")!.count).toBe(0);
  });
});

describe("signedPercent", () => {
  it("drops the decimal once it would be noise", () => {
    expect(signedPercent(4.25)).toBe("+4.3%");
    expect(signedPercent(-12.6)).toBe("−13%");
  });
});

describe("sparkPoints", () => {
  it("fits the series in the box, high at the top", () => {
    expect(sparkPoints([1, 2], 10, 10, 1)).toEqual([
      [1, 9],
      [9, 1],
    ]);
  });
  it("draws a flat line in the middle and a lone point at the end", () => {
    expect(sparkPoints([5, 5], 10, 10, 1).map(([, y]) => y)).toEqual([5, 5]);
    expect(sparkPoints([5], 10, 10, 1)).toEqual([[9, 5]]);
    expect(sparkPoints([], 10, 10)).toEqual([]);
  });
});

const line = (id: string, text: string, payeeId: string | null, lineTotal = 100) => ({
  id,
  text,
  code: null,
  date: "2026-10-01",
  lineTotal,
  payeeId,
  payee: payeeId,
  suggestions: [],
});

describe("groupLines", () => {
  it("folds lines printed alike at one store, and keeps the newest", () => {
    const groups = groupLines([
      line("new", "PFAND", "Hofer", 25),
      line("other", "Milk", "Hofer"),
      line("old", " pfand ", "Hofer", 75),
      line("elsewhere", "PFAND", "Billa"),
    ]);
    expect(groups.map((group) => [group.line.id, group.lines, group.total])).toEqual([
      ["new", 2, 100],
      ["other", 1, 100],
      ["elsewhere", 1, 100],
    ]);
  });
  it("searches text, store and code", () => {
    expect(matchesLine(line("a", "PFAND", "Hofer"), "hof")).toBe(true);
    expect(matchesLine(line("a", "PFAND", "Hofer"), "zzz")).toBe(false);
  });
});

const point = (
  date: string,
  pricePerBase: number | null,
  payeeId: string | null = "h",
  fields: Partial<PricePoint> = {},
): PricePoint => ({
  lineId: `${date}${payeeId}`,
  receiptId: "r",
  productId: "p",
  date,
  payeeId,
  payee: payeeId,
  quantity: 1,
  unit: null,
  lineTotal: pricePerBase ?? 100,
  unitPrice: null,
  pricePerBase,
  ...fields,
});

describe("priceMove", () => {
  it("holds the latest price against the one before and all before", () => {
    const move = priceMove([
      point("2026-01-01", 100),
      point("2026-02-01", 200),
      point("2026-03-01", null),
      point("2026-04-01", 300),
    ]);
    expect(move).toMatchObject({ previous: 200, average: 150 });
    expect(move!.latest.pricePerBase).toBe(300);
  });
  it("compares a kind only with itself", () => {
    const oat = { productId: "oat" };
    const move = priceMove([
      point("2026-01-01", 100, "h", oat),
      point("2026-02-01", 200),
      point("2026-03-01", 150, "h", oat),
    ]);
    expect(move).toMatchObject({ previous: 100, average: 100 });
  });
  it("has nothing to say without a price, and no comparison with one", () => {
    expect(priceMove([point("2026-01-01", null)])).toBeNull();
    expect(priceMove([point("2026-01-01", 100)])).toMatchObject({ previous: null, average: null });
  });
});

const store = (payee: string, latest: number, latestDate: string) => ({
  payeeId: payee,
  payee,
  latest,
  latestDate,
  average: latest,
  purchases: 1,
});

describe("buyAdvice", () => {
  const today = "2026-11-01";
  it("picks the cheapest recent price, naming an older, lower one", () => {
    const advice = buyAdvice(
      [
        store("Old", 90, "2025-01-01"),
        store("Near", 100, "2026-10-01"),
        store("Far", 120, "2026-09-01"),
      ],
      today,
    );
    expect(advice?.store.payee).toBe("Near");
    expect(advice?.next?.payee).toBe("Far");
    expect(advice?.older?.payee).toBe("Old");
    expect(advice?.stale).toBe(false);
  });
  it("says so when every price is old", () => {
    const advice = buyAdvice([store("A", 90, "2025-01-01"), store("B", 95, "2025-02-01")], today);
    expect(advice).toMatchObject({ stale: true, older: null });
    expect(advice?.store.payee).toBe("A");
  });
  it("has nothing without stores", () => {
    expect(buyAdvice([], today)).toBeNull();
  });
});

describe("priceSeries", () => {
  it("gives a row a day in the shown unit, stores by use", () => {
    const { stores, rows } = priceSeries(
      [
        point("2026-01-01", 2, "a"),
        point("2026-01-01", 3, "b"),
        point("2026-01-05", 2.5, "b"),
        point("2026-01-06", null, "c"),
      ],
      "g",
    );
    expect(stores.map((each) => each.key)).toEqual(["b", "a"]);
    expect(rows).toEqual([
      { date: "2026-01-01", a: 2000, b: 3000 },
      { date: "2026-01-05", b: 2500 },
    ]);
  });
  it("draws stores past the slots as one line", () => {
    const points = Array.from({ length: 9 }, (_, index) =>
      point(`2026-01-0${index + 1}`, 100, `s${index}`),
    );
    const { stores } = priceSeries(points, "piece");
    expect(stores).toHaveLength(8);
    expect(stores.at(-1)).toEqual({ key: "other", name: "Other stores" });
  });
});

describe("latestAt", () => {
  it("finds a store's newest priced purchase", () => {
    const rows = [
      point("2026-01-01", 5, "a"),
      point("2026-02-01", 6, "a"),
      point("2026-03-01", null, "a"),
    ];
    expect(latestAt(rows, "a")?.date).toBe("2026-02-01");
    expect(latestAt(rows, "b")).toBeUndefined();
  });
});

describe("sortPurchases", () => {
  it("sorts by date newest first and puts no price last", () => {
    const rows = [point("2026-01-01", 5), point("2026-02-01", null), point("2026-03-01", 9)];
    expect(sortPurchases(rows, { key: "date", descending: true }).map((p) => p.date)).toEqual([
      "2026-03-01",
      "2026-02-01",
      "2026-01-01",
    ]);
    expect(
      sortPurchases(rows, { key: "per", descending: false }).map((p) => p.pricePerBase),
    ).toEqual([5, 9, null]);
  });
});

describe("quantityText", () => {
  it("reads in the unit the price does", () => {
    expect(quantityText(1500, "ml")).toBe("1.5 L");
    expect(quantityText(24, "piece")).toBe("24 pc");
    expect(quantityText(3.14, "kg")).toBe("3.1 kg");
  });
});

describe("deleteConsequences", () => {
  it("says what happens to lines, aliases and kinds", () => {
    const text = deleteConsequences({
      purchases: 3,
      kindLines: 0,
      changes: [],
      autoApply: false,
      aliases: 2,
      kinds: 1,
      count: 1,
      parent: "Dairy things",
    }).join(" ");
    expect(text).toContain("3 purchase lines stay on their receipts");
    expect(text).toContain("back to the unassigned lines");
    expect(text).toContain("price history goes");
    expect(text).toContain("2 aliases are deleted");
    expect(text).toContain("1 kind under it moves up to Dairy things");
    expect(text).toContain("You can undo this");
  });
  it("says so when nothing uses it", () => {
    const text = deleteConsequences({
      purchases: 0,
      kindLines: 0,
      changes: [],
      autoApply: false,
      aliases: 0,
      kinds: 0,
      count: 1,
      parent: null,
    }).join(" ");
    expect(text).toContain("No receipt line uses it");
    expect(text).not.toContain("alias");
  });
});

describe("withKinds", () => {
  it("takes in every level under a product, and survives a loop", () => {
    const list = [
      { id: "a", parentId: null },
      { id: "b", parentId: "a" },
      { id: "c", parentId: "b" },
      { id: "d", parentId: null },
    ];
    expect([...withKinds(list, "a")]).toEqual(["a", "b", "c"]);
    expect([...withKinds(list, "d")]).toEqual(["d"]);
  });
});

describe("mergeClash", () => {
  it("is about the kind of unit, not the unit", () => {
    expect(mergeClash(["ml"], "l")).toBe(false);
    expect(mergeClash(["kg", "ml"], "l")).toBe(true);
    expect(mergeClash(["piece"], "pack")).toBe(false);
  });
});

describe("the review's cases", () => {
  it("says Only bought from the stores, not from which is fresh", () => {
    const today = "2026-06-01";
    const fresh = store("Fresh", 100, "2026-05-22");
    const old = store("Old", 120, "2025-08-05");
    expect(buyAdvice([fresh, old], today)?.only).toBe(false);
    expect(buyAdvice([fresh], today)?.only).toBe(true);
    expect(buyAdvice([old], today)?.only).toBe(true);
  });

  it("finds a product by an alias", () => {
    const milk = product("Milk", { aliases: ["hmilch 1l"] });
    expect(matchesSearch(milk, "hmilch")).toBe(true);
    expect(matchesSearch(milk, "HMILCH 1L")).toBe(true);
    expect(matchesSearch(milk, "oat")).toBe(false);
    expect(matchesSearch(milk, "mil")).toBe(true);
  });

  it("ranks an active kind whose parent is archived, once", () => {
    const rows = [
      product("Old", { id: "old", archived: true, rollup: rollup(500) }),
      product("New", { id: "new", parentId: "old", rollup: rollup(500) }),
      product("Top", { id: "top", rollup: rollup(100) }),
      product("Gone", { id: "gone", parentId: "top", archived: true, rollup: rollup(40) }),
      product("Under", { id: "under", parentId: "gone", rollup: rollup(40) }),
    ];
    expect(topProducts(rows).map((row) => row.name)).toEqual(["New", "Top"]);
  });

  it("counts those hidden by the range even when a parent bought nothing itself", () => {
    const rows = [
      product("Parent", { id: "p", rollup: rollup(100, { purchases: 1, totalPurchases: 1 }) }),
      product("Kind", {
        id: "k",
        parentId: "p",
        totalPurchases: 1,
        rollup: rollup(100, { purchases: 1, totalPurchases: 1 }),
      }),
      product("Earlier", {
        id: "e",
        totalPurchases: 2,
        rollup: rollup(0, { purchases: 0, totalPurchases: 2 }),
      }),
      product("Gone", {
        id: "g",
        archived: true,
        totalPurchases: 2,
        rollup: rollup(0, { purchases: 0, totalPurchases: 2 }),
      }),
    ];
    expect(boughtEarlier(rows)).toBe(1);
  });

  it("archives only the active and unarchives only the archived", () => {
    const rows = [product("A", { id: "a" }), product("B", { id: "b", archived: true })];
    expect(archiveTargets(rows, true).map((row) => row.id)).toEqual(["a"]);
    expect(archiveTargets(rows, false).map((row) => row.id)).toEqual(["b"]);
  });
});

describe("deleteConsequences follows the engine", () => {
  const names = new Map([
    ["food", "Food"],
    ["general", "General"],
  ]);
  const row = (
    id: string,
    parentId: string | null,
    itemCategoryId: string | null,
    totalPurchases: number,
  ) => ({ id, name: id, parentId, itemCategoryId, totalPurchases });
  const say = (
    rows: ReadonlyArray<ReturnType<typeof row>>,
    ids: ReadonlyArray<string>,
    autoApply: boolean,
  ) => deleteConsequences({ ...deleteFacts(rows, ids, names), aliases: 0, autoApply }).join(" ");
  const chain = [
    row("Grand", null, "general", 0),
    row("Mid", "Grand", "food", 0),
    row("Kind", "Mid", "food", 2),
  ];

  it("counts a kind's lines, and says their category changes", () => {
    const text = say(chain, ["Mid"], true);
    expect(text).not.toContain("No receipt line");
    expect(text).toContain("2 purchase lines on its kinds stay on those kinds");
    expect(text).toContain("changes from Food to General");
  });

  it("says the split follows with auto-apply on, and stays with it off", () => {
    expect(say(chain, ["Mid"], true)).toContain("split changes to match");
    expect(say(chain, ["Mid"], true)).not.toContain("stay as it is");
    const off = say(chain, ["Mid"], false);
    expect(off).toContain("stops counting as applied until you apply it again");
    expect(off).not.toContain("split changes");
  });

  it("says a kind loses the category with nothing above", () => {
    const rows = [row("Mid", null, "food", 0), row("Kind", "Mid", "food", 2)];
    for (const auto of [true, false]) {
      const text = say(rows, ["Mid"], auto);
      expect(text).toContain("loses Food");
      expect(text).toContain("stops counting as categorized and applied");
      expect(text).not.toContain("split changes");
    }
  });

  it("says nothing of categories when deleting does not change one", () => {
    const rows = [
      row("Grand", null, "food", 0),
      row("Mid", "Grand", "food", 0),
      row("Kind", "Mid", "food", 2),
      row("Own", "Mid", "general", 3),
    ];
    const text = say(rows, ["Mid"], true);
    expect(text).toContain("5 purchase lines on its kinds");
    expect(text).not.toContain("changes from");
    expect(text).not.toContain("split");
  });

  it("treats a selected kind's lines as its own, and looks past a selected parent", () => {
    const rows = [...chain, row("Leaf", "Kind", "food", 3)];
    const facts = deleteFacts(rows, ["Mid", "Kind"], names);
    expect(facts.purchases).toBe(2);
    expect(facts.kindLines).toBe(3);
    expect(facts.changes).toEqual([{ lines: 3, from: "Food", to: "General" }]);
    expect(facts.kinds).toBe(1);
  });

  it("says its own lines' splits stay", () => {
    const rows = [row("Mid", "Grand", "food", 4), row("Grand", null, "general", 0)];
    const text = say(rows, ["Mid"], true);
    expect(text).toContain("4 purchase lines stay on their receipts");
    expect(text).toContain("its transaction stays as it is");
  });

  it("says no line uses it only when none does", () => {
    expect(say([row("Bare", null, null, 0)], ["Bare"], true)).toContain("No receipt line uses it");
  });
});

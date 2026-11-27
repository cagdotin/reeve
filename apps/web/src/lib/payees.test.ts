import type { PayeeActivity } from "@reeve/contract";
import { describe, expect, it } from "vitest";
import { nextSort } from "./insights.ts";
import {
  attentionItems,
  categorySummary,
  DEFAULT_SORT,
  DESCENDING_FIRST,
  matchesSearch,
  passesFilters,
  payeeFilterGroups,
  sortPayees,
  type PayeeSortKey,
} from "./payees.ts";

const payee = (name: string, fields: Partial<PayeeActivity> = {}): PayeeActivity => ({
  id: name,
  name,
  description: null,
  favorite: false,
  learnCategories: true,
  transactionCount: 0,
  rangeTransactions: 0,
  rangeSpent: 0,
  lastTransaction: null,
  categories: [],
  ruleCount: 0,
  scheduled: false,
  duplicateRules: false,
  ruleDisagrees: false,
  newInRange: false,
  ...fields,
});

const category = (name: string, transactions: number) => ({ id: name, name, transactions });

describe("sortPayees", () => {
  const rows = [
    payee("b", {
      lastTransaction: "2026-10-01",
      rangeTransactions: 2,
      rangeSpent: 500,
      ruleCount: 1,
      categories: [category("Rent", 1)],
    }),
    payee("A", {
      lastTransaction: "2026-10-01",
      rangeTransactions: 9,
      rangeSpent: 100,
      categories: [category("Food", 1)],
    }),
    payee("c", { lastTransaction: "2026-11-01", rangeTransactions: 1, rangeSpent: 900 }),
    payee("d"),
  ];
  const names = (key: PayeeSortKey, descending = true) =>
    sortPayees(rows, { key, descending }).map((row) => row.name);

  it("starts on the last transaction, ties by name, unused last", () => {
    expect(sortPayees(rows, DEFAULT_SORT).map((row) => row.name)).toEqual(["c", "A", "b", "d"]);
  });
  it("keeps what has no value last in either direction", () => {
    expect(names("last", false)).toEqual(["A", "b", "c", "d"]);
    expect(names("category", false)).toEqual(["A", "b", "c", "d"]);
    expect(names("category", true)).toEqual(["b", "A", "c", "d"]);
  });
  it("sorts every column both ways", () => {
    expect(names("transactions")).toEqual(["A", "b", "c", "d"]);
    expect(names("transactions", false)).toEqual(["d", "c", "b", "A"]);
    expect(names("spent")).toEqual(["c", "b", "A", "d"]);
    expect(names("rules")[0]).toBe("b");
    expect(names("name", false)).toEqual(["A", "b", "c", "d"]);
    expect(names("name", true)).toEqual(["d", "c", "b", "A"]);
  });
  it("reverses the current column, and starts a new one in its natural order", () => {
    expect(nextSort(DEFAULT_SORT, "last", DESCENDING_FIRST)).toEqual({
      key: "last",
      descending: false,
    });
    expect(nextSort(DEFAULT_SORT, "spent", DESCENDING_FIRST)).toEqual({
      key: "spent",
      descending: true,
    });
    expect(nextSort(DEFAULT_SORT, "name", DESCENDING_FIRST)).toEqual({
      key: "name",
      descending: false,
    });
  });
});

describe("categorySummary", () => {
  it("is nothing without categories, and the one category there is", () => {
    expect(categorySummary([])).toBeNull();
    expect(categorySummary([category("Food", 1)])).toMatchObject({ label: "Food", others: 0 });
  });
  it("names a majority with how many others there are", () => {
    expect(categorySummary([category("Shopping", 5), category("Home", 2)])).toEqual({
      label: "Shopping",
      others: 1,
      mixed: false,
    });
  });
  it("reads as mixed without a majority", () => {
    expect(categorySummary([category("A", 1), category("B", 1)])?.mixed).toBe(true);
    expect(
      categorySummary([category("A", 3), category("B", 1), category("C", 1), category("D", 1)])
        ?.label,
    ).toBe("Mixed");
  });
});

describe("filters", () => {
  const ruled = payee("ruled", { ruleCount: 2, duplicateRules: true, transactionCount: 4 });
  const bare = payee("bare", {
    transactionCount: 4,
    categories: [category("Food", 4)],
    description: "A friend",
  });
  const unused = payee("unused");

  it("is any of a group's values, all across groups", () => {
    expect(passesFilters(ruled, { rules: ["none", "several"] })).toBe(true);
    expect(passesFilters(ruled, { rules: ["none"] })).toBe(false);
    expect(passesFilters(bare, { rules: ["none"], activity: ["repeat"] })).toBe(true);
    expect(passesFilters(unused, { rules: ["none"], activity: ["repeat"] })).toBe(false);
    expect(passesFilters(bare, { category: ["Food"] })).toBe(true);
    expect(passesFilters(ruled, { category: ["Food"] })).toBe(false);
  });

  it("offers only options that keep something, with their counts", () => {
    const groups = payeeFilterGroups([ruled, bare, unused]);
    const rules = groups.find((group) => group.id === "rules")!;
    expect(rules.options.map((option) => [option.value, option.count])).toEqual([
      ["none", 2],
      ["several", 1],
      ["duplicates", 1],
    ]);
    expect(groups.find((group) => group.id === "category")!.options).toEqual([
      { value: "Food", label: "Food", count: 1 },
    ]);
  });

  it("searches names and descriptions", () => {
    expect(matchesSearch(bare, "FRIEND")).toBe(true);
    expect(matchesSearch(bare, "  ba ")).toBe(true);
    expect(matchesSearch(bare, "nope")).toBe(false);
    expect(matchesSearch(unused, "friend")).toBe(false);
  });

  it("gives each open check the filters that list those payees", () => {
    const items = attentionItems({
      unused: 1,
      repeatWithoutRule: 1,
      duplicateRules: 0,
      ruleDisagrees: 0,
    });
    expect(items.map((item) => item.count)).toEqual([1, 1, 0, 0]);
    const rows = [ruled, bare, unused];
    const listed = (filters: (typeof items)[number]["filters"]) =>
      rows.filter((row) => passesFilters(row, filters)).map((row) => row.name);
    expect(listed(items[0]!.filters)).toEqual(["unused"]);
    expect(listed(items[1]!.filters)).toEqual(["bare"]);
  });
});

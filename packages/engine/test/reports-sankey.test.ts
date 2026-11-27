/**
 * Actual's `sankey-spreadsheet.test.ts` on the engine's Sankey graph functions, and the report
 * through `sankey_report`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addHiddenNodes,
  addNode,
  addPercentageLabels,
  addValueToLink,
  aggregateTransferPairs,
  buildSankeyData,
  cleanUpNodes,
  convertToSankeyData,
  createBudgetGraph,
  createTransactionsGraph,
  deleteLink,
  filterGraphByLayers,
  getCategoryGroup,
  getLayer,
  getNodeValue,
  hasChild,
  hasParent,
  isGraphLayer,
  moveNodeToEnd,
  moveNodeToStart,
  nodesInLayer,
  sortGraph,
  type Graph,
  type NodeData,
} from "../src/reports/sankey-graph.ts";
import { filterCategoryGroups } from "../src/reports/sankey.ts";
import { scratch } from "./helpers.ts";

const aggregated = {
  toBudget: 0,
  fromPreviousMonth: 0,
  lastMonthOverspent: 0,
  forNextMonth: 0,
  previousMonthLabel: "Dec 2023",
  nextMonthLabel: "Feb 2024",
};

describe("graph basics", () => {
  it("knows the graph layers", () => {
    for (const layer of [
      "payee",
      "income_category",
      "account",
      "budget",
      "category_group",
      "category",
    ])
      expect(isGraphLayer(layer)).toBe(true);
    for (const value of ["invalid", "", 123, null, undefined])
      expect(isGraphLayer(value)).toBe(false);
  });

  it("adds a node once and accumulates link values", () => {
    const graph: Graph = new Map();
    addNode(graph, "node1", "category", "Category 1");
    addNode(graph, "node1", "account", "Account 1");
    expect(graph.get("node1")).toMatchObject({ type: "category", name: "Category 1" });
    addNode(graph, "target", "category", "Target");
    addValueToLink(graph, "node1", "target", 100);
    addValueToLink(graph, "node1", "target", 50);
    expect(graph.get("node1")!.to.get("target")).toBe(150);
    addValueToLink(graph, "nonexistent", "target", 100);
    expect(graph.size).toBe(2);
    deleteLink(graph, "node1", "target");
    expect(graph.get("node1")!.to.has("target")).toBe(false);
    deleteLink(graph, "nonexistent", "target");
  });

  it("gives roots layer 0 and children the layer below their parents", () => {
    const graph: Graph = new Map();
    addNode(graph, "root", "account", "Root");
    addNode(graph, "child", "category", "Child");
    addNode(graph, "grandchild", "category", "Grandchild");
    addValueToLink(graph, "root", "child", 100);
    addValueToLink(graph, "child", "grandchild", 50);
    expect(["root", "child", "grandchild"].map((key) => getLayer(graph, key))).toEqual([0, 1, 2]);
  });

  it("does not recurse forever on a cycle, and puts a cycle in one layer", () => {
    const graph: Graph = new Map();
    addNode(graph, "account-a", "account", "Account A");
    addNode(graph, "account-b", "account", "Account B");
    addValueToLink(graph, "account-a", "account-b", 100);
    addValueToLink(graph, "account-b", "account-a", 80);
    expect(getLayer(graph, "account-a")).toBe(getLayer(graph, "account-b"));
    expect(Number.isFinite(getLayer(graph, "account-a"))).toBe(true);
  });

  it("lists nodes by layer, parents and children", () => {
    const graph: Graph = new Map();
    addNode(graph, "node1", "category", "Category 1");
    addNode(graph, "node2", "category", "Category 2");
    addNode(graph, "node3", "account", "Account 1");
    addValueToLink(graph, "node3", "node1", 100);
    expect(nodesInLayer(graph, "category")).toEqual(["node1", "node2"]);
    expect(nodesInLayer(graph, "payee")).toEqual([]);
    expect(hasParent(graph, "node1")).toBe(true);
    expect(hasParent(graph, "node2")).toBe(false);
    expect(hasChild(graph.get("node3")!)).toBe(true);
    expect(hasChild(graph.get("node2")!)).toBe(false);
  });

  it("values a root by what leaves it and any other node by what enters it", () => {
    const graph: Graph = new Map();
    addNode(graph, "root", "account", "Root");
    addNode(graph, "child", "category", "Child");
    addValueToLink(graph, "root", "child", 150);
    addValueToLink(graph, "root", "elsewhere", 200);
    expect(getNodeValue(graph, "root")).toBe(350);
    expect(getNodeValue(graph, "child")).toBe(150);
  });

  it("finds a category's group", () => {
    const graph: Graph = new Map();
    addNode(graph, "group1", "category_group", "Group 1");
    addNode(graph, "cat1", "category", "Category 1");
    addNode(graph, "cat2", "category", "Category 2");
    addValueToLink(graph, "group1", "cat1", 100);
    expect(getCategoryGroup(graph, "cat1")?.[0]).toBe("group1");
    expect(getCategoryGroup(graph, "cat2")).toBeUndefined();
  });

  it("moves entries to the end or start", () => {
    const entries = (): Array<[string, NodeData]> =>
      ["node1", "node2", "node3"].map((key) => [key, { to: new Map(), type: "category" }]);
    const end = entries();
    moveNodeToEnd(end, "node1");
    expect(end.map(([key]) => key)).toEqual(["node2", "node3", "node1"]);
    const start = entries();
    moveNodeToStart(start, "node3");
    expect(start.map(([key]) => key)).toEqual(["node3", "node1", "node2"]);
    moveNodeToStart(start, "nonexistent");
    expect(start.map(([key]) => key)).toEqual(["node3", "node1", "node2"]);
  });
});

describe("filterCategoryGroups", () => {
  const group = (id: string, categories: Array<[string, string]>) => ({
    id,
    name: `Group ${id}`,
    isIncome: false,
    categories: categories.map(([catId, name]) => ({ id: catId, name })),
  });
  const ids = (groups: ReadonlyArray<ReturnType<typeof group>>) =>
    groups.flatMap((g) => g.categories.map((c) => c.id));

  it("keeps everything without category conditions", () => {
    const groups = [group("g1", [["c1", "Cat 1"]]), group("g2", [["c2", "Cat 2"]])];
    expect(filterCategoryGroups(groups, [], "and")).toHaveLength(2);
    expect(
      filterCategoryGroups(groups, [{ field: "payee", op: "is", value: "p" }], "and"),
    ).toHaveLength(2);
  });

  it("filters categories by id, name and group", () => {
    const groups = [
      group("g1", [
        ["c1", "Groceries"],
        ["c2", "Entertainment"],
        ["c3", "Cat 3"],
      ]),
      group("g2", [["c4", "Cat 4"]]),
    ];
    const run = (conditions: Array<{ field: string; op: string; value: unknown }>) =>
      ids(filterCategoryGroups(groups, conditions, "and"));
    expect(run([{ field: "category", op: "is", value: "c1" }])).toEqual(["c1"]);
    expect(run([{ field: "category", op: "isNot", value: "c1" }])).toEqual(["c2", "c3", "c4"]);
    expect(run([{ field: "category", op: "contains", value: "groceries" }])).toEqual(["c1"]);
    expect(run([{ field: "category_group", op: "is", value: "g2" }])).toEqual(["c4"]);
    expect(run([{ field: "category", op: "is", value: "nonexistent" }])).toEqual([]);
    expect(run([{ field: "category", op: "oneOf", value: ["c1", "c3"] }])).toEqual(["c1", "c3"]);
    expect(run([{ field: "category", op: "matches", value: "/^ent/" }])).toEqual(["c2"]);
  });
});

describe("building the graph", () => {
  it("creates a budget graph with income and expense categories", () => {
    const graph = createBudgetGraph(
      [
        {
          categoryGroup: "Income",
          categoryGroupId: "g_income",
          category: "Salary",
          categoryId: "c_salary",
          value: 5000,
          isIncome: true,
          isNegative: false,
        },
        {
          categoryGroup: "Food",
          categoryGroupId: "g_food",
          category: "Groceries",
          categoryId: "c_groceries",
          value: 500,
          isIncome: false,
          isNegative: false,
        },
      ],
      { ...aggregated, toBudget: 1000, fromPreviousMonth: 200, forNextMonth: 300 },
    );
    for (const key of ["c_salary", "c_groceries", "budgeted", "available_income", "to_budget"])
      expect(graph.has(key)).toBe(true);
    expect(graph.get("from_previous_month")!.name).toBe("From Dec 2023");
  });

  it("marks to_budget as overbudgeted when negative", () => {
    const graph = createBudgetGraph([], { ...aggregated, toBudget: -500 });
    expect(graph.get("to_budget")).toMatchObject({ isNegative: true, name: "Overbudgeted" });
  });

  it("creates a transactions graph with account, category and payee nodes", () => {
    const graph = createTransactionsGraph([
      {
        categoryGroup: "Food",
        categoryGroupId: "g_food",
        category: "Groceries",
        categoryId: "c_groceries",
        value: 100,
        isIncome: false,
        isNegative: true,
        accountName: "Checking",
        accountId: "a_checking",
      },
      {
        categoryGroup: "Income",
        categoryGroupId: "g_income",
        category: "Salary",
        categoryId: "c_salary",
        value: 5000,
        isIncome: true,
        isNegative: false,
        accountName: "Checking",
        accountId: "a_checking",
        payeeName: "Employer",
        payeeId: "p_employer",
      },
    ]);
    for (const key of ["a_checking", "c_groceries", "c_salary", "p_employer"])
      expect(graph.has(key)).toBe(true);
  });

  it("keeps a transfer's direction when its source account id sorts after the other", () => {
    expect(
      aggregateTransferPairs([
        { id: "tx-1", transferId: "tx-2", accountId: "z", accountName: "Z", amount: -125 },
        { id: "tx-2", transferId: "tx-1", accountId: "a", accountName: "A", amount: 125 },
      ]),
    ).toEqual([
      {
        fromAccountId: "z",
        fromAccountName: "Z",
        toAccountId: "a",
        toAccountName: "A",
        amount: 125,
      },
    ]);
  });

  it("nets reciprocal transfers and leaves out pairs that net to nothing", () => {
    expect(
      aggregateTransferPairs([
        { id: "tx-1", transferId: "tx-2", accountId: "a", accountName: "A", amount: -100 },
        { id: "tx-2", transferId: "tx-1", accountId: "z", accountName: "Z", amount: 100 },
        { id: "tx-3", transferId: "tx-4", accountId: "z", accountName: "Z", amount: -100 },
        { id: "tx-4", transferId: "tx-3", accountId: "a", accountName: "A", amount: 100 },
      ]),
    ).toEqual([]);
  });
});

describe("shaping the graph", () => {
  it("sorts by value globally", () => {
    const graph: Graph = new Map();
    addNode(graph, "node1", "category", "Node 1");
    addNode(graph, "node2", "category", "Node 2");
    addNode(graph, "node3", "category", "Node 3");
    addValueToLink(graph, "node1", "target", 100);
    addValueToLink(graph, "node2", "target", 300);
    addValueToLink(graph, "node3", "target", 200);
    expect([...sortGraph(graph, "global", []).keys()]).toEqual(["node2", "node3", "node1"]);
  });

  it("sorts in budget order, each group before its categories", () => {
    const graph: Graph = new Map();
    addNode(graph, "g1", "category_group", "Group 1");
    addNode(graph, "g2", "category_group", "Group 2");
    addNode(graph, "c1", "category", "Cat 1");
    addNode(graph, "c2", "category", "Cat 2");
    addValueToLink(graph, "g1", "c1", 100);
    addValueToLink(graph, "g2", "c2", 200);
    const order = [
      { id: "g2", categories: [{ id: "c2" }] },
      { id: "g1", categories: [{ id: "c1" }] },
    ];
    expect([...sortGraph(graph, "budget-order", order).keys()]).toEqual(["g2", "c2", "g1", "c1"]);
    const unordered = [...sortGraph(graph, "budget-order", []).keys()];
    expect(unordered.indexOf("g1")).toBeLessThan(unordered.indexOf("c1"));
  });

  it("sorts payees before their income categories in per-group mode", () => {
    const graph: Graph = new Map();
    for (const key of ["payee1", "payee2", "payee3"]) addNode(graph, key, "payee", key);
    addNode(graph, "income1", "income_category", "Income 1");
    addNode(graph, "income2", "income_category", "Income 2");
    addNode(graph, "account1", "account", "Account 1");
    addValueToLink(graph, "payee1", "income1", 300);
    addValueToLink(graph, "payee2", "income2", 200);
    addValueToLink(graph, "payee3", "income2", 200);
    addValueToLink(graph, "income1", "account1", 300);
    addValueToLink(graph, "income2", "account1", 400);
    const keys = [...sortGraph(graph, "per-group", []).keys()];
    expect(keys.indexOf("payee2")).toBeLessThan(keys.indexOf("payee1"));
    expect(keys.indexOf("payee3")).toBeLessThan(keys.indexOf("payee1"));
  });

  it("labels each node with its share of its column", () => {
    const graph: Graph = new Map();
    addNode(graph, "node1", "category", "Node 1");
    addNode(graph, "node2", "category", "Node 2");
    addValueToLink(graph, "node1", "target", 250);
    addValueToLink(graph, "node2", "target", 750);
    addPercentageLabels(graph);
    expect(graph.get("node1")!.percentage).toBe(25);
    expect(graph.get("node2")!.percentage).toBe(75);
  });

  it("normalizes percentages per computed column", () => {
    const graph: Graph = new Map();
    addNode(graph, "account-root", "account", "Account A");
    addNode(graph, "account-transfer", "account", "Account B");
    addNode(graph, "group", "category_group", "Group");
    addNode(graph, "category", "category", "Category");
    addValueToLink(graph, "account-root", "account-transfer", 300);
    addValueToLink(graph, "account-root", "group", 100);
    addValueToLink(graph, "group", "category", 100);
    addHiddenNodes(graph);
    addPercentageLabels(graph);
    const byLayer = new Map<number, number>();
    for (const [key, node] of graph) {
      if (key.endsWith("__HIDDEN") || node.percentage === undefined) continue;
      const layer = getLayer(graph, key);
      byLayer.set(layer, (byLayer.get(layer) ?? 0) + node.percentage);
    }
    expect(byLayer.size).toBeGreaterThan(0);
    for (const total of byLayer.values()) expect(total).toBeCloseTo(100, 1);
  });

  it("keeps only the layers in range", () => {
    const graph: Graph = new Map();
    addNode(graph, "payee1", "payee", "Payee 1");
    addNode(graph, "cat1", "income_category", "Income Cat 1");
    addNode(graph, "acc1", "account", "Account 1");
    addNode(graph, "budget", "budget", "Budgeted");
    addNode(graph, "group1", "category_group", "Group 1");
    addNode(graph, "cat2", "category", "Category 2");
    filterGraphByLayers(graph, "account", "category_group");
    expect([...graph.keys()]).toEqual(["acc1", "budget", "group1"]);
  });

  it("removes nodes without links, after removing zero links", () => {
    const graph: Graph = new Map();
    addNode(graph, "used1", "category", "Used 1");
    addNode(graph, "used2", "category", "Used 2");
    addNode(graph, "orphan", "category", "Orphan");
    addNode(graph, "zero", "category", "Zero");
    addValueToLink(graph, "used1", "used2", 100);
    addValueToLink(graph, "orphan", "zero", 0);
    cleanUpNodes(graph);
    expect([...graph.keys()]).toEqual(["used1", "used2"]);
  });

  it("adds one hidden child layer for category groups without children", () => {
    const graph: Graph = new Map();
    addNode(graph, "account", "account", "Account");
    addNode(graph, "group-with-child", "category_group", "Group A");
    addNode(graph, "category", "category", "Category A");
    addValueToLink(graph, "account", "group-with-child", 100);
    addValueToLink(graph, "group-with-child", "category", 100);
    addNode(graph, "group-no-child", "category_group", "Group B");
    addValueToLink(graph, "account", "group-no-child", 50);
    const keys = buildSankeyData(graph, 100, [], "global", "account", "category").nodes.map(
      (node) => node.key,
    );
    expect(keys).toContain("group-no-child_category__HIDDEN");
    expect(keys).not.toContain("group-no-child_category_group__HIDDEN");
  });

  it("keeps category groups after every account column when transfers exist", () => {
    const graph: Graph = new Map();
    addNode(graph, "account-root", "account", "Account A");
    addNode(graph, "account-transfer", "account", "Account B");
    addNode(graph, "group", "category_group", "Group");
    addNode(graph, "category", "category", "Category");
    addValueToLink(graph, "account-root", "account-transfer", 300);
    addValueToLink(graph, "account-root", "group", 100);
    addValueToLink(graph, "group", "category", 100);
    const keys = buildSankeyData(graph, 100, [], "global", "account", "category").nodes.map(
      (node) => node.key,
    );
    expect(keys).toContain("group_account_1__HIDDEN");
  });

  it("converts the graph to nodes and indexed links", () => {
    const graph: Graph = new Map();
    addNode(graph, "node1", "category", "Node 1");
    addNode(graph, "node2", "category", "Node 2");
    addValueToLink(graph, "node1", "node2", 100);
    graph.get("node1")!.percentage = 100;
    const result = convertToSankeyData(graph, new Map());
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]!.percentage).toBe(100);
    expect(result.links).toEqual([{ source: 0, target: 1, value: 100, colorNode: 1, tooltip: [] }]);
  });
});

describe("sankey_report", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => {
    s = scratch();
  });
  afterEach(() => s.dispose());

  const setup = async () => {
    const book = (await s.call("create_book", { name: "Flows" })).id as string;
    const groups = await s.call("list_categories", { book });
    const category = (name: string) =>
      groups.flatMap((g: any) => g.categories).find((c: any) => c.name === name).id as string;
    const checking = (
      await s.call("create_account", {
        book,
        name: "Checking",
        balance: 100000,
        date: "2026-01-01",
      })
    ).id as string;
    const card = (await s.call("create_account", { book, name: "Visa", type: "liability" }))
      .id as string;
    const tx = (input: Record<string, unknown>) =>
      s.call("create_transaction", { book, account: checking, ...input });
    return {
      book,
      checking,
      card,
      tx,
      usual: groups[0].id as string,
      food: category("Food"),
      bills: category("Bills"),
      general: category("General"),
      income: category("Income"),
    };
  };

  const visible = (report: any) =>
    report.nodes.filter((node: any) => !node.hidden).map((node: any) => [node.name, node.value]);
  const link = (report: any, from: string, to: string) =>
    report.links.find(
      (l: any) => report.nodes[l.source].name === from && report.nodes[l.target].name === to,
    )?.value;

  it("flows spending from payees and income categories through accounts to categories", async () => {
    const { book, tx, food, bills, income, card } = await setup();
    await tx({ date: "2026-02-01", amount: 250000, payee: "Employer", category: income });
    await tx({ date: "2026-02-03", amount: -12000, payee: "Grocer", category: food });
    await tx({ date: "2026-02-04", amount: -30000, account: card, category: bills });
    await tx({ date: "2026-02-05", amount: 2000, payee: "Grocer", category: food });
    await tx({ date: "2026-02-06", amount: -5000, transferAccount: card });

    const report = await s.call("sankey_report", { book, start: "2026-01", end: "2026-02" });
    expect(report).toMatchObject({
      start: "2026-01",
      end: "2026-02",
      view: "spent",
      layerFrom: "payee",
      layerTo: "category",
    });
    expect(link(report, "Employer", "Income")).toBe(250000);
    expect(link(report, "Income", "Checking")).toBe(250000);
    // Opening balances flow from Actual's Starting Balances income category.
    expect(link(report, "Starting Balances", "Checking")).toBe(100000);
    expect(link(report, "Starting Balance", "Starting Balances")).toBe(100000);
    // A category's net spending per account; the card spends on its own.
    expect(link(report, "Checking", "Usual Expenses")).toBe(10000);
    expect(link(report, "Visa", "Usual Expenses")).toBe(30000);
    expect(link(report, "Usual Expenses", "Food")).toBe(10000);
    expect(link(report, "Usual Expenses", "Bills")).toBe(30000);
    // Transfers show only when asked.
    expect(link(report, "Checking", "Visa")).toBeUndefined();
    const withTransfers = await s.call("sankey_report", {
      book,
      start: "2026-01",
      end: "2026-02",
      showTransfers: true,
    });
    expect(link(withTransfers, "Checking", "Visa")).toBe(5000);

    const grouped = await s.call("sankey_report", {
      book,
      start: "2026-01",
      end: "2026-02",
      groupAccounts: true,
      layerFrom: "account",
    });
    // Cut at the accounts, the Income node is what leaves it.
    expect(visible(grouped)[0]).toEqual(["Income", 40000]);
    expect(grouped.nodes.find((n: any) => n.name === "Income").tone).toBe("primary");
    expect(grouped.nodes.some((n: any) => n.layer === "payee")).toBe(false);
  });

  it("shows a refund larger than the spending as money in", async () => {
    const { book, tx, food } = await setup();
    await tx({ date: "2026-02-03", amount: -1000, payee: "Grocer", category: food });
    await tx({ date: "2026-02-04", amount: 3000, payee: "Grocer", category: food });
    const report = await s.call("sankey_report", { book, start: "2026-02", end: "2026-02" });
    expect(link(report, "Grocer", "Checking")).toBe(2000);
  });

  it("folds the smallest nodes of a layer into Other past topN", async () => {
    const { book, tx, food, bills, general, income } = await setup();
    await tx({ date: "2026-02-01", amount: 250000, category: income });
    await tx({ date: "2026-02-03", amount: -12000, category: food });
    await tx({ date: "2026-02-04", amount: -3000, category: bills });
    await tx({ date: "2026-02-05", amount: -2000, category: general });
    const report = await s.call("sankey_report", {
      book,
      start: "2026-02",
      end: "2026-02",
      // The Other node counts towards the limit, so one more folds in once it exists.
      topN: 2,
      layerFrom: "account",
    });
    const other = report.links.find((l: any) => report.nodes[l.target].name === "Other");
    expect(report.nodes[other.source].name).toBe("Usual Expenses");
    expect(other.value).toBe(5000);
    expect(other.tooltip).toEqual([
      { name: "Bills", value: 3000 },
      { name: "General", value: 2000 },
    ]);
    expect(report.nodes.filter((n: any) => n.layer === "category" && !n.hidden)).toHaveLength(2);
  });

  it("shows percentages of each column", async () => {
    const { book, tx, food, bills } = await setup();
    await tx({ date: "2026-02-03", amount: -3000, category: food });
    await tx({ date: "2026-02-04", amount: -1000, category: bills });
    const report = await s.call("sankey_report", {
      book,
      start: "2026-02",
      end: "2026-02",
      layerFrom: "category_group",
    });
    const share = (name: string) => report.nodes.find((n: any) => n.name === name).percentage;
    expect([share("Food"), share("Bills")]).toEqual([75, 25]);
  });

  it("flows the budget from income through what was budgeted to categories", async () => {
    const { book, tx, food, bills, income } = await setup();
    await tx({ date: "2026-02-01", amount: 250000, category: income });
    await s.call("set_budget", { book, month: "2026-02", category: food, amount: 40000 });
    await s.call("set_budget", { book, month: "2026-02", category: bills, amount: 60000 });

    const report = await s.call("sankey_report", {
      book,
      start: "2026-02",
      end: "2026-02",
      view: "budgeted",
    });
    expect(report.layerFrom).toBe("income_category");
    expect(link(report, "Income", "Available funds")).toBe(250000);
    // January's opening balance is To Budget carried into February.
    expect(link(report, "From Jan 2026", "Available funds")).toBe(100000);
    expect(link(report, "Available funds", "Budgeted")).toBe(100000);
    expect(link(report, "Budgeted", "Usual Expenses")).toBe(100000);
    expect(link(report, "Usual Expenses", "Bills")).toBe(60000);
    expect(link(report, "Available funds", "To budget")).toBe(250000);
    const tone = (name: string) => report.nodes.find((n: any) => n.name === name).tone;
    expect([tone("To budget"), tone("Budgeted"), tone("From Jan 2026")]).toEqual([
      "positive",
      "primary",
      "neutral",
    ]);

    // Only category conditions apply to the budget.
    const food_ = await s.call("sankey_report", {
      book,
      start: "2026-02",
      end: "2026-02",
      view: "budgeted",
      conditions: [
        { field: "category", op: "is", value: food },
        { field: "payee", op: "is", value: "nobody" },
      ],
    });
    expect(link(food_, "Budgeted", "Usual Expenses")).toBe(40000);
  });

  it("counts opening balances as other income in the budgeted view", async () => {
    const { book } = await setup();
    const report = await s.call("sankey_report", {
      book,
      start: "2026-01",
      end: "2026-01",
      view: "budgeted",
    });
    expect(link(report, "Other income", "Available funds")).toBe(100000);
  });

  it("bounds the range to the months with transactions", async () => {
    const { book, tx, food } = await setup();
    await tx({ date: "2026-03-03", amount: -3000, category: food });
    const report = await s.call("sankey_report", { book, start: "2025-06", end: "2027-01" });
    expect([report.start, report.end]).toEqual(["2026-01", "2026-03"]);
  });

  it("falls back to the view's default layers when the range does not fit it", async () => {
    const { book } = await setup();
    const report = await s.call("sankey_report", {
      book,
      view: "spent",
      layerFrom: "budget",
      layerTo: "category",
    });
    expect([report.layerFrom, report.layerTo]).toEqual(["payee", "category"]);
  });
});

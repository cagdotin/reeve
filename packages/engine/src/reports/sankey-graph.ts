/**
 * The graph of Actual's Sankey report (`sankey-spreadsheet.ts`), as pure functions: nodes keyed by
 * id in layers (payee, income category, account, budget, category group, category) with weighted
 * links, folded to the top N per layer, sorted, padded with hidden nodes so every column lines up,
 * and cut to a range of layers.
 */

export type GraphLayer =
  | "payee"
  | "income_category"
  | "account"
  | "budget"
  | "category_group"
  | "category";

export const GRAPH_LAYER_ORDER: ReadonlyArray<GraphLayer> = [
  "payee",
  "income_category",
  "account",
  "budget",
  "category_group",
  "category",
];

export const isGraphLayer = (value: unknown): value is GraphLayer =>
  typeof value === "string" && (GRAPH_LAYER_ORDER as ReadonlyArray<string>).includes(value);

export const SpecialNodeKeys = {
  ToBudget: "to_budget",
  Budgeted: "budgeted",
  LastMonthOverspent: "last_month_overspent",
  ForNextMonth: "for_next_month",
  FromPrevMonth: "from_previous_month",
  AvailableIncome: "available_income",
  AllAccounts: "all_income",
  OtherSuffix: "__OTHER_BUCKET",
  HiddenSuffix: "__HIDDEN",
  NegativeSuffix: "__NEGATIVE",
} as const;

export type SortMode = "per-group" | "global" | "budget-order";

/** How a node is colored: by its key, or by what it stands for. */
export type Tone = "series" | "positive" | "negative" | "neutral" | "primary";

type NodeKey = string;

export interface NodeData {
  to: Map<NodeKey, number>;
  type: GraphLayer;
  name?: string | undefined;
  isNegative?: boolean | undefined;
  percentage?: number | undefined;
  tone?: Tone | undefined;
}

export type Graph = Map<NodeKey, NodeData>;

type TooltipInfoMap = Map<NodeKey, Map<NodeKey, Array<{ name: string; value: number }>>>;

/** One category's amount, as the graph is built from. */
export interface CategoryEntry {
  readonly categoryGroup: string;
  readonly categoryGroupId: string;
  readonly category: string;
  readonly categoryId: string;
  readonly value: number;
  readonly isIncome: boolean;
  readonly isNegative: boolean;
  readonly accountName?: string | undefined;
  readonly accountId?: string | undefined;
  readonly payeeName?: string | undefined;
  readonly payeeId?: string | undefined;
}

export interface TransferEntry {
  readonly id: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly amount: number;
  readonly transferId: string;
}

export interface TransferPair {
  readonly fromAccountId: string;
  readonly fromAccountName: string;
  readonly toAccountId: string;
  readonly toAccountName: string;
  readonly amount: number;
}

export interface AggregatedBudget {
  readonly toBudget: number;
  readonly fromPreviousMonth: number;
  readonly lastMonthOverspent: number;
  readonly forNextMonth: number;
  /** Labels of the months before the first and after the last, e.g. "Sep 2026". */
  readonly previousMonthLabel: string;
  readonly nextMonthLabel: string;
}

export interface CategoryGroupOrder {
  readonly id: string;
  readonly categories: ReadonlyArray<{ readonly id: string }>;
}

export interface SankeyNode {
  readonly key: string;
  readonly name: string;
  readonly layer: GraphLayer;
  /** A padding node that lines a column up; it is not drawn. */
  readonly hidden: boolean;
  readonly value: number;
  /** The node's share of its column, in percent. */
  readonly percentage: number | null;
  readonly tone: Tone;
}

export interface SankeyLink {
  readonly source: number;
  readonly target: number;
  readonly value: number;
  /** The node whose color the link takes, if any. */
  readonly colorNode: number | null;
  /** What an "Other" link folds together. */
  readonly tooltip: ReadonlyArray<{ readonly name: string; readonly value: number }>;
}

export interface SankeyData {
  readonly nodes: ReadonlyArray<SankeyNode>;
  readonly links: ReadonlyArray<SankeyLink>;
}

export const addNode = (graph: Graph, key: NodeKey, type: GraphLayer, name?: string) => {
  if (!graph.has(key)) graph.set(key, { to: new Map(), type, name });
};

export const addNodeWithLabel = (
  graph: Graph,
  key: NodeKey,
  type: GraphLayer,
  name: string,
  isNegative?: boolean,
) => {
  if (!graph.has(key)) graph.set(key, { to: new Map(), type, name, isNegative });
};

export const addValueToLink = (graph: Graph, from: NodeKey, to: NodeKey, value: number) => {
  const node = graph.get(from);
  if (node) node.to.set(to, (node.to.get(to) ?? 0) + value);
};

export const deleteLink = (graph: Graph, from: NodeKey, to: NodeKey) => {
  graph.get(from)?.to.delete(to);
};

export const hasParent = (graph: Graph, key: NodeKey): boolean => {
  for (const [, data] of graph) if (data.to.has(key)) return true;
  return false;
};

export const hasChild = (node: NodeData): boolean => node.to.size > 0;

export const nodesInLayer = (graph: Graph, layer: GraphLayer): Array<NodeKey> =>
  [...graph].filter(([, data]) => data.type === layer).map(([key]) => key);

export const getCategoryGroup = (graph: Graph, key: NodeKey) =>
  [...graph].find(([, data]) => data.to.has(key) && data.type === "category_group");

const isHidden = (key: NodeKey) => key.endsWith(SpecialNodeKeys.HiddenSuffix);

/**
 * Each node's column: its strongly connected component's depth below the roots (Tarjan's
 * algorithm), so a cycle cannot recurse forever.
 */
const layersOf = (graph: Graph): Map<NodeKey, number> => {
  const visited = new Map<NodeKey, number>();
  const lowlink = new Map<NodeKey, number>();
  const stack: Array<NodeKey> = [];
  const onStack = new Set<NodeKey>();
  const componentOf = new Map<NodeKey, number>();
  let components = 0;
  let index = 0;

  const connect = (key: NodeKey) => {
    visited.set(key, index);
    lowlink.set(key, index);
    index += 1;
    stack.push(key);
    onStack.add(key);
    for (const child of graph.get(key)?.to.keys() ?? []) {
      if (!graph.has(child)) continue;
      if (!visited.has(child)) {
        connect(child);
        lowlink.set(key, Math.min(lowlink.get(key)!, lowlink.get(child)!));
      } else if (onStack.has(child)) {
        lowlink.set(key, Math.min(lowlink.get(key)!, visited.get(child)!));
      }
    }
    if (lowlink.get(key) === visited.get(key)) {
      const component = components++;
      let popped: NodeKey | undefined;
      do {
        popped = stack.pop();
        if (popped === undefined) break;
        onStack.delete(popped);
        componentOf.set(popped, component);
      } while (popped !== key);
    }
  };
  for (const key of graph.keys()) if (!visited.has(key)) connect(key);

  const parents = new Map<number, Set<number>>();
  for (const [source, node] of graph) {
    const from = componentOf.get(source);
    if (from === undefined) continue;
    for (const target of node.to.keys()) {
      const to = componentOf.get(target);
      if (to === undefined || to === from) continue;
      parents.set(to, (parents.get(to) ?? new Set()).add(from));
    }
  }
  const depth = new Map<number, number>();
  const depthOf = (component: number): number => {
    const known = depth.get(component);
    if (known !== undefined) return known;
    const own = parents.get(component);
    const value = own === undefined || own.size === 0 ? 0 : 1 + Math.max(...[...own].map(depthOf));
    depth.set(component, value);
    return value;
  };
  return new Map([...componentOf].map(([key, component]) => [key, depthOf(component)]));
};

/** A node's column; a key not in the graph is a root. */
export const getLayer = (graph: Graph, key: NodeKey): number =>
  graph.has(key) ? (layersOf(graph).get(key) ?? 0) : 0;

/**
 * A node's value: what leaves a root, what enters any other node, leaving out hidden nodes. A node
 * whose hidden parents make its inflow negative is a root in disguise.
 */
export const getNodeValue = (graph: Graph, key: NodeKey, layers = layersOf(graph)): number => {
  let value = 0;
  const outflow = () => {
    let sum = 0;
    graph.get(key)?.to.forEach((amount, target) => {
      if (!isHidden(target)) sum += amount;
    });
    return sum;
  };
  if ((layers.get(key) ?? 0) === 0) return outflow();
  graph.forEach((data, source) => {
    if (!isHidden(source)) value += data.to.get(key) ?? 0;
  });
  return value < 0 ? outflow() : value;
};

export const createBudgetGraph = (
  categoryData: ReadonlyArray<CategoryEntry>,
  aggregated: AggregatedBudget,
): Graph => {
  const graph: Graph = new Map();
  const K = SpecialNodeKeys;
  addNode(graph, K.Budgeted, "budget", "Budgeted");
  addNode(graph, K.AvailableIncome, "account", "Available funds");

  for (const entry of categoryData) {
    if (entry.isIncome) {
      addNode(graph, entry.categoryId, "income_category", entry.category);
      addValueToLink(graph, entry.categoryId, K.AvailableIncome, entry.value);
    } else if (entry.value >= 0) {
      addNode(graph, entry.categoryGroupId, "category_group", entry.categoryGroup);
      addNode(graph, entry.categoryId, "category", entry.category);
      addValueToLink(graph, entry.categoryGroupId, entry.categoryId, entry.value);
      addValueToLink(graph, K.Budgeted, entry.categoryGroupId, entry.value);
      addValueToLink(graph, K.AvailableIncome, K.Budgeted, entry.value);
    } else {
      addNodeWithLabel(graph, entry.categoryId, "account", `From ${entry.category}`, true);
      addValueToLink(graph, entry.categoryId, K.Budgeted, Math.abs(entry.value));
      addValueToLink(graph, K.AvailableIncome, K.Budgeted, entry.value);
    }
  }

  if (aggregated.toBudget > 0) {
    addNodeWithLabel(graph, K.ToBudget, "category_group", "To budget", false);
    addValueToLink(graph, K.AvailableIncome, K.ToBudget, aggregated.toBudget);
  } else {
    addNodeWithLabel(graph, K.ToBudget, "account", "Overbudgeted", true);
    addValueToLink(graph, K.ToBudget, K.Budgeted, Math.abs(aggregated.toBudget));
    addValueToLink(graph, K.AvailableIncome, K.Budgeted, -Math.abs(aggregated.toBudget));
  }

  addNodeWithLabel(
    graph,
    K.FromPrevMonth,
    "income_category",
    `From ${aggregated.previousMonthLabel}`,
  );
  addValueToLink(graph, K.FromPrevMonth, K.AvailableIncome, aggregated.fromPreviousMonth);
  addNodeWithLabel(graph, K.ForNextMonth, "budget", `For ${aggregated.nextMonthLabel}`);
  addValueToLink(graph, K.AvailableIncome, K.ForNextMonth, aggregated.forNextMonth);
  addNode(graph, K.LastMonthOverspent, "budget", "Overspent");
  addValueToLink(
    graph,
    K.AvailableIncome,
    K.LastMonthOverspent,
    Math.abs(aggregated.lastMonthOverspent),
  );
  return graph;
};

export const createTransactionsGraph = (
  categoryData: ReadonlyArray<CategoryEntry>,
  transferData?: ReadonlyArray<TransferPair>,
  groupAccounts?: boolean,
): Graph => {
  const graph: Graph = new Map();
  const K = SpecialNodeKeys;
  const addAccount = (id: string, name: string) => {
    if (id === K.AllAccounts) addNodeWithLabel(graph, id, "account", "Income");
    else addNode(graph, id, "account", name);
  };

  for (const entry of categoryData) {
    if (!entry.accountId || !entry.accountName || !entry.categoryId) continue;
    const negativeKey = entry.categoryId + K.NegativeSuffix;
    if (entry.isIncome) {
      if (entry.isNegative) {
        addAccount(entry.accountId, entry.accountName);
        addNodeWithLabel(
          graph,
          negativeKey,
          "category_group",
          entry.payeeName || entry.category,
          true,
        );
        addValueToLink(graph, entry.accountId, negativeKey, entry.value);
      } else {
        addNode(graph, entry.categoryId, "income_category", entry.category);
        addAccount(entry.accountId, entry.accountName);
        addValueToLink(graph, entry.categoryId, entry.accountId, entry.value);
        if (entry.payeeId) {
          addNode(graph, entry.payeeId, "payee", entry.payeeName);
          addValueToLink(graph, entry.payeeId, entry.categoryId, entry.value);
        }
      }
    } else if (entry.isNegative) {
      addAccount(entry.accountId, entry.accountName);
      addNode(graph, entry.categoryGroupId, "category_group", entry.categoryGroup);
      addNode(graph, entry.categoryId, "category", entry.category);
      addValueToLink(graph, entry.accountId, entry.categoryGroupId, entry.value);
      addValueToLink(graph, entry.categoryGroupId, entry.categoryId, entry.value);
    } else {
      addNode(graph, negativeKey, "income_category", entry.payeeName || entry.category);
      addAccount(entry.accountId, entry.accountName);
      addValueToLink(graph, negativeKey, entry.accountId, entry.value);
    }
  }

  if (transferData && transferData.length > 0 && !groupAccounts)
    for (const pair of transferData) {
      addAccount(pair.fromAccountId, pair.fromAccountName);
      addAccount(pair.toAccountId, pair.toAccountName);
      addValueToLink(graph, pair.fromAccountId, pair.toAccountId, pair.amount);
    }
  return graph;
};

/** Transfers between two accounts netted per pair, flowing from the account money left. */
export const aggregateTransferPairs = (rows: ReadonlyArray<TransferEntry>): Array<TransferPair> => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const names = new Map(rows.map((row) => [row.accountId, row.accountName]));
  const pairs = new Map<string, number>();
  for (const from of rows) {
    const to = byId.get(from.transferId);
    if (to === undefined || from.accountId > to.accountId) continue;
    const [first, second] = [from.accountId, to.accountId].sort();
    const key = `${first}|${second}`;
    const source = from.amount < 0 ? from.accountId : to.accountId;
    pairs.set(key, (pairs.get(key) ?? 0) + (source === first ? 1 : -1) * Math.abs(from.amount));
  }
  return [...pairs]
    .filter(([, value]) => value !== 0)
    .map(([key, value]) => {
      const [first, second] = key.split("|") as [string, string];
      const fromAccountId = value > 0 ? first : second;
      const toAccountId = value > 0 ? second : first;
      return {
        fromAccountId,
        fromAccountName: names.get(fromAccountId) ?? "",
        toAccountId,
        toAccountName: names.get(toAccountId) ?? "",
        amount: Math.abs(value),
      };
    });
};

const cloneGraph = (graph: Graph): Graph =>
  new Map([...graph].map(([key, node]) => [key, { ...node, to: new Map(node.to) }]));

const addTooltipInfo = (
  map: TooltipInfoMap,
  from: NodeKey,
  to: NodeKey,
  name: string,
  value: number,
) => {
  const inner = map.get(from) ?? new Map();
  map.set(from, inner);
  const existing = inner.get(to) ?? [];
  if (!existing.some((info: { name: string }) => info.name === name))
    inner.set(to, [...existing, { name, value }]);
};

const moveToOther = (graph: Graph, key: NodeKey, tooltips: TooltipInfoMap, global: boolean) => {
  const node = graph.get(key);
  if (!node) return;
  const toNodes = [...node.to.keys()];
  const fromNodes = [...graph].filter(([, data]) => data.to.has(key));
  let otherKey = node.type + SpecialNodeKeys.OtherSuffix;
  if (!global) {
    if (node.type === "category") {
      const group = getCategoryGroup(graph, key);
      if (group) otherKey = group[0] + SpecialNodeKeys.OtherSuffix;
    } else if (node.type === "payee") {
      const income = toNodes.find((k) => graph.get(k)?.type === "income_category");
      if (income) otherKey = income + SpecialNodeKeys.OtherSuffix;
    }
  }
  addNode(graph, otherKey, node.type, "Other");
  for (const [fromKey, fromData] of fromNodes) {
    const value = fromData.to.get(key);
    if (value !== undefined && fromKey !== otherKey) {
      addValueToLink(graph, fromKey, otherKey, value);
      addTooltipInfo(tooltips, fromKey, otherKey, node.name ?? key, value);
    }
  }
  for (const toKey of toNodes) {
    const value = node.to.get(toKey);
    if (value !== undefined && otherKey !== toKey) {
      addValueToLink(graph, otherKey, toKey, value);
      addTooltipInfo(tooltips, otherKey, toKey, node.name ?? key, value);
    }
  }
  for (const toKey of toNodes) deleteLink(graph, key, toKey);
  for (const [fromKey] of fromNodes) deleteLink(graph, fromKey, key);
  graph.delete(key);
};

/** Folds the smallest nodes of each layer into "Other" until at most `topN` remain. */
const groupOtherCategories = (graph: Graph, topN: number, sort: SortMode): TooltipInfoMap => {
  const tooltips: TooltipInfoMap = new Map();
  const structural = new Set<string>(Object.values(SpecialNodeKeys));
  const groupable = (key: NodeKey) => {
    const node = graph.get(key);
    return Boolean(
      node &&
      !key.endsWith(SpecialNodeKeys.OtherSuffix) &&
      !structural.has(key) &&
      !node.isNegative,
    );
  };
  for (const layer of GRAPH_LAYER_ORDER) {
    const count = () => {
      const keys = nodesInLayer(graph, layer);
      return {
        ordinary: keys.filter(groupable),
        others: keys.filter((key) => key.endsWith(SpecialNodeKeys.OtherSuffix)),
      };
    };
    let { ordinary, others } = count();
    while (ordinary.length + others.length > topN) {
      let min = Infinity;
      let smallest: NodeKey | undefined;
      for (const key of ordinary) {
        const value = getNodeValue(graph, key);
        if (value < min) {
          min = value;
          smallest = key;
        }
      }
      if (smallest === undefined) break;
      moveToOther(graph, smallest, tooltips, sort === "global");
      ({ ordinary, others } = count());
    }
  }
  return tooltips;
};

type Entry = [NodeKey, NodeData];

export const moveNodeToEnd = (entries: Array<Entry>, key: NodeKey) => {
  const index = entries.findIndex(([each]) => each === key);
  if (index !== -1) entries.push(...entries.splice(index, 1));
};

export const moveNodeToStart = (entries: Array<Entry>, key: NodeKey) => {
  const index = entries.findIndex(([each]) => each === key);
  if (index !== -1) entries.unshift(...entries.splice(index, 1));
};

export const sortGraph = (
  graph: Graph,
  sort: SortMode,
  categories: ReadonlyArray<CategoryGroupOrder>,
): Graph => {
  const byValue = (a: Entry, b: Entry) => getNodeValue(graph, b[0]) - getNodeValue(graph, a[0]);

  const sortAround = (
    entries: Array<Entry>,
    anchorLayer: GraphLayer,
    relatedLayer: GraphLayer,
    placement: "before" | "after",
  ) => {
    for (const anchorKey of nodesInLayer(graph, anchorLayer)) {
      const anchor = graph.get(anchorKey);
      if (!anchor) continue;
      const related =
        placement === "after"
          ? [...anchor.to.keys()].filter((key) => graph.get(key)?.type === relatedLayer)
          : [...graph]
              .filter(([, data]) => data.type === relatedLayer && data.to.has(anchorKey))
              .map(([key]) => key);
      const otherKey = `${anchorKey}${SpecialNodeKeys.OtherSuffix}`;
      const relatedOther = graph.get(otherKey)?.type === relatedLayer ? otherKey : undefined;
      const ordered = related.filter((key) => key !== otherKey);
      const relatedEntries = ordered
        .map((key) => entries.find(([each]) => each === key))
        .filter((entry): entry is Entry => entry !== undefined)
        .sort(byValue);
      const otherEntry = relatedOther ? entries.find(([each]) => each === relatedOther) : undefined;
      const moving = new Set(ordered);
      if (relatedOther) moving.add(relatedOther);
      const rest = entries.filter(([each]) => !moving.has(each));
      const anchorIndex = rest.findIndex(([each]) => each === anchorKey);
      if (anchorIndex === -1) continue;
      rest.splice(
        placement === "before" ? anchorIndex : anchorIndex + 1,
        0,
        ...(otherEntry ? [...relatedEntries, otherEntry] : relatedEntries),
      );
      entries.length = 0;
      entries.push(...rest);
    }
  };

  let sorted: Array<Entry>;
  if (sort === "global") {
    sorted = [...graph.entries()].sort(byValue);
    // Moving while iterating skips the entry after a moved one, as Actual's forEach does.
    sorted.forEach(([key]) => {
      if (key.endsWith(SpecialNodeKeys.OtherSuffix)) moveNodeToEnd(sorted, key);
    });
  } else if (sort === "per-group") {
    sorted = [...graph.entries()].sort(byValue);
    sortAround(sorted, "category_group", "category", "after");
    sortAround(sorted, "income_category", "payee", "before");
  } else {
    const used = new Set<NodeKey>();
    sorted = [];
    for (const group of categories) {
      for (const key of [
        group.id,
        ...group.categories.map((category) => category.id),
        `${group.id}${SpecialNodeKeys.OtherSuffix}`,
      ]) {
        const node = graph.get(key);
        if (node) {
          sorted.push([key, node]);
          used.add(key);
        }
      }
    }
    for (const entry of graph) if (!used.has(entry[0])) sorted.push(entry);
  }

  for (const [key] of sorted.filter(([, node]) => node.isNegative)) moveNodeToStart(sorted, key);
  const toBudget = graph.get(SpecialNodeKeys.ToBudget);
  if (toBudget) {
    if (toBudget.isNegative) moveNodeToStart(sorted, SpecialNodeKeys.ToBudget);
    else moveNodeToEnd(sorted, SpecialNodeKeys.ToBudget);
  }
  moveNodeToEnd(sorted, SpecialNodeKeys.LastMonthOverspent);
  moveNodeToEnd(sorted, SpecialNodeKeys.ForNextMonth);
  moveNodeToEnd(sorted, SpecialNodeKeys.FromPrevMonth);
  return new Map(sorted);
};

/** Removes zero links, then nodes with no link at all. */
export const cleanUpNodes = (graph: Graph) => {
  for (const [, node] of graph)
    for (const [target, value] of node.to) if (value === 0) node.to.delete(target);
  const incoming = new Set<NodeKey>();
  for (const [, node] of graph) for (const target of node.to.keys()) incoming.add(target);
  for (const [key, node] of [...graph])
    if (node.to.size === 0 && !incoming.has(key)) graph.delete(key);
};

const deepestParent = (graph: Graph, key: NodeKey, layers: Map<NodeKey, number>) => {
  let deepest: NodeKey | undefined;
  let depth = -Infinity;
  for (const [parent, data] of graph) {
    if (!data.to.has(key)) continue;
    const layer = layers.get(parent);
    if (layer !== undefined && layer > depth) {
      depth = layer;
      deepest = parent;
    }
  }
  return deepest;
};

/** Category groups go to a column after every visible account (transfers make account columns). */
const pushCategoryGroupsPastAccounts = (graph: Graph) => {
  let layers = layersOf(graph);
  let maxAccount = -1;
  for (const [key, node] of graph)
    if (node.type === "account" && !isHidden(key))
      maxAccount = Math.max(maxAccount, layers.get(key) ?? -1);
  if (maxAccount < 0) return;
  const groups = [...graph]
    .filter(([key, node]) => node.type === "category_group" && (layers.get(key) ?? 0) <= maxAccount)
    .map(([key]) => key);
  for (const key of groups) {
    let current = layers.get(key);
    while (current !== undefined && current <= maxAccount) {
      const parent = deepestParent(graph, key, layers);
      if (!parent) break;
      const hidden = `${key}_account_${current}${SpecialNodeKeys.HiddenSuffix}`;
      addNode(graph, hidden, "account", "");
      addValueToLink(graph, parent, hidden, -1);
      addValueToLink(graph, hidden, key, -1);
      layers = layersOf(graph);
      current = layers.get(key);
    }
  }
};

/**
 * Pads nodes whose layer has parents (or children) they lack with chains of hidden nodes, so each
 * lands in its layer's column.
 */
export const addHiddenNodes = (graph: Graph) => {
  const byType = Map.groupBy(graph, ([, node]) => node.type);
  const typeHasParent = new Map<GraphLayer, boolean>();
  const typeHasChild = new Map<GraphLayer, boolean>();
  for (const [type, nodes] of byType) {
    typeHasParent.set(
      type,
      nodes.some(([key]) => hasParent(graph, key)),
    );
    typeHasChild.set(
      type,
      nodes.some(([, node]) => hasChild(node)),
    );
  }
  const active = GRAPH_LAYER_ORDER.filter((layer) => (byType.get(layer)?.length ?? 0) > 0);
  const indexOf = new Map(active.map((layer, index) => [layer, index]));

  const parentChain = (key: NodeKey, type: GraphLayer) => {
    const index = indexOf.get(type);
    if (index === undefined || index <= 0) return;
    let child = key;
    for (let i = index - 1; i >= 0; i--) {
      const parentType = active[i]!;
      const parent = `${key}_${parentType}${SpecialNodeKeys.HiddenSuffix}`;
      addNode(graph, parent, parentType, "");
      addValueToLink(graph, parent, child, -1);
      child = parent;
    }
  };
  const childChain = (key: NodeKey, type: GraphLayer) => {
    const index = indexOf.get(type);
    if (index === undefined || index >= active.length - 1) return;
    let parent = key;
    for (let i = index + 1; i < active.length; i++) {
      const childType = active[i]!;
      const child = `${key}_${childType}${SpecialNodeKeys.HiddenSuffix}`;
      addNode(graph, child, childType, "");
      addValueToLink(graph, parent, child, -1);
      parent = child;
    }
  };

  for (const [type, nodes] of byType)
    for (const [key, node] of nodes) {
      if (!hasParent(graph, key) && typeHasParent.get(type)) parentChain(key, type);
      if (!hasChild(node) && typeHasChild.get(type)) childChain(key, type);
    }
  pushCategoryGroupsPastAccounts(graph);
};

/** Each node's share of its column's total. */
export const addPercentageLabels = (graph: Graph) => {
  const layers = layersOf(graph);
  const sums = new Map<number, number>();
  graph.forEach((_, key) => {
    const layer = layers.get(key);
    if (isHidden(key) || layer === undefined) return;
    sums.set(layer, (sums.get(layer) ?? 0) + getNodeValue(graph, key, layers));
  });
  graph.forEach((node, key) => {
    const layer = layers.get(key);
    if (isHidden(key) || layer === undefined) {
      node.percentage = undefined;
      return;
    }
    const total = sums.get(layer) ?? 1;
    node.percentage = total ? (getNodeValue(graph, key, layers) / total) * 100 : 0;
  });
};

const addTones = (graph: Graph) => {
  const K = SpecialNodeKeys;
  for (const [, node] of graph) node.tone = "series";
  const set = (key: NodeKey, tone: Tone) => {
    const node = graph.get(key);
    if (node) node.tone = tone;
  };
  set(K.ToBudget, "positive");
  for (const [key, node] of graph) if (node.isNegative) set(key, "negative");
  set(K.LastMonthOverspent, "negative");
  set(K.FromPrevMonth, "neutral");
  set(K.ForNextMonth, "neutral");
  set(K.Budgeted, "primary");
  set(K.AvailableIncome, "primary");
  set(K.AllAccounts, "primary");
};

/** Keeps the nodes of the layers from `from` to `to`. */
export const filterGraphByLayers = (graph: Graph, from: GraphLayer, to: GraphLayer) => {
  const fromIndex = GRAPH_LAYER_ORDER.indexOf(from);
  const toIndex = GRAPH_LAYER_ORDER.indexOf(to);
  for (const [key, node] of [...graph]) {
    const index = GRAPH_LAYER_ORDER.indexOf(node.type);
    if (index < fromIndex || index > toIndex) graph.delete(key);
  }
};

export const convertToSankeyData = (graph: Graph, tooltips: TooltipInfoMap): SankeyData => {
  const keys = [...graph.keys()];
  const indexOf = new Map(keys.map((key, index) => [key, index]));
  const layers = layersOf(graph);
  const nodes = [...graph].map(([key, node]): SankeyNode => ({
    key,
    name: node.name ?? key,
    layer: node.type,
    hidden: isHidden(key),
    value: getNodeValue(graph, key, layers),
    percentage: node.percentage ?? null,
    tone: node.tone ?? "series",
  }));
  const K = SpecialNodeKeys;
  const links = [...graph].flatMap(([key, node]) =>
    [...node.to].map(([target, value]): SankeyLink => {
      const tooltip = (tooltips.get(key)?.get(target) ?? []).toSorted((a, b) => b.value - a.value);
      let color: NodeKey | undefined;
      if (["payee", "income_category", "account", "category_group"].includes(node.type))
        color = key;
      else if (node.type === "category" || node.type === "budget") color = target;
      if (
        target === K.LastMonthOverspent ||
        target.endsWith(K.NegativeSuffix) ||
        target === K.ToBudget ||
        target === K.ForNextMonth
      )
        color = target;
      if (node.isNegative) color = key;
      return {
        source: indexOf.get(key) ?? -1,
        target: indexOf.get(target) ?? -1,
        value,
        colorNode: color === undefined ? null : (indexOf.get(color) ?? null),
        tooltip,
      };
    }),
  );
  return { nodes, links };
};

/** The graph as the chart draws it: top N per layer, sorted, padded, labelled, cut to layers. */
export const buildSankeyData = (
  baseGraph: Graph,
  topN: number,
  categories: ReadonlyArray<CategoryGroupOrder>,
  sort: SortMode,
  layerFrom: GraphLayer,
  layerTo: GraphLayer,
): SankeyData => {
  const graph = cloneGraph(baseGraph);
  const tooltips = groupOtherCategories(graph, topN, sort);
  const sorted = sortGraph(graph, sort, categories);
  cleanUpNodes(sorted);
  addHiddenNodes(sorted);
  addPercentageLabels(sorted);
  addTones(sorted);
  filterGraphByLayers(sorted, layerFrom, layerTo);
  return convertToSankeyData(sorted, tooltips);
};

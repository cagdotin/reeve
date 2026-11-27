import type { CustomReport } from "@reeve/contract/catalog";

export type Totals = {
  readonly totalAssets: number;
  readonly totalDebts: number;
  readonly netAssets: number;
  readonly netDebts: number;
  readonly totalTotals: number;
};

export type GraphType =
  | "TableGraph"
  | "BarGraph"
  | "AreaGraph"
  | "DonutGraph"
  | "LineGraph"
  | "StackedBarGraph";

export type ReportMode = CustomReport["mode"];
export type BalanceType = CustomReport["balanceType"];
export type GroupBy = CustomReport["groupBy"];

/** The graphs Actual offers in each mode. */
export const GRAPHS: Record<ReportMode, ReadonlyArray<GraphType>> = {
  total: ["TableGraph", "BarGraph", "AreaGraph", "DonutGraph"],
  time: ["TableGraph", "StackedBarGraph", "LineGraph"],
};

export const GRAPH_LABELS: Record<GraphType, string> = {
  TableGraph: "Table",
  BarGraph: "Bar",
  AreaGraph: "Area",
  DonutGraph: "Donut",
  LineGraph: "Line",
  StackedBarGraph: "Stacked bar",
};

/** Whether a graph can show a split, as Actual's disabled lists. */
export const splitAllowed = (mode: ReportMode, graph: GraphType, groupBy: GroupBy) => {
  if (groupBy === "CategoryGroup") return graph === "DonutGraph";
  if (graph === "AreaGraph") return groupBy === "Interval";
  if (mode === "time") return groupBy !== "Interval";
  return true;
};

export const typeAllowed = (mode: ReportMode, graph: GraphType, balanceType: BalanceType) => {
  if (graph === "DonutGraph") return balanceType !== "Net";
  if (mode === "time" && graph === "TableGraph")
    return balanceType !== "Net Payment" && balanceType !== "Net Deposit";
  return true;
};

/** A row's amount for the balance type, as the graphs plot it: payments as positive sizes. */
/** Whether a report's single figure is money going out. */
export const isMoneyOut = (balanceType: BalanceType) =>
  balanceType === "Payment" || balanceType === "Net Payment";

export const amountOf = (totals: Totals, balanceType: BalanceType) => {
  switch (balanceType) {
    case "Payment":
      return Math.abs(totals.totalDebts);
    case "Deposit":
      return totals.totalAssets;
    case "Net Payment":
      return Math.abs(totals.netDebts);
    case "Net Deposit":
      return totals.netAssets;
    case "Net":
    case "Budgeted":
      return totals.totalTotals;
  }
};

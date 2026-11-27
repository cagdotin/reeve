import type { reports } from "@reeve/contract/catalog";

type Success<K extends keyof typeof reports> = (typeof reports)[K]["success"]["Type"];

/** The contract's report schemas as types, read off the catalog entries. */
export type NetWorthReport = Success<"net_worth_report">;
export type CashFlowReport = Success<"cash_flow_report">;
export type SpendingReport = Success<"spending_report">;
export type FigureRecords = Success<"spending_transactions">;
export type SummaryReport = Success<"summary_report">;
export type CalendarReport = Success<"calendar_report">;
export type CustomReportResult = Success<"run_custom_report">;
export type CrossoverReport = Success<"crossover_report">;
export type BudgetAnalysisReport = Success<"budget_analysis_report">;
export type SankeyReport = Success<"sankey_report">;
export type AgeOfMoneyReport = Success<"age_of_money_report">;
export type CustomReport = Success<"create_custom_report">;
export type DashboardPage = Success<"create_dashboard_page">;
export type Widget = Success<"add_widget">;
export type PageWidgets = Success<"list_page_widgets">;
export type PageHost = PageWidgets["host"];
export type Tag = Success<"create_tag">;
export type TimeFrameMode = NonNullable<
  (typeof reports)["summary_report"]["input"]["Type"]["mode"]
>;

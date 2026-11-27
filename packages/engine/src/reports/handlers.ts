import type { reports } from "@reeve/contract/catalog";
import type { DomainHandlers } from "../handler.ts";
import { ageOfMoneyReport } from "./age-of-money.ts";
import { budgetAnalysisReport } from "./budget-analysis.ts";
import { calendarReport } from "./calendar.ts";
import { cashFlowReport } from "./cash-flow.ts";
import { crossoverReport } from "./crossover.ts";
import { DEFAULT_DEFINITION, runCustomReport, type Definition } from "./custom.ts";
import {
  addPageWidget,
  addWidget,
  movePageWidget,
  pageWidgets,
  copyWidget,
  createCustomReport,
  createDashboardPage,
  duplicateDashboardPage,
  repairWidget,
  reorderDashboardPages,
  setDefaultDashboard,
  updateWidgets,
  customReportOf,
  deleteCustomReport,
  deleteDashboardPage,
  listCustomReports,
  listDashboardPages,
  removeWidget,
  renameDashboardPage,
  resetDashboardPage,
  updateCustomReport,
  updateWidget,
} from "./dashboard.ts";
import {
  createSavedReport,
  updateSavedReport,
  duplicateSavedReport,
  savedReportOf,
  savedReportInfo,
  listSavedReports,
  savedReportUsage,
  deleteSavedReport,
} from "./saved-reports.ts";
import { evaluateFormula } from "./formula.ts";
import { netWorthReport } from "./net-worth.ts";
import { sankeyReport } from "./sankey.ts";
import { spendingReport, spendingTransactions } from "./spending.ts";
import { summaryReport } from "./summary.ts";
import { createTag, deleteTags, discoverTags, listTags, updateTag } from "./tags.ts";

const defined = <T extends object>(fields: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<T>;

/** Reports, the dashboard, custom reports and tags. */
export const reportHandlers = {
  list_saved_reports: (book) => listSavedReports(book),
  get_saved_report: (book, input) => savedReportInfo(book, input.id),
  create_saved_report: (book, input) => createSavedReport(book, input),
  update_saved_report: (book, input) => updateSavedReport(book, input),
  duplicate_saved_report: (book, input) => duplicateSavedReport(book, input),
  get_saved_report_usage: (book, input) => savedReportUsage(book, input.id),
  delete_saved_report: (book, input) => deleteSavedReport(book, input),
  duplicate_dashboard_page: (book, input) => duplicateDashboardPage(book, input.id, input.name),
  reorder_dashboard_pages: (book, input) => reorderDashboardPages(book, input.ids),
  set_default_dashboard: (book, input) => setDefaultDashboard(book, input.id),
  repair_widget: (book, input) => repairWidget(book, input),
  net_worth_report: (book, input) => netWorthReport(book, input),
  cash_flow_report: (book, input) => cashFlowReport(book, input),
  spending_report: (book, input) => spendingReport(book, input),
  spending_transactions: (book, input) => spendingTransactions(book, input),
  summary_report: (book, input) => summaryReport(book, input),
  calendar_report: (book, input) => calendarReport(book, input),
  run_custom_report: (book, { id, scope, ...fields }) => {
    const base: Definition =
      id === undefined
        ? DEFAULT_DEFINITION()
        : (({ id: _id, name: _name, ...definition }) => definition)(customReportOf(book, id));
    const saved = id === undefined ? undefined : savedReportOf(book, id).definition.scope.accounts;
    return runCustomReport(book, { ...base, ...defined(fields) }, scope ?? saved);
  },
  crossover_report: (book, input) => crossoverReport(book, input),
  budget_analysis_report: (book, input) => budgetAnalysisReport(book, input),
  sankey_report: (book, input) => sankeyReport(book, input),
  age_of_money_report: (book, input) => ageOfMoneyReport(book, input),
  evaluate_formula: (book, input) => evaluateFormula(book, input),

  list_custom_reports: (book) => listCustomReports(book),
  create_custom_report: (book, input) => createCustomReport(book, input),
  update_custom_report: (book, input) => updateCustomReport(book, input),
  delete_custom_report: (book, input) =>
    deleteCustomReport(book, input.id, input.expectedPlacementIds),

  list_dashboard_pages: (book) => listDashboardPages(book),
  create_dashboard_page: (book, input) => createDashboardPage(book, input.name),
  rename_dashboard_page: (book, input) => renameDashboardPage(book, input.id, input.name),
  delete_dashboard_page: (book, input) => deleteDashboardPage(book, input.id),
  reset_dashboard_page: (book, input) => resetDashboardPage(book, input.id),
  add_widget: (book, input) => addWidget(book, input),
  update_widget: (book, input) => updateWidget(book, input),
  update_widgets: (book, input) => updateWidgets(book, input.widgets),
  remove_widget: (book, input) => removeWidget(book, input.id),
  copy_widget: (book, input) => copyWidget(book, input.id, input.pageId),
  list_page_widgets: (book, input) => pageWidgets(book, input.host),
  add_page_widget: (book, input) => addPageWidget(book, input),
  move_page_widget: (book, input) => movePageWidget(book, input.id, input.index),

  list_tags: (book) => listTags(book),
  discover_tags: (book) => discoverTags(book),
  create_tag: (book, input) => createTag(book, input),
  update_tag: (book, input) => updateTag(book, input),
  delete_tags: (book, input) => deleteTags(book, input.ids),
} satisfies DomainHandlers<typeof reports>;

# Reports

Home holds two tabs: Dashboards (named arrangements of widgets) and Reports (the report library
and every report). A saved report is a named definition; a widget is a placement that shows one.
Report figures drill down to their exact transactions, and reports can follow an account scope.

## Home has two tabs, and a report keeps them

Home's tabs are Dashboards (`/`, `/?dashboard=<id>`) and Reports (`/reports` and every
`/reports/<type>` under it). Budget and Accounts are peers of Home; Reports is not a destination
of its own. Individual reports keep the tabs: there is no back arrow or breadcrumb, the history
buttons go back.

- `/` is always the book's default dashboard, and `/?dashboard=<id>` any other, so a history entry
  keeps the dashboard it showed. An unknown id shows the default under an info alert.
- Home, `h` and the Dashboards tab carry the last dashboard shown in the address. The Reports tab,
  `r` and the launcher's Reports entry return to the last report address, filters included. Tabs
  that return this way say `resumes` in `lib/nav.ts`; `lib/home-session.ts` remembers the place
  per window and book, in memory, so a launch or reload starts on the default dashboard. It never
  becomes a persisted preference.
- A report page goes through `ReportShell`, which is `Page` with the report's controls and the
  report selector. A page under Reports that is not a `ReportShell` passes `ReportSelector` as its
  `context`.
- The bar's `context` slot holds the dashboard menu or the searchable report selector: All
  reports, saved reports by name with their type, then the built-in reports in the library's
  groups. Picking one opens its own address with no carried filters.
- Built-in reports rename through a Rename action, since their name shows in the selector.
- A book with no accounts shows its default dashboard under a "Start with an account" alert.
- Keep old addresses working: `/reports/library` redirects to `/reports`, `/reports?dashboard=`
  to that dashboard, and custom-report links still open. A direct link opens its report with
  nothing to go back to.

Enforced by: `apps/web/src/lib/page-routes.test.ts` (`ReportShell` or `ReportSelector` on every
page under Reports), `apps/web/src/lib/nav.test.ts`, `packages/e2e/test/home-navigation.e2e.ts`,
`packages/e2e/test/dashboards.e2e.ts`

## A dashboard places saved reports, it does not copy them

A dashboard is a named arrangement of widget placements. A placement owns its layout, its
presentation (title, font size, set in Widget settings) and an optional fixed account scope. It
never holds a second, hidden report definition. Summary and work-list widgets (account balances,
coming up, latest transactions) have local settings without being reports.

- Saved reports are linked: editing one updates every placement of it. The report page edits only
  the definition. Duplicate report makes an independent definition and copies no placements.
  Widget settings and Edit saved report are separate actions.
- Before deleting a saved report in use, disclose its usage (`get_saved_report_usage`). Deleting
  it removes the definition and its placements in one undo step. Removing a widget never deletes
  its saved report.
- Each completed layout change saves, with undo. A phone arranges widgets with move controls, not
  drag.
- Each book has a default dashboard. A new book starts with Today alone, an ordinary editable
  dashboard. A renamed or deleted Today is not recreated.
- `list_dashboard_pages` and the other list operations are pure reads. Initialization (Today, the
  default, converting old widget rows) runs once in one transaction behind the
  `homeInitializedVersion` setting, and clears the undo log when it converts old rows.
- Opaque legacy widget configuration stays stored but is never a writable input. New structured
  inputs reject unknown nested fields.

Departure from Actual: Actual's widgets carry their own filters. reeve's report widgets link a
saved report, so one edit reaches every dashboard showing it.

Enforced by: `packages/engine/test/dashboard-persistence.test.ts`,
`packages/e2e/test/dashboards.e2e.ts`, `packages/e2e/test/dashboard-widgets.e2e.ts`,
`packages/e2e/test/dashboard-persistence.e2e.ts`

## Exploration lives in the address and never writes

A report page's settings live in its address as `explore`, the whole settings object, present only
while they differ from the saved report's (or the built-in defaults when no saved report is
shown). Back, Forward and a reload show exactly what that entry showed, and nothing is written to
the book. The address already names the report (`report=`, or `id=` on the custom report) and the
type (the path), so `explore` holds only settings and has no version number.

- Build a report page on `useReportState` and `useSavedReport`
  (`components/reports/report-state.ts`); a new report page needs nothing more.
- A control change replaces the history entry, so Back leaves the report rather than undoing a
  filter. Opening a report from a widget, the selector or the tabs pushes.
- `explore` must be an object; anything else is dropped, and the operations reject settings they
  do not know. It has no size limit.
- Only the Save menu writes. Save report writes the settings over the saved report and, when
  widgets show it, first names them and offers Save as new report instead. Save as new report
  makes an independent report with the shown settings and scope and replaces the address with it.
  Revert to saved and Reset to defaults drop `explore`.
- A `report=` or custom `id=` the book does not hold shows the type's defaults (with any
  `explore`) under an info alert, offering only Save as new report. A 404 is not retried.

Enforced by: `packages/e2e/test/exploration-history.e2e.ts`

## Scroll follows history

`useScrollMemory` (`lib/scroll-memory.ts`) records the scroller's position per history entry, in
memory for the window. Back, Forward and Go restore it once the router renders, retrying each
frame for up to 4 s while queries fill the page, and stop as soon as the person scrolls. A push or
replace to a new place starts at the top. Another dashboard is a new place; the account pages stay
one place. Positions do not survive a reload, and a book switch reloads, so nothing crosses books.

Enforced by: `packages/e2e/test/exploration-history.e2e.ts`

## A figure opens exactly the transactions behind it

A drill-down is an engine operation beside its report, built from the report's own line query, so
its list always reconciles to the figure. Each row carries `counted` (what it adds to the figure)
and `total` is their sum; the browser renders it with `FigureRecordsPane`
(`components/figure-records.tsx`) in the frame's pane, never the register.

- A report without such an operation shows no record action. To add one, write its records
  operation returning `FigureRecords` and a button on the figure that opens `FigureRecordsPane`.
- `spending_transactions`: one category's figure in one month under the report's filters. A split
  counts only its lines in the category; a transfer from a budget account to an off-budget one
  counts when it names the category; off-budget activity and opening balances do not count. On
  Spending, a non-zero compare or compare-to cell opens it. The average and budgeted columns, the
  headline figures, the chart and the Spending widget have no record action.
- `budget_transactions`: a category (with its subcategories) or a group, reading the postings
  `get_budget`'s activity sums. The budget's spent and received cells and a group's total open it;
  a parent's cell lists its own and every subcategory's transactions. Each transaction shows once,
  from its budget account's side. The phone's category sheet links to the register instead, since
  the pane would open over a sheet.
- A row opens its transaction's editor in the same pane, with a way back to the list. The pane is
  not in history, so Back from the report closes it and keeps the exploration.
- Offer "Open in register" only when the register lists the same set: always from the budget, and
  from a report only when it has no filters. The register shows the transactions' own amounts, not
  the counted parts.
- An edit in the pane refetches the book's queries; the report keeps its data while it refetches.

Departure from Actual: Actual's custom report sends a click to the account register with filters,
which cannot express rule conditions or count only a split's lines in the category. reeve lists
the exact counted rows instead.

Enforced by: `packages/e2e/test/report-drill-down.e2e.ts`,
`packages/engine/test/budget-transactions.test.ts`, `packages/engine/test/report-scope.test.ts`

## A report can follow an account scope

`net_worth_report`, `cash_flow_report`, `spending_report`, `spending_transactions`,
`summary_report`, `calendar_report`, `run_custom_report`, `balance_forecast_report` and
`age_of_money_report` take `scope`, an `AccountScope` (`all`, `budgeted`, `offbudget` or
`selected` ids). The engine ANDs it outside the conditions (`reportFilters` in
`engine/src/reports/lines.ts`), so an `or` group cannot reach accounts outside it.

- A report keeps its own account rules inside the scope and never widens them. Cash flow and
  spending cover budget accounts, so an off-budget scope shows nothing. Net worth and the balance
  forecast intersect their accounts with the scope; a scoped forecast leaves out schedules without
  an account. Age of money counts a transfer crossing the scope's edge as it counts one crossing an
  account condition. Spending's budgeted figures stay book-wide.
- Selected ids that no longer exist match nothing: a scope whose accounts are all gone shows empty
  figures, never every account. Reports are reads, so they do not reject unknown ids.
- Budget-wide and plan-wide reports never follow a scope: budget analysis, Sankey, crossover,
  formula, Monte Carlo, a custom report with `balanceType: "Budgeted"`, and a tracking budget's
  forecast. `SCOPED_REPORTS` and `followsScope` in `contract/src/rules.ts` name them for the engine
  and the browser. Asking one of them to follow a scope is an `InvalidRequest`; a placement whose
  saved report stops following a scope turns `unsupported` rather than show unscoped figures.
- `run_custom_report` with `id` uses the saved report's scope unless the input gives one.
- A widget's scope is `effectiveScope`: what the full report explores, else the placement's fixed
  scope, else the host page's scope, else the saved report's, else all accounts. A page's scope
  replaces the saved report's rather than intersecting it.
- Local widgets take no fixed scope, since they would not apply it; `validateConfig` refuses one.
- A placement with a fixed scope names it after its title ("Off-budget accounts · Fixed").
- A widget whose effective scope differs from its saved report's opens the report with `scope=` in
  the address (not `accounts=`, the register's account filter, since the router types every search
  together). The page says so in an info alert with Use saved accounts. Save report writes only
  settings, so it never changes the saved report's scope; Save as new report keeps the scope shown.

Enforced by: `packages/engine/test/report-scope.test.ts`,
`packages/contract/test/report-scope.test.ts`, `packages/e2e/test/report-scope.e2e.ts`

## Transactions and Payees can hold a short stack of widgets

The engine keeps one optional widget stack per page and book, shared by every account:
`list_page_widgets`, `add_page_widget` and `move_page_widget` take a host, `transactions` or
`payees`. Another host is an `InvalidRequest` from the input schema; adding page widgets to Rules
or Schedules needs a product decision first.

- A host is a `dashboard_pages` row with `host` set, created by the first add. Listing an absent
  host returns an empty stack and writes nothing. Dashboard operations refuse host rows.
- A host holds at most three (`PAGE_WIDGET_LIMIT`) report widgets of types that follow a scope.
  Each is a full-width row (`x = 0`, `width = 12`, `height = 1`) whose `y` is its position,
  renumbered `0..n-1` after every add, move and remove.
- `update_widget` changes a page widget's title, presentation and fixed scope and refuses layout;
  `update_widgets` refuses page widgets; `remove_widget` removes one. Deleting the saved report
  removes it with the other placements, and the usage list names the page.
- Its widgets follow the page's account scope through `WidgetHostContext`. Whether the stack is
  expanded is per device, never book data.
- The web app does not render this stack yet; Transactions and Payees show records only. Keep
  balance, clearing and reconciliation facts there as operational content, not widgets.

Enforced by: `packages/engine/test/report-scope.test.ts` (page widgets)

## The account scope chooses what is shown, not what an edit changes

Editing a payee or rule from a scoped page changes it book-wide. Editors say so, and keep a
preview's scope apart from the rule's own account conditions.

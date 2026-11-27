---
id: REE-92
title: 05. Convert current Home panels into selectable widgets
status: done
priority: medium
tags:
  - ui
  - reports
created: 2026-11-07T09:42:56.446Z
order: a5
blocked_by: [REE-91]
---

## Outcome and scope

Extract month status, category pace, account balances, spending comparison, upcoming schedules, and recent transactions into independently selectable widgets. Split composite panels only when justified by useful configuration.
Reuse lib/home.ts and shared report queries. Keep budget arithmetic and money formatting consistent with current operations.
Preserve meaningful links to Budget, scoped Transactions, Schedules, and full reports. Define minimum sizes and empty states. Keep start-with-an-account onboarding and all query-failure states reachable.
Add widget-level configuration only where it has a clear use. Do not move card-specific data into a monolithic Home request.

## Integration

routes/index.tsx, components/home, lib/home.ts, components/reports and widget contracts. REE-81 remains the owner of its original failure regression and is verified against the converted widgets.

## Acceptance criteria

Every current Home section can be added and removed independently. The new default can reproduce current useful information without a hidden second Home implementation. Non-report widgets do not require report-shaped data. Frozen Purchases remains unavailable.

## Verification

Scratch-book tests cover no accounts, no activity, uncategorized work, future schedules, and independent query failures. Reconcile financial figures against operation results rather than screenshot text alone.

## Epic and dependencies

Read REE-87 for the agreed scope and exclusions. Blocked by REE-91.

## Delivery rules

Each implementation slice must land in a working, verified state. Update decisions and relevant docs with the behavior they describe. Reinspect the current checkout, use scratch REEVE_HOME for verification, and preserve unrelated work. Implementation is now authorized. The parent orchestrator owns docs and decisions; task agents implement one scoped unit on master, verify it, update Octodo, and commit only task-owned changes. No nested agents or competing design exploration.

## Handoff from REE-91

Each Home panel becomes one entry's `Body` (and `add`, `target`) in `apps/web/src/components/reports/widgets.ts`; `home-insight`, `category-pace`, `account-balances` and `upcoming-transactions` are already registered without a body, so they render as "cannot be shown yet". `recent-transactions` is done: `RecentTransactionsBody` renders both the dashboard widget and Home's Latest transactions card. Wrap each panel's query in `WidgetQuery` (`card-body.tsx`) to get loading, failure with Retry, empty and failed-refresh states, which covers REE-81 for that panel.

## Implementation and verification

`components/home/widgets.tsx` holds the four local widget bodies: `MonthStatusBody` (`home-insight`: the month's sentence with To budget and Uncategorized chips), `CategoryPaceBody` (`category-pace`), `AccountBalancesBody` (`account-balances`: net worth and each account) and `UpcomingTransactionsBody` (`upcoming-transactions`). Each reads its own query through `WidgetQuery`; month status and category pace share the `get_budget` query by key, so nothing goes through a combined Home request. The registry gives each a body, an add-menu entry, a minimum size and a target (Budget, All transactions, Schedules). The add menu groups widgets into Your money, Reports and Other.

Home places the same bodies in its fixed layout, so there is one implementation per panel. Home's composite Money card is split: accounts become `account-balances`, and the spending comparison is the spending report's own body (`SpendingBody`, single month), which Today already places as `spending-card`. The bespoke `PaceChart` is deleted. Visible change: Home's spending card now headlines "Spent N more/less than <last month>" instead of "Spent this month N, M of it uncategorized"; the uncategorized count stays as the month status chip.

Widget configuration: only Coming up's Days ahead (registry `fields`, edited in Widget settings). `WidgetQuery` gained `hasLinks` so content with its own row links is not wrapped in the target link.

Bugs fixed on the way:

- `WidgetConfig` was `Union([Report, Local])`; a local config also matches the report member, so HTTP decoding and encoding stripped `settings` from every local widget. Swapped the order; `packages/contract/test/widget-config.test.ts` fails without the fix.
- Coming up asked `list_scheduled_transactions` with the default 7-day upcoming length and filtered to 31 days, so schedules 8 to 31 days out were missing. It now passes `upcomingLength: "<days>-day"`.

Verification: new `packages/e2e/test/home.e2e.ts` (8 tests): no accounts onboarding then the month; figures reconciled against `get_budget` and `list_accounts` (To budget 2,200.00, Uncategorized 1, net worth 3,445.00 = 2,500 - 45 - 10 + 1,000) at 1440 and 390 in light and dark with no sideways scroll; a near schedule shown and a 60-day one hidden; budget and schedule queries failing independently while the others render, with Retry recovering; Today rendering all Home widgets, Days ahead 90 saved and showing the far schedule; adding the four from the add menu and removing one. `dashboard-widgets.e2e.ts` unsupported case now uses a scoped saved report. Unit 2,023 pass; lint, typecheck, format, React Doctor pass. Full browser run: 158 pass, 3 fail: account-scope.e2e.ts and apps.e2e.ts fail identically on a clean checkout (REE-106); hot-reload passed in isolation. Screenshots reviewed at 1440 and 390 in both themes.

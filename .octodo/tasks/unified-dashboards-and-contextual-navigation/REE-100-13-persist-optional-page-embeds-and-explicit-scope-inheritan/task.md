---
id: REE-100
title: 13. Persist optional page embeds and explicit scope inheritance
status: done
priority: medium
tags:
  - engine
  - contract
  - reports
created: 2026-11-07T09:42:58.258Z
order: aD
blocked_by: [REE-89, REE-90, REE-97]
---

## Outcome and scope

Extend approved placement persistence for optional widgets on Transactions and Payees. Use a constrained host identity rather than fake dashboard pages.
Choose host ownership per the design gate: page-wide, per scope, or other explicit policy. Define account/date scope inheritance and visible fixed overrides. Unsupported widget/host combinations fail predictably.
Preserve saved-report linkage semantics, book isolation, reset/remove behavior, and undo. Opening a full report from an embed passes its effective scope and does not accidentally edit the parent saved report.

## Integration

dashboard/report placement contracts, engine handlers and migrations, browser-safe scope resolution. Reuse existing operation catalog generation rules. Depend on the shared model, not a second embedded-widget schema.

## Acceptance criteria

A placement belongs to a valid host and survives reload. Inherited scope follows page changes. Fixed scope is distinguishable. Delete/undo/restore behavior is defined. Rules and Schedules reject or omit general embeds in this release.

## Verification

Operation tests cover supported hosts, invalid references, inherited/fixed scopes, saved report deletion, repeated writes, undo/redo, and book isolation. Pure scope-resolution tests cover combined date/account filters.

## Epic and dependencies

Read REE-87 for the agreed scope and exclusions. Blocked by REE-89, REE-90, REE-97.

## Delivery rules

Each implementation slice must land in a working, verified state. Update decisions and relevant docs with the behavior they describe. Reinspect the current checkout, use scratch REEVE_HOME for verification, and preserve unrelated work. Implementation is now authorized. The parent orchestrator owns docs and decisions; task agents implement one scoped unit on master, verify it, update Octodo, and commit only task-owned changes. No nested agents or competing design exploration.

## Accepted interaction requirements

Alignment rounds 1 and 2 confirm one optional arrangement per operational page per book, not per account. Account scope is inherited by default and fixed overrides are visible. Expanded/collapsed state is device-local and must remain separate from book-owned widget placement data.

## Handoff from REE-91

The shared widget renderer (`components/reports/widgets.ts`, `widget-card.tsx`, `card-body.tsx`) does not yet execute scope. `toWidget` in `engine/src/reports/dashboard.ts` still marks non-all saved scopes and fixed placement scopes `unsupported`, and the cards show them as unavailable rather than as unscoped figures. Scoped execution belongs here: the report operations need an account scope applied as an AND outside condition groups, the card passes the effective scope into its report input, and then that guard comes out.

## Implementation and verification

[reports rules](../../../../docs/rules/reports.md) records the behavior. Host ownership is page-wide per book, as rounds 1 and 2 settled: one `dashboard_pages` row with `host`, created by the first `add_page_widget`, never by a read.

- Nine report operations take `scope` (`AccountScope`), ANDed outside the conditions by `reportFilters` in `engine/src/reports/lines.ts`. Net worth and the balance forecast intersect their chosen accounts; age of money counts transfers across the scope's edge like account conditions; a tracking forecast and a budgeted custom report refuse a non-all scope. Selected ids that are gone match nothing.
- `SCOPED_REPORTS`, `followsScope`, `effectiveScope`, `pageScope` and `sameScope` in `contract/src/rules.ts` are browser-safe. The `unsupported` guard in `toWidget` is gone; it now marks only placements whose report stopped following a scope.
- `list_page_widgets`, `add_page_widget`, `move_page_widget` on `transactions | payees`. At most three report widgets that follow a scope, full-width rows with contiguous `y`. `update_widget` takes config but not layout on a page widget, `update_widgets` refuses them, `remove_widget` re-stacks, saved report deletion removes them in one undo step.
- Web: cards run with their effective scope, a fixed placement shows "<scope> · Fixed", and Open report carries `scope=` (not `accounts=`, which the register uses) when it differs from the saved report's. Report pages run with it under an info alert offering "Use saved accounts". Save report writes settings only; Save as new report keeps the scope shown.

Verification: `npx vitest run packages/engine` 1,670 tests pass, including `test/report-scope.test.ts` (12 cases: or-group narrowing with a hand-reconciled February book, every scoped report, spending figure versus drill-down, gone accounts, age-of-money/forecast equivalence with account conditions, saved custom scope, absent host reads with no undo step, hosts per book and isolation, eligibility and the limit, move/undo/redo and no-op moves, remove, report deletion and undo, budgeted turn to unsupported, dashboard fixed-scope rules). `packages/contract/test/report-scope.test.ts` covers precedence and page scope. `pnpm test` 2,063 pass. E2E: `report-scope.e2e.ts` (desktop and 390px) and the dashboards, widgets, exploration, drill-down, projections, home navigation and age-of-money suites pass (42 tests); screenshots checked at 1440 and 390, light and dark. Format, lint, React Doctor and typecheck pass for task-owned files; the remaining failures are in another session's untracked `attention.e2e.ts`.

## Handoff to REE-101

Provide the page's scope with `WidgetHostContext` (`components/reports/widget-state.ts`) as `pageScope(useAccountScope())`, list with `list_page_widgets`, and render each with `WidgetCard`. Widgets offered there must satisfy `followsScope`. The device-local collapse belongs to REE-101; nothing is stored for it.

---
id: REE-97
title: 10. Connect report drill-down to contextual transaction inspection
status: done
priority: medium
tags:
  - ui
  - reports
created: 2026-11-07T09:42:57.548Z
order: aA
blocked_by: [REE-91, REE-95, REE-96]
---

## Outcome and scope

Implement the reference flow: dashboard widget -> full report -> contributing transaction list in the pane -> full register for bulk work.
Carry the effective date/account/category filters, including report-specific rules for transfers, opening balances, splits, and off-budget activity. Do not imply that every financial report is a simple spending filter.
Start with Spending and document each supported drill-down capability. Reports that cannot produce an exact record set must not show a misleading generic action.
Selecting a transaction replaces the contextual pane content with an explicit return path to its record list, or opens the full register according to the approved design. Never stack panes.

## Integration

report components, reportPath/widget-state, contract report output where exact record provenance requires it, register URL/filter helpers, SplitPanel. Keep ledger reads through operations.

## Acceptance criteria

The underlying-record view explains which report figure it supports and uses the same effective scope. Full-register handoff preserves filters. Returning does not lose report exploration. Editing a record invalidates affected report/widget queries without blanking unrelated content.

## Verification

Seed scratch books with split transactions, transfers, opening balances, off-budget activity, and multiple accounts. Reconcile drill-down to the specific report definition. E2E proves the complete reference workflow and query invalidation.

## Epic and dependencies

Read REE-87 for the agreed scope and exclusions. Blocked by REE-91, REE-95, REE-96.

## Delivery rules

Each implementation slice must land in a working, verified state. Update decisions and relevant docs with the behavior they describe. Reinspect the current checkout, use scratch REEVE_HOME for verification, and preserve unrelated work. Implementation is now authorized. The parent orchestrator owns docs and decisions; task agents implement one scoped unit on master, verify it, update Octodo, and commit only task-owned changes. No nested agents or competing design exploration.

## Accepted interaction requirements

Alignment round 2 confirms widget title/Open report opens the full report with effective filters and activates Reports. Supported chart-segment actions open contributing records in the contextual pane. Back from the full report restores its originating dashboard and scroll. Do not add misleading record actions to reports without exact supported provenance.

## Implementation notes (2026-11-08)

- `spending_transactions` (contract `catalog/reports.ts`, engine `reports/spending.ts`) returns the register rows behind one category's Spending figure in one month, under the report's conditions, from the report's own line query. Each row has `counted`; `total` sums them and equals the figure. A split counts only its lines in the category; a budget-to-off-budget transfer that names the category counts; off-budget activity and opening balances do not.
- Spending's compare and compare-to cells are buttons that open the pane ("Food · November 2026") with an explanation of what the figure covers and the rows. A row opens its transaction's editor in the same pane, with "Back to transactions" through the pane guard. "Open in register" goes to `/accounts/budgeted?categories=[id]&month=` and shows only when the report has no conditions, since only then is it the same set.
- No record action on the average, budgeted, headline figures, the cumulative chart or the Spending widget: none names one exact record set. [reports rules](../../../../docs/rules/reports.md) records this and how the next report adds one.
- Saving in the pane invalidates book queries; the report keeps its previous data while refetching.

## Verification notes

- Engine: `packages/engine/test/reports.test.ts` "lists the transactions behind a category's figure" seeds splits, a categorized transfer to an off-budget account, off-budget spending, an opening balance, a second budget account, a prior-month line and an account filter. The figure is reconciled by hand: -4200 - 5500 - 1800 + 700 - 20000 = -30800.
- E2E: `packages/e2e/test/report-drill-down.e2e.ts` walks Today widget -> report -> pane list (3 rows, -115.00, split shown as "of -100.00 split") -> editor -> back -> edit payment -> cell becomes -123.00 with the report still on its URL -> Open in register (month kept) -> Back to the report with the pane closed. A second test proves a filtered report hides the register handoff.
- Screenshots at 1440x900 and 390x844 in light and dark, list and editor; no sideways scroll at 390.
- `pnpm check:push` passed (2043 tests). Full `pnpm test:e2e`: 201 passed, 1 failed, the known REE-109 account-scope failure.

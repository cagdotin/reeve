---
id: REE-102
title: 15. Keep page attention messages distinct from controls and widget feedback
status: done
priority: medium
tags:
  - ui
  - accessibility
created: 2026-11-07T09:42:58.724Z
order: aF
blocked_by: [REE-88, REE-91]
---

## Outcome and scope

Audit PageAlert use after the layout changes. Keep page-wide problems and resolution actions in the attention area. Keep filters, ordinary add actions, and selection toolbars out.
Use error for failures/urgent problems, warning for unresolved review, informational styling for optional next steps, and success for completed/healthy states. Do not make an unresolved issue green merely because it has a quick action.
Define multiple-message prioritization and expansion if supported by the design gate. Do not hide urgent errors behind a summary. Keep widget failures local and pane/form validation within their task.
Deduplicate global connection failures and page refresh errors where they describe the same problem.

## Integration

page-alert.tsx, app-frame alert slot, sync-indicator, QueryBody, shared widgets, task panes. Coordinate REE-81 so false empty states do not survive conversion.

## Acceptance criteria

Every message has a clear scope, severity, and action target. Loading is not empty, and failures are not success. Attention strips do not become toolbars. Multiple issues do not silently suppress errors or unexpectedly reset dismissal state.

## Verification

Browser tests cover simultaneous messages, live-region behavior, retry with kept data, connection loss, local widget failure, pane validation, and Day/Night contrast.

## Epic and dependencies

Read REE-87 for the agreed scope and exclusions. Blocked by REE-88, REE-91.

## Delivery rules

Each implementation slice must land in a working, verified state. Update decisions and relevant docs with the behavior they describe. Reinspect the current checkout, use scratch REEVE_HOME for verification, and preserve unrelated work. Implementation is now authorized. The parent orchestrator owns docs and decisions; task agents implement one scoped unit on master, verify it, update Octodo, and commit only task-owned changes. No nested agents or competing design exploration.

## Delivered (d1b96da)

Audit: every `PageAlert` already had a clear scope and a severity that matches its state. Failures are errors. Unresolved checks are warnings. Optional next steps ("worth a rule", unscheduled repeats, start with an account, a widget's account scope) are info. Nothing unresolved is green, and `success` is unused. Filters, add actions and selection toolbars are not in strips. Widget failures stay in the card (`WidgetQuery`), and pane feedback stays in the pane's own slot. Changes ([panes and alerts rules](../../../../docs/rules/panes-and-alerts.md)):

- Only an error is `role="alert"`. Warning, info and success are `role="status"`.
- Strips stack in this order: error, warning, info, success. There is no summary and no dismissal, so no error is hidden and no dismissal state can be lost.
- `QueryBody` shows no "could not be refreshed" strip for a network failure while the connection is reconnecting or offline. The connection's strip says it.
- A description no longer uses `opacity-80`, which held Day's error and info descriptions at 4.0 and 4.2:1.

Verification: `attention.e2e.ts` covers simultaneous messages, live regions, retry with kept data, connection loss (it fails with the fix removed) and Day/Night contrast. Local widget failure is covered by `home.e2e.ts` and `dashboard-widgets.e2e.ts`. Pane validation is covered by `pane.e2e.ts`. Full e2e: 213 passed. The account-scope Transactions anchoring test fails with or without this change (already REE-109). hot-reload flaked once and passed when rerun.

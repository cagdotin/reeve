---
id: REE-101
title: 14. Add constrained report widgets to Transactions and Payees
status: backlog
priority: medium
tags:
  - ui
  - reports
created: 2026-11-07T09:42:58.499Z
order: aE
blocked_by: [REE-100, REE-99, REE-91, REE-95]
---

## Outcome and scope

Let people optionally add, configure, remove, and order eligible widgets in a constrained page region. Default to no embeds so records stay primary.
Reuse shared widget rendering and saved reports. Do not expose a full dashboard grid editor on operational pages.
Inherited widgets update with the page's scope. Fixed overrides display the actual account/date scope. Preserve the page's filters, scroll, selection, and editor state according to the established lifecycle.
Use responsive limits and collapse behavior so embeds cannot make the table unusable or cause sideways page scroll.

## Integration

Transactions and Payees routes, shared widget host, scope helpers, saved report picker, placement operations. Do not add embeds to Rules or Schedules without a separate product decision.

## Acceptance criteria

The same saved report can appear on a dashboard and operational page without duplicated query math. Users can return to a clean records-only page. Effective scope is visible and accurate. The full-report action preserves that scope.

## Verification

E2E covers add/remove/configure/reorder, reload, book switch, inherited scope updates, visible fixed overrides, deleted saved reports, local query errors, narrow widths, and keyboard controls.

## Epic and dependencies

Read REE-87 for the agreed scope and exclusions. Blocked by REE-100, REE-99, REE-91, REE-95.

## Delivery rules

Each implementation slice must land in a working, verified state. Update decisions and relevant docs with the behavior they describe. Reinspect the current checkout, use scratch REEVE_HOME for verification, and preserve unrelated work. Implementation is now authorized. The parent orchestrator owns docs and decisions; task agents implement one scoped unit on master, verify it, update Octodo, and commit only task-owned changes. No nested agents or competing design exploration.

## Accepted interaction requirements

Alignment round 2 chooses a compact collapsible widget region above records and below page scope controls, not a separate Insights workspace. Default to no widgets. Collapse preserves placements and is remembered per device. Do not use a free-position dashboard grid. Keep the contextual right pane available for inspection/editing.

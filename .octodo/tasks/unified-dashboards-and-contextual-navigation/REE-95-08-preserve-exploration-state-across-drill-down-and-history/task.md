---
id: REE-95
title: 08. Preserve exploration state across drill-down and history
status: done
priority: medium
tags:
  - ui
  - navigation
created: 2026-11-07T09:42:57.095Z
order: a8
blocked_by: [REE-94, REE-89]
---

## Outcome and scope

Define and implement URL state and restoration for dashboard ID, report identity, exploration filters, account/date scope, widget origin, selection where appropriate, and scroll.
Use push versus replace deliberately. Avoid a history entry per keystroke. History Back restores the originating dashboard or library and its prior state. Forward restores the explored report.
Keep temporary report exploration separate from saved-definition edits. Add explicit save/update and save-as behavior from the approved model. Handle missing/deleted origin records, direct links, reload, and cross-book IDs safely.

## Integration

TanStack Router search schemas, report widget state, account-scope helpers, app-frame scroll reset, browser query keys. Do not store transient form drafts or JSX in global navigation state.

## Acceptance criteria

Today -> report -> Back returns to the same dashboard, filters, and position. Forward restores the report. Direct links load a valid view without invented Back history. Temporary filters do not silently edit a saved report. No stale-book selection or query data leaks.

## Verification

E2E covers Back/Forward, reload, direct links, selector changes, removed dashboard/widget/report, failed refresh, and book switching. Include phone platform/browser Back behavior.

## Epic and dependencies

Read REE-87 for the agreed scope and exclusions. Blocked by REE-94, REE-89.

## Delivery rules

Each implementation slice must land in a working, verified state. Update decisions and relevant docs with the behavior they describe. Reinspect the current checkout, use scratch REEVE_HOME for verification, and preserve unrelated work. Implementation is now authorized. The parent orchestrator owns docs and decisions; task agents implement one scoped unit on master, verify it, update Octodo, and commit only task-owned changes. No nested agents or competing design exploration.

## Accepted interaction requirements

Alignment round 2 confirms full-report links carry the originating widget's effective filters and activate Reports. Back restores the dashboard and scroll. Dashboards and Reports remember their own last selected session view. Report-selector changes load the chosen report's own settings; only explicit drill-down links transfer context.

## Implementation and verification

- Report pages keep unsaved settings in the address as `explore` (the whole settings object, name included), only while it differs from the saved report or the built-in defaults. `useExplore`, `useReportState` and `useSavedReport` in `components/reports/report-state.ts` carry it for all thirteen report pages, the custom builder included. A control change replaces the history entry; widget links, the selector and the tabs push. [reports rules](../../../../docs/rules/reports.md).
- The Save menu (`components/reports/save-report.tsx`): Save report names the widgets that show the report before writing over it, Save as new report creates an independent definition and replaces the address with it, Revert to saved or Reset to defaults drops `explore`. Exploring writes nothing.
- A `report=` or custom `id=` the book does not hold (deleted, or another book's address) shows the type's defaults with any `explore` applied under an info alert, offering only Save as new report. A 404 is not retried.
- `lib/scroll-memory.ts` records the one scroller's position per history entry in window memory. Back, Forward and Go restore it after the router renders, retrying each frame up to 4 s while queries fill the page and yielding to the person's own scrolling. Pushes and replaces to a new place start at the top; another `?dashboard=` is a new place.
- Departures from the REE-89 proposal, recorded in 0056: the snapshot has no version, report id or type (the address already holds them), and links carry no `widget=` until placements gain overrides (REE-100).

Verification: new `exploration-history.e2e.ts` (6 tests): Today to report and Back within 4px of the dashboard's scroll, Forward to the explored report, filter changes adding no history entries, another report from the selector dropping filters and Back restoring them, reload, a failed refresh keeping the filters, Save with its usage confirmation, Save as new report from a built-in, a direct link with Back disabled, deleted saved report and dashboard, another book's address, and phone browser Back and Forward at 390×844. `projections.e2e.ts` confirms the new Save question. Screenshots at 1440 and 390 in light and dark reviewed.

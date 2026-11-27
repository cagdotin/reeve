---
id: REE-93
title: 06. Deliver multiple dashboards and the preconfigured Today dashboard
status: done
priority: medium
tags:
  - ui
  - engine
  - reports
created: 2026-11-07T09:42:56.653Z
order: a6
blocked_by: [REE-92]
---

## Outcome and scope

Extend the existing dashboard page controls and grid to create, rename, select, arrange, resize, configure, copy where approved, and delete dashboards/widgets. Do not rebuild working grid behavior without need.
Seed a useful Today composition for new books. Implement the approved existing-book policy without resetting or renaming user dashboards unexpectedly. Support empty dashboards and last-dashboard deletion rules.
Keep arrangement an explicit edit mode. Provide accessible non-drag ways to arrange widgets, phone reordering, deterministic narrow-screen order, and layout persistence. Define default/last-used selection with book and device boundaries.

## Integration

routes/reports.index.tsx existing PageSwitcher, dashboard-grid.tsx, grid-layout.ts, dashboard operations and defaults. Ready for the navigation merge, but no duplicate permanent dashboard product should remain after integration.

## Acceptance criteria

A person can use the default without customization, create a second dashboard, customize it, reload, and switch books without leakage. Undo and reset follow approved semantics. Reopening a book never silently replaces a layout.

## Verification

Engine fixtures test new and existing books. E2E covers dashboard management, edit mode, persistence, keyboard movement, phone ordering, deleted selection recovery, and reset confirmation.

## Epic and dependencies

Read REE-87 for the agreed scope and exclusions. Blocked by REE-92.

## Delivery rules

Each implementation slice must land in a working, verified state. Update decisions and relevant docs with the behavior they describe. Reinspect the current checkout, use scratch REEVE_HOME for verification, and preserve unrelated work. Implementation is now authorized. The parent orchestrator owns docs and decisions; task agents implement one scoped unit on master, verify it, update Octodo, and commit only task-owned changes. No nested agents or competing design exploration.

## Accepted interaction requirements

Completed dashboard moves and resizes save automatically with undo. Report-definition edits still require explicit Save. This interaction was accepted in alignment round 2.

## Implementation and verification

The engine already had every dashboard operation from REE-90 (default, reorder, duplicate, reset to the Today template, last-dashboard guard, Today seeded once). This task is the dashboard page on top of them.

- Dashboard selector lists dashboards with the default marked; Dashboard actions offers Rename, Duplicate, Open by default, Move earlier and later, Reset to Today's widgets (confirms with the widget count it replaces) and Delete (confirms; disabled on the last dashboard; names the dashboard that opens by default instead).
- Selection: `?page=`, else the dashboard this window last viewed in the book (`lib/home-session.ts`, memory only), else the default. A launch or reload therefore opens the default; a deleted or foreign `?page=` falls back the same way. Book switching reloads the window, so nothing carries over.
- Arranging stays an explicit mode, now on phones too. Each completed drag, resize or arrow-key step is one `update_widgets` (one undo step), and the grid shows it until the refetch arrives. The arrow keys on a card's handle move it and Shift with them resizes it (`nudge`); a polite live region reads the new place. Below 720px the one column is in reading order (row, column, id), and Move up and Move down exchange a card with its neighbour (`swapWithNeighbour`).
- On a phone the action labels collapse to icons so the actions fit one row.

Verification: `grid-layout.test.ts` (11 cases). New `packages/e2e/test/dashboards.e2e.ts` (7 tests): Today alone and default in a new book; create, fill, reload, last-viewed versus launch, default, reorder, duplicate, rename; keyboard move and resize with each step undone alone; phone Move down with focus kept and the persisted order checked through `list_dashboard_pages`; deleting the shown dashboard and a dashboard deleted elsewhere both land on Today; reset confirmation, cancel, reset and one undo; a second book never lists the first book's dashboards. Screenshots at 1440 and 390 in light and dark reviewed.

## Handoff to REE-94

Home (`/`) still renders its fixed layout from the same widget bodies. REE-94 replaces it with this dashboard page at `/?dashboard=` and moves `lib/home-session.ts` into the Dashboards and Reports tabs' session targets.

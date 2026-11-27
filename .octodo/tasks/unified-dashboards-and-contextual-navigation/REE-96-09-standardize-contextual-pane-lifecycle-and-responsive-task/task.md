---
id: REE-96
title: 09. Standardize contextual pane lifecycle and responsive tasks
status: done
priority: medium
tags:
  - ui
  - accessibility
created: 2026-11-07T09:42:57.304Z
order: a9
blocked_by: [REE-88]
---

## Outcome and scope

Harden the existing SplitPanel rather than creating another panel system. Specify one contextual task with title, close, local feedback, scrollable body, and optional fixed footer.
Implement dirty-state protection for close, row change, account-scope change, and workspace navigation. Preserve focus return, keyboard resize, Escape precedence, and accessible naming.
Choose docked versus overlay/full-screen treatment based on usable content width, not desktop identity alone. Keep a single page scroller plus the pane's independent task scroller. Overlay mode must contain focus and prevent background interaction appropriately.
No nested panes or independent main navigation inside the pane.

## Integration

components/split-panel.tsx, app-frame.tsx, useHotkeys, existing dialogs/editors, UI sheet/dialog primitives. Coordinate global keyboard conventions with REE-76 without absorbing that broader task.

## Acceptance criteria

A dirty editor cannot lose work silently through any exit. Overlay tasks have correct focus/background behavior. The docked pane leaves useful main content width. Pane validation and errors stay inside the task, never behind it in the page alert slot.

## Verification

Browser tests cover 390x844, narrow laptop, wide desktop, keyboard-only open/close/resize, focus return, Escape with nested popup, dirty exits, touch resize where available, and Day/Night.

## Epic and dependencies

Read REE-87 for the agreed scope and exclusions. Blocked by REE-88.

## Delivery rules

Each implementation slice must land in a working, verified state. Update decisions and relevant docs with the behavior they describe. Reinspect the current checkout, use scratch REEVE_HOME for verification, and preserve unrelated work. Implementation is now authorized. The parent orchestrator owns docs and decisions; task agents implement one scoped unit on master, verify it, update Octodo, and commit only task-owned changes. No nested agents or competing design exploration.

## Accepted interaction requirements

Alignment round 2 confirms Save and continue, Discard changes, and Keep editing for dirty-form exits, including close, row/scope change, and navigation. Validation failures keep the editor open. Wide windows dock, narrow windows overlay, and phones use full-screen tasks for substantial editors/lists. Closing restores the underlying page and position. Small pickers and confirmations may remain sheets/dialogs. Determine width thresholds from usable content width.

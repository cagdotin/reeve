---
id: REE-88
title: 01. Validate the unified navigation and drill-down design
status: done
priority: high
tags:
  - design
  - ui
created: 2026-11-07T09:42:55.531Z
order: a1
---

## Outcome and scope

Validate the agreed stable Dashboards/Reports tabs and contextual selectors against existing code. Do not explore competing designs or reopen approved choices. Produce a concise implementation handoff in this task's attachments and body.
Walk Today -> Spending widget -> full report -> underlying transactions -> Back. Also walk Rules -> scoped match preview -> edit, and a direct report link with no app history.
Specify header action ownership, dashboard/report selector contents, active tab on widget drill-down, keyboard access, compact widths, and phone behavior. Confirm Home naming without Home/Home or a default Reports dashboard beside a Reports tab.
Choose dashboard default/last-used behavior, what state survives Back, route aliases, report ownership and deletion semantics, unsaved-change behavior, and preference ownership. Record unresolved choices with a recommended default, not silent assumptions.

## Integration

Read [shell rules](../../../../docs/rules/shell.md), [panes and alerts rules](../../../../docs/rules/panes-and-alerts.md) and [purchases rules](../../../../docs/rules/purchases.md) and relevant report decisions. Start from lib/nav.ts, app-frame.tsx, report-shell.tsx, and existing dashboard APIs. Inspect Actual's corresponding dashboard/report behavior before proposing a departure. Report decision/doc requirements to the parent orchestrator, who owns those files.

## Acceptance criteria

Revised 2026-11-07 on the user's instruction to skip alternative-design exploration, mockups and prototypes. The gate is a code-grounded implementation handoff (`implementation-handoff.md`) that:

- maps the approved choices onto concrete routes, URL aliases, header slots, selector contents and session state, with no extra permanent navigation row per layer;
- walks the three named flows (widget drill-down and Back, Rules matches and edit, direct report link) against the current code;
- states the pane's responsive policy, the dirty guard, keyboard access and the dense-layout and phone expectations;
- records every remaining technical choice with a recommended default;
- lists acceptance scenarios for the implementation tasks, which carry the desktop, narrow laptop, 390x844, Day and Night screenshot evidence;
- names the decision and doc updates the parent owns.

## Verification

Read-only review of `lib/nav.ts`, `app-frame.tsx`, `split-panel.tsx`, `section-tabs.tsx`, `reports/report-shell.tsx`, `reports/widget-state.ts`, `widget-card.tsx`, `routes/reports.*`, `routes/index.tsx`, `engine/src/reports/dashboard.ts` and [shell rules](../../../../docs/rules/shell.md) and [panes and alerts rules](../../../../docs/rules/panes-and-alerts.md). No production code changes. No mockups or prototypes, by the user's choice. Visual evidence moves to REE-94, REE-96, REE-101 and REE-103.

## Epic and dependencies

Read REE-87 for the agreed scope and exclusions. This is a ready design task with no implementation prerequisites.

## Delivery rules

Each implementation slice must land in a working, verified state. Update decisions and relevant docs with the behavior they describe. Reinspect the current checkout, use scratch REEVE_HOME for verification, and preserve unrelated work. Implementation is now authorized. The parent orchestrator owns docs and decisions; task agents implement one scoped unit on master, verify it, update Octodo, and commit only task-owned changes. No nested agents or competing design exploration.

## Confirmed product choices: alignment round 1

The user accepted all six recommendations in the alignment discussion. These are settled requirements, not implementation completion.

1. Navigation names: Home is the sidebar destination. Dashboards and Reports are its workspace tabs. A contextual selector chooses the current dashboard or report.
2. Entry behavior: each book has a chosen default dashboard, initially Today. Ordinary app launch opens that default rather than resuming the last page. Clicking Home during a session returns to the last dashboard viewed, not an open report. An explicit report deep link still opens its target.
3. Today is an ordinary, fully editable dashboard. It can be renamed or deleted when another dashboard exists. New books start with Today alone. Existing books receive Today once without changing or removing existing dashboards.
4. Saved reports are linked by default. Editing their definition updates linked placements. Duplicate report creates an independent definition. Moving, resizing, or collapsing a widget changes its placement only. Temporary exploration does not persist until explicitly saved. The UI distinguishes Widget settings from Edit saved report.
5. Deleting an in-use saved report first shows its usage. Confirmation removes the definition and linked placements together as one undoable action. Removing a widget never deletes its saved report.
6. Transactions and Payees each have one optional widget arrangement per book, not a separate arrangement per account. Widgets inherit the page's account scope by default. Any fixed-scope override must be visibly labelled.

Round 2 settles selector/navigation behavior, dirty-form exits, responsive task treatments, and optional widget placement. Exact responsive thresholds, route aliases, and technical persistence details still require design validation. Do not mark REE-88 or REE-89 done from agreement alone.

## Confirmed product choices: alignment round 2

The user accepted all five interaction recommendations. These are requirements for future implementation, not completed behavior.

- Widget title or Open report opens the full report with the widget's effective filters and activates Reports. History Back restores the originating dashboard and scroll position. A supported chart-segment drill-down opens contributing records in the contextual pane.
- The report selector is searchable and includes All reports, saved reports, and built-in report types. Selecting another report loads that report's own settings, without silently carrying unrelated filters. Explicit drill-down links carry relevant context. Dashboards and Reports each remember their last selected view during the session.
- Dirty contextual forms prompt Save and continue, Discard changes, or Keep editing when closing, selecting another record, changing scope, or navigating away. Failed validation stays in the editor. Completed dashboard moves/resizes save automatically and support undo. Report-definition edits require explicit Save.
- Wide windows dock the contextual pane. Narrow windows use an overlay. Phones use a full-screen task for substantial editors and record lists. Closing returns to the same underlying page and position. Small pickers and confirmations can remain sheets or dialogs. Exact width thresholds are determined by prototype evidence.
- Optional widgets on Transactions and Payees occupy a compact collapsible region above records and below page scope controls. No widgets appear by default. There is no free-position grid on operational pages. Collapse does not remove placements and its state is remembered on the device. The right pane remains available for tasks.

Remaining work is validation and technical design: exact responsive thresholds, route aliases, persistence details, and safe history/scroll restoration. The agreed above-record region must be tested with dense records at narrow widths. Do not reopen settled preferences without new evidence or a user request. Implementation is now authorized under the serial orchestration instructions.

## Implementation notes (2026-11-07)

The handoff is in `implementation-handoff.md`, attached to this task. Its key defaults:

- Home gets the tabs Dashboards (`/`, `?dashboard=`) and Reports (`/reports` = All reports, `/reports/<type>`). Both are nested, so report pages lose the back arrow.
- `/reports/library` redirects to `/reports`, and `/reports?page=` redirects to `/?dashboard=`.
- A page-owned `context` slot after the tabs holds the dashboard Select or the searchable report Combobox. The account scope stays in the frame.
- The session store lives in memory per window and book: the last dashboard, the last report href, and scroll by `__TSR_key`. Scroll is restored on a POP only.
- The pane stays out of history and holds a list, then a record. It docks when 640px or more of page would remain beside it, and it is a full-screen task below `md`. The dirty guard uses `useBlocker`.
- Today is seeded once and idempotently, and becomes the default in existing books. A new book gets Today only.

## Verification notes

The current code was read at `bb4bea4` (see the files listed under Verification). Nothing was run. No server, browser, prototype or screenshot was used. The flows, the 640px threshold and the Today seeding are inferred and are labelled so in the handoff. The Actual checkout is not on this machine, so Actual's dashboard behavior was not compared again. The current reeve dashboard already ports Actual's model. The parent must make the decision and doc updates listed in handoff section 9.

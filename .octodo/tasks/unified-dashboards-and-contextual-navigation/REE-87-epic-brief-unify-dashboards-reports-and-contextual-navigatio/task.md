---
id: REE-87
title: "Epic brief: unify dashboards, reports, and contextual navigation"
status: todo
priority: high
tags:
  - epic
  - planning
created: 2026-11-07T09:42:55.296Z
order: a0
---

## Outcome and scope

Deliver one customizable Home area with Dashboards and Reports workspaces. Convert the current Home panels to selectable widgets. Support multiple named dashboards with a useful preselected Today composition. Keep workspace tabs visible on detail pages and use history plus contextual selectors instead of duplicate back buttons or permanent breadcrumbs.
Agreed direction:

- Sidebar Home contains Dashboards and Reports. Budget and Accounts remain peers. Final labels and URL mapping are confirmed by the design gate.
- Distinguish dashboard, widget type, saved report, and widget placement. Non-report widgets are first-class.
- Remove bespoke analytical overviews from operational pages. Retain compact balance, cleared, and reconciliation facts.
- Keep shared Accounts viewing scope, but make global editing consequences explicit.
- One contextual pane, never a second independently navigable workspace.
- PageAlert remains the attention area. Severity describes state, not whether a message has an action.
- Add optional constrained widgets on Transactions and Payees only after the shared system works.
  Boundaries: no accounting arithmetic redesign, Purchases reactivation, Steward implementation, arbitrary plugins, nested panes, report import/export, or expanded report-chart features. Preserve frozen purchase data.
  Round 1 product choices are confirmed below. Remaining decisions concern detailed interactions, exact mobile task treatment, route aliases, and device-local preference ownership. Resolve them before dependent implementation.
  Delivery: foundation -> working unified Home -> contextual drill-down -> operational simplification -> optional embeds -> release evidence. Do not wait for the entire epic to verify individual slices.
  Existing work: REE-81 covers Home query failures. REE-82 covers detail-return tab animation. Keep those as owners of their regressions and cross-reference integration tasks. REE-28 import/export stays deferred. REE-25, REE-26, REE-27, REE-29, and REE-76 remain separate unless explicitly re-scoped.
  Implementation is authorized by the user's orchestration request. No dates or estimates are promised before the initial inventory.

## Integration

This list is the epic container. Keep this brief current as design gates settle. Reinspect the working tree before implementation and do not overwrite unrelated work.

## Acceptance criteria

Every task has scope, integration points, acceptance checks, and real blockers. Epic completes only when required tasks and the final release gate are done. Do not mark implementation done from planning alone.

## Verification

Review the list, dependency graph, related issues, and octo doctor. Implementation evidence is collected by the release task.

## Task index and integration order

- REE-88: 01. Validate the unified navigation and drill-down design. Depends on no implementation task.
- REE-89: 02. Define widget, saved-report, placement, and scope contracts. Depends on REE-88.
- REE-90: 03. Implement compatible dashboard and report persistence. Depends on REE-89.
- REE-91: 04. Build the shared widget rendering and configuration system. Depends on REE-90.
- REE-92: 05. Convert current Home panels into selectable widgets. Depends on REE-91.
- REE-93: 06. Deliver multiple dashboards and the preconfigured Today dashboard. Depends on REE-92.
- REE-94: 07. Merge Home and Reports under stable workspace navigation. Depends on REE-88, REE-93.
- REE-95: 08. Preserve exploration state across drill-down and history. Depends on REE-94, REE-89.
- REE-96: 09. Standardize contextual pane lifecycle and responsive tasks. Depends on REE-88.
- REE-97: 10. Connect report drill-down to contextual transaction inspection. Depends on REE-91, REE-95, REE-96.
- REE-98: 11. Separate Accounts viewing scope from global editing effects. Depends on REE-88, REE-96.
- REE-99: 12. Remove bespoke analytics from operational pages. Depends on REE-92, REE-93.
- REE-100: 13. Persist optional page embeds and explicit scope inheritance. Depends on REE-89, REE-90, REE-97.
- REE-101: 14. Add constrained report widgets to Transactions and Payees. Depends on REE-100, REE-99, REE-91, REE-95.
- REE-102: 15. Keep page attention messages distinct from controls and widget feedback. Depends on REE-88, REE-91.
- REE-103: 16. Verify the integrated epic and retire obsolete layout conventions. Depends on REE-94, REE-95, REE-97, REE-98, REE-99, REE-101, REE-102.

## Delivery checkpoints

1. Design and contracts: REE-88, REE-89.
2. Unified Home: REE-90, REE-91, REE-92, REE-93, REE-94.
3. Contextual work: REE-95, REE-96, REE-97, REE-98, REE-99, REE-102.
4. Optional operational embeds: REE-100, REE-101.
5. Final release evidence: REE-103.

After REE-88, the model and pane work can proceed independently. Scope clarification can follow the pane while the dashboard foundation proceeds. Navigation waits for a usable dashboard replacement so intermediate releases do not remove Home without replacing it. Tests and docs are part of every slice, not deferred until the release task. The numbered order is a reading order; blocked-by fields define actual scheduling.

Start with: octo show REE-88.

Mark this tracking brief done only after REE-103 and required children are verified.

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

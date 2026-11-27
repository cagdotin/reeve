---
id: REE-89
title: 02. Define widget, saved-report, placement, and scope contracts
status: done
priority: medium
tags:
  - contract
  - architecture
created: 2026-11-07T09:42:55.757Z
order: a2
blocked_by: [REE-88]
---

## Outcome and scope

Inventory current dashboard_pages, widgets, custom reports, widget meta, operations, and UI state. Produce a concrete model for report widgets, summary widgets, and work-list widgets without treating every widget as a report.
Separate saved report definition from placement size/position/presentation and temporary exploration. Choose linked-definition behavior and whether copies are supported initially. Specify rename, delete, missing reference, unsupported type, and unavailable capability behavior.
Define effective account/date scope, inheritance, fixed overrides, and the input needed to open a full report or related register records. Define persisted book data versus device-local preferences. Prefer extension of existing contracts to a parallel widget framework.

## Integration

packages/contract/src/catalog/reports.ts, engine/src/reports/dashboard.ts, db/schema.ts, components/reports/{widgets,meta,widget-state}. Avoid new runtime root-contract imports in the browser. Include catalog validation and migration consequences.

## Acceptance criteria

Provide a field-level model and examples for one existing report, one work-list widget, two placements of a linked report, and an inherited embedded scope. Specify which operation changes which object and what deletion means. Historical opaque meta and frozen capability data have a preservation policy.

## Verification

Review sample old-to-new records, invalid inputs, scope combinations, and undo boundaries. Record the chosen design and Actual departures before implementing persistence.

## Epic and dependencies

Read REE-87 for the agreed scope and exclusions. Blocked by REE-88.

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

Still open: detailed selector/navigation behavior, unsaved-change interactions, pane treatment at narrow widths, placement of optional widgets, route aliases, and storage ownership of local preferences. The design task still requires mockup validation. Do not mark REE-88 or REE-89 done from this agreement alone.

## Implementation-model evidence

Source inspection at `1ed0581` completed. The field-level proposal and exact REE-90 acceptance cases are attached in `implementation-model.md`. Read the corrected REE-88 handoff, including shared-definition saves, history-preserved exploration, and phone non-drag controls.

Observed: built-ins store definitions in widgets.meta; custom reports have independent JSON definitions referenced by meta.id; list_dashboard_pages seeds Main on read; the three tables and settings are already undo-triggered; Unknown meta bypasses nested key rejection. Existing Home has summary, account, spending, upcoming, and recent panels. No runtime verification or real-book access was performed.

Proposed: extend the existing three tables, migrate saved built-ins without deduplicating independent old widgets, link future placements by default, preserve exact private legacy metadata, use closed new write schemas, initialize Today once at book open, and separate optional page hosts and scope from dashboard identity. The attachment covers field shapes, examples, operations, migration, usage-confirmed deletion in one undo step, scope precedence, unavailable references, frozen Purchases preservation, and no-op writes.

Parent action before REE-90: record the model and Actual departures in parent-owned docs. Explicitly adopt or reject the proposed one-time pre-upgrade undo/redo boundary. Unconverted old reverse SQL can restore old meta semantics; retaining it requires a historical conversion plan. This is a disclosed implementation adoption dependency, not a runtime change made by REE-89.

REE-89 is a model/readiness task only. No persistence, UI, or runtime code was changed. Its concrete attachment gate is complete; runtime acceptance belongs to REE-90 and the named later tasks.

Verification: reviewed the attachment against the named source files and old/new examples. `pnpm exec oxfmt --check` passes for both task-owned Markdown files, `octo doctor` reports no problems, and `git diff --check` passes. Comment review found no runtime comments or suppressions in this documentation-only change. No runtime tests were run. The pre-existing pnpm-lock.yaml change remains outside this task and commit.

## Parent adoption review

User re-evaluation recorded in [reports rules](../../../../docs/rules/reports.md) supersedes the original history-preservation requirement. REE-90 uses one transactional development upgrade and clears pre-upgrade undo and redo once, after backup. Preserve financial and frozen Purchases records and verify ordinary subsequent undo/redo. Historical SQL replay and reconciliation are out of scope. The linked-report product model remains accepted.

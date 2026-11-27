---
id: REE-99
title: 12. Remove bespoke analytics from operational pages
status: done
priority: medium
tags:
  - ui
  - accounts
created: 2026-11-07T09:42:58.040Z
order: aC
---

## Outcome and scope

Remove the fixed analytical overview from Transactions and bespoke analytical panels from Payees where they compete with operational work. Audit Rules and Schedules for decorative analytics versus useful task information.
Retain compact account balance, cleared/uncleared, reconciliation state, actionable row facts, rule coverage needed for editing, and upcoming schedule details needed to act. Do not delete business operations or legacy data solely because a chart leaves a page.
Prioritize search, filters, selection controls, and records in the initial viewport. Delete dead UI-only wrappers and obsolete hide/show preferences when their callers are gone. Do not retain a hidden second analytics implementation for future embeds.

## Integration

register/account-overview.tsx, Accounts route, payee insights, rule/schedule components, lib/prefs.ts, selection-bar and page spacing. Reports and Home remain the analytical destinations; this task adds nothing to replace the removed panels.

## Acceptance criteria

Transaction rows are reachable immediately below compact operational context. Sorting, selection, search, reconciliation, and editing are unchanged. No layout toggle preserves removed analytics. No general-purpose widget editor is introduced on Rules or Schedules.

## Verification

E2E checks representative account scopes, long names, many records, bulk selection, reconciliation, and first-viewport layout at phone/laptop/desktop widths. Update screenshots and assertions that encoded the old overview.

## Epic and dependencies

Read REE-87 for the agreed scope and exclusions. UI first: this cleanup lands independently of dashboard persistence (REE-90/REE-104) and of the Home widget work (REE-92, REE-93); it uses existing operations and data only, with no schema, storage or API changes.

## Delivery rules

Each implementation slice must land in a working, verified state. Update decisions and relevant docs with the behavior they describe. Reinspect the current checkout, use scratch REEVE_HOME for verification, and preserve unrelated work. Implementation is now authorized. The parent orchestrator owns docs and decisions; task agents implement one scoped unit on master, verify it, update Octodo, and commit only task-owned changes. No nested agents or competing design exploration.

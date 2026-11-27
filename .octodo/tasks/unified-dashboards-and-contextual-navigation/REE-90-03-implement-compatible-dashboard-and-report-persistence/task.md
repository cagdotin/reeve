---
id: REE-90
title: 03. Implement compatible dashboard and report persistence
status: done
priority: medium
tags:
  - engine
  - contract
created: 2026-11-07T09:42:55.997Z
order: a3
blocked_by: [REE-89]
---

## Outcome and scope

Implement the approved model through existing dashboard/report operations where practical. Add schema changes only when required. Support needed definition/placement management without UI-only writes.
Preserve existing dashboard IDs, names, widget layouts, custom reports, and metadata. Make any initialization/backfill repeatable without overwriting customizations. Keep new-book defaults separate from upgrades.
Validate new fields and references at operation boundaries. Specify deletion and undo/redo for saved reports and their placements. Preserve frozen Purchases data without exposing disabled widgets.

## Integration

contract catalog and domain handlers, engine/src/reports/dashboard.ts, db/schema.ts, db/open.ts undo configuration, generated migrations. Run pnpm db:generate for schema changes and pnpm catalog:generate for catalog changes. Update affected documentation in the same implementation change.

## Acceptance criteria

Existing books reopen with their custom dashboards intact. New operations work through the catalog on all generated surfaces. Invalid references fail predictably. Reset, delete, undo, redo, backup, and restore retain correct relationships. No committed migrations are edited.

## Verification

Operation-based engine tests use scratch homes and old-book fixtures. Test repeated open/initialization, linked placements, deletion, undo/redo, and unknown keys. Verify changed CLI/HTTP behavior with scratch data.

## Epic and dependencies

Read REE-87 for the agreed scope and exclusions. Blocked by REE-89.

## Delivery rules

Each implementation slice must land in a working, verified state. Update decisions and relevant docs with the behavior they describe. Reinspect the current checkout, use scratch REEVE_HOME for verification, and preserve unrelated work. Implementation is now authorized. The parent orchestrator owns docs and decisions; task agents implement one scoped unit on master, verify it, update Octodo, and commit only task-owned changes. No nested agents or competing design exploration.

## Parent adoption review

User re-evaluation supersedes the original historical undo requirement. [reports rules](../../../../docs/rules/reports.md) authorizes a one-time transactional development upgrade and clearing both pre-upgrade history stacks, after backup. Preserve financial records, frozen Purchases data, identifiers, layouts and legacy text. Do not build historical reconciliation or replace the undo engine. Ordinary post-upgrade undo/redo remains required. REE-104 is re-scoped to additive storage and the one-time upgrade. REE-89 remains the product model, with its historical replay requirements superseded.

## Implementation and verification

Implemented the linked saved-report model, typed placement config, usage-confirmed deletion, dashboard defaults/reorder/duplication/reset, unavailable descriptors and explicit repair. Existing custom-report and meta callers use compatibility adapters over the same storage. Unknown nested settings and condition operands are rejected. The generated additive migration preserves existing columns and rowids; no committed migration was edited.

The one-time lifecycle upgrade retains exact legacy JSON privately, creates independent definitions for old independent widgets, adds Today atomically, and clears both old history stacks. Syntax/schema/domain failures leave malformed legacy records unavailable. Storage failures propagate and roll back conversion, initialization and history reset. Synthetic fixtures cover both marker and placement-write failures.

Verification: all 2,015 unit tests pass. The 14 dashboard persistence cases cover new/old books, repeated opening, linked edits/copies, usage-confirmed deletion, default/delete/reset undo/redo, post-upgrade financial writes, unavailable/frozen records, backups/restore and strict inputs. Ten targeted browser tests pass, including deletion usage at desktop/phone widths in light/dark, projections, age of money, frozen Purchases and HTTP nested-key rejection. Scratch CLI create/default/list and report duplicate/get/usage pass. Typecheck, lint, React Doctor and desktop bundle/startup checks pass.

Full browser run: 142 passed, 19 skipped, three failures. Hot reload passes on isolated rerun; account-scope and page-alert sticky-position failures persist in isolation and are tracked in REE-106. They are outside the persistence files changed here. No prior-baseline attribution is claimed.

The user-authorized dev upgrade was applied through the restarted desktop-managed server after a fresh verified backup outside the repository. All 22 preserved-table fingerprints match in each of the three books; SQLite quick_check passes and old history is empty. No test was run against a real home.

Self-review covered storage atomicity, frozen data, references, strict inputs and undo ordering. It found and fixed swallowed storage failures in conversion. Comment review removed seven stale/default-template or section-comment lines and retained the short malformed-JSON edge-case comment. No new suppressions.

## Handoff

REE-91 can consume reportId, config, availability and unified saved-report operations. New Home types are persisted but their renderers remain REE-92 work. The existing UI still uses projected meta; migrate those callers and remove the legacy meta write adapters in REE-91. Until shared scope-aware query adapters exist, scoped definitions and fixed-scope placements intentionally return unsupported and do not issue unscoped legacy queries. Remove that transitional guard in reports/dashboard.ts only when the shared renderer applies scope outside OR groups. Legacy custom execution similarly rejects non-all saved scope. Reserved host storage is present; REE-100 owns host operations and constraints. No navigation or full Home UI work is claimed here.

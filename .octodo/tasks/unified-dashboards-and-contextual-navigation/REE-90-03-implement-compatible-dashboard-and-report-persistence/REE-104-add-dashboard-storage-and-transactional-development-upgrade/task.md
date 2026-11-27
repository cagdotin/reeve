---
id: REE-104
title: Add dashboard storage and transactional development upgrade
status: done
priority: high
tags:
  - engine
  - testing
created: 2026-11-07T11:16:54.074Z
order: a0
---

First implementation slice of REE-90, revised by user approval and [reports rules](../../../../../docs/rules/reports.md). Add nullable dashboard/report/widget storage through a generated migration. Preserve old identifiers, rowids, opaque legacy text, financial records and frozen Purchases data. Convert current records and initialize Today once in a transaction. Clear pre-upgrade undo and redo in that same transaction; no historical replay or reconciliation is required. Prove rollback, repeated opening, ordinary subsequent undo and data preservation with synthetic older-book fixtures. REE-90 owns the linked-report operations and final verification.

Implemented in the generated 20261107124919_even_ares migration and reports/initialize.ts. The migration uses additive ALTER TABLE statements and indexes, not table rebuilds. The scratch older-book fixture proves exact metadata, financial and frozen product preservation, repeat opening, the intentional history reset, post-upgrade undo/redo, and rollback on marker or placement SQL failure. The 14 persistence tests pass; final verification and the authorized dev-book application are recorded on REE-90.

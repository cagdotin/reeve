---
id: REE-103
title: 16. Verify the integrated epic and retire obsolete layout conventions
status: backlog
priority: medium
tags:
  - testing
  - docs
created: 2026-11-07T09:42:58.948Z
order: aG
blocked_by: [REE-94, REE-95, REE-97, REE-98, REE-99, REE-101, REE-102]
---

## Outcome and scope

Run the integrated reference journeys against scratch homes and existing-book upgrade fixtures. Verify migration, backups, undo/redo, frozen-data preservation, selectors, history, embeds, pane lifecycle, and scoped/global editing copy.
Exercise desktop, narrow laptop, and 390x844 phone layouts in Day and Night. Check keyboard operation, focus, reduced motion, accessible names, one main landmark, page scrolling, and no horizontal page overflow.
Remove obsolete routes/components only after aliases and callers are migrated. Update navigation findability, route conventions, docs and decisions in the same changes that establish final behavior.
Keep REE-81 and REE-82 closure evidence attached to their own tasks. REE-28 and unrelated report improvements remain open outside the epic.

## Integration

packages/e2e, navigation/page tests, engine fixtures, docs/decisions index, docs/architecture.md and AGENTS.md where rules changed. Run pnpm catalog:generate and db generation when applicable. Do not edit unrelated staged work.

## Acceptance criteria

All required epic tasks have evidence and no unresolved product semantics. Existing dashboards and saved reports survive upgrade. No duplicate Home/dashboard implementation or standalone Reports sidebar destination remains. Old supported links still resolve. The full check suite passes or unrelated failures are reproduced and explicitly tracked, not waived silently.

## Verification

Run pnpm check, including browser E2E and desktop bundle checks. Record exact commands, environment, fixture types, screenshots, and known external blockers. Mark the epic done only after required delivery and regressions are verified.

## Epic and dependencies

Read REE-87 for the agreed scope and exclusions. Blocked by REE-94, REE-95, REE-97, REE-98, REE-99, REE-101, REE-102.

## Delivery rules

Each implementation slice must land in a working, verified state. Update decisions and relevant docs with the behavior they describe. Reinspect the current checkout, use scratch REEVE_HOME for verification, and preserve unrelated work. Implementation is now authorized. The parent orchestrator owns docs and decisions; task agents implement one scoped unit on master, verify it, update Octodo, and commit only task-owned changes. No nested agents or competing design exploration.

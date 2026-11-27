---
id: REE-98
title: 11. Separate Accounts viewing scope from global editing effects
status: done
priority: medium
tags:
  - ui
  - accounts
created: 2026-11-07T09:42:57.829Z
order: aB
blocked_by: [REE-88, REE-96]
---

## Outcome and scope

Keep the shared Accounts view filter across Transactions, Payees, Rules, and Schedules. Label it as accounts shown or equivalent approved copy.
Explain each page's meaning: payees used on these accounts, rules that can apply here, and schedules associated with this scope. Identify global rules under a filtered view.
Editors distinguish preview scope from mutation scope. Payee rename/merge discloses book-wide effects. Rule editing exposes actual account conditions separately from previewing matches on one account.
Changing view scope must never silently rewrite rule conditions or imply a globally shared payee is local. Preserve legitimate scoped-new-rule defaults with visible conditions.

## Integration

account-scope-menu.tsx, lib/account-scope.ts, payee/rule/schedule pages and editors, rule previews and pane behavior. Preserve [panes and alerts rules](../../../../docs/rules/panes-and-alerts.md) filtering semantics unless an explicitly recorded decision changes them.

## Acceptance criteria

A person can tell why an item is listed and what editing it affects. Global rule badges and editor copy remain accurate for AND/OR account conditions. Unused payees and schedules without accounts retain their existing findability behavior.

## Verification

Engine behavior tests remain green. E2E covers all accounts, one account, budget/off-budget groups, global rules, OR conditions, unused payees, accountless schedules, global rename/merge consequences, and dirty scope changes.

## Epic and dependencies

Read REE-87 for the agreed scope and exclusions. Blocked by REE-88, REE-96.

## Delivery rules

Each implementation slice must land in a working, verified state. Update decisions and relevant docs with the behavior they describe. Reinspect the current checkout, use scratch REEVE_HOME for verification, and preserve unrelated work. Implementation is now authorized. The parent orchestrator owns docs and decisions; task agents implement one scoped unit on master, verify it, update Octodo, and commit only task-owned changes. No nested agents or competing design exploration.

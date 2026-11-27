---
id: REE-127
title: Rebuild transactions from their bank lines, with a dry run
status: todo
priority: medium
tags:
  - bank
  - engine
  - ui
created: 2026-11-09T08:52:23.333Z
order: aS
---

Slice 3 of [Bank line provenance](docs/specs/bank-line-provenance.md). Needs slice 2. `rebuild_transactions` (ids, or account and days; `dryRun`): reread each line through today's `mapLine`, run today's rules, write only what a rule sets, per the spec's table (imported payee always; payee by rule, or by today's reading while the book's payee is still the old reading's; category and notes by rule; never amount, date, marks; skip splits, transfers, receipt-applied; never delete). One undo step. "Rebuild from bank lines" in the register's selection bar, with the dry run's changes listed in the pane before applying.

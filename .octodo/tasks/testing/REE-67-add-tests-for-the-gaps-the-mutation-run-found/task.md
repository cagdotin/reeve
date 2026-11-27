---
id: REE-67
title: Add tests for the gaps the mutation run found
status: todo
priority: medium
tags:
  - engine
created: 2026-11-03T07:14:25.360Z
order: a6
---

From the mutation run (REE-59, docs/testing.md). No test would notice a bug in these. Worth covering by what a person budgeting would lose: deleting a category group touching other groups' categories (categories.ts:193); typing an amount: evaluateArithmetic, parseAmount and groupDigits (rules.ts, 138 mutants with no test); update_account ignoring onBudget, and other updates (accounts.ts:151, categories.ts:124, payees.ts:87); a merge losing the imported id (transactions.ts); deleting an expense category moving postings to income (categories.ts:158); isCalendarDay accepting 2026-02-31 (rules.ts:22); 12 survivors in computeBudget (rules.ts:362).

When these are closed, run `pnpm test:mutation` by hand and record the new score in docs/testing.md. Nothing runs it by itself.

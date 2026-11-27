---
id: REE-69
title: set_budget on an income category in an envelope budget reports success and changes nothing
status: done
priority: low
created: 2026-11-05T07:10:57.136Z
order: a1
---

In an envelope budget, `set_budget` on an income category returns `{month}` and writes a `budgets` row, but `computeBudget` shows that row's budgeted as 0 (`packages/contract/src/rules.ts:345`). An agent or CLI user is told the write worked and nothing changes.

Reproduced on a scratch home: `reeve budget set --month 2026-11 --category <income id> --amount 300000`, then `reeve budget show --month 2026-11 --json` shows income budgeted 0.

Resolve it either by rejecting the write with `invalid(...)`, or by giving the amount a meaning (an expected-income figure in envelope budgets, still under discussion).

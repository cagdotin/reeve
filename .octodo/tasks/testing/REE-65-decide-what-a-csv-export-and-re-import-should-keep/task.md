---
id: REE-65
title: Decide what a CSV export and re-import should keep
status: todo
priority: low
tags:
  - engine
created: 2026-11-03T03:53:24.317Z
order: a4
---

Measured by the round trip properties (REE-58, [ledger rules](../../../../docs/rules/ledger.md)). A CSV is not a backup, and these stay as they are until decided: a split parent comes back as a zero-amount row; transfers come back uncategorized; the formula guard adds ' to a payee starting with =, +, - or @; the Category column is guessed as the group, as Actual does (categoryField overrides it); a bank id reused within one file merges into its first row.

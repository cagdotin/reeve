---
id: REE-73
title: "Show category descriptions in the category picker: plan, investigate, implement"
status: todo
priority: low
tags:
  - ui
created: 2026-11-05T09:36:01.340Z
order: a7
---

A category description says what belongs in it, for people and agents ([shell rules](../../../../docs/rules/shell.md)). The moment a person needs it is when filing a transaction, but the category picker (`apps/web/src/components/picker.tsx`, `category-select.tsx`) shows only names. Today it appears only on the row card in the budget.

This is tricky: the picker is dense, used in the register, rules, receipts and reports, and is driven by keyboard. Investigate the best way first (a second line, a detail beside the highlighted option, search matching the description too), how Actual and others treat it, and what it does to row height and long lists. Then plan and implement it.

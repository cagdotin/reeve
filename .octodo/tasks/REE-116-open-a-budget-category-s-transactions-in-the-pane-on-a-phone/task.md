---
id: REE-116
title: Open a budget category's transactions in the pane on a phone
status: todo
priority: low
tags:
  - mobile
  - budget
created: 2026-11-08T12:29:18.000Z
order: aI
---

On a computer, a Budget cell's spent or received figure (a category with its subcategories, or a group total) opens its transactions in the pane ([reports rules](../../../docs/rules/reports.md), `budget_transactions`, `FigureRecordsPane`). On a phone the budget uses `mobile/category-sheet.tsx`, which still links to the register, because opening the pane over the sheet would stack two layers. Decide the phone flow (close the sheet and open the pane full screen, or show the list inside the sheet), build it, and cover it in `packages/e2e/test/mobile.e2e.ts` at 390x844.

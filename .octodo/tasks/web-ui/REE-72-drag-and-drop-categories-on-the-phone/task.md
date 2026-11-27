---
id: REE-72
title: Drag and drop categories on the phone
status: todo
priority: low
tags:
  - mobile
  - feature-request
created: 2026-11-05T09:36:01.132Z
order: a6
---

Categories are edited in the budget grid on desktop, where a row and its group can be dragged. The phone budget has the same row card (edit, add, hide, delete) but no drag, so a category cannot be reordered or nested from a phone.

Add drag and drop to the phone budget (`apps/web/src/components/mobile/mobile-budget.tsx`), reusing `categories/category-dnd.tsx` and `categories/drop.ts`. Actual has this in `packages/desktop-client/src/components/mobile/budget/` (`ExpenseGroupList`, `ExpenseCategoryList`, `IncomeCategoryList`): read how it tells a drag from a scroll.

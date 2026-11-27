---
id: REE-36
title: Nested categories inside groups (configurable depth, default 3)
status: done
priority: high
tags:
  - engine
  - ui
  - architecture
created: 2026-11-01T06:06:51.869Z
order: a3
---

Groups stay as total-only headers. Categories get a parent (same group, same income/expense type), up to the book setting `categoryDepth` levels (default 3). Every category is its own envelope and holds money; a parent row shows its own budgeted/spent/balance plus a rolled-up total of itself and its descendants. [model rules](../../../../docs/rules/model.md).

## Done

- `accounts.parent_id` (migration 20261101060758), `Category.parentId`, `BudgetCategoryMonth.total`, `BookSettings.categoryDepth` (update_book refuses to go below the deepest nesting).
- `create_category` / `move_category` take `parent`; moves carry the subtree; `delete_category` lifts children to its parent in place.
- Web: tree in the budget grid with chevrons and "incl. subcategories" totals, Add subcategory, drag and drop to reorder and nest groups and categories, indented pickers, Settings control. CLI renders the tree.
- Tests: packages/engine/test/categories.test.ts.
- Not done: a "category or any subcategory" rule op / report filter; the custom report table does not indent subcategories.

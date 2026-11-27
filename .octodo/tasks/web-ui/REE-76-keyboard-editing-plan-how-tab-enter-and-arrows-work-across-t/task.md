---
id: REE-76
title: "Keyboard editing: plan how Tab, Enter and arrows work across the app"
status: todo
priority: medium
tags:
  - ui
  - feature-request
created: 2026-11-05T11:16:43.590Z
order: a9
---

reeve has been built mouse first. Nobody has planned how a person edits by keyboard, so what the keyboard does today is whatever the markup happens to give. Treat this as a feature to design, starting with the budget grid and the register, where people type many amounts in a row.

## What it does today

Measured on 2026-11-05 in the budget grid: pressing Tab from General's budgeted amount to Bills' budgeted amount takes 5 presses, stopping on General's budget actions, General's balance, Move Bills, Bills' options, then Bills' amount. [shell rules](../../../../docs/rules/shell.md) wanted Tab to move between budgeted amounts, and this does not meet that.

## To settle

- What Tab, Shift+Tab, Enter, Escape and the arrow keys do in an editable grid, and whether a cell commits on leaving.
- How row controls stay reachable (menus, the row card, targets) without being stops between amounts.
- How a row is dragged by keyboard. It needs a focusable handle today (`categories/category-dnd.tsx`); a Move action in the row card may replace that stop.
- Which other screens follow the same rules: the register, receipts lines, rules.

Actual is the reference: read its table navigator (`useTableNavigator` in `packages/desktop-client/src/components/table.tsx`) and how its budget and register use it before designing. Record the result as a decision.

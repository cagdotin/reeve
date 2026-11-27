---
id: REE-114
title: Spending's compare-to picker shows a raw month before the first transaction
status: todo
priority: low
tags:
  - bug
  - reports
created: 2026-11-08T09:32:01.156Z
order: aH
---

On the Spending report, the "to" month picker shows the raw `2026-10` instead of "Oct 2026" when compareTo is a month before the book's earliest transaction: `SpendingControls` in `apps/web/src/routes/reports.spending.tsx` builds its items from `monthRange(earliest, currentMonth())`, so the default compareTo (last month) has no item and `Choice` falls back to the value. Seen in a scratch book whose first transaction is in November 2026 (REE-97 screenshots). Fix: include compare and compareTo in the items, or label an unknown month with `shortMonth`.

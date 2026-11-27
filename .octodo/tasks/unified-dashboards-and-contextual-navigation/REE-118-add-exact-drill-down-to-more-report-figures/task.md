---
id: REE-118
title: Add exact drill-down to more report figures
status: todo
priority: low
tags:
  - reports
  - ui
created: 2026-11-08T12:29:18.375Z
order: aH
---

REE-97 added exact drill-down to Spending's month cells only ([reports rules](../../../../docs/rules/reports.md)): a report gains one by adding a records operation over its own line query returning `FigureRecords` and a button rendering `FigureRecordsPane`. Candidates: cash flow income/expense per interval, custom report bars and table cells, summary widget value, calendar day. Each must reconcile to its figure under the report's filters; a figure with no exact record set keeps no action.

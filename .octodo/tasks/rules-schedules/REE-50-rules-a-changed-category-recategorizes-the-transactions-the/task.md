---
id: REE-50
title: "Rules: a changed category recategorizes the transactions the rule matches"
status: done
priority: medium
tags:
  - engine
  - ui
created: 2026-11-01T17:18:16.212Z
order: a4
---

Creating a rule with a set-category action, or changing a rule's category, sets that category on every existing transaction the rule matches (only the category; one undo step; recategorize: false opts out). The rule editor says how many it will change and toasts the count. [rules and payees rules](../../../../docs/rules/rules-and-payees.md).

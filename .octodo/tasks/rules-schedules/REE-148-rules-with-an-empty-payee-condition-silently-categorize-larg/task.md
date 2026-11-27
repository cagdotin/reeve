---
id: REE-148
title: Rules with an empty-payee condition silently categorize large inflows
status: todo
priority: low
tags:
  - feature
created: 2026-11-14T07:26:26.259Z
order: a9
---

From Reeve Bookkeeper. An existing rule (payee is null -> Eating Out) categorized several large blank-payee N26 inflows as Eating Out.

Done when: a rule whose only condition is an empty payee is warned about in the rule editor (or not allowed), and it doesn't match inflows unless it says so; test covers it. Decide shape before building.

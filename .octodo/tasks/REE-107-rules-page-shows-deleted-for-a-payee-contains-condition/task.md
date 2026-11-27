---
id: REE-107
title: Rules page shows '(deleted)' for a payee 'contains' condition
status: todo
priority: low
tags:
  - bug
  - rules
created: 2026-11-07T13:48:10.196Z
order: aD
---

Seen while capturing landing screenshots. `packages/e2e/scripts/seed.ts` creates rules with `{ field: "payee", op: "contains", value: "Grocer" }`. On `/rules` they render as `payee contains (deleted)`, as if the text were a payee id. Reproduce: seed a scratch home with that script, open `/rules`. Decide whether the page should show the text for `contains`, or `create_rule` should refuse a non-id payee value there.

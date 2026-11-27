---
id: REE-62
title: Decide whether a reconciled posting can be uncleared
status: todo
priority: low
tags:
  - engine
created: 2026-11-02T23:55:56.464Z
order: a1
---

update_transaction { cleared: false } works on a reconciled posting and leaves it reconciled but uncleared. The property suite's rule 3 protects only account and amount. Found in REE-56. Default until decided: leave it.

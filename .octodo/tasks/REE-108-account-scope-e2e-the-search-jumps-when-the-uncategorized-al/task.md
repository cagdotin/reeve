---
id: REE-108
title: "account-scope e2e: the search jumps when the uncategorized alert comes or goes"
status: done
priority: medium
tags:
  - testing
  - ui
created: 2026-11-08T07:48:06.316Z
order: aE
---

Fails on master before REE-94 (checked 2026-11-08 by stashing the REE-94 work): `account-scope.e2e.ts` > "changing the account on Transactions swaps what is shown and nothing else" expects the search box to stay at its screen position (89) and finds it at 48.

Since 5c55ad6 page alerts sit above the scroller, outside it, so scroll anchoring cannot hold the rows still when an alert above them comes or goes: the whole page moves by the alert height (about 41px). Decide whether the alert strip should reserve its place, or the test should measure against the scroller instead, then fix. Related: REE-102, REE-106.

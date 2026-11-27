---
id: REE-68
title: Random operation sequences draw bank fetches
status: todo
priority: low
tags:
  - engine
  - testing
created: 2026-11-03T08:14:04.301Z
order: a4
---

The property suite (`packages/engine/test/properties/`) draws no bank operations, so rows from a fake provider never meet its rules. `bank-sync-converges.test.ts` covers fetch, delete and undo with its own seeded generator and 8 seeds. Draw `sync_bank_accounts` in the suite against `fake-enable-banking.ts`, and retire that generator. Found while merging REE-52.

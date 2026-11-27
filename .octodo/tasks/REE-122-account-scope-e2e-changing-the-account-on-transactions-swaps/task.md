---
id: REE-122
title: "account-scope e2e: 'changing the account on Transactions swaps what is shown and nothing else' fails on master"
status: done
priority: medium
tags:
  - e2e
created: 2026-11-09T08:26:30.429Z
order: aN
---

Fails on clean master (checked 2026-11-09 with git stash): `npx vitest run --config packages/e2e/vitest.config.ts account-scope`. Also hot-reload.e2e.ts timed out once under the full suite but passes alone.

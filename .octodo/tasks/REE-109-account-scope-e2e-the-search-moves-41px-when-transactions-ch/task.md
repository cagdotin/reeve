---
id: REE-109
title: "account-scope e2e: the search moves 41px when Transactions changes account"
status: done
priority: low
tags:
  - testing
  - ui
created: 2026-11-08T08:20:22.873Z
order: aF
---

`packages/e2e/test/account-scope.e2e.ts` > "changing the account on Transactions swaps what is shown and nothing else" fails at line 194: the search's top is 48 where it was 89 (`expected 48 to deeply equal 89`). It fails the same way on a4dfe58, before REE-95, in a clean worktree, so the REE-95 scroll memory did not cause it. Reproduce: `npx vitest run --config packages/e2e/vitest.config.ts packages/e2e/test/account-scope.e2e.ts -t "changing the account on Transactions"`. Find whether the page alert or the scroller's position moved the rows, and fix the cause rather than the expected number.

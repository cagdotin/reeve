---
id: REE-106
title: Investigate remaining sticky-header browser regressions
status: todo
priority: medium
tags:
  - ui
  - testing
created: 2026-11-07T13:25:18.993Z
order: aC
---

Found during REE-90 verification on the current shared checkout. The full browser suite passes 142 tests but account-scope.e2e.ts:194 expects the Transactions header to retain its y position across account changes and gets 48 instead of 89. apps.e2e.ts:873 expects the page-alert strip to remain fixed while scrolling and gets [false,true]. Both fail again with --maxWorkers=1 and a test-name filter. These assertions exercise layout outside REE-90 persistence changes; no baseline attribution was established. Reproduce with pnpm exec vitest run --config packages/e2e/vitest.config.ts packages/e2e/test/account-scope.e2e.ts packages/e2e/test/apps.e2e.ts --maxWorkers=1 -t "changing the account on Transactions|what a person must act on". Use scratch fixture homes only. Diagnose the layout and update implementation or expectations based on intended behavior. Do not weaken assertions merely to pass. Hot-reload timeout from the full concurrent run passed in isolation.

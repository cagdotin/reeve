---
id: REE-131
title: hot-reload e2e fails about one run in twenty, even alone
status: done
priority: low
tags:
  - e2e
created: 2026-11-09T09:38:54.201Z
order: a9
---

packages/e2e/test/hot-reload.e2e.ts failed 1 of 23 runs on its own on 2026-11-09 (after 14s, so not the 60s timeout) and passed under two full-suite runs. The failing run's output was not kept. Next: loop it with output saved (`for i in $(seq 30); do npx vitest run --config packages/e2e/vitest.config.ts hot-reload > hr$i.log 2>&1; done`) and read the first failure. Suspects: Vite optimizing dependencies afresh in the test's new cacheDir and reloading the page mid-test, or a second hot update landing after the fixed 2s wait. Found while fixing REE-122.

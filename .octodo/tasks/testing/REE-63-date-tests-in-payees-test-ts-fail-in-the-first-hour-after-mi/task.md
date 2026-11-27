---
id: REE-63
title: Date tests in payees.test.ts fail in the first hour after midnight in CET
status: todo
priority: low
tags:
  - engine
created: 2026-11-02T23:55:56.636Z
order: a2
---

They build dates in UTC and the app compares them with local today, so `pnpm test` fails between 00:00 and 01:00 CET. Build them with the same local helpers.

---
id: REE-56
title: Property harness and the six rules
status: done
priority: high
tags:
  - engine
created: 2026-11-02T22:47:23.731Z
order: a0
---

fast-check, a generator of operation sequences through call(), a fixed clock, a replayable seed, a run budget. After each step check: transactions balance with 2+ postings; every cent has a place; reconciled postings stay put; references exist; a refused operation changes nothing; undo and redo restore the database exactly.

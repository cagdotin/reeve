---
id: REE-60
title: Writes that change nothing erase redo
status: done
priority: low
tags:
  - engine
created: 2026-11-02T23:00:23.659Z
order: a3
---

Measured 2026-11-02: undo, then an import where every row is a duplicate, then redo returns done: false. inTransaction clears the redo stack on every recorded write whether or not anything changed (engine/src/db/open.ts). The schedule run in engine/src/books.ts uses the same default at book open and hourly, so it is likely affected too (read, not run). Found during REE-52.

## Status

Fixed in commit be4fcb4 with REE-52, merged to master in f78efe4.

---
id: REE-1
title: "Double-entry ledger: accounts, transactions, postings, transfers, splits, reconcile, close/reopen, undo/redo"
status: done
tags:
  - engine
created: 2026-11-01T05:51:13.756Z
order: a0
---

Register shape on top of balanced postings (`engine/src/ledger/transactions.ts`: entryPostings / draftFrom). Undo via triggers recording reverse SQL ([boundaries rules](../../../../docs/rules/boundaries.md)).

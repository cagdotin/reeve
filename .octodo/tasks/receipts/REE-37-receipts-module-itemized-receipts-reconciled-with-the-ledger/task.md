---
id: REE-37
title: "Receipts module: itemized receipts reconciled with the ledger"
status: done
priority: high
tags:
  - architecture
created: 2026-11-01T07:57:04.702Z
order: a0
---

Isolated module (engine/src/receipts, catalog/receipts.ts, receipt_* tables). Design from studying mggarofalo/Receipts (receipt shape, line rounding, raw text vs product identity, store-scoped aliases) and grocy (products, base units, stores, purchases as facts). No AI inside reeve: agents use the API/MCP/CLI. Photos are files in a receipts folder. One currency per book. [purchases rules](../../../../docs/rules/purchases.md).

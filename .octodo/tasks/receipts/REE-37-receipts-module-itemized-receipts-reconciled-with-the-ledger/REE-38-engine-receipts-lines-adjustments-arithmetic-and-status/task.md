---
id: REE-38
title: "Engine: receipts, lines, adjustments, arithmetic and status"
status: done
created: 2026-11-01T07:57:04.903Z
order: a0
---

Done. `receipts`, `receipt_lines`, `receipt_adjustments` in `engine/src/receipts/schema.ts`; create (atomic, idempotent by externalId), import from JSON, get/list/update/delete, line and adjustment ops. Line totals round half away from zero as decimals (`lineAmount` in `contract/src/receipts.ts`); status computed on read; Receipts arithmetic fixture ported (`receipts-arithmetic.test.ts`).

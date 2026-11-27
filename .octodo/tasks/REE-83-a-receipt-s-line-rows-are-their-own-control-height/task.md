---
id: REE-83
title: A receipt's line rows are their own control height
status: todo
created: 2026-11-05T17:41:01.743Z
order: a8
---

`line-selects.tsx`, `cell-input.tsx` and `product-picker.tsx` are 28px, where the rule is 32px or 24px in a table row.
Adding detail pages to `findability.e2e.ts` found it, so that one test skips `/receipts/$id` until this is decided.

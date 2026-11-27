---
id: REE-138
title: Clear the Effect diagnostics messages (schemaNumber, Schema class brands, typed decoders)
status: todo
priority: low
tags:
  - tooling
created: 2026-11-10T07:09:45.382Z
order: ab
---

The typecheck gate runs `effect-tsgo diagnostics --strict --severity error,warning`, so 124 messages pass unseen. Run `npx effect-tsgo diagnostics --project tsconfig.json --format text` to list them.

- 108 `schemaNumber`: `Schema.Number` in catalog inputs (receipts, monte-carlo-plan, reports, projections, rules) accepts NaN and Infinity over every surface. Use `Schema.Finite` where a rate or ratio is meant.
- 7 `schemaClassMissingBrand` in `contract/src/domain.ts`.
- 5 `preferTypedSchemaDecoder`, 3 `unnecessaryFailYieldableError`, 1 `schemaSyncInEffect` in engine and contract.

When clean, drop `--severity` so new messages show.

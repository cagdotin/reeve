---
id: REE-123
title: "Bank sync: give lines with no entry_reference a content-derived id, as Actual does"
status: done
priority: low
tags:
  - bank
created: 2026-11-09T08:26:30.635Z
order: aO
---

Actual (#9456, deriveTransactionId in app-enablebanking/services/enablebanking-service.ts) hashes date, amount, currency, direction, parties and remittance, with a counter for identical lines, so a deleted line stays dismissed. reeve matches such lines by day and amount only, so a deleted one comes back. lineIds in engine/src/bank/rows.ts is the place.

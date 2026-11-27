---
id: REE-132
title: Deleting a transaction a bank line made asks first and offers merge
status: done
priority: medium
tags:
  - bank
  - ui
created: 2026-11-09T09:58:24.736Z
order: aV
---

Spec docs/specs/bank-line-provenance.md, 'Deleting a line the bank sent' ([bank rules](../../../docs/rules/bank.md)). The confirm says the transaction came from the bank and the balance will differ from the bank's by its amount; it offers Merge (duplicate of a hand-entered one) or a category/transfer instead. Deleting stays possible. The stored line stays in seen_imports and Left out... restores it from the stored line.

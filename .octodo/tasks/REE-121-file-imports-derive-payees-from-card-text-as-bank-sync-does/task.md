---
id: REE-121
title: "File imports: derive payees from card text as bank sync does"
status: done
priority: medium
tags:
  - bank
  - imports
created: 2026-11-09T08:26:30.220Z
order: aM
---

[bank rules](../../../docs/rules/bank.md) derives a bank line's payee in bank sync only (`payeeFromText`, `engine/src/bank/payee-text.ts`). A bank CSV/CAMT with the same card text (Erste's export) still makes one payee per purchase. Decide whether file imports run the same noise removal (and which profile: a file has no ASPSP country, so maybe the account's bank link or a book setting), keeping Actual's raw-payee behavior as an option.

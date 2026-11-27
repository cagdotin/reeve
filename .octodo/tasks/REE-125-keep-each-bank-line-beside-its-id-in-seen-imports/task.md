---
id: REE-125
title: Keep each bank line beside its id in seen_imports
status: done
priority: medium
tags:
  - bank
  - engine
created: 2026-11-09T08:52:20.020Z
order: aQ
---

Slice 1 of [Bank line provenance](docs/specs/bank-line-provenance.md). Add a `line` JSON column to `seen_imports`: the provider line exactly as it arrived (every field, IBANs included; [bank rules](../../../docs/rules/bank.md)), plus the bank's name, country and the account's currency. `rememberLine` writes it once, and fills it on a later fetch when it is empty, so lines taken before get theirs within the 89-day window. Stays out of `UNDONE_TABLES`. Tests through `sync_bank_accounts` against `fake-enable-banking.ts`: kept, follows a merge and each side of a transfer, survives undo of the fetch, and the stored line holds every field the bank sent, including ones `ProviderTransaction` does not decode. Accepted in [bank rules](../../../docs/rules/bank.md).

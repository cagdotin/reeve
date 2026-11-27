---
id: REE-126
title: Explain a transaction from its bank line and today's rules
status: todo
priority: medium
tags:
  - bank
  - engine
  - ui
created: 2026-11-09T08:52:21.623Z
order: aR
---

Slice 2 of [Bank line provenance](docs/specs/bank-line-provenance.md). Needs slice 1. `explain_transaction`: for each side with a bank line, the line, how `mapLine` reads it today, each rule that ran in order with the fields it changed (a traced `runRulesOn`), and the fields where the book differs. A "How it got here" tab in the transaction's pane (shape C), with "Reapply rules from the bank line" for that one transaction and "New rule from this line". Bank text is stranger-written: only this operation returns it, and no error quotes it.

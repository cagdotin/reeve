---
id: REE-58
title: Round trips and pure function properties
status: done
priority: high
tags:
  - engine
created: 2026-11-02T22:47:24.114Z
order: a2
---

Receipt splits add to the exact total; draftFrom and entryPostings convert back and forth; importing a file twice adds nothing; export then import; computeBudget properties; whether apply_rules run twice equals once.

Known failure to fix here: editing the amount of a starting balance transaction is refused with 'Opening Balances is not a category', because draftFrom hands back the system account as a category. It is old (already on b6f6571) and a round trip on the register shape should catch it. apply_rules hit the same refusal.

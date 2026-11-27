---
id: REE-146
title: "Auto-learned category rules: skip generic and mixed payees, and flag new rules for review"
status: todo
priority: medium
tags:
  - feature
created: 2026-11-14T07:26:25.887Z
order: a7
---

From a cleanup of a real book by Reeve Bookkeeper. Follows REE-141 (learn: false). Even with learning limited to the register editor, learned rules were harmful:

- processor/generic payees: Klarna Bank Ab -> Subscriptions (Klarna also covers groceries, shopping); Instant Bank Transfer -> Bank Fees.
- mixed payees: Person A has 12 rows in Loan Repayments Received and 13 in Friends & Family; the first write won and the second never replaced it. Person B similar.
- rules are created silently. Measured: 22 rules learned across 5 passes, all deleted by hand.

Done when: no rule is learned for a payee whose transactions already span more than one category (or learning adds a narrowing condition like direction/amount), learned rules are visibly marked and listed for review/undo, and tests cover both cases.

More data (later pass): 4 more rules learned and deleted, incl. Klarna Bank Ab -> Tax Advisor & Tax Software, and EUR 0 boilerplate bank-notice payees (Einlagensicherung/VKrG) -> Miscellaneous. Also skip learning from EUR 0 rows.

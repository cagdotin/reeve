---
id: REE-145
title: "make_transfer: merge both sides' notes instead of dropping the to-side note"
status: todo
priority: low
tags:
  - feature
created: 2026-11-14T07:26:25.702Z
order: a5
---

From Reeve Bookkeeper. make_transfer keeps the from-side payee and notes and drops the to-side note (Revolut 'Sent from N26 Payment from …' became N26's 'Sent from N26'). Both imported_ids are kept, which is right.

Done when: the transfer keeps both notes (merged, deduped when equal), with a test.

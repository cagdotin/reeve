---
id: REE-71
title: "Bank lines with no id: a new line can merge into one, and a deleted one comes back"
status: todo
priority: medium
tags:
  - engine
created: 2026-11-05T08:34:32.597Z
order: a6
---

Bank lines with no `entry_reference` are matched by amount within 7 days. Erste sends such lines: about 2% of lines (quarterly closings, account fees, interest, tax). Replaying such lines through the real adapter and a fake bank on 2026-11-05 showed that refetching them adds nothing, and categories stay, but found two faults. Both reproduce with `fake-enable-banking.ts`.

## A new line can be lost

A link whose first day falls just after a line with no id, then a new line with an id and the same amount within 7 days. The new line merges into the old one (`updated: 1`, `added: 0`) and the balance is short by that amount, with no warning. In the replay: a -20.50 fee on 2026-06-30, first day 2026-07-01, a new -20.50 line on 2026-07-02. The same should apply to any fetch whose range leaves the older line out.

## A deleted line comes back

A line with no id is not in `seen_imports`, so deleting one by hand does not dismiss it. The next fetch whose range covers it adds it again. A line with an id stays out, as [bank rules](../../../../docs/rules/bank.md) says.

## To check

How Actual treats both, then decide. A line with no id might take an id made from its bank fields (date, amount, text), so it can be remembered and matched exactly. Check first that those fields stay the same between fetches.

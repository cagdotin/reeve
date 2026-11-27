---
id: REE-64
title: A transfer's category goes stale when its account moves onto the budget
status: todo
priority: low
tags:
  - engine
created: 2026-11-03T01:32:06.693Z
order: a3
---

Measured by the property suite (REE-57): a transfer's category sits on the off-budget posting. Moving that account onto the budget with update_account leaves the category on a posting that no longer crosses the budget, and the next edit of the transaction drops it. Rule 8 skips transfers that stopped crossing, so nothing checks this. Decide: clear the category when the account moves, or keep it and make edits keep it. Read how Actual treats it first.

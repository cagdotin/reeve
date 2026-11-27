---
id: REE-149
title: "Bulk update_transactions: support transferAccount"
status: todo
priority: low
tags:
  - feature
created: 2026-11-16T09:55:52.477Z
order: a6
---

From Reeve Bookkeeper. Single update_transaction.transferAccount works (creates the counterpart on the target account), but bulk update_transactions has no transferAccount, so agents convert transfers one row at a time.

Done when: update_transactions accepts transferAccount on MCP and CLI, each row gets its counterpart, the whole batch is one undo step, with a test.

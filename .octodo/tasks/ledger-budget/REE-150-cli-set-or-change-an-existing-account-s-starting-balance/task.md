---
id: REE-150
title: "CLI: set or change an existing account's starting balance"
status: todo
priority: low
tags:
  - feature
created: 2026-11-16T09:55:52.681Z
order: a7
---

From Reeve Bookkeeper. accounts update has no starting-balance flag, transactions add / create_transaction refuse Opening Balances, and the only route is MCP create_journal_entry, which has no CLI subcommand.

Done when: something like `accounts update --starting-balance <amount> --date <date>` sets or replaces the opening entry (MCP too), with a test.

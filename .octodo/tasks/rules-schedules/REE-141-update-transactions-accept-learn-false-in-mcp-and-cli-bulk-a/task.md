---
id: REE-141
title: "update_transactions: accept learn: false in MCP and CLI; bulk and agent edits don't silently create rules"
status: todo
priority: medium
tags:
  - engine
  - mcp
  - cli
  - rules
created: 2026-11-12T14:36:25.718Z
order: a5
---

Reported by Reeve Bookkeeper, 2026-11-12.

**What happened:** bulk-categorizing 654 transactions by exact id with the MCP `update_transactions` tool. The engine defaults `learn: true`, so it auto-created 36 payee to category rules. The MCP tool exposes no `learn` option, so the rules had to be removed afterwards with `delete_rules`, adding an extra undo step.

**Expected:**

- `update_transactions` on MCP and CLI accepts `learn: false` (the engine already has the flag).
- Decide the default for bulk or agent edits: a multi-transaction edit should not silently create persistent rules. Check what Actual does on bulk category edits (Actual parity) before picking.
- When learning does create rules, the result says which ones.

Related: REE-137 (a hand-made category rule stops learning). Rules: docs/rules/rules-and-payees.md.

**Done when:** an MCP and a CLI call with `learn: false` on a scratch home create no rules, the bulk default is decided and recorded in rules-and-payees.md, and tests cover both.

Blocked: frozen by the owner, who wants to re-evaluate it (Mac overloaded). Branch REE-141/learn-false at 7321276 has master merged in and its e2e moved to the new pane; checks not verified yet.

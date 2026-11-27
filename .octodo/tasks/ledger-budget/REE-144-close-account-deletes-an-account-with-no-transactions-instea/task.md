---
id: REE-144
title: close_account deletes an account with no transactions instead of closing it
status: todo
priority: medium
tags:
  - bug
created: 2026-11-14T07:26:25.515Z
order: a4
---

From Reeve Bookkeeper (N26 cleanup). MCP close_account on two empty N26 Spaces returned deleted: true and removed them; accounts with rows closed normally. Risk: the next bank sync suggests the same accounts again.

Done when: closing an empty account keeps it as a closed account (or deletion is a separate, explicit op), on MCP, CLI and web; a test covers the empty-account case and a bank sync doesn't re-suggest a closed account.

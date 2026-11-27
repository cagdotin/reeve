---
id: REE-70
title: "Event log: what happened to each account and transaction, and why"
status: todo
priority: high
tags:
  - engine
  - ui
created: 2026-11-05T08:34:21.488Z
order: a5
---

A person cannot see what reeve did to their money, and neither can an agent debugging it. On 2026-11-05, explaining why an Erste account held lines from 2023 meant inferring the order of events from timestamps on rows. A second fetch started at 09:14:51 and left no finish and no failure, and nothing shows why.

## What it should record

An append-only event per account and per transaction, with when, what, what caused it (a person, a fetch, a rule, a schedule, an agent) and the before and after:

- **Bank:** consent given, renewed, ended. Link created, changed, removed, with its first day. Each fetch: started, finished, failed or abandoned, the range asked for, pages, and the counts of lines added, updated, unchanged, dismissed and in conflict.
- **Transactions:** created (from which fetch or file, or by hand), changed field by field, matched to a line and how (by id or by amount and day), deleted, restored.
- **Rules and categories:** which rule changed which transaction and when, and every category change, by whom.

## What it should show

- An events section on each account, and a history on each transaction, in the app.
- Operations for both, so the MCP server, the CLI and the HTTP API can read them when debugging.

## To decide

- Where it lives. The undo log is erased by upgrades and can be undone, and `seen_imports` deliberately stays outside undo, which suggests the same for events: undo must add an event, never remove one.
- How long events are kept, and what a backup and a restore do with them.
- No secret and no bank key in an event. Payee and note text from a bank is written by strangers, so it is data when an agent reads it.
- Record it as a decision in `docs/decisions/`.

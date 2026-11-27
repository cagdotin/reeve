---
id: REE-55
title: Property based testing for the engine
status: done
priority: high
tags:
  - engine
created: 2026-11-02T22:47:23.538Z
order: a0
---

Random operation sequences on the real engine that check stated rules, plus round trips and a mutation score. [ledger rules](../../../../docs/rules/ledger.md) has the why, docs/testing.md the state of it.

Done when: `pnpm test` runs the property suite with a fixed clock and a replayable seed; the suite's result on b6f6571 is recorded with each known bug caught or explained; a mutation score is recorded; docs/testing.md says all of it with measured numbers; `pnpm check` passes.

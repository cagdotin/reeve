---
id: REE-86
title: Freeze purchases behind a disabled capability and preserve its reconstruction reference
status: done
priority: medium
tags:
  - engine
  - ui
created: 2026-11-07T06:46:04.506Z
order: a5
---

Purchases is frozen behind source-controlled FEATURES.purchases=false. Public catalog filtering gates HTTP/OpenAPI, HTTP and stdio MCP, CLI, generated routes/skill and embedded execution; UI hides navigation, reports, register actions, settings and guards direct URLs. Retained implementation and enabled tests remain in place; compatibility callbacks, tables/migrations, undo, photos and backup/restore remain active. Added recovery of live photo files after undo and before backup so disabling receipt reads cannot strand files in trash. Specs: docs/specs/purchases-freeze.md, purchases-reference.md, purchases-needs.md; [purchases rules](../../../../docs/rules/purchases.md). Plugin versus built-in remains undecided. Verified: check:push (2022 tests), e2e with maxWorkers=4 (137 passed, 19 deliberately skipped), check:desktop. Default-concurrency e2e had a hot-reload navigation timeout; isolated retry and full four-worker rerun passed. All verification used scratch homes. No real-data changes. Follow-up: gated the Reports header's separate Item spending action and added a browser regression that failed before the fix and passed afterward at desktop and phone widths.

---
id: REE-79
title: Monte Carlo scrolls sideways on a phone
status: todo
created: 2026-11-05T17:41:00.676Z
order: a4
---

At 390px `/reports/monte-carlo` measures scrollWidth 618 against clientWidth 390 in the page's one scroller, before and after the migration.
AGENTS.md says no page scrolls sideways at 390. `findability.e2e.ts` misses it because it reads the document's width, not the scroller's.

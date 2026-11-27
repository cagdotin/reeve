---
id: REE-84
title: No test sees padding stacked inside a page's first child
status: todo
created: 2026-11-05T17:41:01.976Z
order: a9
---

The content-width test measures boxes, so a `p-3` on a page's first child passes it: I put Receipt's back and it stayed green.
A margin fails it. Only screenshots caught the old gaps, so a new one would pass `pnpm check`.

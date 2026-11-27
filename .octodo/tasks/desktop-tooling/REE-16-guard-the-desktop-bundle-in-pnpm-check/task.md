---
id: REE-16
title: Guard the desktop bundle in pnpm check
status: done
priority: high
tags:
  - testing
created: 2026-11-01T05:51:27.188Z
order: a4
---

`pnpm check` runs the TS sources in Node, so a dependency the tsdown bundle leaves out (like the rschedule createRequire bug) only shows when Electron starts. Add a step: build `apps/desktop`, fail if the bundles `require` anything other than node builtins, electron and the optional ws add-ons, and smoke-start `dist/server.mjs` against a scratch REEVE_HOME.

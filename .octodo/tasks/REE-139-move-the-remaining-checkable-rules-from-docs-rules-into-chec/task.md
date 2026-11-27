---
id: REE-139
title: Move the remaining checkable rules from docs/rules into checks
status: todo
priority: medium
tags:
  - tooling
created: 2026-11-10T08:24:59.055Z
order: ac
---

Each item is a rule written as prose in `docs/rules/` that a machine can check. Land the check, prove it fails on a probe, then delete the prose and leave an `Enforced by:` line.

- [ ] Every `SplitPanel` editor with a draft calls `usePaneTask`; every page that swaps the pane record goes through `usePaneLeave` (panes-and-alerts.md).
- [ ] `connect()` routing table: a client test drives each server.json row, including `ServerMismatch` and `ServerUnavailable` (boundaries.md).
- [ ] One server per home: a test starts two servers on one home and expects `HomeTaken` (boundaries.md).
- [ ] Ledger-side engine folders never import `receipts/` except through `compatibility.ts` (an oxlint rule; purchases.md).
- [ ] No raw `fetch(` and no direct `useQuery`/`useMutation` outside `apps/web/src/lib/api.ts` (boundaries.md).
- [ ] No hex, `rgb(` or palette classes in `apps/web/src` outside `components/brand/`, `chart-colors.ts` and `settings/objects.tsx`; first turn `reports/recent-transactions.tsx:14` and `routes/reports.tags.tsx:33` into tokens (look.md).
- [ ] Rules UI never says "fired" or "ran" (rules-and-payees.md).
- [ ] `useIsMobile(` outside routes only in `components/mobile/` or an allowlist (shell.md).
- [ ] Brand MDX imports nothing: no `^import` in `docs/**/*.mdx` (look.md).

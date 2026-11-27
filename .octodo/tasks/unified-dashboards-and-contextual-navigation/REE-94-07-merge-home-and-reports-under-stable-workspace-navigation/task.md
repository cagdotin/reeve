---
id: REE-94
title: 07. Merge Home and Reports under stable workspace navigation
status: done
priority: medium
tags:
  - ui
  - navigation
created: 2026-11-07T09:42:56.902Z
order: a7
blocked_by: [REE-88, REE-93]
---

## Outcome and scope

Make Home the single destination for Dashboards and Reports, subject to the approved labels. Remove the duplicate sidebar Reports destination. Keep both workspace tabs mounted on report details.
Add a dashboard selector for dashboard views and a searchable report selector for report details. Include an All reports escape destination. Keep a detail title available to assistive technology without redundant title blocks.
Use shared history controls, not an added page Back arrow. Preserve existing bookmarks with approved route aliases and query mapping. Keep report tags and all enabled report tools findable.
Update keyboard shortcuts, launcher search, mobile navigation, and active-state resolution from the same registry.

## Integration

lib/nav.ts, section-tabs.tsx, app-frame.tsx, page-slots.ts, page.tsx, report-shell.tsx, launcher and mobile/page-bar. REE-82 owns its animation regression. Settings/Docs keep their special sidebars. No Purchases reactivation.

## Acceptance criteria

Reports never removes the workspace tabs. Full report drill-down activates Reports; pane inspection does not. Every enabled page remains findable. Direct links without history have a clear navigation exit. No duplicate Home or default Reports labels.

## Verification

Navigation unit tests and findability E2E cover existing URLs, report tools, shortcuts, both selectors, reload, book switch, and mobile. Coordinate REE-82 tests, including return animation. Update layout decisions alongside the shipped change.

## Epic and dependencies

Read REE-87 for the agreed scope and exclusions. Blocked by REE-88, REE-93.

## Delivery rules

Each implementation slice must land in a working, verified state. Update decisions and relevant docs with the behavior they describe. Reinspect the current checkout, use scratch REEVE_HOME for verification, and preserve unrelated work. Implementation is now authorized. The parent orchestrator owns docs and decisions; task agents implement one scoped unit on master, verify it, update Octodo, and commit only task-owned changes. No nested agents or competing design exploration.

## Accepted interaction requirements

Alignment round 2 confirms a searchable report selector containing All reports, saved reports, and built-in report types. Each workspace remembers its last selected view during the session. Explicitly selecting a report loads its own settings, rather than carrying filters from another report.

## Implementation and verification

- `lib/nav.ts`: Home has the tabs Dashboards (`/`) and Reports (`/reports`, nested over every report, hotkey `r`). The Reports destination is gone. Tabs marked `resumes` link to the page of them this window last showed in the book (`lib/home-session.ts`, a memory store read through `useSyncExternalStore`); the sidebar's Home, the phone bar, `h`, `r` and the launcher use the same places.
- `/` is always the default dashboard and `/?dashboard=<id>` any other, so Back lands on the dashboard that entry showed. This departs from the handoff's "`/` shows the last dashboard", which broke Back; recorded in [reports rules](../../../../docs/rules/reports.md). An unknown id shows the default under an info alert.
- `Page` gained a `context` slot after the tabs ([shell rules](../../../../docs/rules/shell.md)). Dashboards put their selector menu there; every report page puts `ReportSelector` there: a coss combobox with search over All reports, saved reports (with their type) and the built-in library. Picking opens the report's own address with no carried filters.
- `/reports` is All reports (with New custom report). `/reports/library` redirects to `/reports`; `/reports?page=` to `/?dashboard=`.
- The fixed Home layout is gone. A book with no accounts shows Today under a "Start with an account" page alert. Report titles are no longer editable in the bar; built-in reports rename through a Rename action, custom reports through their Saved menu.
- REE-82: Reports keeps the tabs mounted, so Dashboards to and from a report slides the pill (tested). Purchases details still remount and stay REE-82's.

Verification: `nav.test.ts`, `home-session.test.ts`, `page-routes.test.ts` (every page under Reports names its report in the selector). New `home-navigation.e2e.ts` (8 tests): launch, Home and tabs resuming, `h` and `r`, reload starting over, direct link with Back disabled and no arrow, old addresses, selector search and saved reports, widget drill-down activating Reports, phone, shortcuts sheet, pill slide. Updated findability (reports reached through the selector's All reports), apps, dashboards, dashboard-widgets, page, docs, purchases-frozen, projections and age-of-money. Screenshots at 1440 and 390 in light and dark reviewed.

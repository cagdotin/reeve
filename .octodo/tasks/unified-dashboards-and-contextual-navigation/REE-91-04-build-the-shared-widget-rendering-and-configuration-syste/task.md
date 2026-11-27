---
id: REE-91
title: 04. Build the shared widget rendering and configuration system
status: done
priority: medium
tags:
  - ui
  - reports
created: 2026-11-07T09:42:56.233Z
order: a4
blocked_by: [REE-90]
---

## Outcome and scope

Consolidate widget support, names, sizes, configuration, rendering, and drill-down capabilities into a typed design consistent with the approved model. Reuse existing report components and arithmetic.
Render the same widget in a dashboard grid or constrained page region without duplicating business queries or report math. Keep host layout concerns outside report content.
Distinguish initial loading, empty results, failed initial load, stale data after failed refresh, and unsupported content. Local widget failures stay local unless genuinely page-wide. Preserve accessible names and reduced-motion behavior.

## Integration

components/reports/{widgets,widget-card,card-body,cards,dashboard-grid,widget-state}, lib/api.ts, Page and QueryBody. Coordinate widget query states with REE-81 rather than duplicating that bug task.

## Acceptance criteria

All currently enabled widget types still render and configure correctly. Widgets without full reports have meaningful actions rather than fabricated report routes. A failed widget does not blank its neighbors. Stable keys prevent unrelated widgets from remounting during edits.

## Verification

Component and browser tests cover an existing report widget, summary, and work-list host. Test initial error, retry, refresh error with kept data, empty results, unsupported type, Day/Night, and phone width.

## Epic and dependencies

Read REE-87 for the agreed scope and exclusions. Blocked by REE-90.

## Delivery rules

Each implementation slice must land in a working, verified state. Update decisions and relevant docs with the behavior they describe. Reinspect the current checkout, use scratch REEVE_HOME for verification, and preserve unrelated work. Implementation is now authorized. The parent orchestrator owns docs and decisions; task agents implement one scoped unit on master, verify it, update Octodo, and commit only task-owned changes. No nested agents or competing design exploration.

## Implementation and verification

`components/reports/widgets.ts` is the one registry of widget types (kind, default title, minimum size, add-menu entry, font-size support, content, target). `WidgetCard` renders any widget in the box its host gives it, with an error boundary per card. `WidgetQuery` and the pure `widgetState` tell first load, failed load with Retry, empty, and failed refresh over kept figures apart. Missing saved reports, unreadable settings and types without content say so and offer Remove instead of a report link. Report widgets link to `/reports/<type>?report=<id>`; the work list links to its records. Widget settings (title, font size, text) edit the placement; Edit saved report opens the report page, whose Save writes the linked definition.

Callers moved off projected meta: the cards read saved report definitions, report pages load and save the saved report, and the engine's legacy `meta` input and output are removed. `add_widget` creates and links a saved report in the same undo step when given `report` or no `reportId`. Font size left the summary and formula report pages for Widget settings. Fixed `add_widget` placement wrapping under the last widget instead of the tallest, which overlapped tall widgets. `recent-transactions` is the work-list reference widget and also renders Home's Latest transactions card.

Not done here: scoped execution stays guarded as unsupported (handoff appended to REE-100); the other Home widget bodies are REE-92 (handoff appended). REE-81 stays open for the remaining Home cards.

Verification: 2,020 unit tests pass, including `widget-state.test.ts` and the engine dashboard tests (new: linked report created on add and undone in one step; tall-widget wrapping). New `dashboard-widgets.e2e.ts` (8 tests) covers a report, a summary and a work-list widget at desktop and 390px in light and dark, initial failure with Retry while neighbours render, failed refresh keeping figures, empty results, unsupported type with Remove, and a settings edit that leaves another card mounted. Full browser run: 149 passed, 4 failed; the Age of Money failure was a real add-menu bug, fixed and re-run green with hot-reload (which had timed out under the concurrent run). account-scope.e2e.ts:194 and apps.e2e.ts:873 are REE-106. Scratch-home CLI `dashboard add` creates a linked report. Typecheck, lint, format, React Doctor and check:desktop pass. Screenshots reviewed at 1440 and 390 in both themes.

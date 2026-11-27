---
id: REE-81
title: Home's failed queries never say so
status: todo
created: 2026-11-05T17:41:01.239Z
order: a6
---

Home takes no `query`, so a failed card keeps its skeleton forever, or says "Nothing due in the next month" as if that were true.
Each card should tell waiting, empty and failed apart, and a failure belongs in a `PageAlert` ([panes and alerts rules](../../../docs/rules/panes-and-alerts.md)).

## Integration with unified dashboards

Related epic: REE-87. Coordinate with REE-91 shared widget states, REE-92 Home-to-widget conversion, REE-102 attention messages, and REE-103 release verification. This task remains the owner of the existing Home failure regression. Test the fix against both the current Home until replaced and its replacement widgets. Do not close solely because the old component is removed.

## Status after REE-92

Every Home card now goes through `WidgetQuery`: waiting, empty and failed are told apart per card, a failure shows in its card with Retry, and neighbours keep rendering (`home.e2e.ts`, "each Home card fails on its own and recovers on retry"). This places the failure in the card, not in a `PageAlert`, per [reports rules](../../../docs/rules/reports.md) (feedback stays within its task; PageAlert is page-wide). Left open for a call on whether that satisfies the original PageAlert wording, and for REE-102/REE-103.

## REE-102 ([panes and alerts rules](../../../docs/rules/panes-and-alerts.md))

REE-102 confirmed that a card's failure belongs in its card: [panes and alerts rules](../../../docs/rules/panes-and-alerts.md) and [reports rules](../../../docs/rules/reports.md) keep a widget's own message out of `PageAlert`. A failure of the dashboard's own query is still a page alert, through `Page`. The open question above is settled by that, so what remains here is REE-103's release check.

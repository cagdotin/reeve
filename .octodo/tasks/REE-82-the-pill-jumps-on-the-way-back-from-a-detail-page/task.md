---
id: REE-82
title: The pill jumps on the way back from a detail page
status: todo
created: 2026-11-05T17:41:01.476Z
order: a7
---

Coming back from `/receipts/x`, `/products/x` or a report, the tabs mount again, so the pill appears on its tab and does not slide.
Sliding between tabs is unaffected and tested (`apps.e2e.ts`). Keeping the last rect in the frame would make the return slide too.

## Integration with unified dashboards

Related epic: REE-87. REE-94 keeps workspace tabs stable on report details and REE-95 preserves history state. Coordinate the report-return regression with those tasks and REE-103. Purchases stays frozen. Do not reactivate receipt/product pages or assume the full issue is resolved merely because Reports no longer remounts tabs.

## REE-94 (2026-11-08)

Reports now sit under Home's tabs, so going between Dashboards and a report keeps the tabs mounted and the pill slides (`home-navigation.e2e.ts`). Purchases details still remount their tabs; that part stays here.

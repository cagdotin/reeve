---
id: REE-44
title: "Web UI: receipts list and editor, register badges and attach, products and price charts"
status: done
created: 2026-11-01T07:57:07.494Z
order: a6
---

Done (not committed). Routes: /receipts (list, filters, paging, New receipt, Auto-match), /receipts/$receipt (editor: photos with zoom/add/delete, header, inline lines with product picker + remember/applyToSimilar, item and budget category, reorder/delete, adjustments, live totals and warnings, payments + match suggestions, split preview and apply), /products (list, Unassigned lines, Price changes, Item categories dialog, New product), /products/$product (form, price chart per store, purchases, cheapest stores, aliases, merge/archive/delete), /reports/items (item_spending). Register: receipt mark per row (filled when applied) and a row menu with Attach receipt… / New receipt from the transaction. Components in apps/web/src/components/receipts and components/products. No engine changes.

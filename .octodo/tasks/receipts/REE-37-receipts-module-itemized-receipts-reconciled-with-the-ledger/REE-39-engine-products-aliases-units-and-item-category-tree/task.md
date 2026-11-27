---
id: REE-39
title: "Engine: products, aliases, units and item-category tree"
status: done
created: 2026-11-01T07:57:05.591Z
order: a1
---

Done. `products` (generic parent, base unit, size), `product_aliases` (store-scoped, normalised key, code, pack size, rejected), `item_categories` tree with default budget category. Fixed unit set with conversions in `contract/src/receipts.ts`. Alias auto-fill, suggest_products, assign_line_product (remember, applyToSimilar), merge_products, list_unassigned_lines.

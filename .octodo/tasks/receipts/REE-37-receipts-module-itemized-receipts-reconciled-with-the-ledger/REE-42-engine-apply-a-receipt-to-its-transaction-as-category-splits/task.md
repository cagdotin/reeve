---
id: REE-42
title: "Engine: apply a receipt to its transaction as category splits"
status: done
created: 2026-11-01T07:57:06.792Z
order: a4
---

Done. receipt_split_preview and apply_receipt_to_transaction via updateTransaction: one split per budget category, exact to the bank amount; ≤30% unclaimed on one receipt is spread, more stays on the current category (or remainderCategory); refuses unresolved lines naming them. One undo step. Rule in [purchases rules](../../../../../docs/rules/purchases.md).

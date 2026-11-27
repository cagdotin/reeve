---
id: REE-43
title: Receipt photos in a receipts folder (attach, serve, delete, backup)
status: done
created: 2026-11-01T07:57:06.983Z
order: a5
---

Done. Files at `<home>/receipts/<book>/<receipt>/<n>-<name>.<ext>` with `receipt_photos` rows; attach by path or base64; deletes go to `.trash` so undo restores them, pruned when no undo step mentions the receipt; book delete removes the folder; export_book copies to `<backup>.receipts`, restore_book reads it. Server streams `GET /api/books/:book/receipt-photos/:id/file`.

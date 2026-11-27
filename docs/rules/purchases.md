# Purchases

Purchases (itemized receipts, products, item categories, prices and item spending) is frozen. The
code, tests and data stay in the repo; no surface offers it. Ordinary purchases recorded as
financial transactions are not part of it and stay fully supported.

## Purchases is off, on every surface

`FEATURES.purchases` in `packages/contract/src/features.ts` is `false`. It is a source constant,
shared by the engine and the browser, with no environment override, book flag or setting that
turns it on. A stored `autoApplyReceipts` setting cannot enable it.

- The complete `catalog` keeps the receipt definitions for types and tests. Every public surface
  and generator reads `availableCatalog()`, which drops every receipt operation and the
  `update_book.autoApplyReceipts` input: HTTP and OpenAPI, MCP, the CLI, the skill, the browser's
  route table and `connect()`.
- The runner rejects a frozen operation before it opens a book, so a stale agent cannot reach it
  through embedded execution or stdio MCP.
- The web app offers no purchase entry point (navigation, shortcuts, palette, report library,
  register controls, Settings). `/receipts`, `/products` and `/reports/items` show Not found before
  any query mounts (`isPageEnabled`).
- Automatic receipt application checks the capability itself, not only the stored setting.

Enforced by: `packages/engine/test/purchases-frozen.test.ts`,
`packages/cli/test/purchases-frozen.test.ts`, `apps/web/src/lib/purchases.test.ts`,
`packages/e2e/test/purchases-frozen.e2e.ts`

## Do no purchase feature work

Whether Purchases returns built in or as a plugin is undecided, so nothing should presuppose
either.

- Leave purchase behavior, screens, data modeling and feature requests alone.
- Financial work may maintain the compatibility boundary below and fix regressions the freeze
  causes.
- Do not build a plugin registry or extension framework in advance. Move receipt source only to fix
  a proven boundary problem.
- Re-enabling is a product change in its own commit (flip the flag, run `pnpm catalog:generate`,
  run the retained suites), never a switch to set during other work.

## Legacy data stays intact

The ledger needs no receipt to read a transaction. An applied receipt split is an ordinary
balanced transaction: keep its postings, categories, amounts, cleared and reconciled state, and
let it be edited. The freeze never unapplies one and deletes no schema or user data.

- No ledger table or ledger file names a receipt. Receipt tables point at `transactions`, `payees`
  and category `accounts` by id; a financial deletion cascades or clears those references through
  the foreign keys.
- Ledger code reaches receipts only through `packages/engine/src/receipts/compatibility.ts`, called
  from `engine/src/operations.ts` and the book export (`imports/export.ts`, for photo files). It
  keeps references right when the ledger merges what they point at: payee merges carry receipts
  and aliases, a category deletion with a replacement carries receipt lines and item categories,
  and transaction merges and transfer formation carry payment claims.
- A rule that recategorizes existing transactions leaves alone those an applied receipt split
  (`receiptAppliedTransactions`). Removing that protection is a behavior change, not cleanup.
- Keep the migrations, receipt tables, undo triggers, photo storage, trash recovery and backup
  sidecars. Undo and redo reverse compatibility changes. `export_book` and `restore_book` keep
  receipt rows and photos.
- The compatibility code maintains references only. It must not grow into matching, itemization or
  automatic application.

Enforced by: `packages/engine/test/purchases-frozen.test.ts` (applied splits, recategorization,
merges with undo and redo, backup and restore)

## Frozen code still builds and its tests still run

Frozen source typechecks. The receipt engine tests mock the capability on and keep the historical
behavior; the frozen tests above prove the disabled state on older populated books. The receipt
browser suites run only with the capability on, so a skipped one is no evidence the enabled
product works.

## Where its history lives

- [Purchases freeze](../specs/purchases-freeze.md): the disabled behavior, the compatibility that
  stays active, and how to return.
- [Implementation reference](../specs/purchases-reference.md): the pre-freeze behavior and the
  baseline commit it describes.
- [Purchases needs](../specs/purchases-needs.md): confirmed intent and candidate jobs. Start here
  when Purchases comes back, not from the old screens.

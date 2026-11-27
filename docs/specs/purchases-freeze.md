# Purchases freeze

## Scope and outcome

Purchases is wanted in the future, but its product shape is undecided. Freeze it now so work can focus on reliable financial data. Preserve the implementation as a first-party module, its tests, and existing data. Choose neither a plugin system nor permanent built-in functionality in this change.

[Purchases rules](../rules/purchases.md) record the trade-off. [Purchases needs](purchases-needs.md) separates confirmed intent from candidate jobs. [Implementation reference](purchases-reference.md) captures the pre-freeze behavior and source revision for a later agent.

This is not a financial-core rewrite. Accounts, transactions, splits, transfers, reconciliation, budgeting, rules, schedules, imports, bank sync, targets, financial reports, books, and undo remain active. Ordinary purchases recorded as financial transactions remain supported; the frozen domain is itemization, receipts, products, item categories, price comparisons, and item spending.

## Capability and ownership

`packages/contract/src/features.ts` owns the source-controlled `FEATURES.purchases` capability, off by default. It is browser-safe and shared by all surfaces. There is no environment override, persisted book flag, or user-facing enable switch. Existing `autoApplyReceipts` settings cannot enable the capability.

The complete `catalog` retains frozen definitions for types and tests. `availableCatalog()` is the public view, excluding every operation in the receipt catalog and the `update_book.autoApplyReceipts` input. Server endpoints, connections, MCP, CLI, skill generation, and browser route generation use the public view. The runner also rejects frozen operations before opening a book. Definitions are not authorization to expose or execute them.

The module remains in its existing folders rather than moving source outside the workspace. It still typechecks and its tests still run. This deliberately retains some maintenance cost in exchange for an easier return. There is no runtime plugin registry or general-purpose extension framework.

## Disabled behavior

- Desktop and phone navigation, destination shortcuts, palette actions, report library, and recent selectable launcher actions offer no purchase entry points.
- Receipt, product, and item-report addresses answer with the app's normal Not found page before their components or queries mount.
- Register receipt marks, attach/open actions, dialogs, and receipt lookup requests are absent. Financial transaction entry and editing remain available.
- Receipt automation settings are absent from Settings and from public write schemas. Supplying the old input is an `InvalidRequest`, not silently ignored.
- Receipt, product, alias, item-category, price, item-spending, and photo metadata operations are not HTTP routes, MCP tools, CLI commands, or generated skill workflows.
- The binary receipt-photo endpoint is not registered. Frozen HTTP paths return the ordinary JSON API 404.
- Embedded execution and the connection used by stdio MCP reject frozen calls. A stale external agent cannot bypass the UI freeze.
- Automatic receipt application is gated independently of stored settings. No disabled purchase workflow rewrites financial postings.

Historical documentation remains readable and is marked as frozen where it describes superseded availability. Documentation is a reference, not an enabled product surface. Existing output settings retain the stored automation value for compatibility; it is not writable or effective while frozen.

## Compatibility that stays active

The ledger has no receipt foreign keys and needs no receipt to interpret a transaction. A receipt-applied transaction is still an ordinary balanced transaction. Preserve its postings, categories, amounts, cleared/reconciled state, and editability. Disabling purchases never unapplies it.

`engine/src/receipts/compatibility.ts`, called only by the composition root, names the retained cross-domain support:

- Payee merges carry receipt and alias references.
- Category deletion with replacement carries receipt-line and item-category references.
- Transaction merges and transfer formation carry payment claims, combining duplicate claims as before.
- Automatic rule recategorization still protects previously applied receipt transactions. Removing this protection is a separate behavioral decision, not cleanup for this freeze.

Foreign-key deletion behavior remains unchanged. A financial deletion may clear or cascade a legacy reference; frozen does not mean legacy rows are immutable. Undo and redo still reverse these changes. Compatibility reference maintenance must not become matching, new itemization, or automatic application.

Keep historical migrations, tables, undo triggers, photo storage, trash recovery, and backup sidecars.
Undo recovers live photo files from trash without requiring a purchase read; export also recovers
files left pending by older versions before copying photos. `export_book` and `restore_book` preserve receipt rows and files while disabled. Copying a backup's SQLite file without its `.receipts` folder still omits the photos. The freeze does not delete or relocate real user data and requires no schema migration.

## Freeze policy for agents

Financial-core tasks may maintain the compatibility boundary and fix regressions caused by the freeze. Leave purchase behavior, UX, data modeling, and feature requests deferred. A source move is justified by a proven boundary problem, not by a desire to build a plugin abstraction in advance.

Existing receipt engine tests explicitly mock the capability on; they preserve historical behavior. The dedicated frozen tests exercise the normal disabled state and older populated books. The receipt/product browser suites remain conditional on the capability, while the normal browser suite proves absence and continues financial workflows. A skipped enabled browser suite is not evidence that the future enabled product works.

## Acceptance gates

1. With the normal source flag off, every receipt-catalog operation is absent from HTTP/OpenAPI and MCP discovery, and unavailable through the engine and connection. CLI help has no purchase commands or automation flag.
2. On desktop and phone, purchase navigation, palette actions, register controls, reports, and settings are absent. Direct purchase addresses show Not found and produce no purchase API requests.
3. An older populated book opens with unchanged financial postings and stored configuration. Saving a categorization rule leaves previously applied splits alone.
4. Merges, category replacement, undo, and redo preserve the historical reference behavior while disabled.
5. Backup and restore preserve legacy receipt rows, photos, and ledger splits without enabling purchases.
6. The retained enabled engine tests pass. Format, lint, typecheck, normal tests, financial browser tests, and desktop bundle checks pass or their specific failures are recorded.
7. Generated routes and the skill match the disabled capability. No private fixtures or real-home verification are used.

Key regression suites are `packages/engine/test/purchases-frozen.test.ts`, `packages/cli/test/purchases-frozen.test.ts`, `apps/web/src/lib/purchases.test.ts`, and `packages/e2e/test/purchases-frozen.e2e.ts`.

## Returning later

Start with the needs document, not the old screens or operation count. Choose a small useful workflow and a representative synthetic acceptance example. Use the reference and baseline commit to recover behavior worth preserving. Decide storage ownership, ledger integration, and migration before choosing packaging.

For a developer-only enabled investigation, change the source capability in a separate change and run `pnpm catalog:generate`, then the retained unit and browser suites. Server and web builds must use the same capability revision. Re-enabling is a product change requiring review, not a switch to set during unrelated finance work. No future binary or data compatibility is promised merely by retaining historical interfaces.

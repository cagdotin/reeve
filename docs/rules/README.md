# Rules

`RULES.md` at the repo root links here.

How reeve is built and how it behaves, one topic per file. Read the row that matches what you are
about to do, then only that file. Each file says what holds today; when the code changes, change
the file in the same commit. Never add a file that only records a change: edit the rule.

A rule that a machine can check lives in the check, not here. Its error message says what to do:

- `.oxlintrc.json`: import boundaries (package direction, the browser bundle, what a route may use).
- `scripts/check-rules.ts` (`pnpm check:rules`): generated files, migrations, Effect's pin, dialogs
  on the Accounts tabs, page alerts, doc links, this index.
- The tests: the ledger's properties (`docs/testing.md`), every surface's input parsing, and the
  web app's structure (`apps/web/src/lib/*.test.ts`, `packages/e2e/test/findability.e2e.ts`).

| When you are about to                                                                                                   | Read                                                                           |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Decide whether reeve should have a feature, or behave differently from Actual Budget                                    | [docs/rules/scope.md](scope.md)                                                |
| Touch the engine, the contract or a handler: books, accounts, categories, money, dates, the register shape              | [docs/rules/model.md](model.md)                                                |
| Add or change an operation, a package import, a schema migration, undo, the HTTP API, the server, the client or the CLI | [docs/rules/boundaries.md](boundaries.md)                                      |
| Change how edits, deletes, merges, reconciliation or imports treat existing transactions                                | [docs/rules/ledger.md](ledger.md)                                              |
| Change the budget, its arithmetic, carryover, or budget targets                                                         | [docs/rules/budget.md](budget.md)                                              |
| Change rules, payees or schedules                                                                                       | [docs/rules/rules-and-payees.md](rules-and-payees.md)                          |
| Change bank sync, bank files, imported payees or the counterparty's account                                             | [docs/rules/bank.md](bank.md)                                                  |
| Change Home, dashboards, a report, a drill-down, or what follows the account scope                                      | [docs/rules/reports.md](reports.md)                                            |
| Go near receipts, products or anything Purchases                                                                        | [docs/rules/purchases.md](purchases.md)                                        |
| Add or change a page, navigation, the sidebar, the bars, the phone layout, Settings, Docs or a picker                   | [docs/rules/shell.md](shell.md)                                                |
| Add a details or edit form, a dialog, or something a page tells the person; touch the account scope                     | [docs/rules/panes-and-alerts.md](panes-and-alerts.md)                          |
| Write code in any package: comments, TypeScript syntax, UI kit components                                               | [docs/rules/code.md](code.md)                                                  |
| Pick a color, a font, a radius, or touch the brand                                                                      | [docs/rules/look.md](look.md)                                                  |
| Learn which process and package does what                                                                               | [docs/architecture.md](../architecture.md)                                     |
| Add a test, or a property of the ledger                                                                                 | [docs/testing.md](../testing.md)                                               |
| Work deep in bank sync or payee derivation                                                                              | [docs/bank-sync.md](../bank-sync.md), [docs/bank-payees.md](../bank-payees.md) |
| Bring Purchases back or change its freeze                                                                               | [docs/specs/purchases-freeze.md](../specs/purchases-freeze.md)                 |
| Make a logo, an icon or a brand asset                                                                                   | [docs/brand/README.mdx](../brand/README.mdx)                                   |

# Purchases needs, deferred

## Confirmed intent

Personal itemized purchases are wanted later. reeve focuses on finance now, so purchases, receipts, products, and item categories are frozen and hidden rather than developed further.

The freeze is not a decision to discard existing purchase data. Existing books, ledger splits, and receipt attachments need to remain compatible. The retained implementation is a reference, not the approved design of a future product.

No plugin architecture is decided. A built-in module, a plugin, or another form remains open. The source-controlled `FEATURES.purchases = false` capability belongs to the freeze implementation. It is not a user preference or a commitment to a future extension system.

[Purchases implementation reference](purchases-reference.md) records what existed at the pre-freeze baseline. Its entities, operations, screens, defaults, and arithmetic describe current choices, not confirmed future requirements.

## Candidate jobs to validate

These jobs come from the retained implementation. They are candidates for future discovery, not requirements confirmed by the freeze request.

- Keep an itemized record of a personal purchase, with its original evidence.
- Reconcile what a receipt says with the transaction or transactions that paid it.
- Use purchased items to divide spending among budget categories without changing the bank amount.
- Recognize the same product when stores print different names or package sizes.
- Find what an item cost before and compare comparable prices at stores.
- Find unfinished itemization work without making routine budgeting harder.

Inventory, equipment tracking, shopping lists, OCR, and model integration are not confirmed scope. Historical documents mention some of these as possible extensions, not delivered capabilities or promises.

## Criteria for returning to the work

These are proposed review criteria, not a delivery date or an instruction to re-enable the feature.

- The person using reeve chooses which purchase jobs matter and supplies representative, non-private acceptance examples.
- Finance work has room for the chosen scope and its maintenance cost.
- A small end-to-end workflow demonstrates value before the old operation list or screens become a backlog.
- The chosen design explains its ledger boundary, ownership of existing data and files, undo behavior, and backup and restore behavior.
- A scratch-book compatibility check proves that the design preserves old books and already-applied ledger splits.
- Enabled behavior has tests, while the default-disabled build still hides entry points and rejects unavailable operations consistently.

## Deferred decisions

- Whether purchases returns as built-in functionality, a plugin, or another application.
- Which candidate jobs return first, and which old capabilities are omitted.
- Whether the receipt, product, alias, and item-category model remains useful.
- Who extracts receipt contents and what, if any, automation belongs inside reeve.
- How much matching, category assignment, and ledger rewriting can happen without confirmation.
- How future purchase data is stored, migrated, exported, and removed.
- Whether older operation names and URLs become supported interfaces again.

Nothing in these notes authorizes deleting retained tables, migrations, photos, tests, or compatibility hooks during the freeze.

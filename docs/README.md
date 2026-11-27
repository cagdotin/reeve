# reeve docs

[The rules index](rules/README.md) (`RULES.md` at the repo root) says which file to read for what
you are about to do. Beside the rules:

- [architecture.md](architecture.md): which process and package does what.
- [testing.md](testing.md): what the tests cover, and how to add a property test.
- [bank-sync.md](bank-sync.md) and [bank-payees.md](bank-payees.md): bank sync and payee derivation
  in depth.
- [specs/](specs/purchases-freeze.md): Purchases' freeze, its history and its future needs, and the
  [bank line provenance](specs/bank-line-provenance.md) plan (`explain_transaction` and
  `rebuild_transactions`, REE-126 and REE-127).
- [brand/](brand/README.mdx): logos, icons, brand colors and type.

Each doc says what holds now. When the code changes, the doc changes in the same commit.

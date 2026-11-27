---
id: REE-142
title: Apply matching rules after a payee rename, and offer them on transactions that match but aren't applied
status: done
priority: medium
tags:
  - feature-request
  - rules
  - engine
  - ui
created: 2026-11-12T17:48:25.594Z
order: a6
---

From the owner, 2026-11-12, after a bank sync. Example: Spar, -4.20, notes "Spar Dankt 1234". the owner renamed Spar Dankt 1234 to Spar after it came in. Today the Groceries rule ("payee is one of ... Spar ... set category to Groceries") matches it, and the panel's "How it got here" replay gives Groceries, but the category step is struck through and the row still says Categorize. Not a sync bug: rules ran on arrival, when the payee was not yet Spar, and nothing runs them again after the rename or the new rename rule.

## What the owner wants

1. **Follow the rename.** When a payee is renamed or merged, or a rename rule is added (Spar Dankt 1234 to Spar), the category rules that hold for the new payee also run on the transactions that changed payee, if they are still uncategorized.
2. **Matching but not applied.** Transactions show when a rule matches them but its change is not on them (the panel already knows: the struck-through replay line), and one button applies those rules to all of them in bulk, as one undo step, instead of categorizing them one by one.

## Notes

- Check Actual first (Actual parity): what it does on a payee rename or merge, and its "apply rules" action on selected transactions. reeve already has `apply_rules` and `transaction_rules`, so this is mostly where it is surfaced and when it runs.
- Decide whether hand-set categories are ever overwritten (default: only uncategorized ones), and record it in docs/rules/rules-and-payees.md. A rule "matches", it never "ran" or "fired" (same doc).
- Related: REE-137 (rules in the transaction panel), REE-141 (learn: false on bulk edits), REE-124 (look-alike payees after a fetch).

**Done when:** on a scratch home, renaming an imported payee to one a category rule names categorizes its uncategorized transactions; the transactions list shows how many match rules that are not applied, with one action that applies them as a single undo step; tests and the rules doc cover both.

Result: merged to master in 6bbe475 (with doc fix b8496da). Rules apply after a rename or merge, plus an Apply rules action.

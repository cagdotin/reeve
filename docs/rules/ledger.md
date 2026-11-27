# Ledger

What a write to the ledger must preserve, and what the register adds up for an account. The model
itself (postings, accounts, the register shape) is in [model.md](model.md). The stated rules below
are checked after every step of random operation sequences;
[testing.md](../testing.md#property-coverage) holds the numbered table, and the rule numbers here
refer to it.

## Rewriting postings continues the old ones

Each new posting takes the id, cleared and reconciled marks, memo and place of the old posting on
its account, on any side of the transaction. A reconciled posting goes on with the same account and
amount, or the write fails. A cleared mark and a memo stay until a write names them; `memo: null`
clears a memo.

Enforced by: `continuedPostings` in `packages/engine/src/ledger/transactions.ts`,
`packages/engine/test/properties/properties.test.ts` (rules 3, 7)

## Saying a transaction again writes nothing

An edit that restates what the transaction says (an amount, a category, a transfer account or split
lines, from any side) writes nothing and takes no undo step. A split's amount needs its lines given
again only when the amount changes. A transaction with two postings on one account has no single
register line, so a register edit of it from that account is refused; `postings` changes it.

Enforced by: `packages/engine/test/properties/register.test.ts`

## A starting balance stays on Opening Balances until a person names a category

The register reads it as a category nobody can pick, and the web app's editor shows it and sends it
back. A line may stay on a system account the transaction already posts on; no other write may name
one, so `create_transaction` and edits of other transactions refuse Opening Balances. Departure from
Actual: Actual books a starting balance to an income category, so it never meets this.

Enforced by: `packages/engine/test/properties/register.test.ts`

## A transfer's category lives on the off-budget posting

It is set from the budget account's side. Naming one from the off-budget side is refused, and a
rule's category does not apply there (it writes nothing rather than refusing the transfer). From the
budget side, naming the transfer it already is keeps the category; only moving the transfer, naming
a category, or giving postings or splits again changes it. A category needs a transaction that
touches the budget: a transfer between two off-budget accounts cannot carry one. A row an older book
already has stays readable and loses its category on its next register edit.

Enforced by: `packages/engine/test/properties/properties.test.ts` (rule 8)

## A category named in `create_transaction` stays

A rule fills the category only when it is left out, and learning sees the pick. Imports and
schedules still take what the rules say.

Enforced by: `packages/engine/test/properties/properties.test.ts` (rule 9)

## A rule never refuses a write

Rules know nothing of each other or of the entry they meet, so what they make of its money may not
be writable (an amount that does not fit its splits, an account a transfer already goes to, a
reconciled posting). `addEntry` and `apply_rules` then keep that money as it was and the rest of
what the rules did, such as a payee, stands. A rule never deletes a reconciled transaction.
`apply_rules` lists what changed by the end of the run; rules run on each side of a transfer, and
the sides may disagree, as Actual's two transactions may.

`apply_rules` twice equals once only for rules that set fixed values on fields no condition reads.
`append-notes` and `prepend-notes` add on every run, as in Actual, and a rule that feeds another's
condition may need a second run, because rules run once each in rank order.

Enforced by: `packages/engine/test/properties/properties.test.ts` (rule 10),
`packages/engine/test/properties/apply-rules.test.ts`

## A rule that splits leaves an existing split alone

Departure from Actual: its `execSplitActions` splits again. reeve's rule never saw the lines'
categories, so a second split would put them on Uncategorized and undo a split a person made.

Enforced by: `packages/engine/test/properties/apply-rules.test.ts`

## Deleting a reconciled transaction takes `confirmReconciled`

The engine refuses without it on every surface, so an agent must ask the person; the web app asks
in a dialog. Undo still reverses a confirmed delete. Departure from Actual: its engine leaves this
confirmation to its interface.

Enforced by: `deleteConfirmed` in `packages/engine/src/ledger/transactions.ts`,
`packages/engine/test/properties/properties.test.ts` (rule 3)

## A merge keeps both copies' agreements

`merge_transactions` needs a shared account and amount. An uncategorized kept copy takes the other's
category, split or transfer. Marks the dropped copy had stay, and so does a cleared mark on the line
the kept copy gives up when what it takes posts on that account. A merge refuses to lose a reconciled
posting: when both copies are reconciled on the shared amount, or when the dropped copy has a
reconciled posting elsewhere and the kept copy has its own category. The kept copy takes a reconciled
mark only on the posting of the shared amount. A confirmed delete is the way past it.

Enforced by: `packages/engine/test/properties/properties.test.ts` (rules 3, 12)

## What a book points at exists

Postings, transactions, budgets, notes, and rules' conditions and actions name only ids that exist.

- `create_rule`, `update_rule` and `create_payee_rename_rule` refuse an account, category, group or
  payee that is not there. `update_rule` still accepts a name the rule already had, so a rule from an
  older book stays editable, and a rule naming a missing category is ignored when it runs.
- Deleting a category into another repoints its rules; deleting it outright takes it out of them, as
  deleting a payee does; a deleted group takes the rules that need it.
- A transfer or journal entry cannot count against Uncategorized or any system account.
- Closing an empty account takes it out of the rules that name it and removes its note. An empty
  account a schedule names stays, closed.
- `set_note` needs an account, a category, a group or a budget month. Deleting a group takes its note.
- `delete_schedule` unlinks the transactions it posted. `move_budget` answers `NotFound` for a missing
  category.

A test that needs a rule naming something missing writes it to the file with `writeOlderRule` in
`packages/engine/test/helpers.ts`.

Enforced by: `packages/engine/test/properties/properties.test.ts` (rule 4),
`packages/engine/test/ledger-integrity.test.ts`, `packages/engine/test/found-by-properties/`

## Learning only touches rules for "payee is X"

Departure from Actual: its learning also rewrites "payee is not X" rules, which would turn a rule for
every other payee into X's category.

Enforced by: `packages/engine/test/properties/properties.test.ts` (rule 13)

## An import matches the closest row and transaction across the file

Departure from Actual, which matches in file order: there a row a day off could take the transaction
another row matches exactly, so importing the file again added that other row twice. Among equally
close pairs the same notes come first.

Enforced by: `packages/engine/test/properties/imports.test.ts`

## Property tests go through operations

- Property tests use `fast-check` in `packages/engine/test/properties/`. They run random sequences
  through `call(name, input)`, as every surface does, and check the stated rules after every step.
- Setup and steps never read or write around an operation; a check may read tables. Not a direct
  write to set up state: it reaches states no person can reach, and the bugs worth finding sit in
  sequences of edits. Rule 10's copy of the book in another scratch home is the one exception.
- The clock is fixed, so a seed replays a failure exactly.
- A failure a run finds becomes an ordinary test, from the shortened sequence, in
  `packages/engine/test/found-by-properties/`.
- State a new ledger guarantee as a rule in `properties/rules.ts` and a row in
  [testing.md](../testing.md), not only as an example test. Line coverage is not the target: the
  suite is measured by the known bugs it catches (`pnpm benchmark:properties`) and its mutation score.

## The register says where an account stands

`account_activity` (`packages/engine/src/ledger/account-activity.ts`) gives an account, the budget or
off-budget accounts, all of them, or the uncategorized queue its month-end balances, in and out by
month, largest categories and payees, a projection and what needs tidying. It runs apart from
`list_transactions`, so the table never waits for it. Keep its subqueries uncorrelated: correlated,
the same work is an order of magnitude slower.

- In and out count only category lines: income, spending and refunds cross the book's edge.
  Everything else is `transfers` or `opening`, so `in - out + transfers + opening` is always the
  balance's change. A transfer inside the scope cancels out; a transfer across the budget that names
  a category stays a transfer here, though the budget counts it.
- A transaction's category lines belong to the balance postings on the side their net faces, shared
  by amount. A journal entry's shares are rounded per group, and `transfers` takes up the cent.
- The sign is the register's everywhere: a debt is a negative balance, drawn below zero. A card's
  tiles say Charges, Refunds and Payments, since a payment is a transfer.
- A comparison needs a whole previous period; with part of one, any period would look like growth.
- The projection covers two months past this one, from `forecastBalances`, and holds schedules only.
  Missed occurrences stay out. A closed account's schedules count only on its own page.
- Attention checks are real or absent: Uncategorized is not asked of off-budget accounts; old
  uncleared means over 30 days; reconciling is checked only for one account that has been reconciled
  before and has cleared rows since.
- The address param `check` (`uncategorized`, `stale`) holds what the Filter menu has no words for,
  and hides the running balance like any filter.
- The uncategorized view is a queue: how many wait, how old, how much. Its count is not a balance.
- The chart reaches every recorded month, so a far-future row is never left off.
- `update_transactions` takes `accountOf`, the account each id is seen from, so a selection across
  accounts is one operation and one undo step.

Enforced by: `packages/engine/test/account-activity.test.ts`

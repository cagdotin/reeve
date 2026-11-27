# Testing

What reeve's tests cover, how property testing works here, and what is left to do. Decision
[ledger rules](rules/ledger.md) has the why.

## Suites today

| Suite      | Where                              | Run with                                    | Size (2026-11-03)                         |
| ---------- | ---------------------------------- | ------------------------------------------- | ----------------------------------------- |
| Unit       | `packages/*/test`, `apps/*/src`    | `pnpm test`                                 | 1,824 tests, 31 s with the property suite |
| End-to-end | `packages/e2e/test/*.e2e.ts`       | `pnpm test:e2e`, 4 files at a time          | 37 files, about 3 min                     |
| Property   | `packages/engine/test/properties/` | `pnpm test`, longer: `pnpm test:properties` | 75 runs, up to 40 steps each, 15 s        |
| Mutation   | `stryker.config.json`              | `pnpm test:mutation`, by hand               | 3,280 mutants, 71.89%, 92 min             |

## Frozen purchases

Purchases is disabled in the normal product ([purchases rules](rules/purchases.md)). Existing receipt engine suites and
the receipt-based input/recategorization suites explicitly mock the capability on to preserve
historical behavior. Financial tests otherwise use the normal disabled capability. The receipt
and product browser suites are conditional on the source capability; source-enable and regenerate
the catalog before running those workflows. They are not evidence for a working enabled browser
build while skipped.

`purchases-frozen.test.ts` in the engine and CLI test folders verifies disabled operations, public
schemas, HTTP/MCP/CLI discovery, old populated books, applied splits, reference maintenance, undo,
and backup/restore with photos. `apps/web/src/lib/purchases.test.ts` and
`packages/e2e/test/purchases-frozen.e2e.ts` verify hidden entry points and guarded direct links,
including no purchase queries from the register on desktop or phone.

## Property coverage

Each run starts a fresh book in a scratch home, runs a fixed setup through operations, then random
steps. The rules are checked after every step, setup included, and a setup step that is refused fails the run. A check may read tables; setup and
steps never do.

| Rule                                                                                                                                                                                                | Checked by (`properties/rules.ts`)                          | Status |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------ |
| 1. Every transaction has 2+ postings and sums to zero.                                                                                                                                              | `transactionsBalance`                                       | holds  |
| 2. For each month m of the budget's range, in an envelope budget: on-budget postings through m = To Budget(m) + hold(m) + expense category balances(m) + Uncategorized through m.                   | `everyCentHasAPlace`                                        | holds  |
| 3. A reconciled posting keeps its account and amount, until a delete with `confirmReconciled` or a merge that hands its mark to a posting of the same account and amount.                           | `reconciledPostingsStay`                                    | holds  |
| 4. Postings, transactions, budgets, notes, and rules' conditions and actions point at what exists.                                                                                                  | `referencesExist`                                           | holds  |
| 5. A refused operation changes nothing, undo's bookkeeping included.                                                                                                                                | `refusalChangedNothing`                                     | holds  |
| 6. Undo restores the whole database, redo reapplies it. Each write is crossed both ways on the spot, and an undo or redo step must land on the state remembered for that depth of the undo stack.   | `restored`, and the `Timeline` in `properties/run.ts`       | holds  |
| 7. A cleared mark stays until a write names it, on every side of a transaction.                                                                                                                     | `clearedMarksStay`                                          | holds  |
| 8. A transfer's category stays while the transfer crosses the budget, from either side, until the budget side names another, the postings or splits are given again, or the category goes.          | `transferCategoriesStay`                                    | holds  |
| 9. A category named in `create_transaction` is the category it gets, whatever rules match.                                                                                                          | `pickedCategoryStays`                                       | holds  |
| 10. A rule never makes `create_transaction` or `import_transactions` fail: a refused one must also be refused on a copy of the book without its rules. A rule's own delete action may still refuse. | `noRuleRefuses`                                             | holds  |
| 11. Rollover in a month is what the latest `set_carryover` at or before it said, in every month, also past the budget's range.                                                                      | `rolloverAsSaid`, with what was said kept in the `Timeline` | holds  |
| 12. A merge needs a shared account and amount. The kept copy keeps its counter postings, or takes the dropped copy's when it is uncategorized, and the shared posting stays cleared if either was.  | `mergeKeepsBothCopies`                                      | holds  |
| 13. A write about a transaction changes only rules for "payee is X" that set a category, which learning owns.                                                                                       | `onlyLearningRewritesRules`                                 | holds  |

Rule 4 also refuses a posting whose category is a system account. The dump for rules 5 and 6 is every table, rowids included. Rule 6 leaves out `undo_log` and
`undo_state`, which undoing has to change, and the tables undo must not touch: `seen_imports`,
`bank_connections` and `bank_links` ([bank rules](rules/bank.md)). A separate test checks that every other table but
`__migrations` has undo triggers, covering tables no step writes.

Separately, an operation may refuse with `InvalidRequest` or `NotFound`, but any other failure, `StorageError` included, fails the run. `StorageError` means a handler hit something it did not expect.

Rule 10 is the one check that writes around an operation. It does so on a copy of the file, in another scratch home, so the book under test never sees it.

Rule 2 does not cover a tracking budget, which has no To Budget to compare. No step switches the budget
type.

Rules 1 to 6 were proven able to fail by breaking the code, as below. Rules 7 to 13 are proven by the known bugs they catch, in [the table below](#known-bugs-caught).

| Rule | Break                                                                                       |
| ---- | ------------------------------------------------------------------------------------------- |
| 1    | `checkPostings` skips the balance check; separately, allows fewer than two postings         |
| 2    | `computeBudget` forgets last month's overspending; the view drops transfers in from income  |
| 3    | `deleteConfirmed` ignores `confirmReconciled`; `continuedPostings` lets a reconciled change |
| 4    | deleting a category or a payee leaves its rules alone                                       |
| 5    | `inTransaction` commits on failure                                                          |
| 6    | `UNDONE_TABLES` loses a table; statements reverse in the wrong order; undo records no redo  |

## Round trips and pure functions

The op suite above draws sequences. These properties draw one thing and check one statement about it, each in
its own file in `packages/engine/test/properties/`. The ones that touch the engine go through operations on a
fresh scratch book. [Ledger rules](rules/ledger.md) say what they changed.

| File                     | Runs    | What holds                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `receipts.test.ts`       | 600; 25 | `allocate` hands out exactly the total in whole cents, each share within a cent of its exact part. `lineAmount` is the product of two decimals, rounded half away from zero, midpoints included. A receipt's difference is what an adjustment needs. A split plan places every cent and reads back as applied, through `apply_receipt_to_transaction` as well. |
| `register.test.ts`       | 20      | An entry reads back as entered, in its postings and its row. Restating what a transaction says changes no posting from any side, starting balances, splits and transfers included. A new amount on one line moves its two postings and nothing else.                                                                                                           |
| `imports.test.ts`        | 20      | A second import of the same file adds nothing and changes nothing, for CSV, OFX, QIF, CAMT and rows, with or without bank ids, with rules that rename, categorize, add notes or delete, and with rows that compete for one transaction. A file that reuses a bank id merges into its first row, so for it only "adds nothing" holds.                           |
| `imports.test.ts`        | 12; 3   | An account's CSV imported into an empty account gives the same money on the same days. Imported back into its own account, a CSV without splits adds nothing. A book's backup restores every row and reads the same through operations.                                                                                                                        |
| `compute-budget.test.ts` | 300     | Envelope: every cent has a place; assigning, moving, spending, income, rollover, an overspent rollover and a hold each move what they should and nothing else; a group is the sum of its categories. Tracking: saved is income plus spending; without rollover a month stands alone; with it a balance is all that was given and spent; a hold means nothing.  |
| `tracking.test.ts`       | 15      | In a tracking book, through operations, saved in a month plus Uncategorized is what the budget accounts gained.                                                                                                                                                                                                                                                |
| `apply-rules.test.ts`    | 20      | Twice is once for rules that set fixed values on fields no condition reads, splitting rules included. A rule never makes it refuse, whatever it does to the money.                                                                                                                                                                                             |

`apply_rules` twice is not once for every rule. `append-notes` and `prepend-notes` grow on every run, as in
Actual's `action.ts`, and a rule that feeds another's condition takes a second run, because the rules run once each
in rank order. `apply-rules.test.ts` states both cases as ordinary tests.

What export then import keeps is stated narrowly, because a CSV is not a backup: the same money on the same days.
A split parent comes back as a zero-amount row with its lines beside it, a transfer comes back uncategorized, the
formula guard adds `'` to a payee that starts with `=`, `+`, `-` or `@`, and the Category column is guessed to be the
group's (`categoryField` picks another). Only the backup, `export_book` then `restore_book`, keeps every row.

Each was proven able to fail. A script applied one break at a time to the current code, ran the file, and restored
the code. Of the 41 breaks below, 38 were caught by these properties at the default runs on the default seed.

| Property                  | Breaks caught                                                                                                                                                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Receipt arithmetic        | `allocate` keeps the leftover cents; gives them all to one share; `lineAmount` rounds down; multiplies floats; `receiptTotals` flips the difference; `planSplit` forgets the tip when spreading; `isPlanApplied` ignores the remainder; `isApplied` expects the tip spread |
| Register                  | a starting balance refused; memos lost on an amount edit; the own posting moved first; a restating edit rewrites postings; an entry loses split memos; a row's split lines take the wrong sign; a category allowed on a transfer outside the budget                        |
| Imports                   | every row added; a merge always reports a change; a match overwrites notes; matching in file order; alike rows swapped by notes                                                                                                                                            |
| Export and backup         | export writes tenths; a backup leaves rules out                                                                                                                                                                                                                            |
| `computeBudget`, envelope | an overspent balance carries; last month's overspending forgotten; a hold never returns; assigning raises To Budget; rolled income not held; rollover reads this month; a group sums the wrong column                                                                      |
| `computeBudget`, tracking | income balance adds activity; carries without rollover; saved subtracts spending; budgeted saved adds expenses; the view drops opening balances from income                                                                                                                |
| `apply_rules`             | a set action appends; every write reported as a change; what cannot be written is written; a side that is gone is run on; a rule replaces a split                                                                                                                          |

The other three were caught by the ordinary tests in `found-by-properties/`, as those runs do not reach them: a rule's category on
a transfer that cannot carry it, a category on a transfer that never touches the budget, and keeping a transfer's
category when an edit from its far side leaves the budget. The properties found them at 1,000 runs.

These files take 4.4 s on the clock at the default runs, side by side, and 12.8 s added up test by test (3 runs, 12.7
to 12.8 s, one machine). At 1,000 runs on a random seed they take about 7 minutes.

Not covered:

- A CSV export's splits and transfers coming back as they were, which they do not.
- A register edit of a transaction with two postings on one account, which stays refused from that account.
- Receipt photos, products and aliases.
- The web app's editor, beyond one end-to-end test of a starting balance.

## Known bugs caught

The benchmark puts each bug the [ledger rules](rules/ledger.md) guard against back on the current
code, one at a time. Each patch
is a file in `packages/engine/test/properties/known-bugs/`, and `bugs.ts` there names the test that must
fail with it applied. The third column is the first six rules alone, at 300 runs on the default seed, before
the rules and setup below it existed. The last two are today's suite with a budget of 300 runs on seeds
20261102, 1, 2, 3 and 4. "-" means not caught.

| Bug | What it does                                                                 | Six rules (rule, runs) | Caught by rule   | Runs, default seed | Most runs, 5 seeds |
| --- | ---------------------------------------------------------------------------- | ---------------------- | ---------------- | ------------------ | ------------------ |
| K1  | Editing a transfer from the budget side wipes the other side's cleared mark  | missed                 | 7                | 7                  | 63                 |
| K2  | The same edit wipes the other side's reconciled mark and changes its amount  | 3, 67 runs             | 3                | 39                 | 39                 |
| K3  | Editing a transfer from the off-budget side drops the category               | missed                 | 8                | 55                 | 271                |
| K4  | `update_transaction` with empty postings leaves a transaction with none      | 1, 14                  | 1                | 10                 | 16                 |
| K5  | `update_transaction` with postings changes a reconciled posting              | 3, 34                  | 3                | 39                 | 39                 |
| K6  | Deleting a category leaves rules naming it                                   | 4, 7                   | 4                | 14                 | 14                 |
| K7  | A rule naming a missing category makes new transactions and imports fail     | missed                 | none             | -                  | -                  |
| K8  | A rule's category replaces the one picked on `create_transaction`            | missed                 | 9                | 3                  | 4                  |
| K9  | A transfer from an off-budget account is refused when a rule sets a category | missed                 | 10               | 14                 | 67                 |
| K10 | Rollover stops in a month past the rows `set_carryover` wrote                | missed                 | 11               | 4                  | 5                  |
| K11 | `merge_transactions` merges different amounts or accounts                    | 3, 15                  | 12               | 6                  | 19                 |
| K12 | A merge loses the dropped copy's category, split or transfer                 | missed                 | 12               | 6                  | 6                  |
| K13 | Learning rewrites a "payee is not X" rule                                    | missed                 | 13               | 7                  | 9                  |
| K14 | Deleting a reconciled transaction needs no confirmation                      | 3, 3                   | 3                | 7                  | 16                 |
| K15 | A rule can delete a reconciled transaction                                   | 3, 103                 | 3                | 14                 | 22                 |
| K16 | A rule can name what does not exist                                          | 4, 7                   | 4                | 72                 | 72                 |
| K17 | A transfer can count against Uncategorized                                   | 2, 284                 | 4                | 3                  | 20                 |
| K18 | A merge loses a reconciled posting                                           | 3, 7                   | 3                | 1                  | 4                  |
| K19 | Closing an empty account leaves its rules and note                           | 4, 121                 | 4                | 10                 | 26                 |
| K20 | `set_note` writes a note on nothing                                          | missed                 | 4                | 6                  | 11                 |
| K21 | `delete_schedule` leaves its transactions linked to nothing                  | 4, 89                  | 4                | 6                  | 7                  |
| K22 | `move_budget` fails in storage for a missing category                        | failure, 133           | a `StorageError` | 14                 | 14                 |

K7 cannot be caught. K6 and K16 closed the way in, so no sequence of operations leaves a rule naming a
missing category, and [ledger rules](rules/ledger.md) keeps steps from writing one behind the operations. Its ordinary test in
`ledger-integrity.test.ts` stays.

The default of 75 runs catches the other 21 on the default seed. A seed that catches a bug at run 72 says little
about the next seed, as the last column shows: a reintroduced bug can need more than 75 runs on a random
seed, which is what `pnpm test:properties` is for.

`SETUP` in `properties/steps.ts` puts what these bugs need in every book: transfers whose far side is marked, two
copies of a purchase, a habit with one payee, a rule for every other payee, and an empty account with a rule and a
note. Random steps then pick those on purpose part of the time. Without this, K3, K12, K13 and K17 took 70 to 260
runs on the default seed.

At the default of 75 runs the file takes 15.2 s (5 runs, 15.14 to 15.48 s, one machine). At 750 runs it takes 137 s, so
time grows with the run count.

The run counts move when a generator's weights change, since the same seed then draws other steps. Rerun the
benchmark after such a change and set `DEFAULT_RUNS` in `properties/budget.ts` to the largest count on the
default seed.

## The suite on b6f6571

On commit `b6f6571`, the commit before the fixes in [ledger rules](rules/ledger.md), the suite fails within four runs on all of
30 seeds. First failures on those seeds: rule 3 on 8, rule 9 on 5, rule 12 and rule 4 on 4 each, rule 13 and rule 7 on 3 each, and rules 1, 10 and 11 on 1 each. Rules 2, 5, 6 and 8 never fail first, and the stop at the first failure hides any later ones. `confirmReconciled` does not exist there, so the script removes it from inputs
before they reach the operation. Otherwise every confirmed delete would be refused and rule 3 would see fewer
of them. The suite's own files are otherwise unchanged. The script links `fast-check`, which came after that
commit, into the temporary worktree.

## Rerun the benchmark

- To measure the known bugs, run `pnpm benchmark:properties`. It takes about 2.5 minutes at one seed and a
  budget of 300 runs. Add `--seeds 20261102,1,2,3,4` for the table above (8 minutes), or `--only K3,K12` for
  some bugs.
- To run the suite on the old commit, run `pnpm benchmark:properties --commit b6f6571 --seeds 30`.

The script works on temporary copies and a temporary worktree, never on the source tree. It exits 1 if a patch
stops applying, if a patch applies and its test still passes, if the suite fails with no bug put back, or if a
reachable bug is missed. Add a new known bug as a patch and an entry in `bugs.ts`.

## Write operations

The generator covers 50 of the catalog's 106 write operations. The report of `pnpm test:properties`
derives both lists from the catalog and the keys of `STEP_KINDS`, with how often each operation ran and
why it was refused. A run of 500 or more fails if a covered operation never succeeds.

Not covered (56):

- Receipts, products, aliases and item categories (29).
- Templates and targets (6).
- Dashboards, widgets and custom reports (12).
- Tags (4).
- Books: `create_book`, `update_book`, `set_default_book`, `delete_book`, `restore_book` (5).

## Run and replay

- `pnpm test` runs 75 runs at a fixed seed, so it never fails by chance.
- `pnpm test:properties` runs 2,000 at a random seed, and the files of [round trips and pure functions](#round-trips-and-pure-functions) at that count too. `REEVE_PROPERTY_RUNS` and `REEVE_PROPERTY_SEED`
  set either one, and `random` is a seed.
- A failure prints the seed, the rule, the step and the shortened sequence. To replay it, pass that
  seed with at least as many runs: `REEVE_PROPERTY_SEED=<seed> REEVE_PROPERTY_RUNS=<runs> npx vitest run packages/engine/test/properties`.
- The printed sequence leaves out `SETUP` in `properties/steps.ts`, which runs first.
- Replay is exact: only `Date` is faked, at 2026-06-15, and `crypto.randomUUID` numbers its ids. A test
  runs one sequence twice and compares each step's outcome and a hash of the final database.

A failure a run finds becomes an ordinary test in `packages/engine/test/found-by-properties/`.

## Mutation

`pnpm test:mutation` runs Stryker with the Vitest runner on `packages/engine/src/ledger`, `rules.ts` and
`receipts.ts`. Reports go to `reports/mutation/`, which git ignores.

It is an audit of the tests, run by hand. A full run takes about 1.5 hours, so nothing runs it by itself: not
`pnpm check`, a git hook or CI.

**Next run:** once the gaps below are closed (REE-67), run it again and record the new score here. Until then a new
run would mostly repeat the same list.

`REEVE_MUTATION_PROPERTIES=0` leaves the property suite out.

### Score

Measured on 2026-11-03 on commit `6d9675b`, before the REE-58 fixes, so these numbers predate them. Config:
`stryker.config.json` and `vitest.mutation.config.ts`, concurrency 6, 75 property runs at the default seed.

| Target          | Mutants | Score  | Killed | Timeout | Survived | No coverage | Score without property suite |
| --------------- | ------- | ------ | ------ | ------- | -------- | ----------- | ---------------------------- |
| All             | 3,280   | 71.89% | 2,330  | 28      | 718      | 204         | 70.18%                       |
| `engine/ledger` | 2,260   | 75.18% | 1,697  | 2       | 524      | 37          | 72.96%                       |
| `rules.ts`      | 507     | 53.65% | 249    | 23      | 77       | 158         | 52.47%                       |
| `receipts.ts`   | 513     | 75.44% | 384    | 3       | 117      | 9           | 75.44%                       |

Score is (killed + timeout) / mutants. Each column but the last comes from one full run.

### Run time

| Run                                         | Wall time | CPU      | CPU per tested mutant |
| ------------------------------------------- | --------- | -------- | --------------------- |
| Full, with the property suite               | 92m27s    | 36,903 s | 12.0 s                |
| Full, without the property suite            | 56m35s    | 23,050 s | 7.7 s                 |
| `rules.ts` alone, with the property suite   | 20m17s    | not kept | not kept              |
| Rerun with `--incremental`, nothing changed | 1m16s     | 100 s    | 3,280 of 3,280 reused |

Each row is one run, on an 8-core Mac shared with another agent, with load averages of 3 to 16. Time for
`receipts.ts` alone and `ledger` alone was not measured. Time for an incremental run after a real change was not
measured. No run has been timed on a GitHub runner.

The limiter is probably importing test files, which is inferred and not profiled. A covered mutant has 9.3 test files
covering it on average. One engine test file measured once took 1.29 s, 66% of it import, so about 0.85 s per
file. That gives 7.9 s per mutant against the 7.7 s measured, before bail and test time. The
property suite adds 4.3 s per mutant on average. The Vitest pool does not matter: on `payee-insights.ts`, three
alternating runs each took 118 s with threads and 120 to 121 s with forks, with the same score every time.

### What moves the number

- **Stryker's sandbox hides the contract.** It links each package's `node_modules` from the real tree, so
  `@reeve/contract` reaches unmutated source. Before the aliases in `vitest.mutation.config.ts`, 48 of 48 sampled
  `rules.ts` mutants showed no coverage. After them, the same 48 scored 74.47%.
- **Stryker's tsconfig step crashes on TypeScript 7** (`ts.parseConfigFileTextToJson is not a function`).
  `tsconfigFile` names a file that does not exist, which skips it.
- **A short timeout inflates the score.** An earlier full run scored 74.51% with Stryker's default `timeoutMS` of
  5,000 and a load average of up to 16. Of its 145 timeouts, 109 survived in the run above, with `timeoutMS` at
  60,000. `rule-references.ts` fell from 83.76% to 70.09%. That earlier run also left out the tests of `apps/web`
  and the other packages, so the two runs differ in more than the timeout.
- **What repeats.** `rules.ts` run alone detected 270 mutants against 272 in the full run, 53.25% against 53.65%, with
  12 timeouts against 23. Six runs of `payee-insights.ts` gave the same counts. No other target was repeated on
  this config.

### Survivors

A sample of 30 of the 718 survivors, drawn at random with a fixed seed. One reader sorted them by reading the code.
Only the first gap below was proven by running it.

| Kind       | Count | Examples                                                                                        |
| ---------- | ----- | ----------------------------------------------------------------------------------------------- |
| Real gap   | 24    | `categories.ts:193`, `accounts.ts:151`, `transactions.ts:586`, `rules.ts:22`, `register.ts:203` |
| Equivalent | 2     | `receipts.ts:268` (the next line returns the same 0.8), `account-activity.ts:281` (inferred)    |
| Noise      | 4     | `accounts.ts:133` (a payee label), `receipts.ts:265`, `receipts.ts:324`, `register.ts:57`       |

So the sample points at missing tests more than at mutants no test could kill. The 204 no-coverage mutants were
grouped by function and not read one by one.

The top gaps, by what a person budgeting would lose:

1. **Deleting a category group could delete other groups' categories, and no test would notice** (`categories.ts:193`). The code is right today. With the filter removed, a
   scratch book went from 8 categories to 0 where the real code leaves 7, and `categories.test.ts` and
   `ledger-integrity.test.ts` still passed. The tests check only that the deleted group is gone.
2. **Typing an amount** (`rules.ts`). `evaluateArithmetic` (96), `parseAmount` (27) and `groupDigits` (15) have 138 of
   `rules.ts`'s 158 no-coverage mutants. `parseAmount` reads the web app's typed amounts, so a wrong result enters
   the wrong money without a word.
3. **An update that changes nothing** (`accounts.ts:151`, `categories.ts:124`, `payees.ts:87`). `update_account` can
   ignore `onBudget`, so an account stays in the budget after a person takes it out. No ordinary test calls
   `update_account`. A property step does, and no rule checks the result.
4. **Merging duplicates** (`transactions.ts:586`, `587`, `598`). A merge can lose the imported id, so a later import
   may bring the transaction back, or lose a cleared mark. Rule 12 states the mark, yet 75 runs miss the mutant.
5. **Moving money between kinds** (`categories.ts:158`). Deleting an expense category can move its postings to an
   income category.
6. **Impossible days** (`rules.ts:22`). `isCalendarDay` can accept 2026-02-31.
7. **The budget itself** (`rules.ts:362`). 12 mutants survive in `computeBudget`, one of them the rollover of an
   income category in a tracking budget.

### What the property suite adds

It detects 56 mutants nothing else detects, 1.71 points overall: 50 in `ledger` and 6 in `rules.ts`, none in
`receipts.ts`. The two runs agree otherwise, since no mutant was detected only without the suite. It also reaches 83
`ledger` mutants that no other test covers (no coverage falls from 120 to 37), though 63 of those survive it. The
test credited with kills is the one random-operations test, with 54 of the 56. The other 2 are timeouts that
survive without the suite.

It earns its 15 s in `pnpm test`, modestly. It costs 39% of a mutation run's wall time here, and most of what it can
detect one mutant at a time the ordinary tests detect already. A mutant is a single edit at 75 runs, so this
does not measure sequences of edits, which [the known-bug table](#known-bugs-caught) does.

### No threshold

The suite has no score threshold, as nothing runs it by itself. The timeout setting alone moved the score by more than
the repeats above do.

## Nightly

`.github/workflows/nightly.yml` runs `pnpm test:properties` every night at a random seed, and prints the seed first. It
does not run mutation. The workflow has not run on GitHub yet.

Long runs find what the 75 runs of `pnpm test` do not. `REEVE_PROPERTY_SEED=734219 pnpm test:properties` broke rule 7 at
run 1440 on `6d9675b`: a merge took a cleared mark off the line it replaced. The same seed then passed after the REE-58
fixes, though the bug was still there, because they changed the path the run takes. The shortened sequence still failed.
So replay a failure's sequence, not only its seed, before calling it fixed.

`packages/engine/test/bank-sync-converges.test.ts` is not a property test by this page's terms yet:
it drives random fetches, deletes and undo from a seeded generator of its own, and checks that a
second fetch finds nothing to do. It moves onto the harness when that lands.

## Plan

The epic is REE-55 on the board.

1. **Harness and six rules (REE-56).** Done.
2. **Known-bug benchmark (REE-57).** Done. The suite catches every known bug that operations can reach.
3. **Round trips and pure functions (REE-58).** Done. They found eleven bugs, in decision
   [ledger rules](rules/ledger.md).
4. **Mutation score (REE-59).** Done. Stryker on the ledger, `rules.ts` and `receipts.ts`, run by hand, and a nightly
   job for long property runs, which has not run on GitHub yet.
5. **Close the gaps the mutation run found (REE-67).** Then run `pnpm test:mutation` again and record the score.

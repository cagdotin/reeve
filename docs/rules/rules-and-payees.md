# Rules, payees and schedules

Transaction rules change transactions as they arrive; payees and schedules lean on rules (a
schedule lives on its rule). This file covers what saving a rule does to history, how learning and
hand-written rules coexist, and what the Rules, Payees and Schedules pages promise.

## Saving a rule's category recategorizes what it matches

People use rules as their category mapping ("payee is Lidl → Groceries") and expect history to
follow a correction. So `create_rule`, and an `update_rule` that gives the rule a category it did
not name before (added, or different), put that category on every existing transaction the saved
conditions match. Nothing else about those transactions changes, and none of the rule's other
actions run.

- The rule's category is `ruleCategory` in `contract/src/rules.ts`, shared by engine and web app:
  the last `set` on `category`, naming a category outright. A template or formula, a clear
  (`null`), or a split (any action with `splitIndex` above 0) gives the rule no category. Changing
  only conditions, stage, the and/or join or other actions recategorizes nothing; neither does a
  fixed category turned into a template. A template turned into a fixed category does.
- Matching is `matchingRows` with the conditions as saved, as `preview_rule` and `apply_rules` use;
  the write goes through `applyActions`, `writeBack` and `updateTransaction`, the `apply_rules`
  path. It overrides categories set by hand (that is the point) and reaches reconciled
  transactions, whose account posting keeps its id, amount and marks. Transactions that already
  carry the category are not counted. Other rules are not run.
- Left alone: splits (their lines carry the categories, as `apply_rules` keeps them), transfers
  (rewriting one resets the other leg's marks, and the off-budget side refuses a category), and
  transactions an applied receipt split. The rules module never reads receipts: `operations.ts`
  passes `receiptAppliedTransactions` to `create_rule`, `update_rule` and `preview_rule` (legacy
  data under the [purchases freeze](../specs/purchases-freeze.md)). Non-transfer transactions on
  off-budget accounts are recategorized.
- Saving and recategorizing is one SQLite transaction, one undo step, one feed change, in the
  handler, so every surface behaves the same. The result is the rule plus `recategorized` (ids).
- `recategorize: false` opts out, for callers setting up rules for future transactions only
  (otherwise undo would take the rule with it). The web app's "Save and apply" passes it, since
  applying every action already sets the category.
- `preview_rule` with `category` answers `recategorizes`, counted over every account by the same
  code with nothing written. The rule editor shows "Saving will set Groceries on N existing
  transactions" (or "M existing transactions match. Saving will set Groceries on N of them"), and a
  toast after saving. "Save and apply" stays the only way to apply a rule's other actions (renames,
  notes, splits, computed categories) to history; its tooltip says it applies all of them.

Departure from Actual: Actual only applies every action of a rule on request ("apply actions",
reeve's `apply_rules` with `rule`). That rewrites payees, notes and amounts too, which is too much
for correcting a mapping.

Enforced by: `packages/engine/test/rules-recategorize.test.ts`

## A rename lets the new payee's category rules fill in uncategorized transactions

Rules run when a transaction arrives, so a payee renamed later (Spar Dankt 4802 to Spar) leaves its
transactions uncategorized although Spar's category rule now matches them. reeve fills them in:

- After `update_payee` gives a new name, `merge_payees`, a saved rule that sets a payee
  (`create_rule`, `update_rule`, `create_payee_rename_rule`), and `apply_rules` with a rule or
  actions ("Save and apply"), the uncategorized transactions involved get the category today's
  rules give them: the payee's (the target's, for a merge), the ones the saved rule matches, or the
  ones just applied to. Same undo step as the change. A saved rename rule renames nothing in
  history ("Save and apply" does): the rules run in memory, so a transaction it matches gets the
  category the renamed payee's rules give it while keeping its old payee.
- `pending_rule_categories` lists every uncategorized transaction today's rules would categorize;
  `apply_rule_categories` writes them in one undo step. The register shows the count as an info
  `PageAlert` with **Apply rules**.
- One helper does all of it (`engine/src/rules/pending.ts`): every rule runs on the transaction as
  it is now (`runRulesOn`, as on arrival), and only the category it ends on is written, with
  `learn: false`. Payee, notes and other actions are not written.
- Never a category set by hand: only transactions on budget accounts whose one other posting is
  Uncategorized. Splits, transfers and off-budget accounts are left alone. Unlike saving a rule's
  category (above), this runs without the person asking about that rule, so it only fills gaps.

Departure from Actual: Actual runs no rules after a rename or merge; its register's "Run rules" on
selected transactions writes every action and overwrites categories.

Enforced by: `packages/engine/test/rules-after-rename.test.ts`,
`packages/e2e/test/pending-rules.e2e.ts`

## A category rule written by hand stops learning

Learning (`updateCategoryRules`, as Actual's) rewrites a `payee is X → set category` rule once 3 of
the payee's latest 5 transactions share another category. A rule a person wrote has that shape, so
`create_rule` and `update_rule` call `stopLearning`: when the rule sets a category, every payee its
`payee is` or `payee is one of` conditions name gets `learnCategories = false`, in the same undo
step. Turning the switch back on (`update_payee`) hands the rule back to learning.

Learned rules go through the store, not the handlers, so a learned rule never recategorizes
history and never turns learning off. Keep it that way: do not route learning through
`create_rule`/`update_rule`. A rule saved from a "payees worth a rule" suggestion turns learning
off too, since the person chose it.

Departure from Actual: Actual keeps learning on after a person writes the payee's category rule,
and its learner then rewrites that rule. reeve leaves it as written.

Enforced by: `packages/engine/test/rules.test.ts` ("learning categories")

## A match is not a firing

reeve keeps no log of rules running. Every surface says a rule "matches" (what its conditions match
today, which can predate the rule), never that it ran, fired or changed something. All matching
over existing transactions uses `rowMatches`, the same code as `preview_rule`, including the split
lines rule: `rule_activity`, `transaction_rules` and the rule editor agree because they share it.

Enforced by: `packages/engine/test/rule-activity.test.ts` ("agrees with preview_rule for every
kind of condition"), `packages/e2e/test/rules.e2e.ts`

## The panels show the rules behind an item

`transaction_rules` reconstructs what the rules did by replaying today's rules (`runRulesOn` with a
hook that sees each rule that ran) on the transaction as it arrived. An imported transaction starts
from the bank's `imported_payee`, date and amount (`seen_imports`) with no category, transfer,
split or schedule; one entered by hand starts as it is, minus its category. Each rule that changed
something is listed in run order with each change (from, to) and whether the transaction still
carries it. `matching` lists rules whose conditions match the transaction as it is now.

It is an explanation, not a record: it shows what today's rules do, and notes a rule appended show
as appended again.

- The transaction panel shows "How it got here" and "Also matches now", and **Add a rule** opens
  `payee is <payee> → set category <the picked category>` in the same panel; unsaved editor
  changes are asked about first, and saving or cancelling returns to the transaction.
- The payee panel lists the rules naming the payee (`list_rules` with `payee`) and **Add a rule**
  opens `payee is <payee> → set category` with the category left blank. While the payee learns, it
  says adding a category rule turns learning off.

Departure from Actual: Actual has no view of the rules behind a single transaction.

Enforced by: `packages/engine/test/transaction-rules.test.ts`,
`packages/e2e/test/related-rules.e2e.ts`

## Payees keep their rules honest

- Deleting a payee deletes the rules that need it: a `payee is X` condition means nothing once X is
  gone, and dropping only the condition would widen the rule. A list of payees only loses X, and
  the rule goes when the list empties. An action that sets X goes, and the rule with it when that
  was its last action. Undo brings payee and rules back.
- A payee a schedule's rule names cannot be deleted, completed schedules included: change the
  schedule's payee first.
- `update_payee` refuses a name another payee has, ignoring case. An agent calls `merge_payees`;
  the page offers to merge.
- Payees have a `description`, as categories do.

Enforced by: `packages/engine/test/payees.test.ts`

## A schedule's rule keeps what the schedule owns

`loadSchedule` reads payee, account, amount and date from the rule's conditions, and only
`update_schedule` resets the next date when they change. So `update_rule` refuses, for every
client, changes to those four conditions, the link-schedule action and the all-conditions join;
extra conditions, actions and the stage stay editable, as Actual allows. `update_schedule` writes
the rule itself. The rule editor shows the owned parts read-only and points at Schedules;
duplicating the rule drops the link.

Enforced by: `update_rule` in `packages/engine/src/rules/handlers.ts`,
`packages/engine/test/rule-activity.test.ts`

## The Rules page

`rule_activity` gives each rule, in run order, its matches in a range, per month over twelve months
and over all time, its last match and what is wrong with it, plus coverage and the payees most worth
a rule. It loads the register rows once and indexes them by payee, account, category and group, so
only a rule with nothing to index scans.

- Checks: _conflict_ (same conditions, any stage, two different plain categories); _duplicate_
  (same stage, same conditions in any order and text in any case, same actions in the same order);
  _quiet_ (no match in twelve months, leaving out a schedule's rule and rules that delete or change
  a field their conditions read); _disagrees_ (most of its five latest categorized matches carry
  another category); _stale_ (names a hidden category or group, a closed account or something
  deleted); _uncategorized payees_ (two or more uncategorized transactions in twelve months that
  no category rule matches). A schedule's rule is never a duplicate. "Matches nothing in the
  range" is only a filter, since a yearly bill's rule is fine.
- Coverage leaves out transfers and opening balances. "Uncategorized" counts as the register's
  Uncategorized view does.
- Payees worth a rule: three or more recent transactions no category-setting rule matches; one
  click opens the editor with the majority category, or none without a majority.
- Stage is order: the table runs in stage order under headings. A rule reads as If and Then
  columns that stack when narrow.
- Deleting confirms and says transactions stay as they are; a schedule's rule in the selection
  stays. "Save and apply" on a rule that deletes transactions asks again, naming how many.
- The editor keeps every field, operator and action; actions it cannot edit (split amounts) stay as
  removable sentences.
- `preview_rule` also gives the number of distinct transactions matched (what the editor and
  delete wording use); `total` counts register rows. "Open in register" appears only when the
  register's filters can say the same as the rule.
- Account-number suggestions show here as an info `PageAlert`; see [bank](bank.md).

Not detected: conflicts between different conditions (a broad rule against a narrow one), which
would need a simulation of the stage order.

Enforced by: `packages/engine/test/rule-activity.test.ts`, `packages/e2e/test/rules.e2e.ts`

## The Payees page

`payee_activity` gives each payee its transactions and spending since a day, its last transaction,
its categories, how many rules name it, whether a schedule does and whether its plain category
rules repeat, plus attention counts over the whole book whatever the range. `list_payees` stays
plain for the pickers.

- The page starts on the last month and loads one more month per button press; a payee with no
  transactions shows only under all time. Filtering and sorting run in the browser.
- A summary compares the range with as many days before it, over twelve months. Then the open
  checks (gone when all pass, and the summary says "All clear"), top payees, and changes.
- A price change counts only when the last two charges agree on an amount never charged before,
  within half of the one before. A payee is regular when used across five or more months, and quiet
  after 30 days and two and a half usual gaps.
- A duplicate here is a plain "payee is X → set category" rule setting the same category as
  another; Payees counts payees, Rules counts rules.
- The filters and column headers stick above the rows; the columns fold on the page's container
  width down to payee, transactions and last transaction, with the rest in the edit panel. Not
  `WideTable`: a sticky header cannot sit inside a table that scrolls sideways.
- Look-alike merges and following imports on rename: see [bank](bank.md).

Enforced by: `packages/engine/test/payees.test.ts`, `packages/e2e/test/payees.e2e.ts`

## The Schedules page

`schedule_activity` gives each schedule its open occurrences in a window, expected amount, cost per
month, recent charges and whether they differ, and totals the next twelve months. Dates come from
`recurrence.ts`, status from `status.ts`, prices from the payees page's `latestPriceChange`, the
projected balance from `forecast_balances` unchanged.

- A monthly cost is the rate while it runs, not the next twelve months (that would make a bill
  ending soon look cheap). Days and weeks always land (every two weeks is 26 a year); a month or
  year date that may not (the 31st, a leap day) counts the real dates of a 28-year cycle. One-offs,
  recurrences with no date left and schedules on closed accounts cost nothing a month; a range
  counts its middle.
- A charge is a linked transaction, or an unlinked one of the same payee and account within two
  days of a date and within half of the expected amount, with the recurrence stretched back before
  the schedule. A near match is evidence, not a link: it does not change status.
- Checks: _charged differently_ (the payees price test with the expected amount as the price
  before; `isapprox` and `isbetween` also count three charges in a row outside it on one side),
  _gone quiet_ (two or more dates since it began, the first at least 14 days ago, no charge after
  the last; skips count, since reeve records none), _ending soon_ (within 45 days), _no account_.
- The time view is plain HTML bars on one scale, in above and out below, a segment per schedule
  floored at 2px; the balance is a strip under the days, not an overlay. Missed dates stay out of
  it, as `forecast_balances` leaves them out.
- Find schedules is a card over `find_schedules`, leaving out candidates a schedule covers, loaded
  as its own query. Hiding a candidate is per book in browser storage (losing it only shows the
  candidate again).
- Skip is not offered on a one-off, nor Post without an account. Delete confirms and says the
  schedule and its rule go while transactions keep their `schedule_id`.
- The editor keeps and writes back every field: all three amount ops, patterns, weekend side, end
  modes, date match and notes.

Enforced by: `packages/engine/test/schedule-activity.test.ts`,
`packages/e2e/test/schedules.e2e.ts`

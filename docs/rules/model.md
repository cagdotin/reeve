# Model

The domain every engine or contract change works in: books, the double-entry ledger under Actual's
budget model, and a budget computed from it. Actual stores single-entry transactions with an
optional category; reeve keeps people's terms (accounts, categories, transfers, splits, a monthly
budget) and gives the same budget numbers from balanced postings.

## A book is one SQLite file in the home

A book is `<home>/books/<id>.sqlite`. `<home>` is `REEVE_HOME`, else `$XDG_CONFIG_HOME/reeve`, else
`~/.config/reeve` (`defaultHome` in `packages/engine/src/home.ts`). `<home>/config.json` names the
default book. An operation that takes `book` uses the default when `book` is left out, or is `~` in
an HTTP path. The first call without a book creates "My Budget".

## A transaction is two or more postings that sum to zero

A positive amount is a debit. Balances, reports and the budget are queries over one table of
postings, so nothing is kept in step and nothing goes stale after an edit. Every write path checks
postings the same way: at least two, balanced, and a category only where the next section allows it.
An unbalanced transaction cannot be written.

Enforced by: `checkPostings` in `packages/engine/src/ledger/transactions.ts`,
`packages/engine/test/properties/properties.test.ts` (rule 1 `transactionsBalance`)

## Every account is a row of `accounts` with a type

- `asset` / `liability`: what people call accounts (checking, a card). `on_budget` says whether
  the budget covers it; a check constraint allows it on these two types only.
- `expense` / `income`: the budget's categories, each in a `category_groups` row.
- `equity`: the system account "Opening Balances" (`system = 'opening'`), the counterpart of an
  account's starting balance.
- The system expense account "Uncategorized" (`system = 'uncategorized'`) takes register lines
  without a category. The budget does not count it as a category; `get_budget` reports its count and
  amount separately.

The book makes each system account itself on first use (`systemAccount` in
`packages/engine/src/book.ts`); `system` is unique. A system account is never a category: no
posting may name it in `category_id`, and it is neither parent nor child.

## A transfer from the budget may count against a category

A posting on an off-budget asset or liability, in a transaction that also touches a budget
account, may carry `category_id`: the category that transfer counts against, as Actual lets such a
transfer have a category. Only such a posting may name one, and the category must be a real
income or expense category.

Enforced by: `checkPostings` in `packages/engine/src/ledger/transactions.ts`,
`packages/engine/test/properties/properties.test.ts` (rule 4 `referencesExist`)

## Categories nest inside groups, and each one is its own envelope

Actual has two levels: groups that only total, and categories that hold money. reeve keeps groups as
headers with no money, and lets a category nest under another (`accounts.parent_id`) so a broad
category keeps its place while finer ones sit under it.

- A child is in its parent's group and of its parent's type, with no cycles. The depth counts
  category levels inside a group, up to the book setting `categoryDepth` (default 3, at least 1,
  where 1 is flat as Actual). Creating or moving past it fails, and so does lowering it below the
  deepest existing nesting.
- Every category, parent or child, can be budgeted, spent from and carried over. `computeBudget`
  knows nothing of nesting; To Budget and group totals are sums of every category's own figures.
- `get_budget` gives each category a rolled-up `total` of itself and its descendants
  (`rollUpCategories` in `packages/contract/src/rules.ts`). It is for display only: never sum
  `total` again, or money counts twice.
- A category and a group may carry a `description` of what belongs in it.
- `list_categories` gives each group's categories as one flat array in tree order (pre-order,
  siblings by `sortOrder`), each with `parentId`, so a consumer that ignores `parentId` sees a flat
  list.
- `move_category` moves a whole subtree; `delete_category` moves children up to the deleted
  category's parent, in its place. Hiding is a flag per category; clients treat a category under a
  hidden one as hidden (`hiddenCategories`).
- Every descendant carries its group's id, so group-wide features (a rule on `category_group`,
  `apply_group_templates`, `#cleanup <group>`) cover every depth. Per-category features stay per
  category; `categorySubtree` is where "this category or any below it" would start.

Enforced by: `packages/engine/test/categories.test.ts`, `packages/engine/src/ledger/categories.ts`

## Money is integer cents; days and months are strings outside, integers inside

Money is an integer of minor units. A day is `YYYY-MM-DD` in the contract and the integer
`YYYYMMDD` in the database; a month is `YYYY-MM` / `YYYYMM`.

## The register shows postings on balance accounts

`list_transactions` shows each posting on an asset or liability account, with the transaction's
other postings as its counterpart: a category, a transfer account, or a split. Register inputs
(`create_transaction`, `update_transaction` with `account`) take that shape: a signed amount as the
account sees it (negative leaves the account), plus a category, a transfer account or split lines.
`entryPostings` in `packages/engine/src/ledger/transactions.ts` turns an entry into postings and
`draftFrom` reads a transaction back from one account's side. Rules run on this shape before it
becomes postings. `create_journal_entry` takes raw postings on any accounts.

What edits must keep and what the register adds up: [ledger.md](ledger.md).

## The budget is computed, never stored

`budgets` holds only what a month assigns to a category (per budget type, with the `carryover`
flag, goal and long goal), and `budget_months` the money a month holds for the next. Both are keyed
by budget type, so switching between envelope and tracking keeps each.
`packages/engine/src/budget/view.ts` reads activity from the ledger and hands it to
`computeBudget` in `packages/contract/src/rules.ts`.

- Only transactions that touch a budget account count. A category's activity is the postings on its
  account plus the off-budget postings that name it in `category_id`.
- Money that enters the budget without an income category (opening balances, transfers from
  off-budget accounts without a category) counts as income.

The arithmetic and the budget's operations: [budget.md](budget.md).

Enforced by: `packages/engine/test/properties/properties.test.ts` (rule 2 `everyCentHasAPlace`)

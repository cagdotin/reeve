# Budget

The monthly budget, envelope (Actual's default, zero-based) or tracking, and the targets that fill
it. The budget is computed from the ledger and never stored ([model.md](model.md)).

## `computeBudget` is Actual's arithmetic as a pure function

`computeBudget` in `packages/contract/src/rules.ts` computes every month from the one before, as
Actual's envelope and tracking spreadsheets do. It runs in the browser too, so it reads only what
it is given. `packages/engine/src/budget/view.ts` feeds it from the ledger: each category's activity,
the income that has no category (`otherIncome`), what each month assigns, the `carryover` flags and
the month's hold. Change the arithmetic there, never in the view or a client.

- Envelope: a category's balance is what it was given plus its activity plus last month's balance.
  A negative balance carries over only when the category rolls over; otherwise it comes out of next
  month's To Budget. To Budget is income plus last month's To Budget and hold, minus what is
  assigned, last month's overspending and this month's hold. An income category's balance is its
  activity; income held for next month is its `carryover` mark, unless the month has a hold of its
  own (`hold_for_next_month`).
- Tracking: a category's balance is budgeted plus activity, plus last month's balance only when it
  rolls over. Nothing else carries between months, and a hold means nothing. Saved is income plus
  spending.
- A group's figures are the sums of its categories' own figures; nested totals never enter them.

Enforced by: `packages/engine/test/properties/compute-budget.test.ts`,
`packages/engine/test/properties/tracking.test.ts`,
`packages/engine/test/properties/properties.test.ts` (rule 2 `everyCentHasAPlace`, envelope only)

## Rollover goes on until turned off

A month with no budget row takes the latest row before it, in every month, also past the months
`set_carryover` wrote. Departure from Actual: its rollover flag stops at the last created month.

Enforced by: `packages/engine/test/properties/properties.test.ts` (rule 11 `rolloverAsSaid`)

## An envelope budget refuses an amount on an income category

An envelope budget counts income as it arrives, and neither Actual's arithmetic nor reeve's reads a
budgeted amount on an income category. So in an envelope budget `set_budget`, `move_budget`,
`cover_overspending`, `cover_overbudgeted` and `apply_budget_action` with a category refuse an
income category, with an error that names tracking budgets. `set_carryover` still takes one, since
that mark holds income for next month. A tracking budget takes an amount on income, as Actual's does.

- Applying one income category's targets in an envelope budget fails with the same error; applying
  a whole month leaves income out.
- Month-end cleanup skips an income category's leftover rules with a warning, so one cannot stop the
  rest.
- Rows a book already holds stay; the envelope arithmetic ignores them.

Departure from Actual only where its interface cannot go: its `setBudget` accepts the write and the
budget stays the same. Not an "Expected" income amount in envelope budgets: a person who plans
income uses a tracking budget.

Enforced by: `assignableCategory` in `packages/engine/src/budget/actions.ts`,
`packages/engine/test/budget-actions.test.ts`

## Targets are note lines, edited as structured data

A category's targets are its `#template`, `#goal` and `#cleanup` note lines, and nothing else
stores them. Every note line that parses opens in the editor, and a person can still
read the note. Not Actual's UI store (`goal_def` JSON plus a `source = 'ui'` flag): it gives a
category two places its targets may live and a note that can disagree with what the budget does.

- `packages/contract/src/targets.ts` (browser-safe) defines a `Target` per kind the grammar has
  (`simple`, `periodic`, `by`, `percentage`, `schedule`, `average`, `copy`, `remainder`, `goal`) and
  leftover rules (`give-back`, `send`, `receive`, `pool-give`, `pool-receive`, `pool-cover`), the
  editor's kinds and wording, a sentence per target, and Actual's validation with its tests. Money
  is in cents; a percentage names its income category by id.
- `get_category_targets`, `list_targets`, `set_category_targets` and `preview_category_targets`
  (`packages/engine/src/templates/targets.ts`) read and write them. The note parser and `unparse`
  are in `packages/engine/src/templates/notes.ts`.
- `set_category_targets` validates as the editor does, then rewrites template lines in place: the
  first old line takes the first new one, extra old lines go, extra new lines follow the last. Text
  before a line's `#` is kept, and a prose line right above a template stays its description.
  Without any template line, new lines follow the note after a blank line. Every other line stays,
  including ones that do not parse, which come back as `unreadable`. `#cleanup` lines change only
  when `leftovers` is given.
- `preview_category_targets` runs `computeTemplates` on unsaved targets without writing.
- "Send leftovers to a category" is a pool named after it: the giver gets
  `#cleanup <Name> source`, the receiver `#cleanup <Name> sink`, and the sink line goes when no one
  gives to it. A pool whose only taker is its namesake reads back as `send`. Renaming the receiver
  orphans the pool until the givers are saved again.
- What the form can express is what the grammar can express. Schedules are named by name, so
  renaming a schedule breaks its target, as in Actual's notes mode.

Never write `#template`, `#goal` or `#cleanup` lines yourself, from an agent or in code outside the
templates module: use `set_category_targets`. In the UI, never ask a person for syntax: say
"targets", and show the note lines only in the editor's read-only "Advanced: how this is stored".
Operation names (`apply_templates`, `apply_category_templates`) keep Actual's word.

Enforced by: `packages/engine/test/templates-targets.test.ts`,
`packages/contract/test/targets.test.ts`,
`packages/e2e/test/targets.e2e.ts`

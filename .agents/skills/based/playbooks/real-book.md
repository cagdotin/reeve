### Real book

**You own the user's money for this request. Read freely, write only what they asked for, and leave every change easy to reverse.** This is budgeting, not coding: no repo changes. Read `../../reeve/SKILL.md` first.

1. Read before you write. `list_accounts` and `list_categories` for the ids, and `get_budget`, `list_transactions` or the reports for the state. Answer a question from these alone, and do no writes.
2. Answer in the book's terms: the amount in the book's currency, the period, and the accounts or categories it covers. Say what you left out. Money is integer cents on the tools, and never in the reply.
3. Scope the write to what was asked. A request to categorize this month's transactions does not cover creating a rule that rewrites past ones. A new rule that sets a category recategorizes every existing match unless `recategorize: false`, so run `preview_rule` first and report how many transactions it changes.
4. Preview what can be previewed: `preview_import` before `import_transactions`, `preview_rule`, `preview_category_targets`, `receipt_split_preview`. For anything that touches many rows or a judgment call, show the plan and wait.
5. Prefer the safe forms. Give a receipt an `externalId` so a retry can't duplicate it. Let an import's duplicate detection run. Set targets with `set_category_targets`, and never write template lines into notes by hand.
6. Pause and ask before deleting anything, merging payees, reconciling, restoring a book, or changing a book setting.
7. After writing, read the result back and confirm the figures moved as intended. Each write operation is one undo step, so report how many you made and that `undo` reverses them, newest first.
8. If a tool is wrong or missing, or a figure looks off, stop. Don't work around it in the data. Report it and file it with `octo create`, or route to **Wrong number** or **Bug fix** against a scratch home.

Autonomy grants ("don't stop", "going to bed") do not widen what you may write here.

**Reply:** the answer or what changed (counts, amounts, the accounts or months touched), what you previewed, the number of undo steps, and anything that looks wrong and needs the user's eye.

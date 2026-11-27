---
name: reeve
description: Read and manage the user's personal budget in reeve (accounts, transactions, categories, the monthly budget, rules, schedules, bank-file imports, reports). Use when asked about money, spending, balances, budgeting, bills, subscriptions or transactions.
---

# reeve

reeve is a personal budget on a double-entry ledger that works like Actual Budget. Its data lives
in SQLite books under the reeve home; change it only through the `reeve` MCP tools or CLI.

## Model

- Money is an integer of cents: `1234` is 12.34. In a register, negative leaves the account.
- Accounts are assets and liabilities, on or off budget. Categories are the ledger's expense and
  income accounts, in groups. Every transaction is postings that sum to zero.
- The budget is envelope (zero-based) or tracking. Each month: budgeted, spent and balance per
  category, and To Budget: what income has not been assigned yet.
- A book is one budget file; omit `--book` for the default one.
- Rules change transactions as they are added (rename payees, set categories); schedules are
  expected bills and income.
- Budget targets say what a category needs each month and what happens to its leftover money at
  month end. Read them with `get_category_targets` (or `list_targets`) and change them with
  `set_category_targets` (`reeve targets set --content '<json>'`): structured targets in cents,
  validated, each with a plain sentence. Never write `#template`, `#goal` or `#cleanup` note
  lines yourself; the operation keeps them, and the rest of the note, in order.
  `preview_category_targets` shows what they would budget; `apply_category_templates` applies them.
- Creating a rule that sets a category, or changing the category a rule sets, recategorizes: that
  category goes on every existing transaction the rule matches (not splits, transfers or ones an
  applied receipt split), and only the category changes, in one undo step; `recategorized` lists
  them. Pass `recategorize: false` to save the rule for new transactions only. Check what it
  would touch with `preview_rule` first. Such a rule also turns learning off for the payees its
  conditions name, so reeve no longer rewrites it.
- `transaction_rules` explains one transaction: the rules that made it what it is, replayed from
  how it arrived, and the rules that match it now.

## How to act

Call `list_accounts` and `list_categories` first to learn ids. Every operation is an MCP tool and,
where it has one, a `reeve` command with the same inputs as flags (`reeve <command> --help`):

- `list_books`, `reeve books list`: List the books on this computer.
- `create_book`, `reeve books create <name>`: Create a book with the default categories of Actual Budget, and make it the default book when it is the first one.
- `get_book`, `reeve books show`: Read a book's settings: name, currency, budget type and formats.
- `update_book`, `reeve books update`: Change a book's settings; fields left out stay.
- `set_default_book`, `reeve books use <id>`: Make a book the one the CLI and MCP use when no book is named.
- `delete_book`, `reeve books delete <id>`: Delete a book and its file.
- `undo`, `reeve undo`: Undo the latest change to the book; false when there is nothing to undo.
- `redo`, `reeve redo`: Redo the change undo reversed last; false when there is nothing to redo.
- `set_note`, no command: Set the note of an account, a category, a category group or a budget month (id `budget-YYYY-MM`); null or empty removes it.
- `list_accounts`, `reeve accounts list`: List the asset and liability accounts (checking, savings, credit cards, loans) in their order, with balances.
- `account_activity`, `reeve accounts activity`: How an account or a set of accounts got to its balance: month-end balances, money in and out by month (category lines only, so transfers are not spending), the top categories and payees of a period against the period before, the schedules' projected balances, and what needs tidying (uncategorized, old uncleared, last reconciled day, missed schedules).
- `list_ledger_accounts`, no command: List every account of the double-entry ledger: assets, liabilities, equity, and the income and expense accounts that are the budget's categories.
- `create_account`, `reeve accounts create <name>`: Create an account.
- `update_account`, `reeve accounts update <id>`: Rename an account or move it on or off budget.
- `move_account`, no command: Place an account before another one in the list, or last when before is null.
- `close_account`, `reeve accounts close <id>`: Close an account.
- `reopen_account`, `reeve accounts reopen <id>`: Reopen a closed account.
- `reconcile_account`, `reeve accounts reconcile <id>`: Reconcile an account with a bank statement: when its cleared balance differs from balance, a cleared adjustment transaction makes up the difference (when adjust is true); then every cleared posting is locked as reconciled.
- `list_categories`, `reeve categories list`: List the category groups in budget order, each with its categories; the income group last.
- `create_category_group`, `reeve categories create-group <name>`: Create a category group.
- `update_category_group`, no command: Rename, describe or hide a category group.
- `move_category_group`, no command: Place a category group before another one.
- `delete_category_group`, no command: Delete a category group and its categories.
- `create_category`, `reeve categories create <name>`: Create a category in a group, or under a parent category (whose group it takes), up to the book's categoryDepth levels.
- `update_category`, `reeve categories update <id>`: Rename, describe or hide a category.
- `move_category`, no command: Move a category with its subcategories into a group, under parent (null or left out: the top of the group), before another sibling or last.
- `delete_category`, `reeve categories delete <id>`: Delete a category.
- `list_payees`, `reeve payees list`: List payees by name, with how many transactions name each.
- `payee_activity`, `reeve payees activity`: How payees are used: transactions and spending in a range against the period before, twelve months of totals, their last transaction, categories and rules, the largest changes in spending, settled price changes, regular payees gone quiet, and what needs attention across the book.
- `create_payee`, no command: Create a payee, or return the one with that name; a description given replaces its own.
- `update_payee`, no command: Rename or describe a payee, or mark it favorite or as one whose categories rules should learn.
- `merge_payees`, no command: Merge payees into one: their transactions and rules name target, target takes the first description when it has none, and they are deleted.
- `suggest_payee_merges`, no command: Groups of payees that look like one: the words of the first, without digits and punctuation, begin the words of the others.
- `keep_payees_apart`, no command: Say payees are not one, so suggest_payee_merges does not group them together again.
- `delete_payees`, no command: Delete payees; their transactions keep no payee.
- `list_transactions`, `reeve transactions list`: List transactions as register rows, newest first.
- `get_transaction`, `reeve transactions show <id>`: Read one transaction with all its postings.
- `create_transaction`, `reeve transactions add`: Add a transaction the way a register enters it: an amount into or out of an account against a category, a transfer account, or split lines.
- `create_journal_entry`, no command: Add a transaction as double-entry postings on any accounts, categories included.
- `update_transaction`, `reeve transactions update <id>`: Change a transaction.
- `update_transactions`, no command: Change several transactions at once, as a register's bulk edit: each field given is set on every one, the register fields as account sees them.
- `delete_transactions`, `reeve transactions delete`: Delete transactions; a reconciled one changes a balance already agreed, so ask the person, then pass confirmReconciled.
- `duplicate_transactions`, no command: Copy transactions, uncleared, on the same days.
- `merge_transactions`, no command: Merge two transactions that are one, as an imported copy of one entered by hand; they must share an account and amount, and it is refused when it would lose a reconciled posting.
- `make_transfer`, no command: Make one transfer of two transactions that are two sides of one movement, as two banks' imports of a top-up: they must be in different accounts, their amounts must cancel, and neither may be a split or a transfer.
- `get_budget`, `reeve budget show`: Read the budget of one or more months: for each category what is budgeted, spent and its balance, group totals, and the month's summary (envelope: income, To Budget, hold, overspending; tracking: budgeted and real income, spending, savings).
- `budget_transactions`, `reeve budget transactions`: The transactions behind a budget figure for one month: a category's spent (or received) total in get_budget, its subcategories included, or a group's.
- `set_budget`, `reeve budget set`: Set what a month assigns to a category.
- `set_carryover`, no command: Turn rolling over overspending on or off for a category from a month on: its negative balance then carries into next month instead of coming out of To Budget.
- `move_budget`, `reeve budget move`: Move budgeted money in a month from one category to another, or between a category and To Budget, noting it on the month.
- `cover_overspending`, no command: Cover a category's negative balance from another category's balance or from To Budget; all of it unless amount says how much.
- `cover_overbudgeted`, no command: Cover a negative To Budget by taking from a category's balance; all of it unless amount says.
- `hold_for_next_month`, `reeve budget hold`: Hold money of To Budget for next month; at most what To Budget has.
- `reset_hold`, no command: Release the money held for next month back to To Budget.
- `apply_budget_action`, `reeve budget apply`: Apply a budget action to a month, or to one category when category is given: copy-last (last month's budget), set-zero, average-3/average-6/average-12 (average spending of the months before), copy-until-year-end (this month's budget to the rest of the year), set-to-spent (what was spent).
- `list_rules`, `reeve rules list`: List rules in the order they run: stage pre, default, post, and within a stage from the least to the most specific, so the most specific rule has the last word.
- `rule_activity`, `reeve rules activity`: How rules do: for each rule in run order, the existing transactions its conditions match today in a range and per month, its last match, and what is wrong with it; how many transactions some rule matches; and the payees most worth a rule.
- `get_rule`, `reeve rules show <id>`: Read one rule.
- `create_rule`, no command: Create a rule: when a transaction is added (or rules are applied), its actions change it if its conditions match.
- `update_rule`, no command: Change a rule: the fields given replace the rule's.
- `delete_rules`, `reeve rules delete`: Delete rules.
- `apply_rules`, `reeve rules apply`: Run rules on existing transactions now.
- `preview_rule`, `reeve rules preview`: The register rows a rule's conditions match among existing transactions, newest first: give a rule id or conditions.
- `transaction_rules`, `reeve transactions rules <id>`: The rules behind one transaction.
- `run_rules`, no command: Run every rule on a transaction that is not saved, and answer with what it would become; null when a rule deletes it.
- `pending_rule_categories`, `reeve rules pending`: Uncategorized transactions that today's rules would give a category: on budget accounts, neither split nor transfer.
- `apply_rule_categories`, `reeve rules apply-categories`: Put on each uncategorized transaction in scope the category today's rules give it, as pending_rule_categories lists them, in one undo step.
- `create_payee_rename_rule`, no command: Rename imported payees: the pre-stage rule that sets payee to `to` when the imported payee is one of fromNames gets those names added, or is created.
- `list_schedules`, `reeve schedules list`: List schedules with their next date and status as of today: missed, due, upcoming, scheduled, paid (a transaction is linked to the next occurrence) or completed.
- `schedule_activity`, `reeve schedules activity`: Every schedule with its coming occurrences, recent charges (linked, or matched by payee, account and day), what it costs a month, settled differences from what it expects, dates passed with no charge and when it ends; and what the next twelve months hold.
- `get_schedule`, `reeve schedules show <id>`: Read one schedule.
- `create_schedule`, `reeve schedules create`: Create a schedule: a payee, account and amount on a day or a recurrence.
- `update_schedule`, `reeve schedules update <id>`: Change a schedule.
- `delete_schedule`, `reeve schedules delete <id>`: Delete a schedule and its rule.
- `skip_schedule_date`, `reeve schedules skip <id>`: Skip a schedule's next date: move it to the occurrence after.
- `post_schedule_transaction`, `reeve schedules post <id>`: Add a schedule's transaction now, on its next date (or today with today), linked to the schedule, then move a recurring schedule to its next occurrence.
- `complete_schedule`, `reeve schedules complete <id>`: Mark a schedule completed: it stops matching and posting.
- `restore_schedule`, `reeve schedules restore <id>`: Restore a completed schedule, its next date computed again from today.
- `list_schedule_dates`, `reeve schedules dates <id>`: The days a schedule falls on, after weekend moves, from from (today by default) to to, at most count (10 by default when to is left out).
- `preview_recurrence`, `reeve schedules preview`: The next days a recurrence falls on from today, as the schedule editor previews them, with its description.
- `list_scheduled_transactions`, `reeve schedules upcoming`: The schedules' coming transactions to show in a register: each due, missed, paid or upcoming schedule's next date and its further occurrences within the upcoming length, newest first.
- `find_schedules`, `reeve schedules find`: Find recurring transactions in the history of each open account (weekly, every two weeks, monthly on a day, the last day, or the 1st/3rd or 2nd/4th weekday) that could become schedules.
- `run_schedules`, `reeve schedules run`: Bring schedules up to date as of today: post the due and missed transactions of schedules that post them, move paid recurring schedules to their next date, and complete paid one-off schedules that have passed.
- `forecast_balances`, `reeve schedules forecast`: Forecast account balances day by day: recorded transactions, then the schedules' coming transactions not yet recorded; with conditions, the running total of the matching ones.
- `preview_import`, `reeve import preview [<path>]`: Read a bank file (CSV, OFX/QFX, QIF or CAMT.053) as Actual's import dialog does, with its options, and return its rows as transactions to import, newest first.
- `import_transactions`, `reeve import run [<path>]`: Import transactions into an account from rows (preview_import's rows without their index, categoryName, status and match) or from a bank file with the same options.
- `export_transactions`, `reeve export csv`: Export transactions as CSV text, as Actual's account export: Account, Date, Payee, Notes, Category_Group, Category, Amount, Split_Amount, Cleared, newest first, a split as its total and one line per part.
- `export_book`, `reeve export book <path>`: Write a consistent copy of the whole book (its SQLite file) to a path on this computer, as a backup that restore_book reads.
- `restore_book`, `reeve books restore <path>`: Restore a backup that export_book wrote as a new book, with the backup's name unless name is given, and the receipt photos in the folder <path>.receipts beside it if there is one.
- `set_bank_credentials`, `reeve bank credentials`: Set up the Enable Banking application this computer uses.
- `remove_bank_credentials`, `reeve bank forget-key`: Delete the Enable Banking key from the reeve home.
- `list_banks`, `reeve bank banks`: The banks the provider reaches in a country (two letters, as AT).
- `bank_status`, `reeve bank status`: The bank setup of a book: whether a key is set up, each consent and when it ends, and each linked account with its last sync, status and the bank's balance beside the cleared balance.
- `begin_bank_link`, `reeve bank begin`: Start a consent at a bank.
- `complete_bank_link`, `reeve bank complete`: Finish a consent with the address the bank's approval landed on.
- `remove_bank_connection`, `reeve bank remove <id>`: End a consent at the provider and unlink its accounts.
- `link_bank_account`, `reeve bank link`: Feed a ledger account from a bank account of a consent.
- `unlink_bank_account`, `reeve bank unlink <account>`: Stop feeding an account from its bank.
- `sync_bank_accounts`, `reeve bank sync`: Fetch booked transactions for one linked account, or all of them, and import them: rules run, existing transactions are matched and nothing already there is added twice.
- `list_dismissed_imports`, `reeve bank dismissed`: The lines an account has taken and no longer holds, deleted or undone.
- `suggest_account_rules`, `reeve bank suggestions`: Rules worth making on a counterparty's account number, from the bank lines reeve keeps: an account whose lines (two or more, under one imported payee) all land on one payee, or one of the person's own linked accounts.
- `accept_account_suggestion`, no command: Make the rule suggest_account_rules offers for an account number: a pre-stage rule that sets the payee, or one that makes its lines transfers to the person's own account, applied to the lines already in, each joined with the other bank's copy of the movement.
- `dismiss_account_suggestion`, no command: Stop suggesting a rule for an account number.
- `restore_dismissed_imports`, no command: Bring dismissed lines back into the account from the line the bank sent, which reeve keeps; a line taken before reeve kept lines comes back on the account's next fetch that covers it.
- `list_saved_reports`, `reeve reports definitions`: List saved report definitions.
- `get_saved_report`, `reeve reports get <id>`: Read a saved report definition or its unavailable descriptor.
- `create_saved_report`, no command: Create an independent saved report.
- `update_saved_report`, no command: Replace supplied settings or scope of a linked report.
- `duplicate_saved_report`, `reeve reports duplicate <id>`: Duplicate a report without copying placements.
- `get_saved_report_usage`, `reeve reports usage <id>`: Review all placements linked to a report.
- `delete_saved_report`, `reeve reports remove <id>`: Delete a report and its reviewed placements in one undo step.
- `set_default_dashboard`, `reeve dashboard default <id>`: Choose the book default dashboard.
- `reorder_dashboard_pages`, no command: Reorder all dashboards.
- `duplicate_dashboard_page`, `reeve dashboard duplicate <id>`: Duplicate a dashboard with linked reports.
- `repair_widget`, no command: Repair an unavailable widget while retaining legacy metadata.
- `net_worth_report`, `reeve reports net-worth`: Net worth over time, as Actual's net worth report: per interval the balance of each account, assets (positive balances), debt (negative balances), net worth and its change.
- `cash_flow_report`, `reeve reports cash-flow`: Cash flow of the budget accounts, as Actual's cash flow report: income, expenses and transfers per day or month, and the running balance.
- `spending_report`, `reeve reports spending`: Spending of one month against another and an average of earlier months, as Actual's spending report: cumulative spending per day of month (day 28 takes the rest), the month's budget spread over its days, and spending per expense category.
- `spending_transactions`, `reeve reports spending-transactions`: The transactions behind one category's figure in spending_report for one month, under the same filters: each register row with what it counts toward the figure, which for a split is only its lines in that category.
- `summary_report`, `reeve reports summary`: A summary widget's value, as Actual's: the sum of the matching transactions, their average per month, per year or per transaction, or their sum as a percentage of what divisorConditions match.
- `calendar_report`, `reeve reports calendar`: Income and expenses per day, month by month, as Actual's calendar report.
- `run_custom_report`, `reeve reports custom`: Run a custom report, as Actual's custom reports: the transactions grouped by category, group, payee, account, tag or interval, per day, week, month, quarter or year, as payments, deposits, net, net payments, net deposits or budgeted amounts.
- `crossover_report`, `reeve reports crossover`: Actual's crossover (financial independence) report: monthly expenses of the chosen categories against what the chosen accounts would pay at a safe withdrawal rate, projected until the income covers the expenses.
- `budget_analysis_report`, `reeve reports budget-analysis`: Actual's budget analysis: per month what the expense categories were budgeted and spent, the overspending reset from the month before (categories without rollover), and a running balance that carries over as the budget does.
- `sankey_report`, `reeve reports sankey`: Actual's Sankey report: money flowing from payees and income categories through accounts (spent) or the budget (budgeted) to category groups and categories, over a range of months.
- `age_of_money_report`, `reeve reports age-of-money`: Actual's age of money: every inflow to the budget accounts is a lot, every outflow spends the oldest lots first (FIFO), and an outflow's age is the days since the last lot it drew from.
- `evaluate_formula`, `reeve reports formula <formula>`: Evaluate a formula widget's formula with HyperFormula, as Actual's formula card: spreadsheet functions plus QUERY("name") (the sum of a named query, in currency units), QUERY_COUNT, BALANCE_OF("account"), BUDGET_QUERY(dimension, categories, start, end), QUERY_EXTRACT_CATEGORIES, QUERY_EXTRACT_TIMEFRAME_START/END, INTEGER_TO_AMOUNT, FIXED, FORMATNUMBER and FORMATCURRENCY.
- `list_custom_reports`, `reeve reports saved`: List the saved custom reports, by name.
- `create_custom_report`, `reeve reports save <name>`: Save a custom report under a name no other report has.
- `update_custom_report`, no command: Change a saved custom report; the fields given replace its own.
- `delete_custom_report`, `reeve reports delete <id>`: Delete a saved custom report and the dashboard widgets that show it.
- `list_dashboard_pages`, `reeve dashboard list`: List dashboards with their widgets and default selection.
- `create_dashboard_page`, `reeve dashboard create <name>`: Add an empty dashboard page.
- `rename_dashboard_page`, `reeve dashboard rename <id>`: Rename a dashboard page.
- `delete_dashboard_page`, `reeve dashboard delete <id>`: Delete a dashboard page and its widgets; the last page stays.
- `reset_dashboard_page`, `reeve dashboard reset <id>`: Replace a dashboard page's widgets with the Today template, retaining saved reports.
- `add_widget`, `reeve dashboard add`: Add a widget to a dashboard page.
- `update_widget`, `reeve dashboard move <id>`: Move, resize or change a widget's placement settings; edit what a report widget shows with update_saved_report.
- `update_widgets`, no command: Change the layout of several widgets at once, as dragging on the grid does.
- `remove_widget`, `reeve dashboard remove <id>`: Remove a widget from its page.
- `copy_widget`, `reeve dashboard copy <id>`: Copy a widget to the end of another (or the same) dashboard page.
- `list_page_widgets`, `reeve page-widgets list`: The widgets on an operational page (transactions or payees): one short stack per book, shared by every account, empty until a widget is added.
- `add_page_widget`, `reeve page-widgets add`: Add a report widget below a page's others, at most three.
- `move_page_widget`, `reeve page-widgets move <id>`: Move a page widget to a position in its page's stack, 0 at the top.
- `list_tags`, `reeve tags list`: List the tags with how many transactions name each in their notes (#tag).
- `discover_tags`, `reeve tags discover`: Add every tag the transactions' notes use that is not listed yet, as Actual's discover, and list them all.
- `create_tag`, `reeve tags create <tag>`: Create a tag, or update the one with that name.
- `update_tag`, `reeve tags update <id>`: Change a tag's color or description, or rename it: a new name is written into every note that uses the old one.
- `delete_tags`, `reeve tags delete`: Delete tags.
- `balance_forecast_report`, `reeve reports balance-forecast`: Actual's balance forecast widget: the running balance of the chosen accounts (or the running total of the transactions the conditions match) from recorded transactions plus the schedules' coming ones, by day or month, for one line or a comparison of up to four, with the schedules that drive it.
- `monte_carlo_report`, `reeve reports monte-carlo`: Actual's Monte Carlo retirement simulation: thousands of seeded runs of pots drawn down from currentAge to targetAge under random or historical returns, with spending phases, contributions, income streams, withdrawal rules, fees and tax.
- `list_targets`, `reeve targets list`: Every category that has budget targets (goal templates or end-of-month leftover rules), each with its structured targets, leftover rules and plain sentences.
- `get_category_targets`, `reeve targets show`: A category's budget targets as structured data: what its #template, #goal and #cleanup note lines say, with a plain sentence for each, the lines themselves and any line that does not parse.
- `set_category_targets`, `reeve targets set`: Replace a category's budget targets, validated as the target editor does.
- `preview_category_targets`, `reeve targets preview`: What targets would budget a category in a month, writing nothing: the total, each target's part, the goal, and the problems that stop them.
- `apply_templates`, `reeve templates apply`: Apply the targets (templates) of every category that has nothing budgeted in a month yet, priority by priority within To Budget, then remainders; also sets each category's goal.
- `overwrite_templates`, `reeve templates overwrite`: Apply the templates of every category in a month, replacing what is budgeted already.
- `apply_category_templates`, `reeve templates category`: Apply one category's templates to a month, replacing what it has budgeted.
- `apply_group_templates`, `reeve templates group`: Apply the templates of a category group's categories to a month, replacing what they have budgeted.
- `cleanup_templates`, `reeve templates cleanup`: End-of-month cleanup of an envelope budget from #cleanup lines in category notes: `#cleanup source` gives a category's leftover back to To Budget, overspent categories are covered, and `#cleanup sink [weight]` categories share what To Budget then holds; `#cleanup <group> source`, `#cleanup <group> sink [weight]` and `#cleanup <group>` (cover overspending) do the same within a named group first.
- `check_templates`, `reeve templates check`: Check every category's template lines: report each line that does not parse and each schedule a template names that does not exist.

```sh
reeve books create "Household"                                                                                                                          # A new envelope budget
reeve accounts create "Checking" --balance 150000                                                                                                       # 1,500.00 to start
reeve accounts create "Visa" --type liability                                                                                                           # A credit card
reeve transactions list --account <id> --from 2026-10-01                                                                                                # October onward
reeve transactions add --date 2026-10-31 --account <id> --amount -4250 --payee Grocer --category <id>                                                   # Spend 42.50
reeve budget show --month 2026-11                                                                                                                       # November
reeve budget set --month 2026-11 --category <id> --amount 40000                                                                                         # 400.00
reeve rules apply --ids <id>,<id>                                                                                                                       # Run every rule on two
reeve rules apply --rule <id>                                                                                                                           # Apply a rule to every transaction it matches
reeve schedules create --name Rent --payee Landlord --account <id> --amount -120000 --amount-op is --date 2026-11-01 --frequency monthly                # Rent on the 1st of every month
reeve import preview ~/Downloads/bank.csv --account <id>                                                                                                # Rows of a CSV, with duplicates marked
reeve import run ~/Downloads/bank.ofx --account <id>                                                                                                    # Import an OFX file, merging duplicates
reeve reports net-worth --start 2026-01 --end 2026-10                                                                                                   # This year by month
reeve reports custom --group-by Payee --date-range 'Last 3 months'                                                                                      # Spending per payee
reeve reports formula '=BALANCE_OF("Checking")'                                                                                                         #
reeve targets set --category <id> --content '{"targets":[{"type":"by","priority":0,"amount":90000,"month":"2027-02","repeat":null,"spendFrom":null}]}'  # Save 900.00 by February 2027
reeve templates apply --month 2026-11                                                                                                                   # November
```

Every change can be reversed with `undo`.

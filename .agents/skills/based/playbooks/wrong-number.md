### Wrong number

**You own the reconciliation. A budget app's bug is a number someone trusted. Do not touch code until you can say which number is right, and why.** The deliverable is a figure traced to its postings, then a fix if one is needed.

1. Pin the claim: which number, on which surface, for which book, account, category and month, what it shows, and what it should show according to whom (a bank statement, Actual, arithmetic, another reeve screen).
2. Rebuild a case. On a scratch home, seed the smallest set of operations that shows the figure. On the real book, read only, through the `reeve` tools or a read-only SQLite connection to the file. Never reconcile by writing.
3. Compute it by hand from the postings, outside the code under suspicion: `SELECT` the postings, list them, and add them up with a short script. Check the invariants on the way: each transaction sums to zero, and the amounts are integer cents.
4. Name the rule that decides each line. The usual suspects:
   - Activity counts only postings in transactions that touch a budget account.
   - Money entering the budget without an income category counts as income (opening balances, transfers from off-budget accounts).
   - "Uncategorized" is not counted by the budget, and reports as uncategorized.
   - An off-budget posting in a transfer may carry `category_id`.
   - A parent's `total` is a display rollup, and each category remains its own envelope ([model rules](../../../../docs/rules/model.md)).
   - Carryover, the month's hold, and envelope against tracking in `computeBudget`.
   - Split parents against children, and closed accounts, transfers and date boundaries in report filters.
5. Run the same case through Actual's logic, reading its code and tests when a clone is at hand (see **Actual parity**). When reeve and Actual disagree, Actual wins unless a decision says otherwise.
6. Give the verdict: the number was right (explain it, and the confusion may be a **Screen** task), the data is wrong (a user or import problem, so show the rows), or the code is wrong (**Bug fix**, with the hand calculation as the failing test's expected value).
7. Check every other surface that shows this figure. The budget, the register, the reports and the dashboard widgets each compute from their own view, so a fix in one can leave another disagreeing.

**Reply:** the number, the hand reconciliation as a small table, the rule that decided it, the verdict, and which other surfaces agree.

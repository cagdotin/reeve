### Actual parity

**You own matching Actual. Its behavior is the spec, its tests are the starting suite, and every departure is written down.**

1. Find a clone of Actual. Look in `../actual` and `../external/actual`. If there is none, clone it read-only into the scratch directory (`git clone --depth 1 https://github.com/actualbudget/actual`). Read it, never run it. Name the commit you read.
2. Read how the feature behaves there: `packages/loot-core/src/server/` for the logic (budget, rules, schedules, transactions, `transactions/import/` for file parsers), `packages/loot-core/src/shared/` for shared helpers, and `packages/desktop-client/` for what the user sees. A wide sweep goes to a subagent that reports the behavior with file and line (**principle-guard-the-context-window**).
3. Write the behavior down as a list of cases: inputs, outcome, and the edge cases Actual's code and tests handle. Include the ones that look odd, because odd cases are usually a bug report someone once filed.
4. Check the scope against [scope rules](../../../../docs/rules/scope.md). Bank sync, the sync server, CRDT sync, auth and the YNAB and Actual importers stay out. Say so rather than porting around them.
5. Map it onto the ledger. Actual stores a transaction with a category. reeve stores postings, so name what each case becomes in postings, and in the register shape (`entryPostings`, `draftFrom`). **architect** for the shape when it crosses a function boundary.
6. Port Actual's tests to `packages/engine/test/` first, through operations (`call(name, input)`), and watch them fail. Pure budget arithmetic belongs in `contract/src/rules.ts`, as in `computeBudget`.
7. Build it, composing **Operation**, **Schema change** and **Screen** for the parts it needs.
8. Every place reeve deliberately differs from Actual is written in its topic file under `docs/rules/` (**Librarian**). A difference you found but did not choose becomes a bug or an octodo task.
9. Move the octodo task to `done` and run **Landing a change** when the task asks for commits.

**Reply:** the Actual files and commit you read, the cases ported, the differences you kept and the decision that records each, how you verified.

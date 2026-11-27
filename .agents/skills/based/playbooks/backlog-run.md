### Backlog run

**You own the board's truth. Pick what is ready, land it, and leave each task saying what happened.** Tasks live in `.octodo/`, key `REE`. Change them only through `octo`.

1. Read the board: `octo ls`, then `octo show PU-n` for each candidate. Use the user's selection if they gave one. Otherwise take unblocked tasks by priority, and prefer the ones that unblock others. A task that needs a product call goes back with the question written in it, rather than being guessed at.
2. Check that each task still applies. Search the code and `git log --grep 'PU-n'`, since it may be partly done. Tasks in this repo often predate the code around them. One that [scope rules](../../../../docs/rules/scope.md) rules out, or whose premise is gone, gets said so to the user rather than built.
3. Decide sequential or parallel. Parallelize only tasks with disjoint files. Two tasks that both generate migrations or `routes.gen.ts` serialize, or they will conflict. List the seams and overlaps in the throughput checkpoint.
4. Move each to `in-progress` when it starts: `octo move PU-n in-progress`.
5. For each task, run its matching playbook in full (usually **Actual parity**, **Feature** or **Bug fix**). In parallel, give each subagent its own git worktree and a full brief, including the path to `../SKILL.md`.
6. Review every subagent's diff yourself (see **Subagents**). Its own report is not evidence. Rerun its verification.
7. Merge one at a time. After each merge, rerun `pnpm db:generate` and `pnpm catalog:generate` if the task touched schema or catalog, and run the tests. Two migrations generated from the same base have to be reconciled by regenerating, never by editing a committed one.
8. Move each task to `done` in the same commit as its work, per **Landing a change**. Findings out of scope become new tasks with `octo create`.
9. Run `pnpm check` over the final state before you report the batch as done. Remove the worktrees you created once merged.

**Reply:** each task and its outcome (landed with commit, sent back with the question, or dropped with the reason), the new tasks filed, the final `pnpm check` result.

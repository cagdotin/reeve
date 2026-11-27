### Landing a change

Invoked at the end of every playbook that changes code, when the task asks for commits. Without that ask, stop at a clean, reviewable working tree and say so. reeve has no pull requests or reviewers: work lands as commits, so this playbook is the last check it gets.

**Before the commit.** Run **comment-review** over the diff. Run **Librarian** when the change makes a doc untrue. If you changed the catalog or the schema, confirm `pnpm catalog:generate` and `pnpm db:generate` left nothing unstaged. For a diff you would want a second reader on, run **interrogate**.

**Branches.** Trunk is `master`. Stay on the branch you were given. A dirty tree with unrelated work: stage only your own files by name, never `git add -A`. When parallel agents share one checkout, give each its own git worktree.

**Commits.** Small and ordered, each one landable (**principle-sequence-verifiable-units**). Amend when the fix belongs in the commit you just made and you have not pushed it. Lefthook checks secrets, formats, lints, and typechecks on commit, and runs `pnpm check` before push. Never skip the hooks to get a commit through. Fix what they report.

**Messages.** Follow the repo's history, not Conventional Commits. The title is one plain sentence saying what is now true, with no trailing period and the task id at the end when there is one: `Reject unknown input fields on every surface (PU-49)`. The body says what changed for the person using it, why, and any fixes it carries, in short lines. Write it with **technical-writing** and **unslop**. Name a measured number when there is one.

**The task.** Move the octodo task to `done` (`octo move PU-n done`) and stage its file in the same commit as the work. Findings you did not act on become tasks with `octo create`.

**Push.** Only when asked. `pnpm check` must pass on the head you push. Never force-push `master`.

**Reply:** the commits with their titles, the task moved, what `pnpm check` said, and what is still unpushed.

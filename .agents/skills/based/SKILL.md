---
name: based
description: reeve's agent style for rigorous work on a double-entry budgeting app. Routes a task to a playbook (Actual parity, a new operation, a schema change, a screen, a wrong number, work on the real book, a backlog run and more). Concise replies, simple code, verified results, money that adds up. Use for /based, "based mode", or any non-trivial task in this repo that needs rigor.
disable-model-invocation: true
---

# Based mode

The skills this mode routes to live next to this file at `../<name>/SKILL.md`. To run one, read that file and follow it. That works in every harness, whether or not it lists the skill. Give this file's absolute path to every subagent you spawn and tell it to read the file first.

The repo's ground rules are `AGENTS.md` (how to work here) and `RULES.md` (which rules file to read for the change at hand). They outrank anything here.

## Non-negotiables

The Principles section below grounds every trigger. In your reply, name each principle that shaped a decision and the specific choice it changed. Cite only principles whose leaf `SKILL.md` you read this session.

**The real budget**

- The `reeve` MCP tools, and `bin/reeve` without `REEVE_HOME`, act on the user's real money in `~/.config/reeve`. Never use them to test or verify code. Verification runs against a scratch `REEVE_HOME`.
- A request about the user's own money, rather than the code → the **Real book** playbook.

**The domain**

- How should this accounting or budgeting behavior work → Actual is the reference. Read it before designing (**Actual parity**). A departure from Actual goes in its topic file under `docs/rules/`.
- A write that bypasses an operation, or a transaction whose postings do not sum to zero → a bug, whatever else it achieves. Money stays integer cents. The budget stays computed, never stored.
- A number you report or change (a balance, To Budget, a report total) → reconcile it by hand from the postings before you trust it (**principle-explain-the-number**).

**The work**

- Nontrivial change, architecture decision, or "are we sure?" → the **how** skill.
- About to ask the user "which approach", "how should I", or "what should this do" → classify it first. Actual may already answer it. If the answer is a fact you could observe by running something (behavior, timing, layout, output), it is not the user's to answer: sketch it via the **Prototype** playbook and let the result decide. Ask only for a product or preference call that neither Actual nor an experiment can settle. Under a full-autonomy grant, apply a default for that call, report it with the reason, and say in plain words what the user could tell you to do instead.
- Any code → name the data shape first, and choose its organizing structure per **principle-model-the-domain**.
- Code crossing a function boundary → the **architect** skill.
- "Where does the architecture hurt?" or "what should we refactor?" → the **improve-codebase-architecture** skill.
- Contested design, or a diff you would not merge on your own read → the **interrogate** skill.
- Nontrivial multi-step → write the throughput checkpoint (Feature step 3).
- Any prose, your reply included → the **unslop** skill. Write the reply per **Writing the reply**.
- Docs, commit messages → the **technical-writing** skill.
- A change to how reeve is built (a package's job, the design, a rule), or any edit to `RULES.md`, `docs/` or `AGENTS.md` → the **Librarian** playbook, with the doc edits in the same commit as the code.
- `.ts` or `.tsx` work → the **typescript-best-practices** skill.
- Before landing → the **comment-review** skill over the diff.
- Behavior a user can see → prove it on the real surface (see **Verify on the real surface**). For a bug, reproduce it there yourself first.
- Running a benchmark or reporting a speedup or regression you measured → the **benchmark-checklist** skill before you report or act on the number.
- A broken skill mid-task → fix it in its own commit. Don't block on it, and don't silently work around it.
- Long, autonomous, or multi-step work, or a task the user steps away from ("going to bed", "trust it when I'm back") → a decision trail via the **show-me-your-work** skill.
- Work that should outlive the session (a follow-up, a bug found on the way, a backlog item) → an octodo task with `octo create`, not a note in the reply.

## Principles

Read the leaf skill in full for any principle you apply. Each leaf is `../principle-<title>/SKILL.md`, with the title in kebab case, unless the entry gives its name.

**Core**

- **Laziness Protocol.** Refactoring, sizing a diff, or tempted to add abstractions, layers, or signal threading. Bias to deletion and the smallest change that solves the problem.
- **Foundational Thinking.** Before writing logic: core types and data structures, scaffold-vs-feature sequencing, what concurrent actors share.
- **Redesign from First Principles.** Integrating a new requirement into an existing design. Redesign as if it had been foundational from day one.
- **Attack the Premise.** Two or more fixes that share one premise have failed the same gate. Write the premise down and test it directly before you write another fix that assumes it.
- **Subtract Before You Add.** Sequencing an addition, refactor, or rewrite. Remove dead weight first, then build on the simpler base.
- **Minimize Reader Load.** Reviewing or shaping code that's hard to trace. Count layers and hidden state, collapse one-caller wrappers, shrink mutable scope.
- **Outcome-Oriented Execution.** Planned rewrites and migrations with explicit phase boundaries. Converge on the target architecture, don't preserve throwaway compatibility states.
- **Experience First.** Product, UX, or feature-scope tradeoffs. Choose user delight over implementation convenience.
- **Exhaust the Design Space.** A novel interaction or architectural decision with no precedent in Actual. Build 2-3 competing prototypes and compare before committing.
- **Build the Lever.** Any non-trivial work. Build the tool that does or proves it (codemod, script, generator), not by hand. The tool is the artifact a reviewer reruns.

**Architecture**

- **Model the Domain.** Stateful logic, or code that branches a lot or repeats a shape assumption across files. Encode the domain in a structure (state machine, typed model, table or registry, reducer, the right collection) instead of scattered conditionals.
- **Boundary Discipline.** Wiring validation, error handling, or framework adapters. Guards at system boundaries, trust internal types, keep business logic pure.
- **Type System Discipline.** Designing types or a signature. Make illegal states unrepresentable, brand primitives, parse external data at boundaries.
- **Make Operations Idempotent.** Commands, lifecycle steps, or loops that run amid crashes and retries. Converge to the same end state. Imports and receipts (`externalId`) depend on this.
- **Migrate Callers Then Delete Legacy APIs.** A new internal API while old callers exist. Migrate and delete in one wave.
- **Separate Before Serializing Shared State.** Concurrent actors might write the same file, branch, key, or object. Eliminate the sharing first. A write operation is one SQLite transaction, and one server claims a home with a lock ([boundaries rules](../../../docs/rules/boundaries.md)).

**Verification**

- **Prove It Works.** After a task, before declaring done. Verify against the real artifact, not a proxy or "it compiles".
- **Fix Root Causes.** Debugging. Trace each symptom back to the first place the system went wrong and fix it there. A guard is a fix only when the state it handles is legitimate.
- **Sequence Work into Verifiable Units** (**principle-sequence-verifiable-units**). Multi-step work and how you stack commits. Break work into small units that each end in a check, and order delivery so the sequence proves itself.
- **Test Behavior, Not Implementation.** Writing, changing, or keeping a test. Assert what the code's users can observe. Here that means through operations (`call(name, input)`).
- **Explain the Number.** Before you trust, report, or act on a number you measured or computed. Find what limits it, and rule out that it measured something else.

**Delegation**

- **Guard the Context Window.** Context fills up: large outputs, long files, repeated reads. Keep raw payloads out of the main thread, through a subagent or a script that reduces them.
- **Never Block on the Human.** Tempted to ask "should I do X?" on reversible work. Proceed, present the result, let the human course-correct.

**Meta**

- **Encode Lessons in Structure.** You catch yourself writing the same instruction a second time. Encode it as a lint, type, test, or script instead of more text.

## Autonomy

**Just do it.** Reversible work proceeds without asking: edits, scratch homes, local runs, octodo tasks.

**Always pause** for irreversible or outward-facing actions: pushes and commits the user did not ask for, force-pushes, deleting data outside a scratch folder, a write to the real book the user did not ask for, and pointing a test or verification run at a real home.

**Session overrides.** "Don't stop", "going to bed", "run until done", "be fully autonomous" → keep going. These never extend to the real book.

**No is an acceptable answer.** Asked whether to do something, invited to add scope, or shown an approach, reply with your real judgment. Decline or push back when that is true. reeve leaves out bank sync, auth and server deployment on purpose ([scope rules](../../../docs/rules/scope.md)), so name that when a request runs into it.

## Subagents

**Work inline by default.** A subagent starts cold, knows only its brief, and hands back a summary that drops detail. Spawn one only when it pays for that:

- **Parallel slices.** Independent pieces of work, each big enough to be worth a brief, with no shared writes. The **Backlog run** playbook is the usual case.
- **Bulk you only need the conclusion of.** A long transcript, a large profile, a wide sweep across Actual's source.
- **An unanchored reader.** A review of your own diff, a verifier of your claim. Here the fresh context is the point.

Everything else you do yourself, including implementation, fixes, and investigations that fit in a few reads.

When you spawn:

- Brief it like a peer. Goal, scope (paths it may and may not write), what you already ruled out, how to verify, and the report shape. Point at files instead of pasting them.
- Give a writer its own git worktree (**principle-separate-before-serializing-shared-state**).
- For a reviewer or verifier, use a different model family from the author's when your harness lets you pick one. When it doesn't, the fresh context alone still buys independence.
- You own its work. Read the diff and write your own summary. Never pass through what it said.
- Give new work to a fresh subagent with the full consolidated brief rather than resuming an old one, unless the new work needs state that only that agent holds.

If your harness has no subagent tool, do the slice yourself in sequence and say which step lost its independence.

## Harness terms

Skills here say what to do, not which tool to call. Map the generic terms to your harness:

- **Subagent.** The harness's agent-spawning tool, such as Claude Code's `Agent` or opencode's `task`.
- **Todo list.** The harness's plan or todo tool, such as `TodoWrite` or `update_plan`. Without one, keep the list in your reply and update it at each phase.
- **Ask the user.** A structured question tool when there is one, otherwise plain text.
- **Loop.** A harness feature that re-runs a prompt on a schedule, such as Claude Code's `/loop`. Without one, drive the work inside the turn and stop at the predicate.
- **Session transcripts.** Where the harness stores past chats. Claude Code keeps them in `~/.claude/projects/<workspace-slug>/*.jsonl`. Read only this workspace's sessions.

## Verify on the real surface

reeve has several surfaces over one catalog of operations. Prove a change on the one its user touches. Every run below uses a scratch home, and `connect()` reads `server.json` from that home, so it never reaches the user's running server.

- **Engine.** A test in `packages/engine/test/` with `scratch()` and `call(name, input)`. Run `npx vitest run packages/engine`.
- **CLI.** `REEVE_HOME=$(mktemp -d) bin/reeve ...`, and read the result back with a second command in the same home.
- **HTTP API and MCP.** `REEVE_HOME=<tmp> REEVE_PORT=<port> pnpm --filter @reeve/server dev`, then `curl http://127.0.0.1:<port>/api/...`. The schema is at `/api/openapi.json` and MCP at `/mcp`. No credentials: the server has no authentication ([boundaries rules](../../../docs/rules/boundaries.md)).
- **Web app.** An end-to-end test in `packages/e2e/test/*.e2e.ts` (`pnpm test:e2e`), which starts the real server on a scratch home. To look by hand, start the server as above, then run `REEVE_API_PORT=<port> npx vite --port <web-port> --strictPort` in `apps/web` and drive the page with your harness's browser tool. Never use `pnpm dev:web` for this: it needs ports 4620 and 5620, which the user's own app may hold, and without `REEVE_API_PORT` Vite falls back to the server on 4620, which holds the real budget. Capture screenshots at 390×844 and at desktop width, in light and dark.
- **Desktop.** `pnpm dev`, and `pnpm check:desktop` for anything that changes what the bundles load.
- **Everything.** `pnpm check`, which the pre-push hook also runs.

Once a `verify-reeve` skill exists (see **create-verification-skill**), use it instead of this list.

## Writing the reply

Write the reply clean as you draft it. A cleanup pass after drafting does not remove these patterns.

- **Short declarative sentences.** One thought per sentence.
- **No long-dash character anywhere.** Write a file-list bullet as a sentence ("`view.ts` feeds `computeBudget` from the ledger").
- **Terse is not an excuse to drop content.** Every section the playbook's reply names stays: details, tradeoffs, choices, open decisions.
- **Frame impact for the user and the maintainer.** Name who the work is for (someone budgeting in the app, an agent on the MCP server, the next engineer here) and what changes for them before any implementation detail.
- **Never fabricate a link, citation, or transcript reference.** Link only artifacts you produced or read this session.
- **Every claim carries its evidence or its label in the same sentence.** Measured, inferred, or guess. Never hand the user a check you could run.

Every playbook ends with a reply written this way. Each playbook's own reply line names only the content unique to it.

## Comments

The code is the documentation. If a reader needs a comment to understand what a piece of code does, the code has a problem. A comment is a signal: either the code is too complicated, or it handles an edge case. Treat each one as a chance to refactor the code until the comment is unnecessary, or to delete it.

- Before you write a comment, try to make it unnecessary: a better name, a named type or schema, a smaller function, a structure that makes the invalid case impossible (**principle-model-the-domain**, **principle-type-system-discipline**).
- Types and schemas are the spec. A public function, service, or schema may get a one-line doc comment, and only when its name and types don't already say what it does.
- What can stay: the reason for an edge case or a constraint the code cannot show, such as a platform or library quirk, or where Actual's behavior forces something odd. Keep it to the reason, in one or two lines.
- Never narrate the code, leave commented-out code, write changelog comments ("now uses X"), or put phase banners in tests. In a test, the assertion message documents the step.
- Existing comments came from agents by default, not from a decided style. Don't copy them as a pattern. When you touch code with a comment, ask whether the code can carry it instead.
- When code changes, delete or fix the comments it made wrong. A stale comment is a bug.

## Playbooks

Open a todo list whose first items are the matched playbook's steps, copied in verbatim, before any task-specific todos. A step you choose not to do stays in the list with a one-line `skip: <reason>`. Open the playbook at `playbooks/<title>.md`, with the title in kebab case.

Playbooks compose. A parity feature usually runs **Actual parity**, then **Operation**, **Schema change** and **Screen** for the parts it needs. A large or cross-cutting effort, or work the user steps away from to trust later, routes to the **figure-it-out** skill even when a narrower playbook fits. Use **figure-it-out** whenever no playbook fits.

**Building**

- **Actual parity.** A feature or behavior Actual has and reeve lacks or gets different. Read Actual, port its tests.
- **Feature.** New or changed behavior, built from a named data shape. The entry point when no narrower playbook covers the whole task.
- **Operation.** A new or changed entry in the operation catalog, which every surface derives from.
- **Schema change.** A table or column, its migration, its undo, and books that already exist.
- **Screen.** A page or component in the web app, at phone and desktop width.

**Correcting**

- **Bug fix.** A reported defect to reproduce, root-cause, and fix with runtime evidence.
- **Wrong number.** A balance, To Budget, or report total that disagrees with something. Reconcile first, because the number may be right.
- **Perf issue.** A measured slowness to trace and improve against a baseline.
- **Refactoring.** A behavior-preserving change to structure or shape (rename, extract, inline, dedupe, move).

**Deciding**

- **Investigation.** Read-only question: how does X work, why was Y built this way, are we sure about Z, should we do X or Y.
- **Prototype.** A throwaway sketch to make a design or behavioral decision cheaply, or to settle an empirical fork by observing it.

**The real budget**

- **Real book.** Work on the user's own money through the `reeve` tools: categorizing, rules, receipts, imports, budgeting, answers about spending. No code changes.

**Running**

- **Backlog run.** Take tasks off the octodo board and land them, one or several at a time.
- **Autonomous run.** A long task to drive to completion without stopping ("run until done").
- **Session pickup.** Resuming or taking over a prior agent's in-flight work from a transcript, a branch, or a worktree.
- **Pause safely.** Suspending in-flight work cleanly so it can be resumed.

**Housekeeping**

- **Librarian.** Keeping the rules, `docs/` and `AGENTS.md` true as the code changes: a check over prose, rules edited in place, and what goes where.
- **Authoring a skill.** Writing or editing a `SKILL.md`.
- **Landing a change.** Invoked at the end of every playbook that changes code, when the task asks for commits.

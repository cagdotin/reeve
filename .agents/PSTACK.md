# Where the skills come from

A reference for people maintaining the skills. No skill or agent instruction points here.

Most skills in `.agents/skills/` are a fork of [pstack](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan, taken at `cursor/plugins@99b609a` (pstack 0.15.32). They were adapted for octodo, then for reeve, and rewritten to work in any harness that reads `.agents/skills/`. `devl` (downloaded from https://devl.dev/skill/SKILL.md) and `reeve` (generated from the catalog) are not part of the fork, and `improve-codebase-architecture` comes from elsewhere (see below).

## What changed

- **Renamed.** `poteto-mode` is `based`. There is no `poteto-agent` or `poteto-help`. A subagent gets the path to `based/SKILL.md` in its brief.
- **Harness-neutral.** Skills say what to do, not which Cursor tool to call. `based` maps the generic terms (subagent, todo list, ask the user, loop, session transcripts) in its Harness terms section. Skills reference each other by relative path, which works in every harness.
- **Inline by default.** `how`, `why`, `architect`, `interrogate`, `reflect`, and the playbooks do the work themselves. They spawn subagents only for parallel slices, bulk the main thread only needs the conclusion of, or an unanchored reviewer. The Eval playbook still fans out, and runs only when asked.
- **No model roles.** `setup-pstack` and the `pstack-models` rule are gone. Where independence matters, a skill asks for a different model family when the harness allows a choice.
- **Comments.** `no-comments` and the Comment Sicko agent are replaced by `comment-review`, built on the rule that the code is the documentation. The rule itself is in the Comments section of `based` and in `AGENTS.md`.
- **reeve evidence.** `why` searches git and `gh`, the `.octodo/` tasks and their history, `docs/` and `AGENTS.md`, and past agent sessions. The Linear, Notion, Slack, Datadog, Sentry, and Databricks playbooks are gone, because reeve uses none of them.
- **reeve verification.** The playbooks prove behavior on the engine, CLI, API, web and desktop, against a scratch `REEVE_HOME`. They don't use the `control-ui` and `control-cli` skills.
- **Repo specifics.** `typescript-best-practices` covers Effect v4, Schema, and erasable-only syntax. Landing a change uses `master`, lefthook, and this repo's commit style. Follow-ups and backlog items become octodo tasks.
- **reeve playbooks.** `based` adds Actual parity, Operation, Schema change, Screen, Wrong number, Real book and Backlog run.
- **`statechart`.** Added later, from `cursor/plugins@519d36a`. Its `scripts/test` (3.6 MB, mostly golden fixtures) and the test setup in its `package.json` are left out.

## Left out

These are gone, and each can come back:

- `arena` and `swarm`: parallel candidates and parallel workers. Not needed here.
- `setup-pstack`: per-role model config for Cursor.
- `make-bot-ui`: Grok Bot webhook pages.
- `ketchup-video`: the video version of `ketchup`.
- Playbooks: Shipping, Orchestrate, Autopilot-full, Autopilot-stack, Worktree cleanup. They depend on Cursor cloud agents, Bugbot, and bundled Bun scripts (`watch-pr`, `orch`, `check-plan`).
- Playbooks octodo keeps: Babysit and Opening a PR with its review triage (reeve lands commits, without pull requests), Visual parity, Hillclimb, Eval, Multi-phase plan, Runtime forensics and Trace forensics. They are in `octodo/.agents/skills/octo-mode/playbooks/`. `octo-help` is gone too.
- The `benny` automation pack and the pstack guide in `docs/guide/`.

## Not set up yet

- Tracing. The Perf issue and forensics playbooks use `node --cpu-prof` and DevTools for now. Effect spans and an exporter would make every perf task cheaper.
- A `verify-reeve` skill. Run `/create-verification-skill` to make one. Until then, `based` lists how to drive each surface.

## improve-codebase-architecture

Adapted from [mattpocock/skills](https://github.com/mattpocock/skills/tree/main/skills/engineering/improve-codebase-architecture) at `5beb35b`, MIT licensed, Copyright (c) 2026 Matt Pocock (same license text as below).

- The HTML report (`HTML-REPORT.md`) is gone. The skill replies with a structured markdown message.
- Its sibling skills are folded in: `codebase-design` and its `DEEPENING.md` into `references/vocabulary.md`, `domain-modeling` and its formats into `references/domain-records.md`, and `grilling` into step 3.
- Design it twice uses `architect` Phase B, inline, instead of three or more parallel subagents. Exploration is inline too.
- The glossary is `docs/glossary.md` rather than a root `GLOSSARY.md`. Both it and `docs/adr/` are created lazily.

## License

pstack is MIT licensed:

```
MIT License

Copyright (c) 2026 Lauren Tan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

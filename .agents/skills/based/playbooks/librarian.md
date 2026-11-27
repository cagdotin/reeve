### Librarian

**You own whether the rules and docs are true.** Every change that alters what reeve is, how it is built, or which package does what leaves the rules saying so, in the same commit.

Where each kind of text goes:

- **A check, if a machine can verify it.** A lint rule in `.oxlintrc.json`, a check in `scripts/check-rules.ts`, or a test. Its error message is the instruction, so the rule is written nowhere else.
- **`docs/rules/<topic>.md`, if it needs judgment.** What holds today, the why when it is not obvious, and every departure from Actual. A rule a check enforces gets only an `Enforced by:` line there, never the instruction again.
- **`RULES.md`** indexes the topic files: one row per file saying when to read it. `scripts/check-rules.ts` fails when a file has no row.
- **`AGENTS.md`** holds how to work in this repo: the toolchain, how to verify, where tasks live, and a pointer to `RULES.md`. It restates no rule.
- **`docs/`** beside the rules: architecture, testing, deep dives, specs, brand. `docs/README.md` lists them, and the Docs app builds `docs/**/*.md` into the bundle.
- **Agent memory** holds nothing about this repo.

1. List what the change makes untrue. Search `RULES.md`, `docs/`, `AGENTS.md` and `README.md` for every package, file, command, flag and port the diff touches.
2. Edit the rule in place. A changed rule is rewritten to say what holds now: no "replaced by", no dates, no record that only says something changed. Git keeps the history.
3. Prefer a check. Before writing a new rule as prose, try to write the check instead. When a check lands, delete the prose it covers.
4. A new topic file gets a row in `RULES.md`. Split a file when its row needs two different "when" clauses.
5. When code contradicts a rule, change neither to match the other. Open an octodo task to settle it, and say so.
6. Before landing, run `pnpm check:rules`: links resolve, no decision numbers, every rules file is indexed.

**Reply:** the rules and docs each change touched, the checks added or rules removed as prose, and any conflict task opened.

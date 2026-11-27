### Operation

**You own one catalog entry and its handler. Every surface is generated from it, so never write an endpoint, tool, or command by hand.** The rules are in "Adding an operation" in `AGENTS.md`. Read them first.

1. Name the input and output. The input is one flat struct, with `book: BookField` when it runs in a book. A key it does not declare is an `InvalidRequest` on every surface ([boundaries rules](../../../../docs/rules/boundaries.md)), so pick fields rather than spreading an output back in.
2. Write the failing test in `packages/engine/test/` through `call(name, input)`. Cover the failures too: `invalid(message)` and `notFound(entity, id)`.
3. Add the entry to `contract/src/catalog/<domain>.ts` with `inBook()` errors, and a `cli` entry when it makes sense on the command line.
4. Write the handler in that domain's `engine/src/<domain>/handlers.ts` (core domains: `engine/src/operations.ts`). A book handler is a plain synchronous `(book, input) => result`. The runner gives a write its SQLite transaction, its undo step, and its announcement on the feed.
5. For a write, assert `undo` restores the state and `redo` brings it back. For anything touching postings, assert they still sum to zero.
6. Run `pnpm catalog:generate`. It rewrites `contract/src/routes.gen.ts` and `.agents/skills/reeve/SKILL.md`.
7. If the operation changes how an agent should work, update the handwritten prose in `packages/mcp/src/index.ts` and `packages/cli/src/skill.ts`.
8. Drive it on two surfaces against a scratch home: `REEVE_HOME=<tmp> bin/reeve ...` and, when the web app calls it, the page.

**Reply:** the operation's input and output, its failures, the surfaces you drove with their output, and whether undo holds.

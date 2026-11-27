# Agent instructions

reeve is a local-first personal budgeting app: a drop-in replacement for
[Actual Budget](https://github.com/actualbudget/actual) built on a double-entry ledger, running on
one computer.

**Before you change anything, open [RULES.md](RULES.md)** and read the rules file for what you are
about to do. Rules a machine can check are enforced by lint, `pnpm check:rules` and the tests: when
one fails, its message says what to do.

Tasks live in octodo (`.octodo/`, key `REE`): `octo ls` for the board, `octo show REE-n` for a task.
Move a task to `done` when its work lands. Agents: `/based` (`.agents/skills/based/`) routes a task
to a playbook and the other skills in `.agents/skills/`.

## Your real budget is not a test fixture

The `reeve` MCP tools, and `bin/reeve` without `REEVE_HOME`, act on the user's money in
`~/.config/reeve`. Verify against a scratch home: `REEVE_HOME=$(mktemp -d) bin/reeve ...`. Every
Vitest run already gets a scratch `REEVE_HOME`.

## Toolchain

- Node 26, pnpm 12 (`mise run setup`). Node runs the TypeScript sources directly.
- `pnpm dev`: Vite on 5620 plus Electron, which attaches to the server `server.json` names or
  spawns one (127.0.0.1:4620). `pnpm dev:web`: API plus Vite, for the browser. Both use the real
  home and those ports: to look at a change, start a server on a scratch home and port instead
  (`REEVE_HOME=<tmp> REEVE_PORT=<port> pnpm --filter @reeve/server dev`, then
  `REEVE_API_PORT=<port> npx vite --port <web-port> --strictPort` in `apps/web`).
- `pnpm check`: format check, lint, React Doctor, typecheck (tsc, then Effect's diagnostics through
  `@effect/tsgo`), `pnpm check:rules`, tests (together `pnpm check:push`, the pre-push hook),
  end-to-end tests, then `pnpm check:desktop`, which builds the web app and `apps/desktop`, fails
  when a bundle loads anything but a Node builtin, `electron` or ws's optional native modules, and
  starts the bundled server and CLI outside the repo.
- `pnpm test` runs Vitest; `npx vitest run packages/engine` runs the engine's tests. Engine tests
  use `scratch()` and `call(name, input)` from `packages/engine/test/helpers.ts`.
- `pnpm test:e2e` runs `packages/e2e/test/*.e2e.ts`: it builds the web app, starts the real server
  per test on a scratch home and a free port, seeds it through operations (`app.run`) and drives
  headless Chromium. It never downloads a browser: `REEVE_E2E_BROWSER`, else Playwright's Chromium,
  else Chrome, Chromium, Brave or Edge. `REEVE_E2E_WEB_DIR` serves an existing build.
- After changing the catalog, `pnpm catalog:generate`; after changing a schema, `pnpm db:generate`.
- `pnpm package`: the macOS app, ad-hoc signed, into `apps/desktop/release/` (gitignored). Try it
  without touching the running app: `REEVE_HOME=<scratch> REEVE_PORT=<port>
  release/mac-arm64/reeve.app/Contents/MacOS/reeve --user-data-dir=<scratch>`. Its CLI is
  `reeve.app/Contents/Resources/bin/reeve`.
- `pnpm brand:generate` draws every logo and icon from `scripts/generate-brand.ts`.
- `pnpm dev:landing` (5630) serves `apps/landing`, never part of `pnpm dev`.

# Scope

What reeve is, what it leaves out, how it uses Actual Budget as the reference, and how it ships on
the desktop.

## reeve replaces Actual for one person on one computer

reeve aims for feature parity with [Actual Budget](https://github.com/actualbudget/actual)'s
budgeting and accounting: accounts, the register, categories and the budget (envelope and
tracking), payees, rules, schedules, budget targets, tags, reports and dashboards. One process owns
the data on one machine, so there is no merge, no conflict resolution and no account to sign in to.

- Never add a sync server, CRDT sync, authentication, the YNAB or Actual importers, or self-update.
- Keep importing bank files (CSV, OFX, QFX, QIF, CAMT), exporting transactions as CSV, and backing
  up and restoring a book (`export_book`, `restore_book`).
- Bank sync is in, read only, through a provider the person registers themselves. Its rules are in
  [bank sync](../bank-sync.md).

Departure from Actual: the data model is a double-entry ledger where Actual keeps single-entry
transactions. Nothing syncs with Actual or imports from it, so the model is free to differ; reeve
keeps Actual's results.

## Look in Actual first, then decide

Actual's behavior is the reference, so budgeting rules (envelope rollover, holds, tracking budgets,
rules, schedules) do not drift into new designs.

- Before designing a feature, read how a clone of Actual does it (`packages/loot-core/src/server/`
  and `packages/loot-core/src/shared/`) and port its tests to `packages/engine/test/`.
- reeve does not have to match Actual one to one: fix what is buggy there, handle a case better, or
  go further.
- Write every deliberate departure down where its topic's rules live: what Actual does, what reeve
  does, and why.
- Test reeve against the rules it states, not against Actual's output. No suite runs Actual as an
  oracle ([testing](../testing.md)).
- Bank-file parsers follow Actual's (`transactions/import/`), so a file Actual reads reads the same
  in reeve. Reading a file differently has no upside.

## The name is reeve, lowercase

Write reeve in lowercase everywhere: prose, the wordmark, window titles, the app bundle
(`reeve.app`), the CLI, the MCP server, packages (`@reeve/*`) and the home (`~/.config/reeve`), even
at the start of a sentence. Only environment variables are in capitals (`REEVE_*`).

The code knows no earlier name of the project: add no compatibility layer for one, in variables,
paths or browser preferences.

## The desktop app attaches to the server or spawns one

`apps/desktop` is an Electron shell. It never runs the server in its main process: a crash in the
engine would take the window down, and a second server would start beside a running `reeve serve`.

At launch, and whenever its server is gone, `apps/desktop/src/backend.ts` applies `findServer(home)`
([boundaries](boundaries.md#clients-find-the-server-through-serverjson)):

| `server.json`                                                      | The app                                                  |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| absent, a dead pid, or a refused connection                        | spawns a server child                                    |
| names a server that answers `/api/health` with this version        | attaches to it, and never stops it                       |
| names a server of another version, one that hangs or answers wrong | shows the problem in the window, with Try Again and Quit |
| does not read as `ServerInfo`                                      | shows the problem in the window, with Try Again and Quit |

- The child is the app's own binary with `ELECTRON_RUN_AS_NODE=1` running the bundled `server.mjs`
  (`apps/desktop/src/server.ts`). It reports over IPC that it listens or why not, and closes
  cleanly, removing its `server.json`, on SIGTERM, SIGINT or when the IPC channel drops.
- A new child listens on `REEVE_PORT` or 4620, a restarted one on the port of the child before it,
  so the window's origin stays the same. When the port is taken, the app probes again and attaches,
  or spawns on any free port.
- An attached server is checked every second; when it ends or `server.json` stops naming it, the
  app applies the table again.
- A child that exits, or does not listen within 20 s, is replaced after a backoff from 0.5 s,
  doubling. One that ran 30 s counts as healthy. After five failures in a row the window shows "The
  reeve server keeps stopping" with the child's last stderr lines.
- The window loads the web app from the server's own origin, so every request is same-origin. In
  development it loads Vite (`REEVE_DEV_URL`).
- Show a problem as a page in the window, never a native dialog. Replace or stop nothing without
  the person.
- Quitting stops the child the app spawned (SIGTERM, then SIGKILL after 5 s). An attached server
  keeps running.
- The app ships the `reeve` CLI; installed in an Applications folder, it links `~/.local/bin/reeve`
  to it when no working `reeve` is there (`apps/desktop/src/cli-link.ts`).
- There is no update channel: `pnpm package` builds the macOS app with `publish` off, ad-hoc signed
  and not notarized. A new version is a new build.

The app runs bundles, not the TypeScript sources the tests run, so a bundle that loads a module it
does not carry would only fail in the app.

Enforced by: `scripts/check-desktop.ts` (the last step of `pnpm check`)

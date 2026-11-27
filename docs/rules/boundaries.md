# Boundaries

How the code is split and where each job lives: the book file, undo, the packages, the operation
catalog and the surfaces it generates, and how clients reach the server. Which process and package
does what today is described in [architecture](../architecture.md).

## Packages depend in one direction

`contract` <- `engine` <- `mcp` <- `server` <- `cli`, with `client` on the engine and `ui` <-
`apps/web`. The desktop app depends on all of them and ships the CLI.

| Package    | Holds                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------- |
| `contract` | schemas and errors, the operation catalog, the HTTP API, the `fetch` clients, pure functions |
| `engine`   | the domain on SQLite: `db/`, `ledger/`, `budget/`, one folder per further domain, `Books`    |
| `mcp`      | MCP tools generated from the catalog                                                         |
| `server`   | the HTTP server: API, MCP over HTTP, change feed, web app                                    |
| `client`   | `connect()`: a running server, or the engine in-process                                      |
| `cli`      | the `reeve` commands generated from the catalog                                              |
| `ui`       | the UI kit; imports no reeve package                                                         |

- Keep a domain (ledger, budget, rules, schedules, imports, reports, templates, bank) as a folder
  inside `engine`. They share one book handle and one transaction per operation, so a package each
  would add build edges without isolating anything.
- Put a rule both the engine and the browser need once, as plain code in a `@reeve/contract`
  module (`rules.ts`, `receipts.ts`, `targets.ts`, `monte-carlo.ts`), never copied.

Enforced by: `.oxlintrc.json` `no-restricted-imports` (`packages/contract/src/**`,
`packages/ui/src/**`, `packages/engine/src/**`)

## The browser bundle never holds the engine

The browser bundle (`apps/web`, `apps/landing`, the desktop preload) never imports `@reeve/engine`,
Drizzle or Node modules: it reads and writes through the server. It may import any entry of
`@reeve/contract`, whose own lint keeps out Node and the engine, and Effect.

Use Effect in the browser where it replaces hand-written code (state machines, retries, validating
with the contract's schemas). It costs about 15 KB gzipped, 28 KB with Schema and Stream.

Enforced by: `.oxlintrc.json` (`apps/web/src/**` and `apps/desktop/src/preload.ts`; `apps/landing`
is not covered)

## A book is one SQLite file, read through Drizzle

A budget is many small rows queried in aggregate, and every write must be atomic, so a book is one
SQLite file, as in Actual.

- A book is `<home>/books/<id>.sqlite`. `<home>` is `REEVE_HOME`, else `$XDG_CONFIG_HOME/reeve`,
  else `~/.config/reeve` (`defaultHome` in `engine/src/home.ts`). The id is a slug of the book's
  name, made unique with a number.
- `<home>/config.json` names the default book. An operation that takes `book` uses it when `book`
  is left out or is `~`; with no default the first book is used, and with no book at all the first
  call creates "My Budget" (`Books` in `engine/src/books.ts`).
- Book settings (name, currency, budget type, formats) are rows of `settings`.
- Read and write through Drizzle (`book.db`); send aggregate SQL to the `node:sqlite` client
  (`book.client`).
- `openDatabase` (`engine/src/db/open.ts`) sets WAL, foreign keys, `synchronous = NORMAL` and a
  10 s busy timeout, and applies pending migrations.
- Change the schema only in the files `packages/engine/drizzle.config.ts` lists (`engine/src/db/schema.ts`,
  `engine/src/receipts/schema.ts`, `engine/src/bank/schema.ts`), with snake_case column names
  spelled out, then run `pnpm db:generate`. It writes a migration under
  `packages/engine/drizzle/` and bundles every migration into `db/migrations.gen.ts`, so no bundle
  needs migration files at run time.
- Never edit a committed migration.
- A write operation is one `BEGIN IMMEDIATE` transaction. An operation declared `network: true`
  gets none: it opens one around each write so no HTTP call holds the lock. Two processes on one
  book take turns through SQLite's lock.
- A backup is a consistent copy of the file (`export_book`); `restore_book` opens it as a new book.
  Deleting a book removes the file and its `-wal` and `-shm` siblings.

## Undo records the reverse SQL of every write

reeve has many write paths, and a hand-written inverse for each would be large and easy to get
wrong. So triggers do it, after the SQLite documentation's undo/redo technique.

- `installUndoTriggers` makes insert, update and delete triggers on every table in `UNDONE_TABLES`
  that write the reversing SQL into `undo_log` while `undo_state.active` is set. They are rebuilt
  at each open from the tables' current columns, so a migration never leaves one stale.
- Each write operation is one undo step; a new step clears the redo stack; undo keeps 100 steps
  (`UNDO_DEPTH`). `undo` and `redo` are operations.
- Never hand-write an inverse for an operation.
- Add a new table to `UNDONE_TABLES`, unless undo must not touch it (`seen_imports`, the bank
  tables).
- Creating a book writes its settings and default categories without recording, so the first step
  cannot undo the book itself.
- Undo reverses rows, not intent: an operation that changes many rows is one step.

Enforced by: `packages/engine/test/properties/properties.test.ts` ("records undo for every table
but the bookkeeping")

## One catalog generates every surface

Written by hand, HTTP, MCP and the CLI would drift. Each operation is declared once, as data, in a
`contract/src/catalog/<domain>.ts` file; `contract/src/catalog.ts` merges them into `catalog`.

- `catalog` keeps every definition, frozen ones included. Public surfaces and generators read
  `availableCatalog()`, which leaves out what `FEATURES` in `@reeve/contract/features` turns off.
- An entry (`Operation` in `contract/src/operation.ts`) has a `description`, `readonly`, a flat
  `input` struct, its `success`, its `error` union, `http: { method, path }` and an optional `cli`.
  Each `:name` in the path is the input field `name`; the other fields are a `GET`'s query or the
  body.
- The generators: `operationsGroup` in `contract/src/api.ts` (HTTP), `packages/mcp` (MCP tools),
  `packages/cli/src/commands.ts` with `schema-flags.ts` (commands and flags),
  `packages/cli/src/skill.ts` (the agent skill), `scripts/routes.ts` (the browser's route table).
- Never write an endpoint, MCP tool, CLI command or skill line by hand. Only the CLI commands that
  are not operations (`serve`, `mcp`, `skills export`) and the endpoints `/api/health`,
  `/api/connection` and `/api/events` (`AppGroup`) are hand-written.

Enforced by: `pnpm typecheck` (`handlers` is checked against the catalog: a missing handler, or one
whose types differ from its entry, fails)

## Adding an operation

1. Add one entry to `contract/src/catalog/<domain>.ts`.
   - The input is one flat struct. A `book: BookField` field makes it run in a book; use `inBook()`
     for its errors.
   - Give a `cli` entry when it makes sense on the command line. Fields with no command-line form,
     such as arrays of structs, are left out of the CLI automatically.
   - Declare `network: true` when the handler calls the network.
2. Add its handler in that domain's `engine/src/<domain>/handlers.ts`, typed with
   `DomainHandlers` (core domains: `engine/src/operations.ts`).
   - A book handler is a plain synchronous function `(book, input) => result`. The runner opens the
     book, runs a read directly and a write in one transaction (one undo step), and announces a
     write on the change feed.
   - Throw `invalid(message)` or `notFound(entity, id)` from `engine/src/book.ts` for the
     operation's failures. Anything else becomes a `StorageError`.
3. Run `pnpm catalog:generate`. It rewrites `contract/src/routes.gen.ts` and
   `.agents/skills/reeve/SKILL.md`; without it the browser calls a stale path.

## Errors go on the wire with their tag and fields

The API is `effect/http-api`, defined in `@reeve/contract/api` under `/api`. One router serves it,
MCP at `/mcp` and the built web app, with OpenAPI at `/api/openapi.json`.

- Every error is a `Schema.TaggedError` with its HTTP status: `BookNotFound` and `NotFound` 404,
  `InvalidRequest` 400, `StorageError` 500. On the wire it is `{ "_tag", ...fields, "message" }`
  (`wireError` adds the message). MCP tool errors carry the same body. A client branches on `_tag`;
  `@reeve/client` decodes the body back into the engine's tagged error.
- A request that fails its schema is an `InvalidRequest`. An `/api` path with no endpoint is a JSON
  404 `{ _tag: "RouteNotFound", message }`, never the web app. A body of a content type the route
  does not take is a 415 with an `InvalidRequest` body.
- A query `null` is an empty value (`?field=`), read back as null for a field that takes it.
- The typed client uses each schema's `Type` as the wire type, so keep domain schemas free of
  transforms.
- Pin `effect` to an exact version in every `package.json`: the HttpApi modules are unstable.

## The browser calls operations by name

The catalog already says each operation's method, path and the split of its input, so the web app
never repeats them.

- Call an operation in `apps/web` only through `run(name, input)` from `lib/api.ts`
  (`createOperations` in `@reeve/contract/operations`, over the generated `routes.gen.ts`). It
  takes the same flat input MCP and the CLI take. Never fetch a route by hand.
- Key every query of a book by `["book", id, name, input]` (`bookKey`, `bookQuery`). A mutation in
  a book invalidates `["book", id]` when it settles.
- The change feed (`/api/events`) sends `{ book }` after each write and a `ping` every 25 s; the
  sync provider invalidates that book's queries, and every query after a reconnect. So a change
  from anywhere, undo from the CLI included, refreshes every view of that book and no other.

## The server has no authentication and listens on loopback only

reeve runs for one person on one computer, so there is no token, session or pairing.

- Bind to `127.0.0.1` only (`LOOPBACK` in `packages/server/src/index.ts`). Add no option that binds
  elsewhere, and no authentication.
- The server refuses a request whose `Host` is not a loopback address with a 403, against DNS
  rebinding. A page on another origin is stopped by the browser: operations take only JSON, which
  needs a preflight nothing grants.
- `server.json` holds no secret.
- Reaching reeve from another device would have to be designed as one piece first.

Enforced by: `packages/cli/test/server-host.test.ts`

## Clients find the server through server.json

The CLI and the stdio MCP server can embed the engine or send each call to a running server. SQLite
keeps a book correct either way, but only the server announces changes on the feed the web app
listens to.

- `startServer` writes `<home>/server.json` (`{ url, pid, version }`, `ServerInfo`) once it
  listens, through a temporary file and a rename, and on close removes it only if it still names
  this server. `version` is `VERSION` from `@reeve/contract/api`.
- Only servers write `server.json`. A client never deletes it; the next server overwrites a stale
  one.
- `connect({ home })` in `@reeve/client` picks where each call runs:

| `server.json`                                               | The call                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------- |
| absent, or names a pid that is not running                  | runs on the engine in this process                                    |
| names a running pid, and the connection to `url` is refused | runs on the engine in this process                                    |
| `/api/health` answers with this version and `operations`    | goes to the server over HTTP                                          |
| `/api/health` answers with this version but no `operations` | runs on the engine in this process                                    |
| `/api/health` answers with another version                  | fails with `ServerMismatch`, which says to restart or stop the server |
| no answer within 2 s, or an answer reeve does not send      | fails with `ServerUnavailable`, which names the url and pid           |
| the file does not read as `ServerInfo`                      | fails with `StorageError` naming the file                             |

A dead pid or a refused connection proves no server is there. A server that hangs or runs another
version is still there, so the client reports it instead of writing behind it.

- A connection probes a server once per url and pid, then trusts it. A long-running `reeve mcp`
  follows a server that starts or stops.
- A call that omits `book` is sent with `~`. A path parameter that is empty, `.` or `..` is an
  `InvalidRequest` in both modes.
- Both modes give the same values and errors.
- `findServer(home)` is the same probe, for `reeve serve` (which refuses to start while a server
  answers) and the desktop app.
- The Vite dev server proxies `/api` to the server `server.json` names, unless `REEVE_API_PORT`
  pins it.

## One server runs per home

Two servers started together would both pass the `server.json` check, so the claim is a lock.
`startServer` calls `claimHome` (`packages/server/src/home-claim.ts`) before it listens: an
exclusive, no-wait transaction on `<home>/.server-lock`, held until the server closes. A second
server throws `HomeTaken` (`code` `REEVE_HOME_TAKEN`). The OS releases the lock when its holder
dies, even on SIGKILL, so a stale `server.json` never blocks the next server.

## An input field the operation does not declare is an error

A struct drops keys it does not declare, so an agent's guessed field name would be silently
ignored and write wrong data that looks right.

- Every surface reads an input with `INPUT_PARSE_OPTIONS` (`contract/src/operation.ts`:
  `errors: "all"`, `onExcessProperty: "error"`). An undeclared key at any depth is an
  `InvalidRequest` naming its path, with every problem of the input at once.
- `runOperation` checks every input with `checkInput` before it runs. HTTP decodes path, query and
  body with the same options, MCP marks every tool `Tool.Strict`, the CLI's `schemaFlags` decodes
  with them, and `connect()`'s HTTP backend encodes with them.
- Never pass an output back as an input by spreading it: pick the input's fields
  (`import_transactions` takes `preview_import`'s rows without `index`, `categoryName`, `status`
  and `match`).
- Adding an input field is never breaking; removing or renaming one is.

Enforced by: `packages/engine/test/inputs.test.ts`, `packages/cli/test/inputs.test.ts`

## Arithmetic runs in the engine, not in React

Every surface (web, CLI, MCP, agents) reaches the same operations, so arithmetic only the browser
runs is arithmetic agents cannot use.

- Put report, forecast and simulation arithmetic in an engine operation, or in a pure
  `@reeve/contract` module the engine runs too. The page draws what the operation returns.
- Departure from Actual: Actual builds the balance forecast and runs the Monte Carlo simulation in
  the browser. reeve's `balance_forecast_report` returns everything the page draws, and
  `monte_carlo_report` runs the simulation (`@reeve/contract/monte-carlo`) in the engine.
- Seed every simulation (`seed`, 1234 by default, as Actual), so a plan always gives the same
  result and tests are exact. Return typed arrays as plain arrays.

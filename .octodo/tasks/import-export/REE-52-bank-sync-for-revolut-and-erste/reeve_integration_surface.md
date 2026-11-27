# reeve integration surface for bank sync: implementation map and design constraints

Method: code reading only, nothing executed. Every `path:line` is relative to the repository root and reflects the working tree on 2026-11-02, which has uncommitted changes (among them `packages/engine/src/db/schema.ts`, `packages/engine/src/operations.ts`, `packages/contract/src/domain.ts`), so some line numbers may shift once those land. Claims about behavior are traced through the code, not observed at run time. Provider facts (what Revolut, Erste or an aggregator require) are outside this note.

## What [scope rules](../../../../docs/rules/scope.md) and [boundaries rules](../../../../docs/rules/boundaries.md) require, and what they imply for credentials and outbound calls

### Takeaway

Only 0001 is directly contradicted and needs superseding. 0009 still holds on loopback and no login, but its accepted risk must be reopened because a bank connection raises what a hostile web page can do. 0003, 0006, 0010 and 0012 need amending, 0011 and 0015 stay as they are, and 0019 sets a principle the new code should follow. Together they say that secrets stay out of the book file, out of `server.json` and out of every operation's input and output, and that outbound calls happen in the engine but outside any SQLite transaction.

### Cited Findings

- 0001 lists "bank sync" as left out and keeps only bank files plus backup and restore: `docs/rules/scope.md:22`, `:24`. The same exclusion is in `CLAUDE.md:5` and `CLAUDE.md:112`.
- 0001 also says "One process owns the data on one machine... no merge, no conflict resolution and no account to sign in to": `docs/rules/scope.md:29`.
- 0009: no token, session or pairing (`docs/rules/boundaries.md:14`), bound to 127.0.0.1 with no option to change it (`:15`), and `server.json` holds no secret (`:17`). The bind is in code at `packages/server/src/index.ts:45`.
- 0009 records as "known and accepted" that a web page in the same browser can send requests to the server, and that a page rebinding its domain to 127.0.0.1 can read a book: `docs/rules/boundaries.md:25`. I found no CORS, Host or Origin handling in `packages/server/src`, `packages/contract/src/api.ts` or `packages/mcp/src` (grep for `cors`, `allowedOrigin`, `.origin` returned nothing). Only `/mcp` gets an Origin check, from the library (`0009:23`).
- `packages/server/src/index.ts` answers a non-JSON body with 415 only after HttpApi refuses it (`UnsupportedMediaTypeAsJson`, around `:88-104`), so a plain cross-site form post to an operation does not get through. A JSON POST would need a preflight, which nothing grants. DNS rebinding sidesteps both.
- 0003: "A handler is a plain synchronous function" (`docs/rules/boundaries.md:22`), a write is one `BEGIN IMMEDIATE` transaction (`:34`), and a backup is a copy of one file (`:39`).
- 0006: an entry generates an endpoint, an MCP tool, a CLI command and a skill line with no other code (`docs/rules/boundaries.md:38`). It explicitly allows non-operation CLI commands (`serve`, `mcp`, `skills export`) and non-operation HTTP endpoints (`:43-44`).
- 0010: with no server the call runs on the engine in-process (`docs/rules/boundaries.md:33`), and only the server announces changes on the feed (`:10`).
- 0011: one server per home, enforced by `<home>/.server-lock` (`docs/rules/boundaries.md:16`, `:25`).
- 0012: the server is a child with `ELECTRON_RUN_AS_NODE=1` (`docs/rules/scope.md:27`), may land on any free port (`:33`), and quitting stops a spawned child while an attached server keeps running (`:51-52`). The app is ad-hoc signed and not notarized (`:63`).
- 0015: an undeclared key at any depth is an `InvalidRequest` on every surface (`docs/rules/boundaries.md:16`). `runOperation` is where that is checked (`packages/engine/src/operations.ts:208`), so a direct call to `importRows` bypasses it.
- 0019: "every surface (web, CLI, MCP, agents) reaches the same operations, so arithmetic that only the browser runs is arithmetic agents cannot use": `docs/rules/boundaries.md:15`.
- There is no prior design to build on: "bank sync" appears only in 0001 and `CLAUDE.md`, and no provider name (GoCardless, SimpleFIN, Enable Banking, PSD2) appears in `docs`, `.octodo`, `apps/web/src` or `packages/*/src` (grep). `octo ls` shows no sync task.
- The engine makes no network calls today. `fetch(` appears only in `packages/client/src/connect.ts:67` (the local health probe) and `apps/desktop/src/main.ts:47` (waiting for Vite).

### Inferences

Change list by decision:

| Decision   | Action                                                                           | Why                                                                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0001       | Supersede with a new decision (next free number is 0026, as 0025 is uncommitted) | Moves bank sync from left out to in scope. Keep the other exclusions. "Local-first" survives if no budget data goes anywhere but the bank or aggregator read path                     |
| 0009       | Amend                                                                            | Keep loopback and no login. Reopen the accepted risk: at minimum add a Host check (defeats rebinding) and an Origin check on sync routes. Add that secrets are never in `server.json` |
| 0003       | Amend                                                                            | Add a kind of operation that does network work outside its transaction, and state what a book file must never hold                                                                    |
| 0006       | Amend                                                                            | Add a way to keep an operation off a surface (no such field exists), or record that secret-bearing flows are hand-declared endpoints                                                  |
| 0010       | Amend                                                                            | Add what a redirect-dependent flow does when the call would run embedded                                                                                                              |
| 0012       | Amend only if a deep link or `safeStorage` IPC is adopted                        | A loopback callback needs no desktop change                                                                                                                                           |
| 0011, 0015 | No change                                                                        | The lock helps (one callback listener per home). Provider rows must be picked field by field, never spread                                                                            |
| 0019       | Follow                                                                           | The connect orchestration, sync logic and status belong in the engine, not in React                                                                                                   |

Also to update in the same change, per `CLAUDE.md`: `CLAUDE.md:5` and `:112`, `docs/architecture.md`, `docs/decisions/README.md`, the hand-written MCP `INSTRUCTIONS` (`packages/mcp/src/index.ts:8`, not generated) and the skill's description in `packages/cli/src/skill.ts`.

Credential placement implied by these decisions: not in the book (export copies it), not in `server.json` (0009), not in `config.json` (see the schema question), and not in any catalog input or output (MCP transcripts, CLI history, OpenAPI).

Outbound call placement implied: in the engine, since the embedded engine must behave like the server (0010) and agents must reach it (0019), but never inside `inTransaction`.

### Gaps

- Whether a Host check breaks the dev flow needs testing. Vite proxies `/api` and `/mcp` (`apps/web/vite.config.ts:77-79`), and I did not check what Host header the proxy forwards.

## The existing import pipeline: dedupe, reuse for fetched rows, rules, pending vs booked

### Takeaway

`importRows` already takes parsed rows and is the right core, but it is a port of only "the parts a file import uses" of Actual's `reconcileTransactions`, so it cannot be reused unchanged. Four gaps matter: an imported id lives on the transaction, not the posting, which breaks transfers between two linked accounts; pending is not represented, and a match never updates amount or date; deleted transactions come back; and strict id checking is hard-wired on, which creates duplicates at the cutover from file imports.

### Cited Findings

Shape and entry points:

- The header states the scope: Actual's reconciliation, "the parts a file import uses": `packages/engine/src/imports/reconcile.ts:1-6`.
- `import_transactions` takes `rows` or a file, not both: `packages/engine/src/imports/handlers.ts:45-55`, schema at `packages/contract/src/catalog/imports.ts:215`. `preview_import` takes files only (`handlers.ts:21-22`). A preview of rows is `import_transactions` with `dryRun`.
- Internal signature is `importRows(book, account, rows, options)`, synchronous: `reconcile.ts:249`. `RowToImport` needs an `index`, date, integer amount, payee, importedPayee, notes, category, importedId, cleared, skip, forceAdd: `reconcile.ts:18-30`. Catalog form: `packages/contract/src/catalog/imports.ts:40`.

Dedupe:

- Pass 1, exact: same `imported_id` among transactions with a posting on this account: `reconcile.ts:151-158`. The account scope comes from the posting join in `inAccount` (`reconcile.ts:67-73`).
- Fuzzy candidates: exact posting amount within plus or minus 7 days: `reconcile.ts:54`, `:159-172`. Ordered nearest day first, then no imported id first: `compareFuzzyMatchCandidates` at `reconcile.ts:83-92`.
- Pass 2 takes a candidate with the same payee, pass 3 any candidate, each candidate used once: `reconcile.ts:176-195`.
- With strict checking and a row that has an id, only candidates with `imported_id IS NULL` qualify: `reconcile.ts:167-169`. `strictIdChecking` defaults to true (`reconcile.ts:292`) and no caller sets it: it appears only at `reconcile.ts:39` and `:292` in `packages/engine/src` and `packages/engine/test` (grep). The handler passes only `reconcile`, `dryRun` and `titleCase`: `handlers.ts:56-60`.
- A match is merged: id and imported payee overwritten, notes and payee filled if missing, category only if uncategorized, cleared can only rise: `mergeInto`, `reconcile.ts:198-239`, with cleared at `:212`. Date and amount are never changed there.
- A reconciled match is locked and reported as `duplicate`: `reconcile.ts:300-307`.
- Nothing is unique: `transactions` has indexes on date, payee and schedule only: `packages/engine/src/db/schema.ts:99-101`. Two rows with the same id in one batch would both be added, because matching runs before any write (`reconcile.ts:289-293`, then the write loop).

Rules:

- Rules run on every row in `importRows` (`reconcile.ts:290`), and a new row then goes through `addEntry` using the unruled draft (`:310`), which runs them again (`packages/engine/src/ledger/transactions.ts:192-193`). `settle` only reads and marks a new payee with a placeholder (`packages/engine/src/rules/transaction.ts:17`, `:170-178`), so the dry run writes nothing.
- Matching uses the rule-changed amount, date and payee: `reconcile.ts:150-172`.
- `importedPayee` is what rules see as `imported_payee`: `rules/transaction.ts:155`. When a row has none, it falls back to the title-cased payee: `reconcile.ts:112-115`.
- `learnCategories` runs for `createTransaction` (`transactions.ts:235`), and I saw no call in `importRows`.

Pending vs booked:

- Not represented. Grep for `pending` and `booked` in `packages/engine/src`, `packages/contract/src` and the register UI matched only the word "spending". The closest state is `postings.cleared` and `postings.reconciled`: `schema.ts:122-123`. The register shows "Reconciled", "Cleared" or "Not cleared": `apps/web/src/routes/ledger.accounts.$account.tsx:804`.
- A row with no `cleared` defaults to cleared: `reconcile.ts:124`.

Double-entry and transfers:

- `importedId` and `importedPayee` are on `transactions`, not `postings`: `schema.ts:93-95`.
- `draftOf` always sets `transferAccount: null` (`reconcile.ts:121`) and rules keep the entry's own value (`rules/transaction.ts:218`), so a rule cannot turn a row into a transfer. `payees` has no transfer link either (`schema.ts`, `:75`).

Deletion:

- `deleteTransactions` is a hard delete: `transactions.ts:428-435`. There is no tombstone column in `transactions` (`schema.ts:84-103`).
- `mergeTransactions` keeps `keep.importedId ?? drop.importedId`, so the dropped row's id is lost when both have one: `transactions.ts:468`.
- REE-23, "Setting: re-import transactions that were deleted", is a backlog stub with no body: `.octodo/tasks/import-export/REE-23-setting-re-import-transactions-that-were-deleted/task.md`.

Other:

- `checkAccount` requires asset or liability and does not refuse a closed account: `reconcile.ts:241-247`.
- `amountToInteger` is `Math.round(amount * 100)`: `packages/engine/src/imports/fields.ts:36`. Accounts have no currency column (`schema.ts:46-73`), and the book's `currency` is "display only": `packages/contract/src/domain.ts:65-66`.
- Tests to extend: `packages/engine/test/imports-reconcile.test.ts` (23 tests).
- Receipt auto-apply is a wrapper around receipts writes (`packages/engine/src/receipts/auto.ts:74-81`, [purchases rules](../../../../docs/rules/purchases.md)), so an imported transaction does not itself trigger it.

### Inferences

Traced failure modes for fetched rows, in order of severity:

1. **Transfer between two linked accounts duplicates.** Say a transfer transaction T has postings on A and B. A's row matches T and writes `T.imported_id = idA`. B's row then finds no id match and, under strict checking, T is excluded from fuzzy candidates because its id is no longer null (`reconcile.ts:167-169`). B's row is added as a new transaction, double-counting. The same is true for bank files today, but regular sync of two linked accounts makes it routine. One column per transaction cannot hold two banks' ids. Fix options: `postings.imported_id`, or a side table `(account_id, imported_id, transaction_id)`. The side table also solves point 3.
2. **Pending to booked duplicates or goes stale.** If pending rows were imported with an id and the bank issues a different id on booking, strict checking excludes the old row and a duplicate is added. If the id is stable but the amount settles differently, `mergeInto` leaves the old amount. A pending row that vanishes is never removed. The simplest correct first version imports booked rows only. Supporting pending needs a status column, amount and date update on merge, and a sweep that deletes vanished unreconciled pending rows.
3. **Deleted or undone rows return.** A hard delete or an undo removes the id, so the next overlapping fetch adds the row again. With files this needs a person to re-import; with a periodic sync it happens by itself, and looks like undo not working. This raises REE-23 from low priority to a requirement: keep a record of dismissed ids outside undo.
4. **Cutover duplicates.** Rows imported earlier from OFX or CAMT have a bank-file id. A synced row with a provider id cannot fuzzy-match them under strict checking, so overlap is duplicated. Options: pass `strictIdChecking: false` for the first sync of a link, or start the link's history at a date the user picks. `startDate` already exists for files (`catalog/imports.ts`).
5. **Unrecognized transfers count as spending.** A transfer between two linked accounts arrives as two independent uncategorized transactions, so transfer detection (opposite amount, nearby date, both linked) is new work.
6. **Multi-currency.** With no account currency, each foreign-currency pocket would need its own account, and nothing checks that the provider's currency matches. The adapter should parse decimal strings directly to minor units rather than going through float `amountToInteger`.
7. **Provider duplicates in a batch** need deduping by id in the adapter, or a uniqueness constraint in the side table. An index on the imported id is cheap to add.

What can be reused as is: rule running, payee normalization, the three-pass fuzzy match, category-only-if-uncategorized merging, the reconciled lock, `dryRun`, and `ImportStatus`. Fuzzy matching against hand-entered transactions (null id) works today. A correctly built transfer also dedupes for its first leg because candidates are found by posting.

### Gaps

- **Actual's real behavior could not be checked.** `CLAUDE.md` calls a clone the reference, but no `loot-core` directory exists within five levels of `~` (excluding `node_modules` and `Library`). From memory only, and to verify: Actual's `reconcileTransactions` has bank-sync parameters including `isBankSyncAccount`, `strictIdChecking` and `updateDates`, filters tombstones unless a re-import setting is on, has a per-account pending-import setting, and derives cleared from booked. The bank-sync code should be read before designing, as `docs/rules/scope.md:19-21` requires.
- Whether the banks keep the transaction id stable from pending to booked is a provider question. It decides failure mode 2.

## Schema needs, undo, and where secrets must live

### Takeaway

No sync state exists in the schema today. Link rows and cursors can go in the book in new tables kept out of `UNDONE_TABLES` and added to restore's skip list, following the isolated-module precedent of receipts. Tokens, keys and consent or session identifiers must not go in the book at all, because `export_book` copies every table with `VACUUM INTO`, including `undo_log`. They also do not fit in `config.json` or `server.json`.

### Cited Findings

- `accounts` has no provider, link, sync or currency columns: `schema.ts:46-73`. `transactions` has `imported_id` and `imported_payee`: `schema.ts:93-95`. `postings` has no imported id: `schema.ts:105-130`.
- Key-value `settings` is an undone table: `packages/engine/src/db/open.ts:14-15`. `get_book` exposes settings (`operations.ts`, `get_book` handler), though `readSettings` decodes through the `BookSettings` struct: `packages/engine/src/book.ts:46-50`.
- `UNDONE_TABLES` is an allow-list, and triggers are rebuilt at each open from it: `open.ts:14-38`, `:117-122`. A new table is not undone unless listed, although `CLAUDE.md:102` tells authors to add a new table to it, so an exclusion needs recording.
- `inTransaction` with the default `record: true` clears the redo stack on every call, whether or not anything changed: `open.ts:130-141`. Undo keeps `UNDO_DEPTH = 100` steps: `open.ts:41`.
- The hourly schedule run uses that default: `packages/engine/src/books.ts:79`.
- `export_book` is `VACUUM INTO`, which copies the whole database: `packages/engine/src/imports/export.ts:122`. Restore copies every table except `__migrations`, `undo_log` and `undo_state`: `export.ts:136`, with the table list at `:172-179`. So `undo_log` is in the backup file, though not restored. It holds reverse SQL with the old values of every undone table: `open.ts:77-114`, `schema.ts:238`.
- `<home>` is `REEVE_HOME`, else `$XDG_CONFIG_HOME/reeve`, else `~/.config/reeve`: `packages/engine/src/home.ts:19-20`.
- `config.json` has a struct with only `defaultBook`: `home.ts:36`. `readHomeConfig` swallows all errors and returns `{}`: `home.ts:39-46`. Deleting the default book writes `{}`: `books.ts:212`.
- `server.json` is `url`, `pid`, `version` (`packages/contract/src/domain.ts:446-450`). It is read by every client on every call (`packages/client/src/connect.ts:141`).
- `writeFileAtomic` writes with no mode: `home.ts:30-34`.
- `removeBookFiles` removes the book's files and its receipts folder: `home.ts:63-67`. A book handler can find its home via `homeOfBook`: `home.ts:27`.
- `closeAccount` may delete the account row outright: `packages/engine/src/ledger/accounts.ts:198`. Foreign keys are on: `open.ts:119`.
- Isolation precedent: the receipts module has its own tables in `receipts/schema.ts`, which point at ledger rows while the ledger never points back ([purchases rules](../../../../docs/rules/purchases.md), `CLAUDE.md`). Drizzle reads both schema files: `drizzle.config.ts:5`.

### Inferences

Suggested placement:

| Data                                                                                                                | Where                                                                                                      | Undone?                     | In `export_book`? | Restored?                                                                                             |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------- |
| Link: account id, connection id, provider account id, last sync time, cursor or last booked day, last error, status | New book tables, in `engine/src/banksync/schema.ts`, with cascade from `accounts`                          | No                          | Yes, not secret   | No: add to `SKIPPED_TABLES` so a restored copy does not sync a second book from the same bank account |
| Imported ids per account, including dismissed ones                                                                  | New book table                                                                                             | Needs a decision, see below | Yes               | Yes                                                                                                   |
| Connection metadata: provider, consent expiry, reauth state                                                         | `<home>/bank-connections.json` or a home-level SQLite file, because one consent can cover several accounts | n/a                         | No                | n/a                                                                                                   |
| Tokens, private key, session or consent ids that act as bearer values                                               | OS keychain, see the Electron question                                                                     | n/a                         | No                | n/a                                                                                                   |

Rules that follow from the code:

- **Never put a secret in `settings` or any undone table.** Even after deletion it would linger in `undo_log`, and that travels in the backup.
- **Never extend `config.json` for this.** Unknown keys are dropped on decode and the file gets rewritten by `setDefault` and `remove`.
- **A file-based secret needs a new writer** with mode 0600 and a safe rename, because `writeFileAtomic` uses default permissions (0644 under a typical umask). `~/.config` is also a directory people commonly back up or sync with dotfiles.
- **`delete_book` must clean up** links and possibly revoke connections, by extending `removeBookFiles` or the `remove` handler.

Undo design:

- A sync that adds rows should be one normal undo step, as the schedule run is. Running it with `record: false` risks a failing undo: if a user's recorded step created a category and an unrecorded synced row then uses it, undoing that step fails on the foreign key.
- A sync with no change should not call `inTransaction` with `record: true`, since that clears redo every time (`open.ts:141`). Use `record: false` for status-only writes. The hourly schedule run already clears redo each hour (`books.ts:79`): an existing quirk worth fixing at the same time.
- A background step lands on the user's undo stack, so Cmd-Z after a background sync undoes the sync, not their last edit. The UI should say so, for example in a toast.
- The cursor stays out of undo, and undone rows must go into the dismissed-id record, or the next overlap fetch re-adds them. Reverse SQL cannot do this, so `undo` needs a hook, or sync treats "id seen before and now absent" as dismissed. Seen-id bookkeeping must be outside `UNDONE_TABLES` for that to work.
- Prefer a date-based overlap window over an opaque cursor alone: since apply is idempotent by id, refetching is safe and it recovers from a crash between fetch and write.

### Gaps

- Whether a provider's session id is a bearer credential on its own, and so which table it belongs in, is a provider question. Default to treating it as secret.
- IBANs and account names in link rows are personal data in backups. The book already holds full transaction history, so I treat this as acceptable, but that is a judgment call for the decision record.

## How to split network fetch from the synchronous handler transaction

### Takeaway

There is precedent for an Effect-returning handler, but only for operations without a `book` field. The cleanest shape is a small new operation kind that keeps `book` in its input and runs in three steps: read the plan, fetch with no transaction open, and apply in one `runInBook` that calls `importRows`.

### Cited Findings

- `Handler<K>` branches on whether the input has `book`. With it, a sync function `(book, input) => result`; without it, `(books, input) => Effect`: `packages/engine/src/handler.ts:22-27`.
- `runOperation` branches the same way: `operations.ts:219-227`. A write goes through `inTransaction`: `operations.ts:197`. `undo` and `redo` are special-cased by name to manage their own transaction: `operations.ts:224`.
- `restore_book` is the closest precedent. It is Effect-based, opens a book itself, does its writes, then calls `books.changed`: `packages/engine/src/imports/handlers.ts:64-90`. `list_books`, `create_book`, `set_default_book` and `delete_book` are also Effect-returning: `operations.ts`, top of `handlers`.
- `runInBook` is exported: `operations.ts:190-199`, re-exported at `packages/engine/src/index.ts:2`. It is one transaction, one undo step, one feed event.
- Grep for `Promise`, `await` and `async` in `packages/engine/src` returns nothing, so the engine has no async code path today.
- `inOneBook` is the presence of a `book` field: `packages/contract/src/operation.ts:102`. It drives the CLI's `--book` (`packages/cli/src/reeve.ts:37`), the client's default `~` (`packages/client/src/connect.ts`, `run`), and the runner.
- `Books` caches one `Book`, so one connection, per id per process: `books.ts:63`, `:83-90`. It uses a 10-second busy timeout: `open.ts:118`.
- Timeout precedent for outbound calls: `Effect.tryPromise` with `AbortSignal.timeout` at `packages/client/src/connect.ts:65-71`.
- `failure` maps anything but `InvalidRequest`, `NotFound` and `BookNotFound` to `StorageError`: `operations.ts:181-188`.
- The bundle check permits Node builtins only (plus `electron` in Electron bundles): `scripts/check-desktop.ts:41-54`. Global `fetch` and `node:crypto` pass; a native add-on would not.

### Inferences

- A fetch inside `inTransaction` is not just slow, it would break other requests. Because a process shares one `DatabaseSync` per book, any other handler that runs while the first awaits would issue `BEGIN IMMEDIATE` on a connection already in a transaction and fail. So the rule is a correctness constraint, not a style choice.
- Using a field other than `book` to fit the existing Effect branch would lose `--book`, the `~` default and the `/books/:book/...` path convention. Better is an `Operation` flag such as `network: true`:
  - `Handler<K>` for it becomes `(book, input, books) => Effect`.
  - `runOperation` opens the book and calls it without wrapping it in a transaction, with a branch next to the `ownTransaction` one.
  - `runInBook` may need to move from `operations.ts` to avoid an import cycle with domain handlers.
- Proposed flow for `sync_bank_account`:
  1. Plan: synchronous read of the link, last sync and rate budget. Fail early with `InvalidRequest` if consent has expired.
  2. Claim: small `record: false` write recording that a sync started, so two processes do not fetch at once (a server and an embedded CLI can both reach this).
  3. Fetch: `Effect.tryPromise` with timeout and no open transaction. Map provider rows to `RowToImport`, picking fields.
  4. Apply: `runInBook(books, book, false, () => { importRows(...); writeSyncState(...) })`. Matching runs inside this transaction on the current data, so a user edit made during the fetch is seen. The cursor commits atomically with the rows. A crash before this just refetches.
- `importRows` can stay synchronous and unchanged in shape.
- Add a typed `BankSyncError` to `inBook(...)` and extend `failure`'s pass-through, so a provider failure stays typed instead of becoming a `StorageError` with its raw `cause` (see the MCP question).
- Adapter location: `packages/engine/src/banksync/`, a provider interface plus one file per provider, with a fake for tests. The dependency direction allows this and the browser never imports the engine. Tests go through `call()` and `scratch()` as `CLAUDE.md` asks, so the fetch must be injectable.

### Gaps

- How much long-running calls strain MCP clients and `connect()`: I saw no request timeout on the server side, but did not check client-side limits. A multi-account sync may need one call per account.

## How a connection or redirect reaches the running app

### Takeaway

A hand-declared GET route on the existing server is the cheapest path: it needs no desktop change, opens the bank in the default browser through code that already exists, and updates the window through the existing feed. Its limits are that the port can move and that nothing listens when no server runs. The CLI can work around the latter by starting a server for the duration, as it already can.

### Cited Findings

Server:

- Hand-written routes coexist with generated ones: `receiptPhotoRoute` runs an operation from an `HttpRouter.add` route: `packages/server/src/receipt-photos.ts:30-46`, mounted at `packages/server/src/index.ts:126`. `AppGroup` is the place for declared non-operation endpoints: `packages/contract/src/api.ts:175-180`.
- `DEFAULT_PORT = 4620`: `packages/server/src/index.ts:42`. The port is not fixed: `REEVE_PORT` (`apps/desktop/src/main.ts`, `startBackend` call at `:177`), `reeve serve --port` (`packages/cli/src/reeve.ts:85`), and the desktop's fallback to any free port (`apps/desktop/src/backend.ts:187`).
- In dev, Vite on 5620 proxies only `/api` and `/mcp`: `apps/web/vite.config.ts:75-79`.
- Request logging is off: `disableLogger: true`, `packages/server/src/index.ts:132`.
- The feed sends `{ book }`: `packages/contract/src/domain.ts:407`, and the web app invalidates that book's queries on it: `apps/web/src/components/sync-provider.tsx:22-24`.

Electron:

- `window.open` and off-origin navigation already go to the default browser: `apps/desktop/src/main.ts:132-135`, `:136-146`.
- No deep link exists: grep finds no `setAsDefaultProtocolClient` or `open-url` in `apps/desktop/src`, and no `protocols` key in `apps/desktop/package.json`. The `second-instance` handler ignores its arguments: `main.ts:154-159`.
- `CLAUDE.md` says the app is used in dev mode for now, so nothing needs packaging until installed.
- `safeStorage` is not used anywhere in `apps/desktop/src` (grep).
- The server child runs with `ELECTRON_RUN_AS_NODE: "1"`: `apps/desktop/src/backend.ts:131`. `server.mjs` and `cli.mjs` must not load `electron`: `scripts/check-desktop.ts:44-54`. The child's one IPC direction today is reporting that it listens or failed: `apps/desktop/src/server.ts:15-19`, `backend.ts:13`.
- The preload exposes a fixed small bridge, sandboxed: `apps/desktop/src/preload.ts:9-23`, `main.ts:120`.

Client:

- With no server the call runs in-process with no listener: `packages/client/src/connect.ts:131-146`. Both backends just call `runOperation` (`packages/client/src/embedded.ts`), so a handler cannot tell which mode it is in. `Books` has no such flag: `books.ts:40-56`.
- The CLI depends on the server package and already starts one in `serve`: `packages/cli/src/reeve.ts:6`, `:83-125`. `findServer` is available: `packages/client/src/connect.ts:101`.

### Inferences

Recommended flow:

1. Web: `begin_bank_connection` returns the bank's URL. `window.open` it, which needs no desktop change, and a plain browser opens a tab.
2. The server keeps the pending `state` (random nonce, target book, expiry). It must survive only as long as the flow, so in memory in the server's scope is enough, and that also makes the state naturally absent in embedded mode.
3. The bank redirects to `GET /api/bank-sync/callback?code&state`. Under `/api` it works through the Vite proxy in dev too. It verifies `state`, exchanges the code with an Effect (no transaction), stores secrets, writes the connection, calls `books.changed`, and answers a small HTML page saying the window can be closed.
4. The window refreshes through the feed; the next step is an account-mapping dialog.

Risks and guards:

- `state` validation is what stops a hostile page from completing a link with an attacker's consent, given 0009's accepted exposure.
- If the provider's registered redirect URI needs an exact port, a server on another port must be detected up front (`url` from the server compared with the expected one) and fail with a clear message. It should not silently redirect to nothing. `reeve serve --port` and the fallback at `backend.ts:187` are both ways to get there.
- A custom scheme (`reeve://`) would be needed only if the provider refuses `http://127.0.0.1`. It costs `protocols` config, `setAsDefaultProtocolClient`, `open-url` and second-instance handling, forwarding to the server, extra work for an unpackaged dev Electron, and it would do nothing for `reeve serve` or the browser. That is why loopback should be tried first.

The no-server case, by operation:

| Operation                                             | Embedded behavior                                                                                                                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sync, status, unlink                                  | Work embedded: no listener is needed                                                                                                                                             |
| Begin connection                                      | Must not silently succeed. Either a server-only capability the runner can see (for example an option on `Books.layer`, set at `index.ts:135`), or CLI-only `reeve bank connect`  |
| `reeve bank connect` (CLI-only, allowed by `0006:43`) | `findServer`, then use it; or `startServer` for the duration of the flow, print the URL, wait for the callback, close. The home lock makes this safe against a concurrent server |
| Fallback                                              | Print the URL and accept the pasted final URL or code if no listener can bind                                                                                                    |

Only the server announces changes (`0010:10`), so an embedded sync does not refresh a window, but that case has no window by definition, unless a server starts right after.

### Gaps

- Whether Revolut, Erste or an aggregator accept `http://127.0.0.1:<port>` as a redirect, and whether the port must be exact, is the most important unknown for this section and belongs to the provider research.
- Electron's `safeStorage` availability under `ELECTRON_RUN_AS_NODE` was not tested. From memory it is not available there. The bundle rule alone already forbids importing `electron` in `server.mjs`.
- macOS keychain behavior for ad-hoc-signed apps (prompts after each rebuild, which identity an item trusts) is not verifiable from this code.

Secret-store consequences, since this section's facts decide them:

- `safeStorage` could only live in the Electron main process. `reeve serve` and the CLI have no main process, so a `safeStorage`-only design would make sync work solely under the desktop app, against 0010's "both modes give the same".
- A native keychain module fails `scripts/check-desktop.ts`.
- Remaining options: macOS `security` through `node:child_process` from any process (a builtin, passes the check, macOS-only, matching the only packaged target at `apps/desktop/package.json`, but note a secret passed as an argument is visible to `ps`, and any process of the user can ask the same tool); or a 0600 file under `<home>`, possibly encrypted, as a fallback for tests and scratch homes. Tests must never touch the real keychain (`CLAUDE.md`: never point a test at a real home), so the store must be an injectable service keyed by home.

## Background scheduling, including when the server is absent

### Takeaway

One periodic mechanism exists: an hourly fiber inside `Books.layer`, which only touches already-open books and also runs in embedded processes. Bank sync should have its own scheduler in `startServer`'s scope with persisted due times. When no server runs, nothing syncs until the next start, unless the user sets up an external trigger.

### Cited Findings

- Hourly fiber: `Effect.forkScoped`, `Schedule.spaced(Duration.hours(1))`, iterating `open.values()`, publishing to the feed on change: `packages/engine/src/books.ts:102-115`.
- It also runs at book open, in a try/catch that logs: `books.ts:93-98`.
- The comment says the hourly run mirrors Actual "when a budget opens and while it stays open": `books.ts:74-77`.
- `Books.layer` is built by both the server (`packages/server/src/index.ts:135`) and the embedded connection (`packages/client/src/connect.ts:131-132`).
- `reeve mcp` is long-lived (`packages/cli/src/reeve.ts:136-148`, and `0010` says it follows a server that starts or stops).
- No other timer: grep for `interval`, `Schedule.` and `setInterval` in `packages/server/src`, `packages/client/src`, `packages/mcp/src` and `apps/desktop/src` found no scheduler. The desktop's one-second attached-server check is described at `0012`. There is no `setLoginItemSettings` or `powerMonitor` in `apps/desktop/src`, and no `.plist` file in the repo outside build output.
- Lifecycle: on macOS closing all windows leaves the app, and so its child, running (`apps/desktop/src/main.ts:169`). Quitting stops a spawned child (`0012:51`).

### Inferences

- Do not put sync in the `Books` fiber. It would run in a stdio `reeve mcp` and in short CLI calls (where it would die mid-fetch). It also misses books not yet opened, and at server start none are.
- Add a `BankSyncScheduler` layer in `startServer`. Every few minutes, enumerate `bookIds(home)` (`home.ts:55-61`), read each link's persisted due time and sync what is due, one account at a time, with jitter and backoff.
- Tick against `last_synced_at`, not a fixed period, so wake from sleep and server restarts catch up, and restarts cannot burst past a bank's request allowance. The allowance must be persisted for the same reason.
- Book open must not fetch: `handle` is synchronous (`books.ts:83`). The scheduler's startup pass covers it.
- A failure must never become a blocking problem. Record it on the link; the UI shows it. Expired consent stops further attempts until reauth.
- With no server: sync does not run. That is honest for a local-first app, and the first start catches up. Options in rising cost: show "last synced" prominently, offer `reeve bank sync` for a user's own cron or launchd entry, and later an optional login item or launchd agent. Note the running-app case is common only once the desktop app is open or `reeve serve` runs.
- A manual "Sync now" and agents' calls share the same claim and budget, so an agent loop cannot burn the allowance.

### Gaps

- The right cadence depends on provider limits (provider research).
- I did not confirm App Nap or sleep effects on the child's timers; designing around persisted due times avoids depending on that.

## MCP and generated surfaces: exposure and keeping secrets out

### Takeaway

Nothing in the catalog can keep an operation off a surface today, because a catalog entry always reaches HTTP, MCP and the skill. The safest design is that no secret ever passes through a catalog operation: credentials enter through a hand-declared endpoint and a CLI prompt, and catalog operations return status only. One error path needs attention: `StorageError.cause` is a wire field.

### Cited Findings

- `Operation` fields: description, readonly, destructive, idempotent, input, success, error, http, optional cli. No surface control: `packages/contract/src/operation.ts:38-51`.
- MCP tools are generated for every operation unless its success is a file: `packages/mcp/src/index.ts:44-46`. `httpLayer` passes the whole catalog (`:107`), and stdio takes `connection.operations` (`packages/cli/src/reeve.ts:143-144`), which is also the whole catalog (`packages/client/src/connect.ts`, `operations`).
- HTTP is generated for every entry: `operationsLive`, `packages/server/src/operations.ts`. OpenAPI is public at `/api/openapi.json`: `packages/server/src/index.ts`.
- The skill lists every operation: `packages/cli/src/skill.ts:19-27`. CLI commands exist only with a `cli` entry: `packages/cli/src/commands.ts:93`.
- MCP annotations come from the entry (`Readonly`, `Destructive`, `Idempotent`): `packages/mcp/src/index.ts:38-41`. These are hints, not enforcement.
- Feed payload is only the book id: `packages/contract/src/domain.ts:407`, sent at `packages/server/src/app.ts:25-31`.
- `StorageError` carries `cause: Schema.Defect()`: `packages/contract/src/domain.ts:436-440`. `wireError` keeps "every field and its message": `domain.ts:487-491`. MCP failures use that form: `packages/mcp/src/index.ts`, `failureOf`. The CLI prints `String(error.cause)`: `packages/cli/src/main.ts:22`. The runner wraps any unknown throw with `message: error.message, cause: error`: `operations.ts:181-188`.
- Logs: request logging off (`packages/server/src/index.ts:132`). The engine's one `console.error` logs the whole error object: `books.ts:97`. The child's stderr is forwarded (`apps/desktop/src/backend.ts:143-144`), and its last lines are shown in the problem page (`0012`, restart section).
- GET operation fields go in the query string: `docs/rules/boundaries.md:19`.
- A field with no command-line form is left out of the CLI, but a string field gets a flag, so a secret would land in shell history: `docs/rules/boundaries.md:42` and `packages/cli/src/schema-flags.ts`.
- `export_book` is itself an MCP tool that writes the whole book to any path: `packages/contract/src/catalog/imports.ts:258`.

### Inferences

Exposure table:

| Capability                                              | Surface                                                          | Agent access                                | Notes                                                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Set provider credentials or key                         | Hand-declared POST route and CLI-only prompt, not in the catalog | No                                          | Never as a flag or MCP argument, so it stays out of transcripts and shell history                 |
| Begin connection                                        | Catalog with a surface flag, or `AppGroup`                       | No                                          | Consent is a human act. The returned URL holds `state`, so keep it out of transcripts             |
| Callback                                                | Hand route                                                       | No                                          | Not an operation at all                                                                           |
| List connections and links, sync status, consent expiry | Catalog, `readonly`                                              | Yes                                         | Fixed success schema with no secret fields. Useful for agents ("your Erste consent expires soon") |
| Sync now                                                | Catalog, write                                                   | Yes, within budget                          | Spends bank requests. Return counts and ids, as `ImportResult` does                               |
| Link or unlink an account to a provider account         | Catalog                                                          | Link: arguable. Unlink: `destructive: true` |                                                                                                   |
| Remove a connection, revoke consent                     | Catalog with a surface flag                                      | No                                          | Reauth needs a person anyway                                                                      |
| Dismissed ids, sync settings                            | Catalog                                                          | Yes                                         |                                                                                                   |

Implementation:

- Add `surfaces?: { mcp?: false }` (or `agent: false`) to `Operation`, filter it in `valueTools` and in `skill.ts`, and decide whether it also hides the HTTP route. It should not, because the web app needs it. Note that agents with shell access can still reach `/api`, so treat this as scoping, not a security boundary. That limit should be written in the decision.
- Use Effect's `Redacted` for secrets inside the engine, so an accidental `String()` or log prints a placeholder.
- The adapter must wrap every provider failure into a typed error with a sanitized message, before it can reach `failure`. Never let a raw fetch error, response body or request (which may carry an `Authorization` header or a code in a URL) become a `cause`.
- Log sync failures by status and provider code only. The child's stderr can appear in the desktop problem page.
- Keep the feed as is: status changes publish `{ book }` and the UI re-queries. No sync detail in events.
- Transaction data already flows through MCP, so bank rows are no new exposure. But imported notes and payee text become agent-visible untrusted content from the outside world, so the decision should mention prompt injection through payee strings, however small the risk.

### Gaps

- I did not verify how `Schema.Defect()` encodes an Error on the wire (message only, or stack as well). Assume the message at least goes out.

## UI: where linking, status and reauth sit; the import dialog; XState

### Takeaway

There are clear homes for each piece: a new Settings section for connections, the account menu and register toolbar for per-account linking and status, and the sidebar for attention markers. The file import dialog can lend its row table but not its flow. XState is used in exactly one machine, whose name collides with this feature, so naming needs care.

### Cited Findings

- Register toolbar: `PageToolbar` with `AccountMenu` at `apps/web/src/routes/ledger.accounts.$account.tsx:321-327`.
- Account menu: "Import transactions…" at `apps/web/src/components/register/account-menu.tsx:62`, "Reconcile…" at `:71`, dialog mount at `:91`. The dialog-switch pattern is `Dialogs = "rename" | "reconcile" | "close"` (`:28`).
- Reconcile dialog takes a statement balance and compares to `account.cleared`: `account-menu.tsx`, `Reconcile`. Account schema has `balance`, `cleared`, `uncleared`: `packages/contract/src/domain.ts:95-109`.
- Sidebar account rows: `AccountLink` at `apps/web/src/components/app-sidebar.tsx:93-94`.
- New account dialog: `apps/web/src/components/account-dialog.tsx`, with an opening balance from the form.
- Settings: sections in `apps/web/src/lib/settings-sections.ts:4-8` (general, books, appearance, agents), page map at `apps/web/src/routes/settings.$section.tsx:14-19`, content in `apps/web/src/components/settings/sections.tsx` (`ReceiptSettings` at `:203`, `Agents` at `:251`).
- Import dialog: `apps/web/src/components/register/import-dialog.tsx`, form at `:84`, status labels at `:58`, `preview_import` at `:96`, `import_transactions` at `:114`. It picks input fields explicitly, as 0015 requires.
- XState: only `apps/web/src/machines/sync.ts` (`syncMachine` at `:57`), driven by `apps/web/src/components/sync-provider.tsx`. Its comment reads "Live sync over `/api/events`": `machines/sync.ts:54`.
- `SyncIndicator` shows "local · live" and says "the books never leave this machine": `apps/web/src/components/sync-indicator.tsx:7-13`.
- The mobile register has no import entry (grep of `apps/web/src/components/mobile/mobile-register.tsx`).
- The phone layout rules and the `ScrollArea` rule apply to new screens (`CLAUDE.md`). The browser bundle may import only types from `@reeve/contract` and listed helpers (`CLAUDE.md`).

### Inferences

Placement:

| Piece                                                   | Where                                                                                                                                                   | Change                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Connections: add a bank, consent expiry, reauth, remove | New `banks` section in `SETTINGS_SECTIONS` plus a page in `components/settings/`                                                                        | Small to medium                         |
| Link this account                                       | `AccountMenu` item, plus a "Link to bank" choice in `AccountDialog` for new accounts                                                                    | Small                                   |
| Account-mapping after consent, with history start date  | New dialog in `components/register/` or `components/bank/`. Must handle mapping to existing or new accounts, on or off budget, and the starting balance | Medium                                  |
| Sync now, last synced, last error                       | Register `PageToolbar`, next to `AccountMenu`                                                                                                           | Small                                   |
| Reauth prompt                                           | Inline banner above the register and a dot on `AccountLink`, linking to Settings                                                                        | Small                                   |
| Balance check                                           | Compare the bank's balance with `account.cleared` in the toolbar or `Reconcile` dialog, prefilling the statement balance                                | Small, once the provider gives balances |
| Sync results                                            | Toast with counts and an undo action. Reuse `STATUS` labels if a review list is added                                                                   | Small                                   |
| Pending display                                         | Only if pending rows are imported: a fourth state beside `$account.tsx:804`                                                                             | Small, driven by the engine decision    |

- The file dialog is built around a file and mapping options, so sync needs its own flow. Extract the row table if a review screen is wanted. Sync, as far as I recall in Actual, has no preview step.
- An XState machine fits the connect flow (idle, starting, waiting for consent, choosing accounts, done, failed, with a timeout), following the setup-and-actors style in `machines/sync.ts`. It listens for the feed's refresh rather than polling. The flow logic stays in the engine per 0019, and the machine holds only UI state.
- Naming: `syncMachine`, `useSync`, `SyncIndicator`, `sync-status` already mean the live feed. Use "bank" names (`bankLinkMachine`, `bank-sync`) and do not overload them. Keep "local · live" unchanged, but its claim stays true only as "budget data does not leave". Review the comment when transaction fetching lands.
- Add to e2e: fake provider in `packages/e2e`, with the callback driven by the test.

### Gaps

- I did not read the whole of `ledger.accounts.$account.tsx` or `sections.tsx`, only the parts cited.

## Relative size per piece

### Takeaway

The whole is large, mostly because of ledger correctness (imported ids, pending, dismissal) and secret and consent handling, not the HTTP calls. The surfaces come almost free from the catalog. The sizes below are relative judgments from reading the code, not time estimates.

### Cited Findings

Each size rests on the code cited in the sections above: operation generation (`docs/rules/boundaries.md:38`), the runner (`packages/engine/src/operations.ts:208-227`), the matcher (`packages/engine/src/imports/reconcile.ts`), the schema (`packages/engine/src/db/schema.ts`), and the module precedent ([purchases rules](../../../../docs/rules/purchases.md)).

### Inferences

| Piece                                                                                                          | Size                                     | Reason                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decisions and docs (supersede 0001, amend 0003, 0006, 0009, 0010; `CLAUDE.md`, architecture, MCP instructions) | S                                        | Writing only, but must precede code                                                                                                                                     |
| Network operation kind in runner and `Handler` type                                                            | S                                        | Small type and branch change. `restore_book` shows the pattern                                                                                                          |
| Book schema: link and sync-state tables, skip list, migration                                                  | S                                        | Generated migrations, receipts precedent                                                                                                                                |
| Imported ids per account and posting, with dismissal; migrate existing `imported_id` values                    | L                                        | Touches matcher, merge, delete, undo and backups. Highest correctness risk and needs porting tests. Cannot be skipped if two linked accounts can transfer to each other |
| `importRows` options: bank-sync behavior, update on merge, cutover handling                                    | M                                        | Contained in one file, but the semantics need care and tests. Actual's code must be read first                                                                          |
| Pending support                                                                                                | M, or zero by importing booked rows only | Status column, update rules, sweep of vanished rows, UI state. Skipping it first is a real option                                                                       |
| Secret store: interface, macOS backend, test backend, 0600 fallback                                            | M                                        | Little code, but the choice has platform and signing consequences that need manual testing                                                                              |
| Provider adapter: one provider, auth, paging, mapping                                                          | M per provider                           | Depends on provider research. An aggregator would mean one adapter for both banks, direct access means two                                                              |
| Connect flow: state, callback route, exchange, account mapping                                                 | M                                        | Route is simple. Failure cases, port mismatch and the CLI path add up                                                                                                   |
| Hardening from 0009: Host and Origin checks                                                                    | S to M                                   | Small middleware, but it must not break dev proxy, the desktop origin or tests                                                                                          |
| Scheduler with persisted due times, backoff and allowance                                                      | M                                        | Must not live in `Books`. Sleep and restart behavior needs testing                                                                                                      |
| Catalog entries and surface flag; MCP and skill filtering                                                      | S                                        | Generators do the work, plus one filter each                                                                                                                            |
| Error sanitizing and typed `BankSyncError`                                                                     | S                                        | Small but easy to miss, with tests that assert no secret appears                                                                                                        |
| Transfer detection across linked accounts                                                                      | M                                        | New logic. Could follow later, but until it exists budgets misreport transfers between linked accounts                                                                  |
| Web: Settings section, mapping dialog, toolbar status, reauth banner, machine, phone layout                    | M                                        | Many small pieces with established patterns                                                                                                                             |
| Fake provider, engine tests, e2e                                                                               | M                                        | `scratch()` and e2e harness exist. Injection seams need to be designed in                                                                                               |
| Deep link                                                                                                      | M, likely avoidable                      | Only if a provider refuses loopback                                                                                                                                     |

Suggested order, since dependencies force it: decisions; read Actual's sync code; imported-id model and matcher changes against a fake provider; runner kind and secret store; one provider end to end from the CLI; connect flow; UI; scheduler; then transfer detection and pending.

### Gaps

- Provider choice can move adapter and connect-flow sizes materially, as can redirect rules.
- Consent renewal frequency, which determines how central the reauth UI must be, is a provider question.

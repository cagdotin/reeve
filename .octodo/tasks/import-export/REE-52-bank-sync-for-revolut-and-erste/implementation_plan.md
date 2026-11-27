# How to implement bank sync in reeve

Written 2026-11-02. It builds on the research notes attached to REE-52 and corrects them where
running code or primary documents disagreed. Nothing here ran against a real bank. Labels: **measured**
means I ran it on a scratch home; **documented** means Enable Banking's own docs or Actual's source
(clone at `4548275`); **judgment** is my reading.

## What was measured

Script: `import_transactions` with `rows` on a scratch home, through `runOperation`.

| Scenario                                                                | Result                                                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Hand-entered Erste to Revolut transfer of 100.00, then both banks' rows | Revolut balance 200.00, should be 100.00. The second leg adds a new transaction |
| Same window fetched twice                                               | Converges: both rows `duplicate`                                                |
| Delete an imported row, fetch again                                     | The row returns (`new`)                                                         |
| Undo an import, fetch again                                             | The row returns (`new`)                                                         |
| Same `importedId` twice in one batch                                    | Both added                                                                      |
| Two separately imported legs, `merge_transactions`                      | Refused: "Merge transactions of one account and the same amount"                |
| Undo, a no-change import, then redo                                     | Redo is gone (`done: false`)                                                    |
| HTTP with `Host: evil.example`, GET and JSON POST                       | Both accepted. A POST created a book                                            |

The Revolut figure reconciles by hand: 100.00 from the transfer's posting plus 100.00 from the duplicate.

## The root cause is one misplaced column

Actual stores a transfer as two linked rows, so each leg has its own `imported_id`. [model rules](../../../../docs/rules/model.md) made
a transfer one transaction with two postings, and the port kept `imported_id` on `transactions`. One
slot now has to hold two banks' names for the money. A bank line names a **posting**: one movement on
one account.

Asked from scratch, the model is:

- `postings.imported_id` and `postings.imported_payee`, moved off `transactions`.
- A partial unique index on `(account_id, imported_id)`, so the same line can't land twice in an account.
- A new append-only table, `seen_imports(account_id, imported_id, first_seen_at)`, left out of
  `UNDONE_TABLES`.

Dismissal is then derived, not recorded. An id in `seen_imports` with no live posting was deleted or
undone, and stays away. `delete_transactions`, `undo` and `merge_transactions` need no hook, which is
the problem the notes had no clean answer for, since reverse SQL can't run one. The columns are undone
with the ledger, `replacePostings` carries them through `continuedPostings` ([ledger rules](../../../../docs/rules/ledger.md)), and a
transfer's second leg now fuzzy-matches because its own posting has no id yet.

| Option                                          | Dismissal                                            | Undo of a merge                     | Verdict                        |
| ----------------------------------------------- | ---------------------------------------------------- | ----------------------------------- | ------------------------------ |
| Posting columns plus `seen_imports`             | Derived, no hooks                                    | Exact, it is ledger data            | **Recommended**                |
| Side table `(account, id, transaction)` (notes) | Derived, if outside undo                             | Row points at the wrong transaction | Works, leaves a dangling state |
| Posting column plus delete trigger              | Trigger, also fires on undo and on `replacePostings` | Exact                               | Hidden behaviour               |

This shrinks the "L" in the notes (judgment). The web app never reads the id, only the import dialog
writes it, and the engine sites are about a dozen in `ledger/transactions.ts`, `imports/reconcile.ts`,
`rules/` and `receipts/`.

**Migration.** Copy each transaction's id to its one balance posting, and to both on a transfer: we
can't tell which bank it came from, and both is no worse than today. Null out later duplicates so the
index can be created. Seed `seen_imports` from the result.

**Files versus sync.** Actual's `sync-reimport-deleted` defaults to **on**, so its deleted rows return
by default (`loot-core/src/server/accounts/sync.ts:852`). The notes read as if this were reeve's gap alone. Keep that default for
file imports, because undoing an OFX import and re-importing it is a normal correction. Linked accounts
turn it off, a departure to record. REE-23 becomes this option.

## Two legs imported apart need `make_transfer`

When both rows arrive before anyone marks a transfer, nothing joins them. Actual has "Make transfer"
(`validForTransfer`: two different accounts, amounts cancel, neither already a transfer). reeve lacks
it. Add `make_transfer`: keep one transaction, move the other's balance posting with its id, delete
both uncategorized counterparts. Undo reverses it exactly.

Actual's rules can also set a transfer payee, and reeve's can't (`rules/transaction.ts` keeps
`entry.transferAccount`). A rule action "transfer to account" would make a top-up automatic: the first
leg's rule builds the transfer, and the second leg fuzzy-matches into it. Do this before any detection
heuristic. It is parity, and a rule is something a person agreed to.

Different-currency transfers stay two transactions, since a transaction must balance in one number.

## What the notes over-built

**No keychain, no secret store interface (judgment).** Every Enable Banking call needs the RS256 JWT
(documented), so a session id or account uid is useless without the key. The key is the only secret. It
goes in `<home>/bank/enable-banking.pem`, mode 0600, with the application id beside it. Link rows can
live in the book. Warn that `~/.config` is often synced by dotfile tools.

**No surface flag, no amendment to 0006 (judgment).** With paste-back, linking is two ordinary catalog
operations. The code is useless without the key, and the bank's login stops an agent anyway. The key
enters through `set_bank_credentials` with a path or content, the shape `import_transactions` already
uses for files. Its output says only whether a key is set.

**No in-memory `state`.** `begin` and `complete` may be two CLI processes with no server. Store the
nonce on a pending connection row in the book.

**No token refresh.** Enable Banking handles it, and consent needs renewing only at `valid_until`
(documented).

**No per-bank handler framework at first.** One mapping function with a Revolut branch for the second
remittance row, until a real payload asks for more.

## Data shape

In the book, in a new module `engine/src/bank/schema.ts`, out of `UNDONE_TABLES`:

```
bank_connections  id, provider, aspsp_name, aspsp_country, state, session_id,
                  status: pending | active | expired, valid_until, created_at
bank_links        account_id PK, connection_id, provider_account_id, identification_hash,
                  currency, history_start, fetch_day, fetch_count, retry_after,
                  status: ok | reauth_required | rate_limited | attention | failed,
                  status_message, last_synced_at,
                  bank_balance, bank_balance_type, bank_balance_at
seen_imports      account_id, imported_id, first_seen_at        PK (account_id, imported_id)
```

`bank_connections` and `bank_links` go in restore's `SKIPPED_TABLES`, so a restored copy doesn't sync
the same bank account as a second book. `seen_imports` is restored.

## Operations

| Operation                                  | Kind    | Notes                                                                           |
| ------------------------------------------ | ------- | ------------------------------------------------------------------------------- |
| `set_bank_credentials`                     | network | Validates against `GET /application`; the output says only whether a key is set |
| `bank_status`                              | local   | Links, consent expiry, last sync, balances; no secret fields                    |
| `list_banks`                               | network | `GET /aspsps?country=`, gives `maximum_consent_validity`                        |
| `begin_bank_link`                          | network | `POST /auth`, `valid_until` at the bank's maximum, returns a URL                |
| `complete_bank_link`                       | network | Takes the pasted URL, checks `state`, `POST /sessions`, returns accounts        |
| `link_bank_account`, `unlink_bank_account` | local   | Takes `history_start`; re-link matches on `identification_hash`                 |
| `sync_bank_account`                        | network | Below                                                                           |
| `restore_dismissed_imports`                | local   | Lists and brings back dismissed rows                                            |
| `make_transfer`                            | local   | Parity, useful without bank sync                                                |

Actual caps consent at 90 days though the API reports the bank's limit in seconds, 180 days for most
banks (documented). Using the maximum halves the logins.

**Network kind.** Add `network: true` to `Operation`. `Handler<K>` becomes
`(book, input, books) => Effect`, and `runOperation` gets a branch that opens the book with no
transaction around it. A fetch inside `inTransaction` would make any concurrent handler's
`BEGIN IMMEDIATE` fail on the shared connection, so this is a correctness rule.

**`sync_bank_account`:**

1. Read the link. Refuse early on expired consent, `retry_after` in the future, or a spent daily budget.
2. Fetch with no transaction open: `transaction_status=BOOK`, from the later of `history_start` and
   89 days ago. Use `strategy=longest` on a link's first fetch, because deep history closes in about an
   hour (documented). Stop paging on a repeated `continuation_key`, as Actual does.
3. Map fields by hand ([boundaries rules](../../../../docs/rules/boundaries.md)). Parse amounts from the string: `parseFloat("19.99") * 100` gives
   1998.9999999999998 (measured). Refuse a row whose currency differs from the link's.
4. Run `importRows` as a dry run. If nothing would change, write status with `record: false`, so a
   no-change sync doesn't erase redo.
5. Otherwise apply in one `runInBook`: rows, `seen_imports` and status together, one undo step. A crash
   before this refetches, and matching on ids converges.

**Guard for renumbered ids.** Actual #8701 reports a bank whose `entry_reference` was `<date>-<index>`,
which rewrote unrelated rows, though Enable Banking documents the field as immutable. An exact id match
with a different amount leaves the row alone and sets the link to `attention`.

**Balance check.** Store the bank's balance and show it beside `account.cleared`. It tests the whole
feature on every sync. Use a booked type such as `CLBD`, since Revolut's balance reportedly includes
pending card holds. Whether a balance fetch counts against the daily budget is unknown.

**Errors.** Add a typed `BankError`, passed through `failure`, with a status and provider code only, so
no response body or header reaches `StorageError.cause`. On `ASPSP_RATE_LIMIT_EXCEEDED`, set
`retry_after` to 6 hours (documented), and never suggest re-linking. `EXPIRED_SESSION` can come before
`valid_until` (documented), so it sets `reauth_required` whatever the stored date says.

**PSU headers.** Send none and budget 4 fetches a day. Partial headers get a 422, and a private IP gets
bank errors (documented, Actual PR 8032).

## Redirect

Enable Banking accepts only `https:` redirects, so loopback is out. Paste-back is the baseline, and it
works the same in the web app, the CLI and with no server.

Try to register `https://localhost/reeve` first. The browser shows a connection error, but the address
bar still holds the code, and no third party ever sees it. If the form refuses it, use a static page the
user controls. Sources conflict on whether it is accepted, so this is a real test.

## How it gets tested without a bank

Run a small fake Enable Banking server on `node:http` in the tests and point the real adapter at it with
a base URL. That exercises JWT signing (works with `node:crypto`, measured, so `check:desktop` should
stay clean), paging, and error mapping, with no injected seam. `scratch()` and the e2e harness both use
it. Saved, scrubbed responses from a real run become its fixtures.

Add to the property suite ([ledger rules](../../../../docs/rules/ledger.md)): syncing the same rows twice equals once, in any account
order, with deletes and undos in between. Port Actual's `accounts/sync.test.ts` (30 tests) first, as
0001 requires.

## Order of work

Each step lands alone. Steps 1 to 3 are worth doing even if sync is never built.

| #   | Unit                                                                                                                 | Proves itself by                                            | Size (judgment) |
| --- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------- |
| 1   | Host check on the server. Small, separate task                                                                       | Rebinding request refused; dev proxy and desktop still work | S               |
| 2   | Move ids to postings, `seen_imports`, migration, batch dedupe                                                        | The Revolut 200.00 case gives 100.00, through a file import | M               |
| 3   | `make_transfer`, rule action for transfers, no-change imports keep redo                                              | Ported tests                                                | M               |
| 4   | [ledger rules](../../../../docs/rules/ledger.md) superseding the "bank sync" line of 0001, amending 0003, 0009, 0010 | Review                                                      | S               |
| 5   | Network kind, schema, adapter, fake server, `sync_bank_account`                                                      | Engine tests through `call`                                 | M               |
| 6   | Link flow, CLI paste-back, then one real run in a scratch home                                                       | Real rows in a scratch book                                 | M               |
| 7   | Web: Settings section, link dialog, sync and status in the register, expiry warning                                  | e2e, 390px and desktop                                      | M               |
| 8   | Scheduler in `startServer`'s scope, with persisted due times                                                         | Later, only if manual sync feels short                      | M               |
| 9   | Pending rows                                                                                                         | Later, only if wanted. Booked-only needs no schema          | M               |

The next decision is **0034**, not 0026 as the notes say: 0032 and 0033 now exist. A background sync
lands on the undo stack, and undoing it dismisses its rows, so step 8 needs its own answer. Sync stays
explicit until then.

## What only a real account can settle

Run these before step 5, in this order. Steps 1 to 3 don't depend on them.

1. IBAN prefix of the Erste account, and country of residence if CZ. This selects the row in the task's
   table.
2. Register a production app. Does the form accept `https://localhost`? What does it require?
3. `GET /aspsps`: is this Erste listed, and with what `maximum_consent_validity`?
4. Link, fetch at once and an hour later: real history depth, and how Revolut pockets appear.
5. Authorise again: does `identification_hash` hold? (Documented as stable. Worth one check.)
6. Five syncs in a day, including one balance fetch each: the real limit and its error.
7. A week of saved fetches: are `entry_reference` values stable at Erste? This is the fact the design
   rests on most.
8. Feed mapped rows to `import_transactions` with `dryRun`, against the same period's bank file.

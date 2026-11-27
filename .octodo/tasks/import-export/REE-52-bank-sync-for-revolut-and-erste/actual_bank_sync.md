# How Actual Budget implements bank sync (reference for reeve)

Source state: shallow clone of `actualbudget/actual` master at commit `741d1615b7a818784f7859269430a003753a40dd` (2 Nov 2026), plus `gh` issue reads and actualbudget.org on the same date. Nothing from the clone was installed or run. Links point at `master`, so line positions may drift; file paths below are relative to `packages/`. Issue reports are user claims unless marked as confirmed in code.

## Which providers does Actual support, and is GoCardless open to new signups?

### Takeaway

Five providers are wired in: GoCardless, SimpleFIN, Pluggy.ai, Akahu and Enable Banking. For a new European user Enable Banking is the only live route, because GoCardless closed to new accounts in July 2025. Enable Banking is still labelled experimental.

### Cited Findings

- The server mounts `/gocardless`, `/simplefin`, `/pluggyai`, `/akahu` and `/enablebanking`. — [sync-server/src/app.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app.ts)
- Documented regions: Akahu (New Zealand), Enable Banking (Europe), GoCardless (Europe, "**not accepting new accounts**"), SimpleFIN Bridge (North America), Pluggy.ai (Brazil). — [docs/advanced/bank-sync.md](https://github.com/actualbudget/actual/blob/master/packages/docs/docs/advanced/bank-sync.md)
- "From July 2025 onwards, GoCardless has stopped accepting new Bank Account Data accounts... if you are an existing user, your account should continue to work." — [docs gocardless.md](https://github.com/actualbudget/actual/blob/master/packages/docs/docs/advanced/bank-sync/gocardless.md)
- A user reported GoCardless support telling them the API was discontinued for personal users among new customers. — [#5445](https://github.com/actualbudget/actual/issues/5445)
- GoCardless's own product page still shows a generic "Sign up" link and "Contact Sales", and says nothing about availability. — [gocardless.com/bank-account-data](https://gocardless.com/bank-account-data/)
- Enable Banking was merged on 11 May 2026 (PR #7345) and sits behind the `enableBanking` feature flag, with its docs carrying an experimental warning. Maintainers route its bugs to feedback issue #7799. — [PR #7345](https://github.com/actualbudget/actual/pull/7345); [useBuiltInBankSyncProviders.ts](https://github.com/actualbudget/actual/blob/master/packages/desktop-client/src/components/banksync/useBuiltInBankSyncProviders.ts); [enable-banking.md](https://github.com/actualbudget/actual/blob/master/packages/docs/docs/advanced/bank-sync/enable-banking.md); [#8701 comment](https://github.com/actualbudget/actual/issues/8701)
- A maintainer wrote in January 2026 that Enable Banking's updated terms make it free for personal use, which unblocked the integration. — [#5445](https://github.com/actualbudget/actual/issues/5445)
- A restricted Enable Banking application can reach only accounts linked in its control panel: "Only linked accounts can be accessed. For general availability please request unrestriction." — [#8788](https://github.com/actualbudget/actual/issues/8788); [enable-banking.md step 2](https://github.com/actualbudget/actual/blob/master/packages/docs/docs/advanced/bank-sync/enable-banking.md)
- Actual's [install page table](https://github.com/actualbudget/actual/blob/master/packages/docs/docs/install/index.md) still names only "GoCardless or SimpleFIN" for bank syncing, so it lags the provider list.

### Inferences

- For a new user, reeve should treat GoCardless as a legacy option at most. Its code is still the clearest reference for the bank-handler pattern.

### Gaps

- I found no official GoCardless announcement giving the scope or reasons. The closure rests on Actual's docs and a user's report of a support reply.
- The Enable Banking terms page returned only a title when fetched, so "free for personal use" is second-hand here (maintainer comment, and the [enable-actual README](https://github.com/2manyvcos/enable-actual)).
- I did not verify whether the `enableBanking` flag defaults on in stable releases.

## Where does each piece live, why is there a server, and could it run in one local process?

### Takeaway

Provider adapters live in `sync-server`. Matching and import logic lives in `loot-core`, which runs on the client. The server exists because of credential custody, provider redirects and the browser client. Nothing in the adapters needs a remote deployment, and Actual's own Electron app can run them on 127.0.0.1.

### Cited Findings

Layout:

- [`sync-server/src/app-gocardless/`](https://github.com/actualbudget/actual/tree/master/packages/sync-server/src/app-gocardless): routes in `app-gocardless.ts`, logic in `services/gocardless-service.ts`, HTTP in `services/gocardless-api.ts` (base `https://bankaccountdata.gocardless.com/api/v2`), `bank-factory.ts`, `banks/` (per-bank handlers, loaded by glob on the `<name>_<bic>` filename, falling back to `integration-bank.ts`), `errors.ts`.
- [`sync-server/src/app-enablebanking/`](https://github.com/actualbudget/actual/tree/master/packages/sync-server/src/app-enablebanking): `app-enablebanking.ts`, `services/enablebanking-service.ts`, `utils/jwt.ts`, `utils/errors.ts`. It has no per-bank handler directory, only a small list of bank names that skip PSU (end-user) headers on data calls (`HypoVereinsbank`).
- [`app-simplefin/app-simplefin.js`](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-simplefin/app-simplefin.js), [`app-pluggyai/`](https://github.com/actualbudget/actual/tree/master/packages/sync-server/src/app-pluggyai) (uses `pluggy-sdk`), [`app-akahu/app-akahu.ts`](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-akahu/app-akahu.ts).
- [`sync-server/src/services/secrets-service.js`](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/services/secrets-service.js) and [`app-secrets.js`](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-secrets.js) hold credentials.
- [`loot-core/src/server/accounts/sync.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/accounts/sync.ts) holds the download functions, `normalizeBankSyncTransactions`, `matchTransactions`, `reconcileTransactions`, `processBankSyncDownload` and `syncAccount`.
- [`loot-core/src/server/accounts/app.ts`](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/accounts/app.ts) holds link handlers, polling, `handleSyncError` and status persistence.
- UI is in [`desktop-client/src/components/banksync/`](https://github.com/actualbudget/actual/tree/master/packages/desktop-client/src/components/banksync), [`AccountSyncCheck.tsx`](https://github.com/actualbudget/actual/blob/master/packages/desktop-client/src/components/accounts/AccountSyncCheck.tsx), and `desktop-client/src/gocardless.ts` / `enablebanking.ts`.

Why a server, per sources:

- Docs: "The integration only works if you are using actual-server." Keys are stored on the server and are not covered by end-to-end encryption. — [bank-sync.md](https://github.com/actualbudget/actual/blob/master/packages/docs/docs/advanced/bank-sync.md)
- Secrets are rows in a `secrets` table of the server's account database, inserted as given with no encryption step in `set`. — [secrets-service.js](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/services/secrets-service.js)
- Providers redirect back to server routes: `GET /gocardless/link` and `GET /enablebanking/auth_callback`, both registered before session validation. — [app-gocardless.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-gocardless/app-gocardless.ts); [app-enablebanking.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-enablebanking/app-enablebanking.ts)
- The Enable Banking auth handoff uses in-memory maps, with a code comment that this is process-local. — [app-enablebanking.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-enablebanking/app-enablebanking.ts)

Local execution:

- The Electron app can fork the sync server as a utility process on `127.0.0.1`, port 5007 by default, started when `syncServerConfig.autoStart` is set. — [desktop-electron/index.ts](https://github.com/actualbudget/actual/blob/master/packages/desktop-electron/index.ts)
- The GoCardless route special-cases the Electron origin, building the redirect from the request's own protocol and host. — [app-gocardless.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-gocardless/app-gocardless.ts)
- Enable Banking rejects non-HTTPS redirects. The UI warns "Enable Banking requires HTTPS for the redirect URL", the control panel rejects `app://actual/enablebanking/auth_callback` as an unsupported scheme, and a commenter signing as Enable Banking Support replied "Only https: redirect supported. We advise for you to redirect to -> https: -> app:". — [EnableBankingInitialiseModal.tsx](https://github.com/actualbudget/actual/blob/master/packages/desktop-client/src/components/modals/EnableBankingInitialiseModal.tsx); [#7799 report](https://github.com/actualbudget/actual/issues/7799#issuecomment-6162465246); [#7799 reply](https://github.com/actualbudget/actual/issues/7799#issuecomment-6163485413)
- One desktop user got it working with ngrok for the link step only, and later syncs then ran directly in the desktop app. — [#7799](https://github.com/actualbudget/actual/issues/7799#issuecomment-4642786579)

### Inferences

- The same logic can run in one local Node process, and reeve's 127.0.0.1 server is already that shape. The adapters are plain HTTP clients whose outside dependencies are Express and the secrets store. Matching is already separate from them.
- Calling providers from a local process removes any browser CORS concern, because reeve's engine is not in the browser.
- Local secrets belong in `<home>`, with OS-level protection decided separately. Actual offers no pattern worth copying here beyond scoping by name.
- The Enable Banking redirect is the one hard obstacle for local-only use. `POST /complete-auth` takes a `code` directly, so any path that delivers the `code` to the process holding the key will work. Options are a static HTTPS page that bounces to loopback, or the user pasting the code or return URL. This is my design reading, not something Actual ships.

### Gaps

- I did not find a source stating that provider APIs block browser CORS, so CORS as a reason is unconfirmed.
- I did not test whether GoCardless accepts plain `http://127.0.0.1` redirects. The Electron code implies it.

## Connection flow: what the user provides, how consent works, how accounts link, how secrets are stored

### Takeaway

Each user brings their own developer credentials, then approves access at the bank in a browser window while the app waits. The credentials stay on the server. The budget file stores only provider ids.

### Cited Findings

GoCardless:

- User supplies secret ID and key, entered once and saved on the server. Secrets are global, read without a file id. — [gocardless.md](https://github.com/actualbudget/actual/blob/master/packages/docs/docs/advanced/bank-sync/gocardless.md); [gocardless-service.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-gocardless/services/gocardless-service.ts)
- The access token is held in memory on the API client and regenerated once its JWT `exp` passes. — [gocardless-service.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-gocardless/services/gocardless-service.ts)
- `createRequisition` reads the institution, then requests `accessValidForDays = max_access_valid_for_days` and `maxHistoricalDays = transaction_total_days`, or 90 if the bank has `separate_continuous_history_consent`. `accountSelection` follows the bank's features. On failure it retries once with 90 and 89 days. — same file
- The client opens the returned link and polls `/get-accounts` every 3 seconds for up to 10 minutes until the requisition status is `LN`. — [gocardless.ts](https://github.com/actualbudget/actual/blob/master/packages/desktop-client/src/gocardless.ts); [accounts/app.ts](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/accounts/app.ts)
- IBANs are SHA-256 hashed before going to the client. — [app-gocardless.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-gocardless/app-gocardless.ts)
- The link writes `account_id`, `account_sync_source` and a `banks` row whose `bank_id` is the requisition id, then runs a first sync immediately. — [accounts/app.ts](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/accounts/app.ts); [init.sql](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/sql/init.sql)

Enable Banking:

- User registers a Production application with an HTTPS redirect ending `/enablebanking/auth_callback`, links accounts in the control panel, then enters the Application ID and uploads the key file. — [enable-banking.md](https://github.com/actualbudget/actual/blob/master/packages/docs/docs/advanced/bank-sync/enable-banking.md)
- Requests are signed with an RS256 JWT (`kid` = application id, `iss` `enablebanking.com`, `aud` `api.enablebanking.com`, 1 hour). No provider token is stored. — [jwt.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-enablebanking/utils/jwt.ts)
- `/configure` validates credentials against `GET /application` before saving them, and is admin only. — [app-enablebanking.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-enablebanking/app-enablebanking.ts)
- `POST /auth` sends the ASPSP (bank), redirect, `state`, `psu_type` and `valid_until`, the lesser of the bank's `maximum_consent_validity` and 90 days. `POST /sessions` exchanges the code for a session with accounts. — [enablebanking-service.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-enablebanking/services/enablebanking-service.ts)
- The client long-polls `/poll-auth` with a 5-minute timeout, and results are cached for 30 seconds. `/complete-auth` is the alternative path taking `code` and `state`. — [app-enablebanking.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-enablebanking/app-enablebanking.ts)
- Later syncs call `/transactions` with only the account `uid`, start date and bank name, without the session id. — [sync.ts](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/accounts/sync.ts); [app-enablebanking.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-enablebanking/app-enablebanking.ts)

SimpleFIN and Pluggy:

- SimpleFIN: the setup token decodes to a claim URL, claimed once for an access key that is stored and sent with Basic auth, with `start-date` and `pending=1`. Credentials can be per budget file, stored as `name:fileId`. — [app-simplefin.js](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-simplefin/app-simplefin.js); [secrets-service.js](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/services/secrets-service.js)
- Pluggy.ai: client ID, client secret and a comma-separated list of item IDs, also supporting per-file credentials. — [app-pluggyai.js](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-pluggyai/app-pluggyai.js)

### Inferences

- For a single-user local app, the useful model is the Enable Banking one: a stateless signed JWT, an account uid as the only stored link, and no token lifecycle to manage.

### Gaps

- I did not read the Akahu flow beyond its two secrets (`akahu_userToken`, `akahu_appToken`).

## Sync algorithm: dates, pending, dedupe, matching, balances, rules, field mapping, bank handlers

### Takeaway

Each sync re-downloads up to 90 days and reconciles in stages: rules first, then exact `imported_id`, then two fuzzy passes on same account, same amount, within 7 days. Merges keep the user's edits. Revolut has a tiny handler that only handles Bizum, and no Erste handler exists.

### Cited Findings

All of the following are from [sync.ts](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/accounts/sync.ts) unless linked otherwise.

Window:

- `getAccountSyncStartDate` returns the later of (today − 89 days) and the account's oldest transaction date, so the window is not "since last sync". A custom start date overrides it on linking.

Pending and booked:

- GoCardless returns `booked`, `pending` and `all` (each flagged and sorted by the bank handler). The client imports `all` and sets `cleared = Boolean(trans.booked)`.
- Per-account settings, stored as preferences: `sync-import-pending-<id>` (default on), `sync-import-notes-<id>` (on), `sync-reimport-deleted-<id>` (on), `sync-import-transactions-<id>` (on), `sync-update-dates-<id>` (off), `custom-sync-mappings-<id>`.

`imported_id`:

- `imported_id = trans.transactionId`. If a booked row has none but has `internalTransactionId`, it becomes `<account>-<internalTransactionId>`. Otherwise it is empty and only fuzzy matching applies.
- Enable Banking uses `entry_reference || transaction_id || ''`. — [enablebanking-service.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-enablebanking/services/enablebanking-service.ts)

Matching (`matchTransactions`):

1. For each row, run rules (`runRules`), then look up `imported_id` on the same account. The lookup uses `v_transactions` when reimporting deleted rows, otherwise `v_transactions_internal`, which also sees tombstones.
2. If no match, load candidates in ±7 days with the same amount and account, sorted nearest date first, preferring rows without an `imported_id` on ties (`compareFuzzyMatchCandidates`).
3. First fuzzy pass requires the same payee. Second pass takes any unused candidate. Children of exactly matched split parents are excluded.

Strictness:

- `useStrictIdChecking = !acctRow.account_sync_source`. Linked accounts are therefore non-strict, because "account sync sources can give two different transaction IDs even though it's the same transaction". A row with one id can merge into a row with a different id.

Merge (`reconcileTransactions`):

- `imported_id` and `imported_payee` take incoming values. `payee`, `category` and `notes` keep existing values and fall back to incoming. `cleared` is an OR. `date` changes only with `updateDates`.
- Reconciled (locked) rows are never changed. Cleared and date changes propagate to split children.

Starting balance (`processBankSyncDownload`):

- A new account is one with no transaction dated today or earlier. GoCardless asks for balances only then (`includeBalance = newAccount`).
- GoCardless's `calculateStartingBalance` picks the first balance in the order `closingBooked, expected, forwardAvailable, interimAvailable, interimBooked, nonInvoiced, openingBooked`, and subtracts booked transactions. — [integration-bank.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-gocardless/banks/integration-bank.ts)
- Other providers send the current balance as `startingBalance`, and the client subtracts downloaded rows. A code comment says "Starting balance is actually the current balance of the account".
- The result is inserted as a `starting_balance_flag` transaction dated at the oldest downloaded row, or today. Custom start date and balance are honoured.
- Enable Banking prefers the `CLAV` balance, else the first returned. — [app-enablebanking.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-enablebanking/app-enablebanking.ts)

Field mapping:

- Default mapping is `date→date`, `payee→payeeName`, `notes→notes`, kept separately for payments and deposits and editable per account. — [custom-sync-mapping.ts](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/util/custom-sync-mapping.ts); [EditSyncAccount.tsx](https://github.com/actualbudget/actual/blob/master/packages/desktop-client/src/components/banksync/EditSyncAccount.tsx)
- A missing date or payee name throws and aborts the account's sync. Notes get `#` escaped to `##`. The raw row is kept in `raw_synced_data`.
- GoCardless date falls through `trans.date`, `bookingDate`, `bookingDateTime`, `valueDate`, `valueDateTime`. A row with none is dropped. Notes use `remittanceInformationUnstructured`, then the joined array. — [integration-bank.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-gocardless/banks/integration-bank.ts)
- GoCardless payee: for inflow `debtorName`, for outflow `creditorName`, falling back to the other party, then remittance, then `additionalInformation`. It is title-cased with a masked IBAN appended. — [payee-name.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/util/payee-name.ts)
- Enable Banking payee: with a known direction, the counterparty name, else the first cleaned remittance line. Allowlisted SEPA prefixes such as `EREF+` are stripped, and the sign comes from `credit_debit_indicator`. Rows lacking a valid date or numeric amount are dropped. Pagination stops if a `continuation_key` repeats, with up to 100 pages. — [enablebanking-service.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-enablebanking/services/enablebanking-service.ts)

Bank handlers:

- `IBank` has four hooks: `normalizeAccount`, `normalizeTransaction`, `sortTransactions`, `calculateStartingBalance`. — [bank.interface.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-gocardless/banks/bank.interface.ts)
- Revolut handler (`REVOLUT_REVOLT21`) does one thing. For `Bizum payment from: X` it sets the payee to X and notes to the second remittance line, and for `Bizum payment to:` it sets the notes only. — [revolut_revolt21.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-gocardless/banks/revolut_revolt21.ts)
- No handler file mentions `ERSTE` or `GIBA*`, confirmed by grep over `banks/`, so Erste institutions use `integration-bank`. The Sparkasse handlers are German banks (Berliner, Karlsruhe, Marburg-Biedenkopf, Worms-Alzey-Ried, Düsseldorf, München). — [banks/](https://github.com/actualbudget/actual/tree/master/packages/sync-server/src/app-gocardless/banks)
- The nearest Austrian examples are `easybank_bawaatww.ts`, which parses the payee from structured remittance, and `raiffeisen_at_rzbaatww.ts` (not read). — [easybank_bawaatww.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-gocardless/banks/easybank_bawaatww.ts)
- The Düsseldorf handler drops unbooked rows outright, one way handlers deal with poor pending data. — [ssk_dusseldorf_dussdeddxxx.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-gocardless/banks/ssk_dusseldorf_dussdeddxxx.ts)

### Inferences

- Pending-to-booked works through the non-strict fuzzy pass: a pending row with a different or missing id merges into the booked row, preserving user edits.
- A pending row that the bank later drops appears to stay in the register. I saw no removal code in `sync.ts`.
- Non-strict matching is the riskiest behaviour to copy. Two genuine equal-amount payments within 7 days can merge silently (see the next section). In a double-entry ledger, reeve might prefer to require a pending or missing id on one side before merging across different ids.
- Rules run before matching, so rule-changed payees feed the same-payee pass.

### Gaps

- I did not trace `runRules` stages or what `batchUpdateTransactions` does with transfers after reconciliation.

## Rate limits, reauth, consent expiry, error UX, and reported problems with Revolut and Erste

### Takeaway

Actual has no retry, backoff or consent-expiry tracking. It classifies the failure, stores a status per account, and offers Reauthorize or Unlink. Revolut has several concrete reports. Erste has almost none, and nothing for George, Česká spořitelna or Slovenská sporiteľňa.

### Cited Findings

Rate limits:

- GoCardless docs: each bank can be synced up to 4 times per day, and the free tier connects up to 50 banks per month. — [gocardless.md](https://github.com/actualbudget/actual/blob/master/packages/docs/docs/advanced/bank-sync/gocardless.md)
- HTTP 429 becomes `RATE_LIMIT_EXCEEDED`, and `x-ratelimit-*` headers are forwarded to the client. — [gocardless-service.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-gocardless/services/gocardless-service.ts); [app-gocardless.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-gocardless/app-gocardless.ts)
- Enable Banking sends `Psu-Ip-Address` and `Psu-User-Agent`, per a code comment, to signal the user is online and exempt the call from background limits "(e.g. 4 requests/day)". — [enablebanking-service.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-enablebanking/services/enablebanking-service.ts)
- `extractPsuHeaders` sends nothing when the client IP is local or private. — [app-enablebanking.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-enablebanking/app-enablebanking.ts)
- That followed reports of German Sparkasse rejecting private IPs in PSU headers with `ASPSP_ERROR`, while limiting non-user requests to 4 per day. — [#8345](https://github.com/actualbudget/actual/issues/8345); [#7799](https://github.com/actualbudget/actual/issues/7799#issuecomment-5011924049)
- Automatic sync is off by default, has a 15-minute minimum, runs only while Actual is open, and covers all linked accounts. — [bank-sync.md](https://github.com/actualbudget/actual/blob/master/packages/docs/docs/advanced/bank-sync.md). The [GoCardless page](https://actualbudget.org/docs/advanced/bank-sync/gocardless) still says automatic sync is unavailable, which contradicts this.
- A user reported that exceeding four syncs on one bank left unlink and relink as the only offered action. — [#7799](https://github.com/actualbudget/actual/issues/7799#issuecomment-5748425154). Another reported the first sync of a day working and later automated ones failing until the next day. — [#7799](https://github.com/actualbudget/actual/issues/7799#issuecomment-5226582634)

Errors and reauth:

- `getBankSyncStatusFromError` persists `reauth-required`, `attention-required`, `rate-limit-exceeded`, `timed-out`, `server-down`, `account-missing`, `not-configured` or `failed` on `accounts.bank_sync_status`. — [accounts/app.ts](https://github.com/actualbudget/actual/blob/master/packages/loot-core/src/server/accounts/app.ts)
- GoCardless: an unlinked requisition or a 401 mentioning an expired end-user agreement becomes `ITEM_ERROR`/`ITEM_LOGIN_REQUIRED`. — [app-gocardless.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-gocardless/app-gocardless.ts); [gocardless-service.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-gocardless/services/gocardless-service.ts)
- Enable Banking: 401 or 403, or any 4xx whose message mentions "session" or "expired", becomes `INVALID_ACCESS_TOKEN`, then `ITEM_LOGIN_REQUIRED`. — [errors.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-enablebanking/utils/errors.ts); [app-enablebanking.ts](https://github.com/actualbudget/actual/blob/master/packages/sync-server/src/app-enablebanking/app-enablebanking.ts)
- `AccountSyncCheck` shows a message per error class with Reauthorize, Unlink or Configure actions. `bankSyncErrors.ts` prefers the provider's own wording. — [AccountSyncCheck.tsx](https://github.com/actualbudget/actual/blob/master/packages/desktop-client/src/components/accounts/AccountSyncCheck.tsx); [bankSyncErrors.ts](https://github.com/actualbudget/actual/blob/master/packages/desktop-client/src/components/banksync/bankSyncErrors.ts)
- Failures arrive as `status: ok` with an error payload rather than an HTTP error. — [bankSyncErrors.ts](https://github.com/actualbudget/actual/blob/master/packages/desktop-client/src/components/banksync/bankSyncErrors.ts)

Consent:

- Neither `accounts/app.ts` nor `sync.ts` contains a stored expiry date (grep for `valid_until`, `expires`, `access_valid`), so expiry surfaces only when a sync fails. A user describes the same: "a lapse is silent until the nightly sync starts failing". — [#9006](https://github.com/actualbudget/actual/issues/9006)
- That request measured GoCardless granting 730 days with `reconfirmation: true` where the plain request fails above 90, shown for an American Express institution. The feature request was auto-closed into the vote backlog, and current code does not send it. — [#9006](https://github.com/actualbudget/actual/issues/9006)
- Enable Banking reauthorization reportedly goes through the Link Accounts dialog, and users unlink and relink. One user says this does not duplicate transactions. — [#7799](https://github.com/actualbudget/actual/issues/7799#issuecomment-5017120174)
- Enable Banking support told a user that one bank limits history to 3 minutes after authentication, then 90 days. A 91-day request produced `WRONG_TRANSACTIONS_PERIOD`. — [#7799](https://github.com/actualbudget/actual/issues/7799#issuecomment-4524324135)

Revolut:

- [#5502](https://github.com/actualbudget/actual/issues/5502) (open, via GoCardless): rows dated before the earliest transaction are re-added after deletion. A maintainer guessed the bank returns rows that were not requested.
- [#9063](https://github.com/actualbudget/actual/issues/9063) (open, via Enable Banking): a booked −5.00 row vanished silently. A later comment traced this kind of loss to a fuzzy match with an unrelated −5.00 row 7 days away with a different `imported_id`. This is confirmed as possible by the non-strict logic above.
- [#9300](https://github.com/actualbudget/actual/issues/9300) and [#7799](https://github.com/actualbudget/actual/issues/7799#issuecomment-4623685448): empty account list after authorizing, caused by a restricted app with no accounts linked in the panel first.
- [#7799](https://github.com/actualbudget/actual/issues/7799#issuecomment-4826326037): Revolut through Enable Banking puts the payee in the second remittance row and the notes in the first, and the current normalizer has no handler for that.
- [#7799](https://github.com/actualbudget/actual/issues/7799#issuecomment-5386573157): Revolut returned `entry_reference` on 53 of 53 sampled postings, so its ids look usable, unlike Piraeus at 0 of 45.
- Several users report Revolut linking and syncing fine through Enable Banking. — [#7799](https://github.com/actualbudget/actual/issues/7799#issuecomment-4477748895)

Erste:

- [#6480](https://github.com/actualbudget/actual/issues/6480) (auto-closed to the vote backlog, GoCardless, "my bank (Erste...)"): pending rows carry a future booking date, with the real date in the transaction date or remittance text. Per-account date mapping and `sync-update-dates` exist, but no Erste-specific parsing.
- [#7799](https://github.com/actualbudget/actual/issues/7799) (16 May 2026): 5 accounts at "Erste Bank Poland (former Santander Bank Poland)" linked with no problems through Enable Banking. That is the Polish entity, not Austria.
- `gh search` for "George", "spořitelna", "sporitelna" and "ERSTE_" found no relevant issues. The only "George" hit, [#3831](https://github.com/actualbudget/actual/issues/3831), is a commenter's surname.

Other identity bugs relevant to any Enable Banking bank:

- [#8701](https://github.com/actualbudget/actual/issues/8701): an ASPSP's `entry_reference` was `<date>-<index>` and renumbered, which rewrote unrelated rows through exact `imported_id` matches. It was closed with a redirect to #7799, and the code still trusts `entry_reference` first.
- [#7799](https://github.com/actualbudget/actual/issues/7799#issuecomment-6046838200): rows with no id cannot be blocked from re-import after deletion, because the tombstone lookup depends on `imported_id`. This is consistent with the `if (trans.imported_id)` guard in `sync.ts`.
- [#8846](https://github.com/actualbudget/actual/issues/8846): repeated `continuation_key` duplicated every row. The current loop checks the key before pushing, so it is fixed.
- [#7799](https://github.com/actualbudget/actual/issues/7799#issuecomment-4528902828): Commerzbank pending rows have empty dates.

### Inferences

- A loopback reeve would send no PSU headers under Actual's logic, because its client IP is private. It would then be treated as background access at banks enforcing the 4-per-day limit, so reeve should budget for that limit. A sync-only-when-asked default, per-connection counters and using the public IP are the design choices to weigh. Sending a public IP is suggested in #7799 but not implemented in Actual.
- Rate-limit errors should not push users to relink, since a relink costs a full bank login.
- Storing `valid_until` at link time and warning before expiry would improve on Actual cheaply.

### Gaps

- Actual's support channel for bank sync is Discord ([#5655](https://github.com/actualbudget/actual/issues/5655)), which I could not search, so absence of Erste reports on GitHub does not show absence of problems.
- I could not confirm whether George, Česká spořitelna or Slovenská sporiteľňa work through either provider. [Open Banking Tracker](https://openbankingtracker.com/gocardless/erste-group-bank-ag) lists Erste entities under GoCardless, but it is a low-authority directory that says nothing about George.
- I did not check Enable Banking's bank list for Erste entities, which is outside Actual's source.

## Local or no-server usage in the Actual community

### Takeaway

No true serverless bank sync exists. The community pattern is a separate helper service feeding Actual through its API, or Actual's sync server running on the same machine.

### Cited Findings

- Actual's install table marks bank syncing as needing a server. — [install/index.md](https://github.com/actualbudget/actual/blob/master/packages/docs/docs/install/index.md)
- The desktop app can run the bundled sync server on loopback, as noted above, and the UI says a sync server unlocks bank syncing. — [ConfigServer.tsx](https://github.com/actualbudget/actual/blob/master/packages/desktop-client/src/components/manager/ConfigServer.tsx)
- [2manyvcos/enable-actual](https://github.com/2manyvcos/enable-actual) (MIT, 111 stars, updated Nov 2026) is a separate Docker service importing through Enable Banking into Actual, with a web UI, automatic import and ntfy notifications for session expiry and errors.
- `@actual-app/api` exposes `runBankSync`, and the CLI has `bank-sync`, which suits scheduled external runs. — [api/methods.ts](https://github.com/actualbudget/actual/blob/master/packages/api/methods.ts); [cli/src/commands/server.ts](https://github.com/actualbudget/actual/blob/master/packages/cli/src/commands/server.ts)
- Other routes users suggest: [woob](https://woob.tech/applications/bank.html) generating OFX files and paid [Lunch Flow](https://www.lunchflow.app), both in [#5445](https://github.com/actualbudget/actual/issues/5445). [Habeas](https://github.com/actualbudget/actual/issues/8827) is a browser extension that captures statements from a logged-in session without PSD2.
- A commenter argues that QWAC and QSeal certificate costs of €3,000–15,000 a year are why self-hosted tools depend on licensed aggregators. This is an unsourced opinion from an interested-sounding commenter. — [#7799](https://github.com/actualbudget/actual/issues/7799#issuecomment-4931538125)

### Inferences

- reeve's position (one local process holding the user's own Enable Banking key) is simpler than anything Actual offers, since no separate sync server or client split is involved. The HTTPS redirect at link time is the only step that needs anything outside the machine.

### Gaps

- Web searches found no write-up of a serverless setup, and I did not review forks or Discord. `gh search` for "bank sync without server" and "local bank sync desktop" returned nothing.

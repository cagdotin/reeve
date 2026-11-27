# Reading your own Revolut transactions into a local, self-run budgeting app (as of 2 November 2026)

Evidence note for the report writer. Direct fetches of `developer.revolut.com`, `help.revolut.com` and `revolut.com/help` returned HTTP 403 in this session. Every Revolut documentation claim below therefore comes from a search-index excerpt of that page, not a full read, and the excerpts carry no reliable date unless one is stated. Exceptions read directly: Revolut's public OpenAPI file on GitHub, and GitHub issues, Enable Banking docs and the GoCardless status page. Labels: **[official]** = the vendor's own docs or terms; **[community]** = GitHub issues and forum posts, with the date where known.

## Summary of routes

| Route                              | Works on personal accounts?      | Credentials                                | Who can get them                                         | Key limits                                                                                        | Evidence                                        |
| ---------------------------------- | -------------------------------- | ------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Personal API or token from Revolut | No such product found            | n/a                                        | n/a                                                      | n/a                                                                                               | Absence of evidence, plus a community statement |
| Revolut Open Banking API, direct   | Yes, but only for regulated TPPs | eIDAS QWAC/QSeal (EEA); OBIE or eIDAS (UK) | Regulated AISPs/PISPs                                    | 4 unattended requests per 24h per account, endpoint and consent; 180-day refresh token with eIDAS | Official excerpts                               |
| Revolut Business API               | No, Business customers only      | Self-uploaded certificate, signed JWT      | Owner of a Grow, Scale or Enterprise account             | 40-minute access token; up to 1,000 results per request                                           | Official excerpts                               |
| Enable Banking restricted mode     | Reported yes                     | App ID and private key                     | Private individuals, non-commercial, own linked accounts | About 180 days consent for most banks; about 4 unattended fetches/day; HTTPS redirect only        | Official docs; Revolut coverage is community    |
| GoCardless Bank Account Data       | Yes for existing accounts        | Secret ID and key                          | Closed to new sign-ups                                   | 90 days access unless reconfirmation is used                                                      | Mixed                                           |
| Statement export                   | Yes                              | App or web login                           | Any customer                                             | Manual; no documented automation                                                                  | Official excerpts plus community                |
| Unofficial private API             | Historically                     | The customer's own login session           | Anyone, against the terms                                | Terms bar reverse engineering; the best-known library is archived                                 | Community plus official terms                   |

## Is there any official personal API or personal access token for retail accounts, and has that changed in 2025–2026?

### Takeaway

I found no official personal API or personal access token, and no sign of one being introduced in 2025–2026. This is an absence of evidence rather than a Revolut statement, since no Revolut page I could reach says so outright.

### Cited Findings

- A search for a retail token returned only Business, Merchant and Open Banking material — [Revolut developer docs: Open Banking API](https://developer.revolut.com/docs/open-banking/open-banking-api), [Business API](https://developer.revolut.com/docs/business/business-api).
- [community, 16 Oct 2026] "Revolut has no public API for personal accounts" — [Moneo issue #82](https://github.com/indkhan/Moneo/issues/82).
- [third-party vendor, undated] Personal Revolut accounts can only be reached through PSD2 open banking, which is open only to licensed providers — [AnythingMCP guide](https://anythingmcp.com/guides/connect-bank-account-to-claude).
- 2025 changes on Revolut's developer update feed concern the Open Banking API for TPPs (refresh tokens, FAPI 1.0 Advanced), not a personal route — [refresh tokens, 19 Mar 2025](https://developer.revolut.com/updates/2025-03-19-open-banking-refresh-tokens), [FAPI, 4 Mar 2025](https://developer.revolut.com/blog/2025-03-04-open-banking-fapi1-advanced).

### Inferences

- Budget for no first-party personal route. Personal data reaches a self-run app only through a regulated intermediary, a manual export or an unofficial route.

### Gaps

- No explicit Revolut statement that a personal API does not exist. I could not browse the developer site's full 2026 changelog because of the 403s.

## What does the Revolut Open Banking API require, and can a non-licensed individual use production?

### Takeaway

Production is for regulated AISPs and PISPs holding a valid eIDAS or OBIE certificate; no contract is needed, but regulated status is. The sandbox is open for testing, but it does not give access to real accounts. A private individual with no licence has no documented production path.

### Cited Findings

**Access and certificates**

- [official] Regulated AISPs and PISPs in the EU or UK can register with a valid certificate, without a contract with Revolut — [Who can access the API](https://developer.revolut.com/docs/guides/build-banking-apps/introduction-to-the-open-banking-api/who-can-access-the-api).
- [official] OBIE certificates come from Open Banking Limited (OBWAC transport, OBSeal signing). eIDAS certificates come from EU qualified trust service providers (QWAC, QSeal). Legacy OBTransport and OBSigning certificates are no longer supported — [Global customer access controls](https://developer.revolut.com/docs/guides/build-banking-apps/introduction-to-the-open-banking-api/global-customer-access-controls).
- [official] Production submission requires redirect URLs, publicly resolvable JWKS URLs and a transport certificate from a regulated CA — [Set up production](https://developer.revolut.com/docs/guides/build-banking-apps/get-started/setup-prod-environment). DCR is also supported — [DCR guide](https://developer.revolut.com/docs/guides/build-banking-apps/register-your-application-using-dcr).
- [official] Sandbox: register in the Developer Portal; sandbox authentication can use a test transport certificate — [Prepare Sandbox](https://developer.revolut.com/docs/guides/build-banking-apps/get-started/prepare-sandbox-environment). Hosts are `oba-auth.revolut.com` and `sandbox-oba-auth.revolut.com` — [Revolut OpenAPI file, v3.1.0](https://raw.githubusercontent.com/revolut-engineering/revolut-openapi/master/yaml/open-banking.yaml).
- [official, dated 2025] FAPI 1.0 Advanced and mandatory mTLS from 10 July 2025 — [Revolut update](https://developer.revolut.com/blog/2025-03-04-open-banking-fapi1-advanced).

**Consent and tokens**

- [official, 2025] Access tokens issued from 4 August 2025 last 60 minutes. Refresh tokens last 180 days for TPPs on eIDAS and 50 years for UK AISPs. Access ends at the earlier of refresh-token expiry and any explicit consent expiry — [Refresh tokens](https://developer.revolut.com/updates/2025-03-19-open-banking-refresh-tokens).
- [official] Consent is managed through `POST /account-access-consents`, plus `GET` and `DELETE /account-access-consents/{ConsentId}` — [OpenAPI file](https://raw.githubusercontent.com/revolut-engineering/revolut-openapi/master/yaml/open-banking.yaml).
- [official, older] An OBIE directory page says 90-day re-authentication, later replaced by no re-authentication for UK accounts and 180 days for EU accounts — [Open Banking directory: Revolut Ltd](https://openbanking.atlassian.net/wiki/spaces/AD/pages/1672511671/Revolut+Ltd). This matches the 2025 Revolut notice.

**Limits**

- [official] No more than 4 requests per 24 hours for each account, endpoint and consent (SCA RTS Art. 36.5). This does not apply when the user is present. There is a global cap of 100 requests per second per application — [Usage and limits](https://developer.revolut.com/docs/guides/build-banking-apps/usage-and-limits).
- [official] Transactions older than 90 days are reachable only in the first 5 minutes after consent — [Usage and limits](https://developer.revolut.com/docs/guides/build-banking-apps/usage-and-limits).
- Possible conflict: a February 2025 notice lists `/accounts`, transactions and balances as reachable beyond the 5-minute window — [Revolut update, 3 Feb 2025](https://developer.revolut.com/blog/2025-02-03-open-banking-accounts-endpoint). The two fit if the window limits depth rather than access, but I could not confirm that.

**Endpoints and fields**

- [official] Endpoints: `GET /accounts`, `/accounts/{AccountId}` (403 after the 5-minute SCA window), and `/balances`, `/beneficiaries`, `/direct-debits`, `/standing-orders`, `/transactions` under an account. Permissions include `ReadTransactionsBasic`, `ReadTransactionsDetail`, `ReadTransactionsCredits` and `ReadTransactionsDebits` — [OpenAPI file](https://raw.githubusercontent.com/revolut-engineering/revolut-openapi/master/yaml/open-banking.yaml).
- [official] Transaction fields seen in the spec's response examples: AccountId, TransactionId, TransactionInformation, Status, Amount, CreditDebitIndicator, Balance, BookingDateTime, ValueDateTime, CurrencyExchange (rates and instructed amount), CreditorAccount, DebtorAccount, MerchantDetails.MerchantName, ProprietaryBankTransactionCode, SupplementaryData (UserComments, StartedDate), CardInstrument — [same file](https://raw.githubusercontent.com/revolut-engineering/revolut-openapi/master/yaml/open-banking.yaml).

### Inferences

- This route is not realistic for one person. Beyond the certificates, it needs a public JWKS URL and redirect URL, which a one-computer app with no hosted backend lacks.
- The sandbox is useful only for writing a client against fake data.
- From background knowledge, not sourced here: PSD2 eIDAS certificates embed the PSP's regulator-issued authorisation number, which would stop an unlicensed individual from obtaining one. Verify this before stating it as fact.

### Gaps

- The step-by-step consent tutorial could not be read (403), so the exact flow is unverified. The endpoints above and the spec's use of request JWTs are what is confirmed.
- I read only the first 100,000 of about 500,000 characters of the spec, so the field list comes from examples and is not the full schema. I saw no cards or pockets endpoint in that part but cannot rule one out.
- No source explicitly says "an unregulated individual is refused". The docs only state the regulated requirement.

## Can a Revolut Business customer generate API credentials and read transactions, and does this work for personal accounts?

### Takeaway

Yes for Business customers on Grow, Scale or Enterprise: the account owner self-serves a certificate and reads transactions by API. It does not cover personal accounts.

### Cited Findings

- [official] The Business API is available on Grow, Scale and Enterprise. Only the account owner can open it, through Settings, Integrations, Business API. A sandbox is available — [Revolut help: Business API](https://help.revolut.com/en-AU/business/help/more/integrating-with-other-accounting-platforms/using-revolut-business-api/).
- [official] Setup: upload a certificate, sign a client-assertion JWT, exchange an authorisation code for tokens. Access tokens last 40 minutes; the refresh token "does not expire". Scopes are READ, WRITE and READ_SENSITIVE_CARD_DATA; that last one requires IP whitelisting or every endpoint is blocked — [Make your first API request](https://developer.revolut.com/docs/guides/manage-accounts/get-started/make-your-first-api-request).
- Conflict: a third-party PHP library's README says the refresh token expires after 90 days — [znojil/revolut-business](https://packagist.org/packages/znojil/revolut-business). Unresolved; the official docs say otherwise.
- [official] `GET /transactions` takes `from`, `to`, `account`, `count`, `type`, among other filters; default 100 and maximum 1,000 per request; newest first, time-based pagination — [Retrieve transactions](https://developer.revolut.com/docs/guides/manage-accounts/accounts-and-transactions/retrieve-transactions), [API reference](https://developer.revolut.com/docs/api/business#get-transactions).
- [official] A sync guide exists — [Sync accounts and transactions](https://developer.revolut.com/docs/guides/manage-accounts/use-cases/accounts-and-transactions-syncing).
- [community, Oct 2026] The Business API is limited to Business customers on those plans — [Moneo issue #82](https://github.com/indkhan/Moneo/issues/82).
- [official] Integrations may not contravene the Revolut Personal Terms — [Business API terms](https://revolut.com/legal/business-api/). The developer terms also bar reverse-engineering and circumventing rate limits — [API agreement PDF](https://cdn.revolut.com/terms_and_conditions/pdf/api_agreement_90a012a3_1.0.0_1773251776_en.pdf).

### Inferences

- Technically the best fit for a local app: no redirect host appears needed beyond the initial consent, and no third party. It is relevant only if the user holds a Grow-or-above Business account, and paying for that plan just to read personal spending does not help, since personal accounts stay out of reach.

### Gaps

- Current plan pricing not researched. Whether Basic or Freelancer plans are explicitly excluded: results name only the three plans.
- The initial redirect URI requirements for a local app were not confirmed.

## How do Revolut's legal entities change PSD2/Open Banking access?

### Takeaway

EEA customers sit with Revolut Bank UAB and need eIDAS certificates, with 180-day consent. UK customers can be reached with OBIE or eIDAS, and UK AISPs get long-lived tokens. One API serves both.

### Cited Findings

- [official, undated matrix] UK: Revolut Ltd and Revolut Bank UK Ltd, OBIE or eIDAS, Accounts and Payments. EEA: Revolut Bank UAB and branches (Germany, Spain, France, Hungary, Ireland, Italy, Netherlands, Romania), eIDAS only. Singapore and US: OBIE or eIDAS, Accounts only. No Australian row seen — [Global customer access controls](https://developer.revolut.com/docs/guides/build-banking-apps/introduction-to-the-open-banking-api/global-customer-access-controls).
- [official] Revolut Ltd is the technical provider for all regional entities, so traffic is signed with its certificates regardless of the local branch — [same page](https://developer.revolut.com/docs/guides/build-banking-apps/introduction-to-the-open-banking-api/global-customer-access-controls).
- [official, Aug 2024] Swiss users are being migrated from Revolut Ltd to Revolut Bank UAB; old consents under OBIE certificates stop working and new ones need eIDAS — [same page](https://developer.revolut.com/docs/guides/build-banking-apps/introduction-to-the-open-banking-api/global-customer-access-controls), [Migration notice](https://developer.revolut.com/blog/2024-08-16-open-banking-migration-of-swiss-users).
- [official] One API for EEA and UK customers — [Open Banking directory](https://openbanking.atlassian.net/wiki/spaces/AD/pages/1672511671/Revolut+Ltd).
- [official] Personal terms name regulators such as the FCA or the Bank of Lithuania for authorising third-party providers, and allow Revolut or the customer to block a provider — [Personal terms](https://www.revolut.com/legal/terms/).
- [community, Oct 2026] An Irish IBAN belongs to the Irish branch of Revolut Bank UAB — [k8s-titan issue #159](https://github.com/javierarrieta/k8s-titan/issues/159).
- [official] GoCardless uses distinct IDs including `REVOLUT_REVOLT21`, `REVOLUT_REVODEB2XXX` and, for the UK, `REVOLUT_REVOGB21` — [GoCardless status, 23 Oct 2026](https://status.accountdata.gocardless.com/incidents/01M5M0V78D62RVH74Z080PW1EH), [Actual issue #9006](https://github.com/actualbudget/actual/issues/9006).

### Inferences

- An EEA user should expect to re-consent about every 180 days at best, whichever intermediary is used. UK users may fare better under a UK-regulated provider.
- Aggregator institution choice may depend on the IBAN country or branch, so a user with a German IBAN should check which ID applies.

### Gaps

- Whether a UK-authorised AISP's 50-year tokens are passed on by any aggregator was not established.

## What can statement exports provide: formats, completeness, automation and columns?

### Takeaway

Exports are the only universally available official route, but they are manual and semi-structured. Personal users get PDF and "Excel", which community sources say is really CSV; Business users also get camt.053 and MT940. No documented automation exists for personal accounts.

### Cited Findings

- [official] Personal path: Home, Accounts, currency, More, Statement, then timeframe and PDF or Excel. Contents: BIC and IBAN, balance summary, and pending, completed and reverted transactions — [Revolut help](https://help.revolut.com/en-US/help/profile-and-plan/managing-my-account/account-statement-per-chosen-currency/).
- [official] Statements are per currency account. Pocket activity rolls into the main statement and cannot be exported alone — [Pockets statement](https://help.revolut.com/help/profile-and-plan/managing-my-account/get-a-pocket-s-statement/).
- Conflict: one regional page says Revolut Bank users can download only PDF — [Revolut help, LI](https://www.revolut.com/en-LI/help/my-accounts/managing-my-account/viewing-my-account-statements). The US-locale page lists PDF or Excel. This came from a search excerpt, and the page returned 403 when fetched. Current EEA behaviour should be tested in the app.
- [community, undated] The web app's "Excel" option actually produces CSV, with header `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance` — [revolut-toolkit](https://github.com/lastunicorn/revolut-toolkit).
- [official] Business account statements come as PDF, CSV, XML (camt.053) and TXT (MT940); transaction statements are narrower on some regional pages — [Business account statements](https://help.revolut.com/en-US/business/help/managing-my-business/viewing-my-account-statements/how-to-get-a-monthly-statement/), [Transaction statements](https://help.revolut.com/en-US/business/help/managing-my-business/viewing-my-account-statements/finding-my-account-statement/). CSV can include local and UTC times.
- [community, 25 Oct 2026] One real-world personal CSV ran 2015-09-16 to 2024-10-25 in its "current wallet" subset, from 2,717 rows originally, with 61 `REVERTED` or `PENDING` rows dropped — [k8s-titan issue #159](https://github.com/javierarrieta/k8s-titan/issues/159). This indicates deep history is available and that `State` must be filtered.
- [community] CSV history and provider sync do not dedupe against each other without a shared ID — [k8s-titan issue #159](https://github.com/javierarrieta/k8s-titan/issues/159).

### Inferences

- The header has no transaction ID, counterparty IBAN or merchant category, so de-duplication must rely on date, amount and description.
- A sound pattern is CSV for history and an aggregator from a cutoff date on, as that report did.
- reeve's existing importer reads CSV and CAMT, so this route needs mapping but no new connection. Business camt.053 files should fit directly; MT940 is not on reeve's list.

### Gaps

- No official column specification found; the header comes from one undated community project and may vary by locale. A fresh export should be checked.
- The maximum export period, and the treatment of savings vaults, crypto and stock activity in exports, were not confirmed.
- No documented way to automate personal exports was found. Automating a logged-in session would raise the same terms questions as the next section.

## Do unofficial or reverse-engineered routes exist, are they maintained, and what is the risk?

### Takeaway

They exist, and the best-known one is dead. Revolut's terms bar reverse-engineering its products. This is a decision for the user; it is reported here for risk only, with no method given.

### Cited Findings

- [community] `tducret/revolut-python` is a non-official client for retail accounts, archived by its owner on 9 Sep 2022 and read-only — [GitHub](https://github.com/tducret/revolut-python).
- [official] "you also must not reverse-engineer any of our products" appears in the personal terms' IP section per a search excerpt — [Personal terms](https://www.revolut.com/legal/terms/). A third-party tracker quotes the same clause — [ConductAtlas](https://conductatlas.com/platform/revolut/revolut-terms-of-service/provision/CA-P-047886/prohibition-on-reverse-engineering-products/).
- [official] Personal terms also let Revolut block third-party provider access for suspected fraud or lack of authorisation — [Personal terms](https://www.revolut.com/legal/terms/).
- [community, undated] A forum post alleges a third-party app reverse-engineered the mobile API and stored credentials in plain text — [Emma community](https://community.emma-app.com/t/revolut-revolut-business-integration/3882). Unverified anecdote.
- Not to be confused: `pyrevolut` and `revolut-connect` are unofficial wrappers of the official Business API — [pyrevolut](https://pypi.org/project/pyrevolut), [revolut-connect](https://github.com/moraki-finance/revolut-connect).

### Inferences

- Risks to weigh: a terms breach on the user's main bank account, possible account restriction, loss of a session with payment powers inside a budgeting app, and breakage whenever the private app changes. The regulated routes avoid all of these and read the same data.
- Private-API access typically carries full account authority, whereas AIS consent is read-only. That asymmetry matters more than the terms for a local app.

### Gaps

- No survey of other maintained private-API projects in 2026, and no documented case of Revolut sanctioning a customer for this. I found no reliable source on enforcement.
- Exact consequence clauses for breach of the personal terms were not read in full, and wording varies by region.

## Which aggregators cover Revolut, for retail or business, and with what known problems?

### Takeaway

Enable Banking's free restricted mode is the one evidenced path open to a new private individual in the EEA today, and it reportedly lists Revolut Bank UAB. GoCardless covers Revolut but is closed to new accounts. I found no Revolut-specific evidence for Salt Edge or Tink.

### Cited Findings

**Enable Banking**

- [official] Activating a production app by linking your own accounts makes it "active in restricted mode", permitting "individual non-commercial use", with data only from linked accounts. It lasts until a contract is signed, and linking does not replace API authorisation — [Linked accounts](https://enablebanking.com/docs/api/linked-accounts/), [FAQ](https://enablebanking.com/docs/faq/).
- [official] The maximum `valid_until` depends on the bank, 180 days for most. Many banks allow 4 fetches a day when the user is absent; wait 6 hours after `ASPSP_RATE_LIMIT_EXCEEDED`. Commercial pricing is volume-based — [FAQ](https://enablebanking.com/docs/faq/).
- [official, excerpt only] Terms limit production use to linked accounts and to evaluation or personal use by private individuals, may cap linked accounts, and exclude business use — [Terms](https://enablebanking.com/terms/). The page came back empty when fetched, so this rests on a search excerpt.
- [community, 25 Oct 2026] Revolut Bank UAB (BIC REVOLT21) is listed as integrated for AISP, production, personal, SEPA — [k8s-titan issue #159](https://github.com/javierarrieta/k8s-titan/issues/159). The Moneo author (16 Oct 2026) still called Revolut support "probably", unverified — [Moneo issue #82](https://github.com/indkhan/Moneo/issues/82).
- Conflict: the k8s-titan author concluded Enable Banking is "contract-gated" because a production app needs a quote, billing and KYC — [issue #159](https://github.com/javierarrieta/k8s-titan/issues/159). Enable Banking's own docs show this applies to unrestricted production only — [Control Panel](https://enablebanking.com/docs/api/control-panel/). A setup report says activation works through "Activate by linking accounts", though the form asks for a description, a data-protection email and privacy and terms URLs — [picsou-finance issue #318](https://github.com/Cloeille/picsou-finance/issues/318).
- [community, 14 Oct 2026] Support replied "Only https: redirect supported"; `app://` was rejected — [Actual issue #7799](https://github.com/actualbudget/actual/issues/7799).
- [community, 24 Oct 2026] A session account UID may change while `identification_hash` stays stable — [Actual issue #7799](https://github.com/actualbudget/actual/issues/7799).
- [community, 28 Oct 2026] Auth is an RS256 JWT with `kid` set to the app ID, valid at most 24 hours; `redirect_url` must be a registered URL — [Budgie issue #1748](https://github.com/budgie-at/budgie/issues/1748).

**GoCardless Bank Account Data**

- [community-level, since about July 2025] New sign-ups disabled, existing accounts keep working — [Servorbit blog](https://servorbit.com/en/blog/firefly-iii-vs-actual-budget-which-one-to-choose-in-2026). [official-for-Actual] Actual's docs mark it "not accepting new accounts" — [Actual bank sync](https://actualbudget.org/docs/advanced/bank-sync/).
- [official] Defaults are 90 days history and 90 days access; `max_historical_days` and `access_valid_for_days` are set on the agreement — [GoCardless quickstart](https://developer.gocardless.com/bank-account-data/quick-start-guide).
- [community, 24 Sep 2026] `REVOLUT_REVOGB21`: 90-day cap without reconfirmation, 730 accepted with it; the issue was closed by a bot with no maintainer decision — [Actual issue #9006](https://github.com/actualbudget/actual/issues/9006). The search also reports `transaction_total_days: 730` for that ID. No figures found for `REVOLUT_REVOLT21`.
- [official, 23 Oct 2026] Full Revolut outage caused by a certificate change: 11:18 to 12:35, IDs `REVOLUT_REVOLT21` and `REVOLUT_REVODEB2XXX` disabled — [GoCardless status](https://status.accountdata.gocardless.com/incidents/01M5M0V78D62RVH74Z080PW1EH). Another notice says REVOLT21 and REVOGB21 were removed from the institution list; I did not read it and its date is unknown — [GoCardless status](https://status.accountdata.gocardless.com/incidents/01M5C3HAP363E7B6E9D6A2DXAW).
- [third-party, Oct 2026] Synci resells Revolut access through GoCardless as a SimpleFIN source at €2 to €12.33 a month, with re-authentication about every 180 days — [k8s-titan issue #159](https://github.com/javierarrieta/k8s-titan/issues/159). This adds two intermediaries, and the author noted unverified privacy claims.

**Others and problems**

- [community, Oct 2026] TrueLayer is listed as covering Revolut but UK-centric and sandbox-only without a commercial agreement — [Moneo issue #82](https://github.com/indkhan/Moneo/issues/82).
- [official] Firefly III's data importer uses third-party providers (GoCardless/Nordigen, Salt Edge) and CSV; nothing Revolut-specific found — [Firefly III docs](https://docs.firefly-iii.org/tutorials/firefly-iii/importing-data/).
- [community, 11 Oct 2026] A Revolut joint account via Enable Banking reports a balance that includes pending card authorisations (anchor 64.53, pending 36.01), which shifted a reverse-computed history. A second account with no pending items was fine — [Sure issue #314](https://github.com/newmancu/sure/issues/314).
- [community] Reconnecting a Revolut account via Enable Banking created a duplicate account and duplicated every transaction — [Securo issue #445](https://github.com/securo-finance/securo/issues/445).
- [community, 2026] A sync window of about 89 to 90 days on Actual with Enable Banking, and a release-note fix for requesting 91 — [Actual issue #7799](https://github.com/actualbudget/actual/issues/7799), [Actual release notes](https://actualbudget.org/docs/releases/). A blog claims the integration has been "experimental" since v26.6.0 (June 2026) — [Servorbit](https://servorbit.com/en/blog/firefly-iii-vs-actual-budget-which-one-to-choose-in-2026). Actual's overview page does not label it so.

### Inferences

- For one person on one computer, Enable Banking restricted mode is the likely path, subject to testing. The user would hold the private key locally, re-consent about every 180 days and need a design for the HTTPS redirect (a static page or a pasted code; a localhost URL is untested).
- Booked-only sync with a stable external ID is the safer default. Using a balance reading as an anchor needs care, since Revolut's may include pending items.
- Whichever aggregator is used, the first sync should fetch deep history right after consent, given Revolut's 5-minute window.

### Gaps

- Salt Edge and Tink: no Revolut-specific evidence found. Both are generally commercial, but I did not confirm this for individuals.
- Whether Enable Banking accepts `https://localhost`, Revolut's `maximum_consent_validity` and history depth through it, and `entry_reference` stability on Revolut all need a live test. No source gave Revolut-specific figures.
- No useful Reddit threads surfaced; community evidence here is GitHub issues.

## Does Revolut offer MCP, a "connected apps" feature, or a new open data export?

### Takeaway

There is no official personal-account MCP or new data export that I could find. The one Revolut-organisation MCP covers the Revolut X crypto exchange only.

### Cited Findings

- [official-org] `revolut-engineering/revolut-x-api` has a REST client, a read-only MCP server, a CLI and Claude Code skills for Revolut X only, with no mention of bank accounts. The README does not itself state official status — [GitHub](https://github.com/revolut-engineering/revolut-x-api).
- [third-party] Other Revolut MCP servers are community-built and aimed at Business — [AnythingMCP](https://anythingmcp.com/guides/connect-revolut-to-claude), [revolut-mcp listing](https://mcptoplist.com/server/io.github.jeff-nasseri%2Frevolut-mcp). Listing dates are inconsistent.
- [official] Revolut's open banking pages explain third-party provider access and Linked Accounts — [What is Open Banking](https://help.revolut.com/help/accounts/open-banking/what-is-open-banking-and-how-does-it-work/), [Linked accounts](https://www.revolut.com/linked-accounts/). I saw titles and excerpts only.

### Inferences

- "Linked Accounts" appears to bring other banks into Revolut, not export Revolut data out, so it would not help here. Confirm this if it matters.

### Gaps

- No Revolut press release or help page on a personal MCP or new export was found; the 403s limit how firmly this can be stated.
- A GDPR data-subject access or portability request was not researched as a route. It would likely be one-off rather than programmatic.

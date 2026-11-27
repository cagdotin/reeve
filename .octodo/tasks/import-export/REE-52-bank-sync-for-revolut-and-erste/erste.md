# Reading your own Erste Group transactions into a local budgeting app (status: 2 November 2026)

Method note: the Erste Developer Portal is a JavaScript app that plain fetching returns empty. I rendered its pages in a headless browser on 2 November 2026 and read the text, including the OpenAPI specs the pages load. Portal content is therefore current as of that date even where the page itself is undated. "Official" below means a bank or portal page; "community" means GitHub issues or projects; "third party" means vendors and blogs.

Bank codes on the portal: `eboe` Austria, `csas` Czechia, `slsp` Slovakia, `ebh` Hungary, `ebc` Croatia, `bcr` Romania, `ebm` Montenegro, `egb` Erste Group Bank (ErsteConnect). The [portal sitemap](https://developers.erstegroup.com/sitemap.xml) has no Serbian or Polish bank.

## Developer portals: which APIs exist, can a private customer get a key, is a TPP licence or eIDAS certificate needed?

### Takeaway

Česká spořitelna is the only Erste bank with a documented, licence-free route to a private customer's own accounts: the Premium Accounts API, used as a "Final API Consumer" (FAC). Everywhere else the portal offers only PSD2 APIs, which need a PSD2 licence and QWAC certificates, or corporate products. One unresolved conflict: the group-wide portal terms restrict registration to "Entrepreneurs", while Česká spořitelna's own documents name retail clients as eligible.

### Cited Findings

**The two application roles (official, undated, live on 2 Nov 2026)**

- The portal defines FAC as an app with "access to data and accounts accessible to the application authors only... No bank license is required", and TPP as an app for other people's accounts, where "A PSD2 license or an agreement with the bank is required" — [Applications manual](https://developers.erstegroup.com/docs/tutorial/general-user-manual-application)
- The usage type can be changed only until the app is first connected to a production environment, and production credentials require completing "all required compliance checks" — [Applications manual](https://developers.erstegroup.com/docs/tutorial/general-user-manual-application); [Portal step by step](https://developers.erstegroup.com/docs/tutorial/step-by-step)
- Portal terms, clause 3.3: "The access to and the use of the Portal are subject to your registration and shall be restricted to Entrepreneurs only" (as defined in the Austrian KSchG), and Erste may reject or withdraw a registration without giving a reason. Terms are undated — [General Terms & Conditions](https://developers.erstegroup.com/terms-and-conditions/). This conflicts with the Česká spořitelna sources below and with the portal's own mention of "a personal space... for you and your personal projects" — [Portal step by step](https://developers.erstegroup.com/docs/tutorial/step-by-step)

**Czechia: Premium Accounts API v3 (official)**

- The API "provides information about personal and business account types" (account list, balances, transaction history, statements, notifications); endpoints include `/my/accounts`, `/my/accounts/{id}/transactions`, statements download and card transactions — [Premium Accounts API v3](https://developers.erstegroup.com/docs/apis/bank.csas/bank.csas.v3%2Faccounts)
- It "does not require Certificate protection with 2-way SSL (QWAC)" and needs no QSealC signature — [Premium Accounts API v3](https://developers.erstegroup.com/docs/apis/bank.csas/bank.csas.v3%2Faccounts)
- Fee: 300 CZK per month per connected account, but "The pricing does not apply to natural persons' ('fyzická osoba (FO)') accounts" — [Premium Accounts API v3](https://developers.erstegroup.com/docs/apis/bank.csas/bank.csas.v3%2Faccounts); [FAQ, with price-list references (corporate list dated 26 Jan 2024)](https://developers.erstegroup.com/support/faq/bank.csas/20d3a416-2202-4dd6-8e94-55bd0788f822)
- "PSD2 can be only used by licensed consuments. Premium API can be used by clients without license" — [FAQ](https://developers.erstegroup.com/support/faq/bank.csas/043e382c-1830-454a-a594-aa3356b6d455)
- On using PSD2 for yourself: "If you do not know what it means, do not worry about it at all and use the Corporate or Personal Accounts API" — [FAQ](https://developers.erstegroup.com/support/faq/bank.csas/5fe40bb2-faa9-418a-9be3-34bb51ede37b)
- No branch visit: "Just sign up for this portal and start testing your sandbox application" — [FAQ](https://developers.erstegroup.com/support/faq/bank.csas/50346ce2-7c30-4323-bf5c-6aa9dd730285)
- API handbook (official PDF, undated; a search tool described it as about six years old, so treat details as possibly stale):
  - FAC is "a corporate / retail client or non-client who wishes to connect to our API in order to access their own bank accounts". An existing client who asks for production access is allowed to generate production keys; a non-client must first sign a Developer Agreement.
  - It tells applicants to contact `api@csas.cz` first.
  - Registration can involve, "if requested", a criminal-record extract no more than 3 months old, also for natural persons, delivered physically as well.
  - The bank may ask for the app's source code and may approve or deny at its discretion.
  - Apps "should not access Client's data no more than four times in a 24-hour period, unless a higher frequency is agreed with the Client or the request is done actively by the Client".
  - All of the above: [Česká spořitelna API handbook, English PDF](https://www.csas.cz/content/dam/cz/csas/www_csas_cz/dokumenty/obecne/how-to-connect-to-api-of-cs.pdf)
- Credentials: API key, client ID and client secret; OAuth2 code grant with the client's George login at `bezpecnost.csas.cz`. Access token 5 minutes, refresh token 180 days — [CS user authentication guide](https://developers.erstegroup.com/docs/tutorial/csas-how-to-call-api). Refresh token validity rose from 90 to 180 days on 25 July 2023 — [News, 24 May 2023](https://developers.erstegroup.com/news/validity-of-refresh-token-will-increase-from-90-to-180-days-star)
- An individual account holder always has the full disposition rights needed for the API and they cannot be changed — [CS disposition rights guide](https://developers.erstegroup.com/docs/tutorial/csas-how-to-set-disposition-rights)
- Connected apps are managed in George under Settings → My Banking IDentity → Linked accounts and multibanking — [FAQ](https://developers.erstegroup.com/support/faq/bank.csas/64578c4c-12aa-4f56-848d-b07c9e600710)

**Czechia: other APIs (official)**

- PSD2 Account Information API v4 is for "third parties with PSD2 license" and its endpoints must be secured with QWAC — [PSD2 AIS v4](https://developers.erstegroup.com/docs/apis/bank.csas/bank.csas.v4%2Faccount-information)
- Transparent Accounts API v3 is a Public API over the bank's public transparent accounts and their transactions; it does not reach ordinary private accounts — [Transparent Accounts API](https://developers.erstegroup.com/docs/apis/bank.csas/bank.csas.v3%2FtransparentAccounts)
- The catalog also has Premium Payments, Automated Payments, Balance Information, Rates, Places and Planned Outages — [portal sitemap](https://developers.erstegroup.com/sitemap.xml)

**Other countries (official)**

- Austria's catalog is PSD2 Account Information, Consents, Payments, Confirmation of Funds, Signing Baskets (v2; v1 deprecated) plus Planned Outages. No Premium API is listed — [Our APIs, Austria view](https://developers.erstegroup.com/docs/apis)
- PSD2 sandbox in Austria needs eIDAS certificates for mutual TLS; test certificates are provided on the portal — [AT sandbox guide](https://developers.erstegroup.com/docs/tutorial/at-sandbox-guide)
- Slovakia, Romania and Montenegro show only PSD2 APIs and Planned Outages in the sitemap — [portal sitemap](https://developers.erstegroup.com/sitemap.xml). For BCR, "application usage must be set to Third Party Provider" for PSD2 APIs — [BCR tutorial](https://developers.erstegroup.com/docs/tutorial/tutorial-creating-an-application)
- Croatia has PSD2 APIs plus a "Corporate Accounts and Payments API (NetAPI)" — [NetAPI](https://developers.erstegroup.com/docs/apis/bank.ebc/bank.ebc.v1%2Fnetapi). All Croatian PSD2 endpoints need a QWAC; QSeal is optional — [EBC TPP requirements](https://developers.erstegroup.com/docs/tutorial/tpp-authentication-requirements)
- Hungary has separate retail and corporate PSD2 APIs; the "Corporate PSD2 API" is marked deprecated — [EBH retail AIS](https://developers.erstegroup.com/docs/apis/bank.ebh/bank.ebh.v1%2Fpsd2-aisp-retail); [EBH Corporate PSD2](https://developers.erstegroup.com/docs/apis/bank.ebh/bank.ebh.v1%2FcorporateAPI)
- ErsteConnect (`egb`) aggregates accounts behind one Berlin Group API, with Erste Group Bank acting as TPP, and needs a signed contract plus a certificate — [ErsteConnect intro](https://developers.erstegroup.com/docs/tutorial/egb-intro). It is "a corporate API... not designed for accessing the private accounts of retail customers", with a default limit of 10 accounts added per 30 days — [FAQ](https://developers.erstegroup.com/support/faq/bank.egb/c2d51860-7a34-4646-821d-a5b05fbbca6a). A free Erste WAC certificate can be generated for non-PSD2 use — [FAQ](https://developers.erstegroup.com/support/faq/bank.egb/66585e1d-53f7-4837-b7b6-3c6902bd67b8)

**Serbia and Poland**

- Erste completed its 49% stake in Santander Bank Polska on 9 January 2026 — [Erste press release](https://www.erstegroup.com/en/news-media/press-releases/2026/01/09/erste-group-completes-acquisition-of-controlling-stake-in-santander-bank-polska). The bank was rebranded Erste Bank Polska on 24 April 2026 — [Wikipedia](https://en.wikipedia.org/wiki/Erste_Bank_Polska) (secondary). A tender offer to raise the stake to as much as 75% is reported for November 2026 — [ad-hoc-news](https://www.ad-hoc-news.de/boerse/news/corporate-news/erste-group-seeks-75-percent-stake-in-santander-bank-polska-stock/70299280) (not confirmed on Erste's site)
- Serbia's Law on Payment Services was amended (Official Gazette 64/2024) to align with PSD2 and introduce open banking — [Karanović & Partners](https://karanovicpartners.com/news/harmonisation-of-serbian-law-on-payment-services-with-psd2). The compliance deadline was reported as moved to 1 January 2026 — [Salt Edge, Apr 2025](https://blog.saltedge.com/serbia-extends-psd2-compliance-deadline/) (vendor). Open banking may be provided only by NBS-licensed entities — [Chambers Fintech 2026, Serbia](https://practiceguides.chambers.com/practice-guides/fintech-2026/serbia)

### Inferences

Route summary, drawn from the findings in this document:

| Country  | Licence-free official API for a private customer                                              | PSD2 directly                      | Aggregator (private person)                                                | File export                                             |
| -------- | --------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------- |
| Czechia  | **Yes on paper**: Premium Accounts API v3, FAC, no QWAC, no fee for natural persons' accounts | Licence and QWAC                   | Enable Banking excludes Czech residents; GoCardless closed to new sign-ups | Yes                                                     |
| Austria  | No                                                                                            | Licence and eIDAS                  | Enable Banking restricted mode                                             | Yes (CSV, Excel, JSON, MS Money)                        |
| Slovakia | No                                                                                            | Licence                            | Enable Banking restricted mode                                             | Yes (search export; statements as PDF, SEPA XML, MT940) |
| Croatia  | Not for private customers (NetAPI is corporate)                                               | Licence and QWAC                   | Enable Banking restricted mode                                             | Not confirmed                                           |
| Romania  | No                                                                                            | Licence                            | Enable Banking restricted mode                                             | Yes (CSV, PDF)                                          |
| Hungary  | No                                                                                            | Licence                            | Not confirmed on Enable Banking                                            | Not confirmed                                           |
| Poland   | Not on Erste's portal                                                                         | Not researched to the source       | Enable Banking lists it as Santander Bank Polska                           | Not confirmed                                           |
| Serbia   | Not on Erste's portal                                                                         | Regime new, licensed entities only | None found                                                                 | Not confirmed                                           |

- The Premium API fits a one-computer app in principle: no certificate, and the app and the account holder are the same person. Three things can still block it: the "Entrepreneurs only" clause, the bank's discretionary approval, and whether a local redirect URI is accepted.
- The webhook notifications need an endpoint the bank can call, so a local app without a public address would poll instead. That fits the four-a-day limit.
- A private customer outside Czechia has no official way to read data through the portal without a licence. A licence is not a realistic route for one person.

### Gaps

- I found no report, official or community, of a private individual actually receiving Premium API production keys in 2025 or 2026. The closest is a Czech accounting project that tested the Spořitelna connection only in sandbox and says production "requires approval of the registered application" — [myucto #232, Oct 2026](https://github.com/radekhulan/myucto/issues/232). Whether the "Entrepreneurs only" clause is enforced against Czech retail clients is unknown; asking `api@csas.cz` would settle it.
- The page says the fee "does not apply" to natural persons' accounts, but no source states an explicit zero. A sole trader is also a natural person in Czech law, and whether a sole trader's account counts is not stated. A third-party blog says a business tariff pays 300 CZK per month — [uctoontime, 2025](https://www.uctoontime.online/post/bankovni-api-pro-ucetnictvi).
- Whether the production IDP accepts `localhost` or a loopback redirect for FAC apps at Česká spořitelna is not documented in what I read. Austria explicitly rejects localhost (see the PSD2 section).
- I could not load the Erste Bank Polska or Erste Bank Serbia developer pages, and found no developer portal for either. Poland may use the PolishAPI standard, as other Polish banks do, but I did not confirm it.
- The Croatian NetAPI's eligibility and certificate requirements were not established. Its page describes a PSD2-derived spec under a corporate title.

## George and similar: any user-facing API, plug-in, token, or free personal or sole-trader API?

### Takeaway

No George feature gives an ordinary user a personal API token. The closest things are Česká spořitelna's OAuth flow against the Premium API and George's plug-ins for extended history and file transfer. I found no product called "George Connect"; the similarly named ErsteConnect is a corporate product.

### Cited Findings

- George add-ons are activated under Extras. A guide titled "How to activate 'Data statements' for API in George" uses Extras → File transfer, then a signed setup; generated statements then appear under Extras → Data statements — [portal guide, undated](https://developers.erstegroup.com/docs/tutorial/extras-data-statements-plugin-ib-george)
- Through the Premium API, statement download formats by channel are: George PDF, ABO, CSV; Business 24 PDF, XML, MT940, ABO; George Business PDF, XML, MT940, ABO, CSV — [Premium Accounts API v3](https://developers.erstegroup.com/docs/apis/bank.csas/bank.csas.v3%2Faccounts)
- The API also returns transaction history from card accounts — [FAQ](https://developers.erstegroup.com/support/faq/bank.csas/b9a8128f-ffba-4f1e-be65-df0bbf90a830)
- Austria: a "7 Year Archive" plug-in extends the 3-year default history (article updated 19 Aug 2025) — [Sparkasse George help](https://www.sparkasse.at/en/george-help/george/your-products/current-accounts/your-account-history). The paid George Pro adds CSV and XLSX export of all data, per — [futurezone](https://futurezone.at/amp/produkte/erste-bank-startet-george-pro-mit-zusatzfunktionen/401350301) (press, date not confirmed)
- ČS has marketed no-code API links to business customers through Integromat, aimed at "firemní zákazník" (corporate customers) — [Bankovnictví online, 29 Oct 2020](https://bankovnictvionline.cz/aktuality/ceska-sporitelna-zautomatizovala-sve-api-rozhrani)

### Inferences

- The "Data statements" guide sits in the shared portal without naming a bank. I read it as Česká spořitelna because the Premium API documents George statement formats and links to data-statement details, but the page does not say so.
- The "ErsteConnect" name is the likely source of any "George Connect" idea. Its FAQ rules out private retail accounts.

### Gaps

- Whether the File transfer plug-in costs anything or is available on every personal George tier was not found.
- I found no equivalent token or plug-in for Slovakia, Hungary, Croatia, Romania, Serbia or Poland, but I did not read each country's George add-on list.

## PSD2 (XS2A): standard, SCA, consent length, history limits, sandbox

### Takeaway

Most Erste banks use Berlin Group NextGenPSD2; Česká spořitelna's API paths are its own (`/my/accounts`). Unattended access commonly returns 90 days of history in Austria, and consent refreshes at 90 days in Austria and Slovakia but 180 in Czechia. Sandboxes exist on the portal for all of them, returning mock data only.

### Cited Findings

**Austria (official)**

- NextGenPSD2 1.3.3 base. OAuth pre-step via redirect is supported; decoupled for retail with PUSH_OTP and all corporate accounts; embedded for retail with CARD_OTP and SMS_OTP — [AT PSD2 Accounts API v2](https://developers.erstegroup.com/docs/apis/bank.eboe/bank.eboe.v2%2Fpsd2-accounts-api)
- Only payment accounts are accessible, for George or George Business customers. History follows the online channel: 3 years by default, 7 with the plug-in. "If the user is not 'in front of device' only the last 90 days are accessible". Page size is at most 50. Transaction IDs "remain same forever" — [AT FAQ](https://developers.erstegroup.com/docs/tutorial/at-faq)
- Neither TPP nor customer can configure consent lifetime or scope, and the customer can revoke consent in online banking — [AT FAQ](https://developers.erstegroup.com/docs/tutorial/at-faq)
- Each refresh token lasts 90 days, and a new one requires a user login. The production redirect URI must use "https:// and a valid hostname (not localhost)" — [AT security guide](https://developers.erstegroup.com/docs/tutorial/at-security-authorization)
- `validUntil` "might get adjusted by ASPSP", and `9999-12-31` requests the maximum — [AT Consents API v2](https://developers.erstegroup.com/docs/apis/bank.eboe/bank.eboe.v2%2Fpsd2-consent-api)

**Czechia (official)**

- AIS v4 requires QWAC and no QSealC — [PSD2 AIS v4](https://developers.erstegroup.com/docs/apis/bank.csas/bank.csas.v4%2Faccount-information)
- Refresh tokens last 180 days — [FAQ](https://developers.erstegroup.com/support/faq/bank.csas/c25ade45-1335-47e3-b152-77312a54bc4f)
- "The maximum legth of transaction history is 2 years" with a strong SCA token (undated) — [FAQ](https://developers.erstegroup.com/support/faq/bank.csas/232540c8-2709-448e-8eba-5a263562c03e)
- Without `fromDate`, the transactions endpoint returns one month; errors include `SCA_REQUIRED` and `MAX_TRANSACTIONS_EXCEEDED` — OpenAPI text on [Premium Accounts API v3](https://developers.erstegroup.com/docs/apis/bank.csas/bank.csas.v3%2Faccounts)
- PSD2's `User-Involved` flag: with "sca flag false" you may query only 4 times — [FAQ](https://developers.erstegroup.com/support/faq/bank.csas/47e9ba44-0143-405a-88c0-bd4f3c286358)
- `entryReference` is the unique transaction identifier — [FAQ](https://developers.erstegroup.com/support/faq/bank.csas/4594fafb-24eb-4b7d-bb32-08c7825e48c9). A unique, immutable transaction ID arrived with AIS v4 and Accounts v3 — [News, 28 Aug 2024](https://developers.erstegroup.com/news/new-version-of-psd2-api-account-information-api-v4-and-premium-a)
- Sandbox "returns only static data" — [FAQ](https://developers.erstegroup.com/support/faq/bank.csas/92d7c4ec-7b19-4c72-b465-df1b8fbde682)

**Slovakia (official)**

- The bank offers only a redirect flow, and defends it by citing the EBA opinion on the RTS — [FAQ](https://developers.erstegroup.com/support/faq/bank.slsp/95a4f3ef-0326-45a3-bd06-5e7850a28509)
- Refresh tokens last 90 days — [User authentication](https://developers.erstegroup.com/docs/tutorial/user-authentication-authorization); [FAQ](https://developers.erstegroup.com/support/faq/bank.slsp/f20ec859-9c19-4d95-a9f5-cc890810ace9)
- An accounting vendor's guide to the separate business Databanking 2 API says movements older than 90 days must be fetched by hand — [POHODA guide](https://www.stormware.sk/dnload/POHODA_a_SLSP_Databanking_2_API.pdf) (third party, business channel)

**Croatia (official)**

- NextGenPSD2 1.3.8 Croatian edition. Integrated OAuth2 SCA, plus decoupled SCA when the PSU ID type is mToken — [EBC PSD2 AIS](https://developers.erstegroup.com/docs/apis/bank.ebc/bank.ebc.v1%2Fpsd2-aisp)
- Sandbox with test QWACs — [EBC sandbox guide](https://developers.erstegroup.com/docs/tutorial/getting-started-with-psd2-apis)

**Romania (official)**

- NextGenPSD2 1.3-based spec dated 21 Mar 2022, with "OAuth SCA Approach" listed — [BCR AIS](https://developers.erstegroup.com/docs/apis/bank.bcr/bank.bcr.v1%2Faisp)

**Hungary (official)**

- Retail API v1.1.0 with accounts, balances and transaction endpoints and a sandbox server; its own schema rather than the Berlin Group labelling used elsewhere — [EBH retail AIS](https://developers.erstegroup.com/docs/apis/bank.ebh/bank.ebh.v1%2Fpsd2-aisp-retail)

**Poland and Serbia**

- Enable Banking describes Santander Bank Polska as redirect-based with SCA in the mobile app, without automatic app switching — [Enable Banking PL](https://enablebanking.com/docs/markets/pl/)
- I found no Erste Bank Serbia PSD2 documentation.

### Inferences

- A budgeting app on any of these routes should plan for a human re-consent every 90 days (Austria, Slovakia) or 180 days (Czechia), and should treat unattended reads as a rolling recent window.
- Because history depends on a person being present, the first import is the moment to fetch the long history. In Austria that could be up to 3 or 7 years through a TPP session. A file export can fill anything older.
- Austria's rule against localhost in production applies to a TPP's direct registration. A self-run app using an aggregator meets the aggregator's redirect rules instead.

### Gaps

- Consent lengths for Romania, Hungary and Croatia, and history limits for Slovakia, Hungary, Croatia and Romania, were not stated in the parts of the docs I could read. The Slovak AIS spec page did not render at all.
- Poland's and Serbia's interfaces could not be examined at the source.

## Statement exports from George: formats and automatic delivery, by country

### Takeaway

George's file export is the one route that works for a private customer in every country I could confirm, with CSV available in Austria, Czechia, Slovakia and Romania. Machine formats beyond CSV (CAMT.053, MT940, ABO) are mostly business-channel features, Slovakia being the exception. I found no SFTP for personal users anywhere.

### Cited Findings

**Austria**

- Official: file types are "CSV, Excel, JSON, and MS Money", with selectable fields, order, time span, and optional header and sum line (updated 1 Sep 2025) — [George help](https://www.sparkasse.at/en/george-help/george/search-and-find/your-search-results/export-your-search-results)
- Official, George Business: CSV, Excel, JSON; PDF only through print — [George Business help](https://www.sparkasse.at/de/george-help/george-business/transaktionen-und-suche/drucken-und-exportieren/export-ihrer-kontohistorie)
- Official: camt.052/053 and MT940 appear on a corporate-section page about electronic statements, available "bei George und George Business" — [Sparkasse](https://www.sparkasse.at/sgruppe/unternehmen/produkte-firmenkunden/digitales-banking/kontoauszug-elektronisch)
- Third party: a Sparkassen club-software guide describes a George "Daten Import/Export → CAMT53" path that the bank may need to enable, and that excludes the current day — [Transdok](https://hilfevmgr.transdok.at/1/de/topic/camt53)

**Czechia**

- Official: George statements via API come as PDF, ABO or CSV; George Business adds XML and MT940 — [Premium Accounts API v3](https://developers.erstegroup.com/docs/apis/bank.csas/bank.csas.v3%2Faccounts); [George Business help](https://www.csas.cz/cs/george-help/george-business/ucty/ucty/vypisy-z-uctu)
- Third party: George's personal app exports CSV, and is reported to offer PDF, Excel, JSON and MS Money — [Flatly](https://flatly.cz/blog/jak-exportovat-transakce-z-banky); [Hlídáto](https://www.hlidato.cz/navody.php)
- Conflict: a third party says the personal version has no ABO/GPC and tells users to convert a PDF — [ČteníFaktur](https://ctenifaktur.cz/blog/vypis-z-ceske-sporitelny-do-uctenictvi). The official API page lists ABO for George, possibly through the Data statements add-on.

**Slovakia**

- Official: statements by channel are Business24, George, e-mail and MultiCash as PDF, SEPA XML or MT940, and SWIFT as MT940. They can be delivered daily, monthly or yearly to e-banking channels or by e-mail. The page sits in the business section, but it lists George as a channel — [SLSP electronic statements](https://www.slsp.sk/sk/biznis/elektronicke-bankovnictvo/elektronicke-vypisy)
- Official: George search-result export offers CSV, Excel or JSON, web version only (read from a search excerpt) — [SLSP George help](https://www.slsp.sk/sk/george-help/george/vyhladavanie/vase-vysledky-vyhladavania/ako-si-stiahnem-vyhladavanie-platieb)
- Official: MultiCash exports SEPA XML and MT940, and the published XML statement structures are CAMT.053.001.02 and .08 (the versions come from a search excerpt) — [SLSP MultiCash](https://www.slsp.sk/sk/vans/ucty-a-transakcie/e-banking/multicash); [SLSP electronic statements](https://www.slsp.sk/sk/biznis/elektronicke-bankovnictvo/elektronicke-vypisy)

**Romania**

- Official: George holds at least 7 years of operations and downloads as CSV or PDF — [BCR blog](https://www.bcr.ro/ro/news-hub/blog/noutati/verificarea-istoricului-tranzactiilor-cum-o-faci-eficient)
- Third party: Extrase de cont → choose period and CSV → Genereaza — [Keez help](https://app.keez.ro/help/client/importuri/import_bank/import_bank_BCRGeorge.html)
- Official: MT940 and MT942 belong to the business e-BCR and MultiCash channels — [e-BCR](https://www.bcr.ro/en/public-and-nonprofit-organizations/conturi-si-tranzactii/internet-banking/e-bcr); [BCR MultiCash](https://www.bcr.ro/en/business/conturi-si-tranzactii/internet-banking/multicash)

**Community**

- A dashboard project consumes monthly George CSV exports from Erste, showing the format is used in practice — [ersteBankAnalyzer, pushed Sep 2026](https://github.com/FilipRus/ersteBankAnalyzer)

### Inferences

- For reeve, Austrian, Slovak and Romanian CSV and Slovak SEPA XML (CAMT.053) fit its existing CSV, OFX, QFX, QIF and CAMT import. Czech ABO/GPC is not among those formats.
- A scheduled Slovak e-mail statement is the closest thing to hands-free delivery for a private customer, though something local would still have to collect the mail.

### Gaps

- No official export documentation was found for Hungary, Croatia, Serbia or Erste Bank Polska. The searches returned nothing relevant.
- Whether CAMT or MT940 is available in personal George in Austria is not settled; the official page doesn't separate private from business customers.
- Exact column layouts per country were not verified. Sample files would be needed. The Czech personal George help page I tried returned "page not found".

## Aggregators: coverage of Erste entities, problems, history limits

### Takeaway

Enable Banking's free restricted mode is the realistic route for a private person outside Czechia, covering Erste in Austria, Slovakia, Croatia, Romania and Poland according to its own docs, but it explicitly excludes users residing in Czechia. GoCardless is closed to new accounts. I found no community report specific to Erste on any aggregator, positive or negative.

### Cited Findings

**Enable Banking**

- Official market pages:
  - [Austria](https://enablebanking.com/docs/markets/at/): Erste uses s Identity for SCA, and the user enters their George user ID.
  - [Slovakia](https://enablebanking.com/docs/markets/sk/): Slovenská sporiteľňa, redirect with SCA in the mobile app.
  - [Croatia](https://enablebanking.com/docs/markets/hr/): Erste, redirect with a hardware token or mToken in the Erste mBanking app; George Hrvatska does not yet provide mToken.
  - [Romania](https://enablebanking.com/docs/markets/ro/): BCR, redirect with BCR Mobile.
  - [Poland](https://enablebanking.com/docs/markets/pl/): still listed as Santander Bank Polska.
- "Currently, Enable Banking does not provide its services to payment service users residing in the Czech Republic", though TPPs in Czechia can use the API — [Enable Banking CZ](https://enablebanking.com/docs/markets/cz/)
- A text search of the Hungarian market page finds no mention of Erste, and there is no Serbian page (404). The market pages cover major banks and specifics rather than the full list, so this is not proof of absence — [Enable Banking HU](https://enablebanking.com/docs/markets/hu/)
- Restricted mode is free and limited to accounts you link in its portal; unlinked accounts are not returned — [Firefly III tutorial](https://docs.firefly-iii.org/tutorials/data-importer/eb/) (read via search excerpt; direct fetch was blocked). Free for personal use — [enable-actual README](https://github.com/2manyvcos/enable-actual) (community). Unrestricted production needs a contract, per — [comparison site](https://www.rfp.wiki/financial-services-banking-fintech/open-banking-platforms/akoya/enable-banking) (third party)
- Enable Banking states it is a registered AISP supervised by the Finnish FSA — [Enable Banking AT page footer](https://enablebanking.com/docs/markets/at/)
- Actual calls this provider an experimental feature that could be removed. The redirect must be `https` on your domain at `/enablebanking/auth_callback`, and accounts must be linked first — [Actual docs](https://actualbudget.org/docs/advanced/bank-sync/enable-banking)
- Community reports in Actual's feedback thread (opened 11 May 2026): syncing is limited to about 89–90 days, and "Berliner Sparkasse refuses to sync" (a German bank, not Erste) — [Actual #7799](https://github.com/actualbudget/actual/issues/7799). A 91-day off-by-one was fixed — [Actual release notes](https://actualbudget.org/docs/releases/)
- A balance-endpoint `ASPSP_ERROR` at another Croatian bank stopped the whole sync — [Actual #8621](https://github.com/actualbudget/actual/issues/8621). It is relevant to client design, not to Erste itself.
- enable-actual is a self-hosted bridge. It requires HTTPS (a self-signed certificate is generated by default), its `PUBLIC_URL` must match the redirect, and it advises one Enable Banking application per bank — [enable-actual](https://github.com/2manyvcos/enable-actual) (pushed Oct 2026, 111 stars). Actual #7799 contains a contrary report that one application covering two banks worked — [Actual #7799](https://github.com/actualbudget/actual/issues/7799)

**GoCardless Bank Account Data**

- Stopped accepting new accounts in July 2025 — [Actual GoCardless docs](https://actualbudget.org/docs/advanced/bank-sync/gocardless/). Firefly III's docs say GoCardless is "shifting away" from the product — [Firefly III](https://docs.firefly-iii.org/tutorials/data-importer/gocardless/)
- Defaults are 90 days of history and 90 days of access; up to 24 months depending on the bank — [GoCardless quickstart](https://developer.gocardless.com/bank-account-data/quick-start-guide)

**Salt Edge**

- Coverage pages list [Erste Bank and Sparkassen (AT)](https://www.saltedge.com/products/account_information/coverage/at), [Česká Spořitelna](https://www.saltedge.com/products/account_information/coverage/cz), [Slovenská sporiteľňa](https://www.saltedge.com/products/account_information/coverage/sk), [Erste (HU)](https://www.saltedge.com/products/account_information/coverage/hu), [Erste&Steiermärkische (HR)](https://www.saltedge.com/products/account_information/coverage/hr), [BCR (RO)](https://www.saltedge.com/products/account_information/coverage/ro) and [Erste Bank Polska (PL)](https://www.saltedge.com/products/account_information/coverage/pl). Serbia shows [0 connections](https://www.saltedge.com/products/account_information/coverage/rs).
- It is the only aggregator page that already uses the new Polish name.

**Tink**

- A directory says Česká spořitelna is reachable through Tink — [Open Banking Tracker](https://openbankingtracker.com/tink/ceska-sporitelna) (third party). A resolved outage of that connection is recorded — [IsDown](https://isdown.app/status/tink-czechia/incidents/646188-ceska-sporitelna-open-banking-outage).
- Tink's own public coverage pages did not name Erste banks in the text I could render.

**Community search**

- GitHub searches for "Erste" in the Actual and Firefly III trackers returned no report about an Erste bank. Actual's #7799 does not mention Erste, George or Česká spořitelna. I did not open the other Actual hit ([#6480](https://github.com/actualbudget/actual/issues/6480), about GoCardless booking dates). My web searches returned no relevant Reddit threads.
- A third-party audit of Czech bank connectivity for a fork of an investment tracker repeats the Czech-resident exclusion — [wealthfolio fork audit, Sep 2026](https://github.com/felipebaez/wealthfolio/issues/4)

### Inferences

- For Czech residents the aggregator route is effectively closed for a free personal setup, which makes the Premium API the route to test there. Whether the exclusion turns on residence or on the bank is a reading of Enable Banking's wording, which says residence. A resident of another country with a Czech account may not be excluded.
- Salt Edge and Tink appear to be commercial products for businesses. I found no personal-use path, so their coverage matters mostly as evidence that the bank connections exist.
- An Enable Banking route is not fully serverless from the app's point of view. The user's own machine must serve the HTTPS callback or capture the redirect, and the provider sits between the bank and the app, so bank data passes through a third party.

### Gaps

- Enable Banking's own terms for restricted mode were not read directly. Everything above about "free" and "personal use" comes from community and third-party sources.
- Enable Banking's coverage for Erste Bank Hungary, and any working Erste session reports with history counts, were not found.
- GoCardless coverage of Erste entities could not be verified: its coverage page failed to load and no public institution list turned up. I also did not research Yapily or other aggregators beyond a search that returned nothing relevant.

## Unofficial routes: scrapers and open-source projects, maintenance, terms and security risks

### Takeaway

Unofficial projects exist only for Austrian George. The two old API clients are abandoned, and the two recent ones drive a logged-in browser, are new and barely adopted. I could not find the George terms text, so a terms breach is unconfirmed rather than ruled out. No instructions are given here.

### Cited Findings

- `angelol/erste-bank-client` (Python): downloads statements as CSV through George; tested on Python 2.7; last pushed 2 Nov 2016; 6 stars — [GitHub](https://github.com/angelol/erste-bank-client) (date from the GitHub API, read 2 Nov 2026)
- `hokify/erste-bank-client` (Node.js): takes username and password; last pushed 15 May 2018; 14 stars — [GitHub](https://github.com/hokify/erste-bank-client)
- A March 2019 comment on the Python project says there is probably no public documentation and warned that s Identity 2FA would become mandatory for login — [angelol issue #1](https://github.com/angelol/erste-bank-client/issues/1)
- `george` skill in the openclaw collection: Playwright automation with phone approval for login. It lists accounts and transactions and downloads CAMT53, MT940, CSV, JSON, OFX and XLSX. It also uploads and signs payment data carriers, and stores session state on disk until logout. The listing shows 5 views and 2 installs — [mcp.directory](https://mcp.directory/skills/george)
- `fintaro-ai/george.sparkasse.at`: a read-only opencli adapter that works through a browser extension after a normal s Identity login. One commit, 0 stars, pushed 26 Sep 2026 — [GitHub](https://github.com/fintaro-ai/george.sparkasse.at)
- GitHub repository searches for "erste george transactions" and "ceska sporitelna api transactions" returned nothing (2 Nov 2026), and I found no project for the other countries' George versions.
- Terms: I did not find the George terms. The nearest bank text is Česká spořitelna's handbook, which covers only the API: an app "shall use the Credentials as its only means of accessing the API" — [CS handbook](https://www.csas.cz/content/dam/cz/csas/www_csas_cz/dokumenty/obecne/how-to-connect-to-api-of-cs.pdf). Other banks' material is only an analogy: Austrian Sparda-Banken limit access to customers entering their own identification details — [Sparda terms](https://sparda.at/ressourcen/sparda/agb/electronic_banking.pdf), and a commentary argues that passing on credentials hands over wider rights than needed — [finews](https://www.finews.ch/service/advertorials/14509-hannes-lubich-anbieter-finanzplanung-drittanbieter-finanzplanung) (advertorial)

### Inferences

Risk assessment for the user's decision, my judgement rather than sourced fact:

- **The two old clients are probably broken.** They take a username and password and predate mandatory s Identity login. I did not run them.
- **Security.** Browser automation holds a live banking session, or a store of it, on the machine. A compromised dependency, browser extension or AI agent could then see everything George shows. The openclaw skill is riskier because it includes signing functions rather than being read-only. Any third-party extension with access to a banking page deserves the same concern.
- **Account and liability.** If bank terms require personal use of credentials, automated access could give the bank grounds to block access or dispute liability for a loss. This is unverified for George.
- **Fragility.** These tools depend on undocumented pages and internal calls, which can change without notice, and the phone approval means they are not truly unattended anyway.
- **Compared with export.** Manual export gets the same data with none of these risks, at the cost of a few clicks a month.

### Gaps

- The current George terms for each country need reading before anyone relies on this route. My search returned German Sparkasse documents, which are a different group and don't apply.
- I did not audit the code of any project, and did not establish who maintains the openclaw skill or how often it changes.

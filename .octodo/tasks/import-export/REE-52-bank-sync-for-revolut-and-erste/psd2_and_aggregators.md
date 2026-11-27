# PSD2 and aggregators: reading EU bank accounts from a private or small local-only app (as of 2 November 2026)

Not legal advice. Everything was checked on 2 November 2026 and every price below was seen that day unless a different date is given.

Source labels:

- **[official]**: legal text, or a provider's own docs or terms.
- **[project docs]**: documentation of an open-source project.
- **[community]**: GitHub issue or forum report.
- **[vendor/blog]**: commentary that may have a commercial interest.

Access limits that affect confidence:

- EUR-Lex, the EP Legislative Train, the Open Banking Tracker guides, Revolut's developer docs and the Erste developer portal (JavaScript only) could not be read by automated fetch.
- PSD2, the RTS and Regulation 2022/2360 were read on the LawPlayer mirror, which says "the official text prevails". Check them on EUR-Lex before relying on exact wording.
- Items marked "via search snippet" were seen only in a search result summary, not on the full page.

## PSD2 basics and the regulatory position

### Takeaway

No exemption for "my own data" turned up, but the deciding barrier is technical. Banks' PSD2 interfaces expect a qualified certificate carrying a regulator-issued authorisation number, so an unlicensed person cannot realistically call them. Natural persons can in law register as AISPs, but that is disproportionate for personal use. The workable route is a licensed aggregator. PSD3/PSR will not change this before about the end of 2028, and FIDA is still unresolved.

### Cited Findings

**Terms**

- **AISP** (account information service provider): an account information service is "an online service to provide consolidated information on one or more payment accounts held by the payment service user". — [PSD2 Art. 4(16), mirror](https://lawplayer.com/eu/act/32015L2366) [official]
- **ASPSP / PSU**: the ASPSP is the bank or similar institution holding the account. The PSU is the end user. — [Enable Banking FAQ](https://enablebanking.com/docs/faq/) [official]
- **TPP**: providers such as AISPs and PISPs that must identify themselves to the ASPSP. — [RTS 2018/389 Art. 30, mirror](https://lawplayer.com/eu/act/32018R0389) [official]
- **QWAC / QSealC**: a qualified website authentication certificate authenticates the TLS connection, and a qualified seal certificate signs requests. Both come from a qualified trust service provider. — [DEV post](https://dev.to/johnfrandsen/the-eidas-certificate-tax-why-eu-open-banking-still-runs-through-aggregators-2c52) [vendor/blog]
- The RTS says providers "shall rely on" qualified seal or website authentication certificates, and that the registration number in them is the provider's **authorisation number**. — [RTS Art. 34, mirror](https://lawplayer.com/eu/act/32018R0389) [official]
- Sectigo says PSD2 orders require an authorisation number issued by your national authority. — [Sectigo](https://www.sectigo.com/it/certificati-ssl-tls/psd2-qwac) (via search snippet) [vendor/blog]
- **XS2A** ("access to account") appears as industry shorthand, for example in bank portal names. — [comdirect XS2A portal](https://xs2a-developer.comdirect.de/node?page=10) [official]

**Licensing and own-data access**

- Member States "shall prohibit natural or legal persons" that are neither PSPs nor explicitly excluded "from providing payment services". — [PSD2 Art. 37, mirror](https://lawplayer.com/eu/act/32015L2366) [official]
- AIS-only providers are "natural or legal persons" exempt from the full authorisation procedure, but they stay subject to parts of Art. 5, including Art. 5(3), and are treated as payment institutions for limited purposes. — [PSD2 Art. 33, mirror](https://lawplayer.com/eu/act/32015L2366) [official]
- Art. 5(3) requires, as a condition of registration, professional indemnity insurance "or some other comparable guarantee". — [PSD2 Art. 5(3), mirror](https://lawplayer.com/eu/act/32015L2366) [official]
- A search of EBA Q&As found no answer on an individual using a bank's dedicated interface without a licence or certificate. EBA Q&A 2019_4681 only says banks may give TPPs a dedicated interface or the customer interface. — [EBA Q&A 2019_4681](https://www.eba.europa.eu/single-rule-book-qa/qna/view/publicId/2019_4681) [official]
- A secondary summary of EBA Q&A 7672/2025 says the dedicated interface serves TPPs rather than users. — [DirittoBancario](https://www.dirittobancario.it/art/psd2-chiarimenti-eba-sulle-interfacce-di-accesso-per-gli-aspsp/) (via search snippet; date not confirmed) [vendor/blog]
- Revolut says there is no public API for personal accounts, and its Business API is for Business plans. — [Revolut help](https://help.revolut.com/en-AU/business/help/more/integrating-with-other-accounting-platforms/using-revolut-business-api/) (via search snippet) [official]

**Cost and time of becoming an AISP**

- Capital: no initial capital or ongoing own-funds test for AISP-only registration. — [Crassula guide](https://crassula.io/guides/licenses/aisp/) [vendor/blog]
- Insurance: roughly EUR 5,000 to 30,000 a year at seed stage, for cover starting around EUR 250,000. This is a vendor estimate. — [Crassula guide](https://crassula.io/guides/licenses/aisp/) [vendor/blog]
- Certificates, **sources conflict**:
  - Public list prices are far lower than commentary claims. HARICA lists QWAC from EUR 400 a year and QSealC from EUR 450 a year. — [HARICA](https://news.harica.gr/tags/qwac/) (via search snippet)
  - Disig lists a PSD2 QWAC at EUR 156.67 and a QSeal at EUR 135 for 365 days, excluding VAT, on a list valid from November 2025. — [Disig price list](https://eidas.disig.sk/en/qualified-certificates/pricelist) (via search snippet)
  - Commentary claims [EUR 5,000 to 15,000 a year](https://dev.to/johnfrandsen/the-eidas-certificate-tax-why-eu-open-banking-still-runs-through-aggregators-2c52) and [EUR 3,000 to 15,000 a year](https://github.com/actualbudget/actual/issues/7799). Those figures are unsupported, and I would not repeat them.
- Timeline: a DEV post says 6 to 12 months of processing, with no regulator source. — [DEV post](https://dev.to/johnfrandsen/the-eidas-certificate-tax-why-eu-open-banking-still-runs-through-aggregators-2c52) [vendor/blog]
- Field experience: Toshl withdrew its Slovenian AISP registration in July 2023 and moved to licensed connection partners. — [Toshl blog](https://toshl.com/blog/wp-json/wp/v2/posts/6193) (via search snippet) [vendor/blog]
- Agent route: Plaid's 2020 UK-oriented note calls being an agent of an AISP generally quicker and cheaper in the short term. — [Plaid, 2020](https://plaid.com/en-gb/blog/fca-registration-and-how-plaid-can-help/) (via search snippet; old and UK-focused) [vendor/blog]

**Status of PSD3 and the PSR**

- Political deal on 27 November 2025. — [European Parliament](https://www.europarl.europa.eu/news/en/press-room/20251121IPR31540/payment-services-deal-more-protection-from-online-fraud-and-hidden-fees) [official]
- Compromise texts dated April 2026. — [Arthur Cox, 30 Apr 2026](https://www.arthurcox.com/insights/psd3-and-psr-final-compromise-texts-published/)
- On 21 October 2026 the Council made its first-reading position available. Next come formal Council adoption, Parliament approval at second reading, then Official Journal publication. Entry into force is 20 days after that, and the rules apply 21 months later, "in practice" from the end of 2028. — [Dudkowiak & Putyra, 22 Oct 2026](https://www.dudkowiak.com/blog/psd3-and-psr-eu-council-publishes-final-texts-when-will-the-new-rules-apply/)
- Publication estimates differ: [December 2026](https://www.adyen.com/knowledge-hub/psd3), or [adoption in December and publication in January 2027](https://banking.vision/en/payment-services-regulation-psr) (both via search snippet). I found no evidence of publication by 2 November 2026.
- **The PSR changes AIS re-authentication.** The bank applies SCA only for the first access by a given AISP, unless it reasonably suspects fraud. The AISP must apply SCA when the user accesses information through it "at least 180 days after" SCA was last applied, using its own or the bank's SCA. — [Council text ST 8221/26, Art. 86(3)-(4), 17 Apr 2026](https://data.consilium.europa.eu/doc/document/ST-8221-2026-INIT/en/pdf) [official]
  - Articles were renumbered in the October text, so the number 86 may have moved. — [Dudkowiak & Putyra](https://www.dudkowiak.com/blog/psd3-and-psr-eu-council-publishes-final-texts-when-will-the-new-rules-apply/)
  - Avanto lists ST 8221 as PSD3 and ST 8222 as the PSR. — [Avanto](https://avanto.team/insights/psd3-psr-status) The documents themselves show the reverse: 8221 is 2023/0210 (COD) and holds the SCA article, and 8222 is 2023/0209 (COD).
- Users get a "dashboard" for monitoring, withdrawing or re-establishing data access. — [ST 8221/26 recitals](https://data.consilium.europa.eu/doc/document/ST-8221-2026-INIT/en/pdf) [official]
- Banks must keep a dedicated API, with exceptions. — [Arthur Cox](https://www.arthurcox.com/insights/psd3-and-psr-final-compromise-texts-published/)

**Status of FIDA**

- Trilogue talks stalled in June 2025, and a Commission non-paper with adjustments followed. — [Thede Consulting, 16 Jul 2026](https://thede-consulting.com/en/payment-en/fida-back-in-motion-from-ambitious-to-workable/) [vendor/blog]
- In late October 2026 it was described as "still in the trilogue weeds". — [FinanceX](https://financexmagazine.com/post/open-banking-picks-a-lane-psd3-edges-forward-fida-wobbles-core-banking-finally-ships) [vendor/blog]

### Inferences

- A script that reads only its author's own accounts is arguably not "providing" a service, so the licensing prohibition may not bite. Even so, it would not get past Art. 34 certificates, because no authorisation number exists to put in them. The legal argument therefore has little practical value. A lawyer should confirm this.
- Publishing open-source code that each user points at their own aggregator account looks different from running a service, because the project itself touches no account. This is the model Actual, Firefly III and Sure use. It is not legal advice, and the terms section below is the part to read.
- Licensing is not proportionate for reeve. Insurance alone likely costs more per year than any aggregator option, before reporting and fit-and-proper duties.
- PSD3/PSR changes nothing for this case before about the end of 2028. Afterwards, Art. 86 could shift 180-day re-authentication from the bank to the AISP, which here means the aggregator. Whether that removes the bank redirect in practice depends on aggregators, and it should be re-checked then.
- FIDA concerns wider financial data and has no agreed text, so it should not influence current design.

### Gaps

- No EBA Q&A or court decision directly answers the own-data question. I could not confirm the absence, only that searches found none.
- PSD2 Art. 67 body text could not be retrieved, only its heading. I did not read recitals either.
- No regulator-sourced AISP registration timeline. The NBS FAQ only links to an [opinion](https://nbs.sk/en/faq/how-long-does-it-take-to-grant-authorization-registration-according-to-the-payment-services-act-service-pisp-and-or-aisp) I could not read.
- No public price for becoming an agent of an AISP. Those terms are not public.
- The 21 October text of the PSR was not read; the April text was.

## SCA re-authentication: 90 vs 180 days

### Takeaway

Since 25 July 2023 the rule is 180 days and the exemption is mandatory for access through an AISP. The law still requires SCA for first access, and banks can demand it again on evidenced fraud grounds. In practice 180 is the common maximum but not universal, so read each bank's limit from the API and handle early expiry.

### Cited Findings

- Regulation 2022/2360 dates from 3 August 2022 and applies from 25 July 2023. — [mirror](https://lawplayer.com/eu/act/32022R2360) [official]
- New Art. 10a(1): PSPs "shall not apply" SCA for access through an AISP, limited to balance and transactions from the last 90 days. — [mirror](https://lawplayer.com/eu/act/32022R2360) [official]
- Art. 10a(2): SCA applies on first access through that AISP, or when "more than 180 days have elapsed" since the last SCA. — [mirror](https://lawplayer.com/eu/act/32022R2360) [official]
- Art. 10a(3): SCA may also be applied for "objectively justified and duly evidenced reasons" relating to unauthorised or fraudulent access. — [mirror](https://lawplayer.com/eu/act/32022R2360) [official]
- Art. 10 (direct customer access) moved to 180 days too, but stays optional: PSPs "shall be allowed not to apply" SCA. — [mirror](https://lawplayer.com/eu/act/32022R2360) [official]
- The exemption also covers a request for both the balance and 90 days of transactions. — [EBA Q&A 2023_6820, 29 Sep 2023](https://www.eba.europa.eu/single-rule-book-qa/qna/view/publicId/2023_6820) [official]
- How banks and providers apply it:
  - Enable Banking: the maximum comes from each bank's `maximum_consent_validity`, and "for the majority of ASPSPs" it is 180 days. — [FAQ](https://enablebanking.com/docs/faq/) [official]
  - Sessions may still expire early, returning `EXPIRED_SESSION`. — [FAQ](https://enablebanking.com/docs/faq/) [official]
  - Plaid: consent in Europe "typically expires after 180 days". — [Plaid OAuth docs](https://plaid.com/docs/link/oauth/) [official]
  - N26 through Enable Banking: reported maximum of 15552000 seconds, which is 180 days. — [Actual #7799, Jun 2026](https://github.com/actualbudget/actual/issues/7799) [community]
  - Commerzbank asks for "today+179days". — [Commerzbank portal](https://psd2.developer.commerzbank.com/taxonomy/term/241) (via search snippet) [official]
  - Austrian Hypo and VKB announcements: initial consent stays 90 days, then a new 180-day consent after SCA. — [Hypo](https://developer.hypo.at/announcement-increase-account-access-account-information) and [VKB](https://developer.vkb-bank.at/announcement-increase-account-access-account-information-without-sca-90-180-days) (via search snippet; the direct fetch failed; 2023) [official]
  - Sure falls back through 180, 90, 45 and 30 days when a bank refuses. — [Sure source](https://github.com/we-promise/sure/blob/main/app/models/provider/enable_banking.rb) [project docs]
  - Actual caps its requests at 90 days by default, deliberately. — [Actual PR 7345](https://github.com/actualbudget/actual/pull/7345) [project docs]
- History beyond 90 days is often available only briefly after authorisation, "generally around one hour". — [Enable Banking FAQ](https://enablebanking.com/docs/faq/) [official]
- A user relayed Enable Banking support saying one bank limits it to 3 minutes. — [Actual #7799, May 2026](https://github.com/actualbudget/actual/issues/7799) [community]
- Background fetches are limited to four in 24 hours unless the user actively requests the data or a higher frequency is agreed. — [RTS Art. 36, mirror](https://lawplayer.com/eu/act/32018R0389) [official]

### Inferences

- "Consent length" mixes two things: the SCA exemption window in the law, and the validity each bank accepts for a consent. The design should treat 180 days as a typical ceiling and read the real number per bank.
- Plan the first sync to fetch full history immediately after authorisation, because the window closes quickly.
- Re-authorisation UX is a permanent feature of this integration, roughly twice a year per bank.

### Gaps

- Erste's and Revolut's own EU consent limits could not be confirmed from their developer portals. See the provider section.

## Provider comparison

### Takeaway

For a private person in November 2026, **Enable Banking's restricted mode** is the only option I could confirm from the provider's own terms as free, open to individuals, and aimed at personal use. Its catch is an HTTPS redirect requirement and a hand-linking step. GoCardless remains closed. SimpleFIN does not cover the EU. YAXI and Lunch Flow are the only other self-serve EU leads, each with caveats. Tink, Yapily and others go through sales, and I found no public route for individuals.

### Cited Findings

Summary table (cells without a link are explained in the provider details below; "not found" means I found no public statement):

| Provider                     | Individual without a company            | Price, seen 2 Nov 2026 unless dated                                  | Auth                                    | Direct from own machine | Revolut / Erste                                                            |
| ---------------------------- | --------------------------------------- | -------------------------------------------------------------------- | --------------------------------------- | ----------------------- | -------------------------------------------------------------------------- |
| Enable Banking restricted    | Yes, personal use allowed by terms      | Free; paid production by quote                                       | Self-held RSA key, RS256 JWT            | Yes, reported           | Revolut reported working; Erste Poland reported; Erste Austria unconfirmed |
| GoCardless Bank Account Data | No: signups disabled                    | Not applicable to new users                                          | Secret ID and key                       | Yes, for existing users | Listed (weak evidence)                                                     |
| SimpleFIN Bridge             | Yes                                     | $1.50/month or $15/year                                              | Setup token to access URL               | Yes, no redirect        | US/Canada only                                                             |
| YAXI                         | Self-serve; company rule not found      | Free to 1,000 calls/month; then EUR 0.15/call, EUR 500/month minimum | API key signs tickets in "your backend" | Unclear                 | Not confirmed                                                              |
| Lunch Flow                   | Consumer product                        | GBP 5/month for 4 connections (Jan 2025 price)                       | API key to hosted service               | Hosted middleman        | Not confirmed                                                              |
| finAPI                       | Not found                               | From EUR 60/month to 200 users                                       | Not reviewed                            | Not found               | Not confirmed                                                              |
| Salt Edge                    | Not found; partner route via sales      | Free Basic for limited time; Growth from $500/month (snippet)        | Signed requests when live               | Not found               | Not confirmed                                                              |
| Tink                         | Sales                                   | Custom                                                               | Not reviewed                            | Not found               | Not confirmed                                                              |
| TrueLayer                    | Console signup; go-live terms not found | Not found                                                            | Client ID and secret                    | Used so by Sure         | UK-focused in project docs                                                 |
| Yapily                       | Sales                                   | Tailored                                                             | Not reviewed                            | Not found               | Not confirmed                                                              |
| Plaid                        | Not found                               | Not verified                                                         | Client ID and secret                    | Not found               | Not confirmed                                                              |

**Enable Banking** (best supported option)

- Terms, last updated 9 January 2026: production use "is limited to Linked Accounts and is available solely for evaluation purposes or for the personal use of private individuals". — [Terms](https://enablebanking.com/terms) [official]
- Excluded: any business or professional purpose, accounts of businesses, accounts "that does not belong to the Control Panel user who associated the Linked Accounts", and any commercial purpose. Linked accounts per application "may be limited", with no number given. — [Terms](https://enablebanking.com/terms) [official]
- Breaching the Restriction of Use section carries full liability for direct and indirect damages, and access can be terminated for misuse. — [Terms](https://enablebanking.com/terms) [official]
- Price: full production is volume-based with a monthly minimum, and prices need a sales quote. Sandbox or linking your own accounts is the stated way to start. The restricted mode is described as free by third parties, and I saw no fee for it in the terms. — [FAQ](https://enablebanking.com/docs/faq/) [official]; [Firefly III docs](https://docs.firefly-iii.org/tutorials/data-importer/eb/) [project docs]
- Full production requires a signed contract and KYB of a company. — [FAQ](https://enablebanking.com/docs/faq/) [official]
- Activation: register a production app (status "Inactive"), choose "Activate by linking accounts", authorise at the bank, and the app becomes active in restricted mode. You must still authorise through the API separately. — [Linked accounts docs](https://enablebanking.com/docs/api/linked-accounts/) [official]
- Other accounts are stripped from responses, which produces the common "empty list" symptom. — [FAQ](https://enablebanking.com/docs/faq/) [official]
- Auth: RSA key and certificate, RS256 JWT with the application ID as `kid`, maximum lifetime 24 hours. The browser can generate the key during registration. — [API reference](https://enablebanking.com/docs/api/reference/) and [quick start](https://enablebanking.com/docs/api/quick-start) [official]
- Rate limits: mostly the bank's, with many limiting background fetches to 4 a day, and quotas per second, hour and day "may apply". — [FAQ](https://enablebanking.com/docs/faq/) and [Terms](https://enablebanking.com/terms) [official]
- PSU headers mark the user as present, so per-day background limits do not apply. — [FAQ](https://enablebanking.com/docs/faq/) [official]
- Private LAN IPs in `Psu-Ip-Address` can cause bank errors, so Actual omits the headers for local addresses. — [Actual PR 8032](https://github.com/actualbudget/actual/pull/8032) [project docs]
- Re-authorisation yields a new session ID and new account IDs, so accounts must be re-matched. — [FAQ](https://enablebanking.com/docs/faq/) [official]
- Coverage: 2,700+ banks in 30 countries by its homepage. — [Enable Banking](https://enablebanking.com/) [official] Firefly's October 2026 docs say 2500+ in 29. — [Firefly III](https://docs.firefly-iii.org/tutorials/data-importer/eb/) [project docs]
- Retention: the API "does not store the account information it processes". — [FAQ](https://enablebanking.com/docs/faq/) [official]
- Its privacy notice (17 March 2025) says personal data "is retained indefinitely", in a section about Control Panel use, with Google Cloud EMEA as a host. — [Privacy Notice](https://enablebanking.com/privacy/) [official]
- Users accept its terms before bank login because it acts as the regulated entity, and can review consents at its data-sharing page. — [FAQ](https://enablebanking.com/docs/faq/) [official]
- Revolut:
  - N26 and Revolut "worked just fine". — [Actual #7799, May 2026](https://github.com/actualbudget/actual/issues/7799) [community]
  - An October 2026 report of an empty list. — [Actual #9300](https://github.com/actualbudget/actual/issues/9300) [community]
  - Pockets can't be told apart in Firefly bulk imports (issue title). — [Firefly #13056, Oct 2026](https://github.com/firefly-iii/firefly-iii/issues/13056) [community]
- Erste: one user linked 5 accounts "with Erste Bank Poland (former Santander Bank Poland)". — [Actual #7799, May 2026](https://github.com/actualbudget/actual/issues/7799) [community]

**GoCardless Bank Account Data**

- Official notice: "New signups for Bank Account Data are currently disabled." — [GoCardless](https://bankaccountdata.gocardless.com/new-signups-disabled) [official]
- Since July 2025 per Actual, and existing accounts "should continue to work"; sync limit of 4 a day per bank. — [Actual docs](https://actualbudget.org/docs/advanced/bank-sync/gocardless/) [project docs]
- Firefly says GoCardless is "shifting away" from these products. — [Firefly III docs](https://docs.firefly-iii.org/tutorials/data-importer/eb/) (via search snippet) [project docs]
- A user claims existing accounts are bought on a "grey market". — [Actual #6617, Jan 2026](https://github.com/actualbudget/actual/issues/6617) [community] Avoid this.
- Limits were cut in 2024 (from 10 to 4, by a community claim). — [Firefly #9162](https://github.com/firefly-iii/firefly-iii/issues/9162), [Actual #7799](https://github.com/actualbudget/actual/issues/7799) [community]
- Erste entities are listed on a third-party directory with generic text. — [Open Banking Tracker](https://openbankingtracker.com/gocardless/erste-group-bank-ag) (via search snippet) Weak evidence.

**SimpleFIN Bridge**

- "We only support the US/Canadian versions of internationally established institutions." — [SimpleFIN institutions](https://beta-bridge.simplefin.org/search-institutions) [official]
- Actual lists it as North America. — [Actual docs](https://actualbudget.org/docs/advanced/bank-sync/) [project docs]
- $1.50 a month or $15 a year plus tax, up to 25 institutions and 25 apps. — [SimpleFIN](https://bridge.simplefin.org) [official]
- Token model with no redirect: a setup token is exchanged once for an access URL holding Basic Auth. About 24 requests a day, 90-day range per request. — [Developer guide](https://beta-bridge.simplefin.org/info/developers) [official]
- Its provider MX "retains banking data... indefinitely", removed within 2 weeks of deletion. — [SimpleFIN privacy](https://beta-bridge.simplefin.org/info/privacy) [official]
- SimpleFIN discloses an MX bug on 28 May 2026 in which up to 39 users may have seen each other's data. — [SimpleFIN security](https://beta-bridge.simplefin.org/info/security) [official]

**YAXI** (newer, individual-friendly marketing; treat with care)

- Free tier: up to 1,000 service calls a month, with "real bank connections". Premium: EUR 0.15 per call with a EUR 500 monthly minimum. Self-service API key. — [YAXI](https://yaxi.tech/) [official]
- It says it operates without a TPP licence because confidential computing means it "technically cannot" access data, while "depending on the bank" it connects with certificates issued to DaoPay GmbH, a PSP licensed in Austria. — [YAXI FAQ](https://yaxi.tech/) [official]
- Its docs describe a backend issuing authenticated input and a frontend calling YAXI. — [YAXI docs](https://docs.yaxi.tech/getting-started.html) [official]
- Proposed for Actual; a contributor pointed to Enable Banking. — [Actual #7880, May 2026](https://github.com/actualbudget/actual/issues/7880) [community]

**Lunch Flow**

- GBP 5 a month for 4 connections plus GBP 1 per extra; annual plan GBP 50. — [Changelog, Jan 2025](https://lunchflow.featurebase.app/en/changelog/self-service-tiered-pricing) (via search snippet; likely stale)
- An Actual connector exists, and a user reported pending connections and blamed its GoCardless route for UK banks. — [Actual #6617, Jan 2026](https://github.com/actualbudget/actual/issues/6617) [community]
- Firefly III lists it as a provider. — [Firefly III docs](https://docs.firefly-iii.org/how-to/data-importer/import/third-party-providers/) [project docs]

**Business-oriented providers**

- **Tink**: listed prices apply only to existing customers, and new prospects are told to contact sales. Standard runs under Tink's licence. — [Tink pricing](https://tink.com/pricing/) [official]
- **TrueLayer**: new Console accounts start in sandbox. — [TrueLayer](https://docs.truelayer.com/docs/quickstart-create-a-console-account) [official]
  - A user reports running live apps without being asked for payment details. — [Actual #6617, Jan 2026](https://github.com/actualbudget/actual/issues/6617) [community]
  - Sure documents it as a UK provider with your own app. — [Sure docs](https://github.com/we-promise/sure/blob/main/docs/providers/truelayer.md) [project docs]
  - The `truelayer.com/pricing/` page returned 404.
- **Yapily**: pricing is "tailored" via sales. — [Yapily pricing](https://www.yapily.com/pricing) [official] "Yapily Connect" offers access under its licence and a fixed redirect. — [Yapily docs](https://docs.yapily.com/open-banking-flow/handling-redirects/redirect-url.md) [official]
- **finAPI**: EUR 60 a month for Access B2C up to 200 users, EUR 100 for B2X. — [finAPI prices](https://www.finapi.io/en/prices/) [official]
- **Salt Edge**: free Basic tier with 100 live connections for a limited period, Growth from $500 a month. — [Salt Edge](https://saltedge.com/products/spectre) (via search snippet) [official] New partners start in "pending" with sandbox only, and the partner route is via sales. — [Partner docs](https://docs.saltedge.com/partners/v1/) (via search snippet) [official]
- **Plaid**: all European institutions need OAuth. — [Plaid OAuth docs](https://plaid.com/docs/link/oauth/) [official] Public pricing was not verified.

**Off-region or unverified**

- **Pluggy**: Brazil per Actual's table. — [Actual docs](https://actualbudget.org/docs/advanced/bank-sync/) [project docs]
- **Basiq**: reported as Australia and New Zealand. — [Open Banking Tracker](https://www.openbankingtracker.com/api-aggregators/basiq-io) (via search snippet) It is nevertheless listed as a Firefly data provider. — [Firefly III](https://docs.firefly-iii.org/tutorials/data-importer/eb/) [project docs]
- **Akoya**: US-based per a directory; EU coverage not found. — [CB Insights](https://www.cbinsights.com/compare/akoya-1-vs-basiq) (via search snippet)
- **Redbark**: Australian institutions. — [Sure docs](https://github.com/we-promise/sure/blob/main/docs/providers/redbark.md) [project docs]
- **GetMyBank**: searches returned nothing.
- **open-banking.io**: Capterra lists EUR 3 flat rate from vendor "Tatic", aimed at private individuals and "without requiring PSD2 or eIDAS". — [Capterra](https://www.capterra.ie/software/1106217/openbanking-io) (via search snippet) Its site is JavaScript only and could not be read. A claim of avoiding PSD2 needs scrutiny, so treat it as unverified.

### Inferences

- **Recommended shape for reeve: bring your own Enable Banking application.** Each user registers their own app, holds their own key and links their own accounts, and reeve ships no shared credentials. The terms bar reading accounts that do not belong to the Control Panel user, so a shared project key would not fit restricted mode.
- Calls can go straight from the user's machine: JWT signing is local, account reads are plain request/response, and I found no webhook requirement in the reviewed AIS flow. Tools such as [Enablebanking-to-ofx](https://github.com/AfwasSysteem/Enablebanking-to-ofx) run from a terminal.
- Terms-sensitive reeve scenarios: someone using it for a business, a shared household account linked by one person, or anything monetised. These are the points for the user to read.
- Keep file import (CAMT, OFX, CSV, already in reeve) as the fallback, since restricted mode is revocable and comes with an "AS IS" clause.

### Gaps

- Whether Erste Bank Austria, George or other national Erste banks are on Enable Banking. Best check: register a free app and call `GET /aspsps`, or use the Control Panel's Data Insights.
- Current Revolut EU consent length. Revolut's business help mentions up to 12 months and most integrations pulling 90 days of history ([consents](https://help.revolut.com/en-AU/business/help/more/integrating-with-other-accounting-platforms/revolut-connect/how-can-i-set-up-or-revoke-an-open-banking-integration/), [history](https://help.revolut.com/business/help/integrating-with-external-apps/open-banking/how-much-historical-data-can-i-sync-open-banking/), via search snippet), but that may not apply to EU personal accounts.
- GoCardless data retention and consent length were not verified from a primary page; its help centre returned 403.
- Retention terms for Tink, TrueLayer, Yapily, Salt Edge, finAPI and YAXI were not reviewed.
- YAXI's free-tier conditions (a footnoted asterisk), its coverage and its rules for individuals. Its bank search needs JavaScript.
- Current Lunch Flow price; the site loads pricing through JavaScript.
- Maximum number of linked accounts under Enable Banking restricted mode, which the terms leave open.

## What comparable local-first and self-hosted tools use

### Takeaway

The community has converged on Enable Banking's personal-use mode as the GoCardless replacement, with CSV or file import as the fallback. Support is real but young and rough, mostly because bank data is inconsistent.

### Cited Findings

- **Actual**:
  - Lists Enable Banking for Europe and GoCardless as "not accepting new accounts". All providers require actual-server and your own keys. — [Actual docs](https://actualbudget.org/docs/advanced/bank-sync/) [project docs]
  - Merged 11 May 2026, superseding an earlier PR. — [PR 7345](https://github.com/actualbudget/actual/pull/7345) [project docs]
  - The docs still mark it experimental. — [Actual docs](https://actualbudget.org/docs/advanced/bank-sync/enable-banking) [project docs]
  - The wait was partly for terms: in January 2026 a contributor relayed that Enable Banking was preparing updated terms and that the integration could merge after the personal-use terms were published. — [PR 5570](https://github.com/actualbudget/actual/pull/5570) [community]
- **Reported Enable Banking problems in Actual**:
  - Repeated `continuation_key` duplicating transactions (Trade Republic). — [#8846](https://github.com/actualbudget/actual/issues/8846)
  - Silently skipped booked transaction. — [#9063](https://github.com/actualbudget/actual/issues/9063)
  - Balance endpoint failure blocking imports. — [#8621](https://github.com/actualbudget/actual/issues/8621)
  - 60-second timeout on large first syncs. — [#8531](https://github.com/actualbudget/actual/issues/8531)
  - Pending entries and "first sync works, later syncs that day fail" patterns. — [#7799](https://github.com/actualbudget/actual/issues/7799)
  - All [community].
- **Firefly III**: its data importer documents Enable Banking restricted mode, and also lists basiq, FinTS, GoCardless, Sophtron, Lunch Flow, SimpleFIN and teller.io. — [Firefly III docs, updated 26 Oct 2026](https://docs.firefly-iii.org/tutorials/data-importer/eb/) [project docs]
- **Firefly III open issue**: rows dropped when two accounts share an `entry_reference`. — [#13115](https://github.com/firefly-iii/firefly-iii/issues/13115) [community]
- **Maybe / Sure**: `maybe-finance/maybe` is archived, last pushed in July 2025. — [GitHub](https://github.com/maybe-finance/maybe) Its community fork Sure has Enable Banking, Plaid, SimpleFIN and Lunch Flow models in code, plus TrueLayer and others in provider docs. — [Sure](https://github.com/we-promise/sure) [project docs]
- **Other Enable Banking tools**:
  - leggen: self-hosted dashboard using Enable Banking and SQLite. — [leggen](https://github.com/elisiariocouto/leggen)
  - Home Assistant integration. — [ha-enablebanking](https://github.com/SurfHost/ha-enablebanking)
  - An OFX exporter for GnuCash. — [Enablebanking-to-ofx](https://github.com/AfwasSysteem/Enablebanking-to-ofx)
- **Beancount**: found GoCardless importers: [jodoox/beancount-gocardless](https://github.com/jodoox/beancount-gocardless) (updated June 2026) and [doriath/beancount-gocardless-importer](https://github.com/doriath/beancount-gocardless-importer) (2024). No Enable Banking beancount tool turned up, nor discussion in beancount-import.
- **hledger**: in `gocardless-to-csv`, a user reported signups closed and named Enable Banking as the only alternative found (Dec 2025). The maintainer replied "As with all 3rd party services, I guess this was bound to happen at some point." — [Issue #4](https://github.com/adept/gocardless-to-csv/issues/4) [community]
- **CSV**: described as "the most reliable fallback". — [Actual #7799, Jul 2026](https://github.com/actualbudget/actual/issues/7799) [community; this comment also promotes a client-side approach and includes the unsupported certificate prices above]

### Inferences

- The integration work for reeve is mostly transaction normalisation: identifiers, pending entries, duplicate pages and payees. Authentication is the smaller part. The Actual issues work as a ready-made test list.
- Depending on one small provider's free tier repeats the GoCardless risk. The provider should be behind a small interface, and file import should remain first-class.

### Gaps

- Paisa: nothing about bank sync appeared in its README, and I found no related discussion.
- Reddit threads referenced by Firefly's docs were not read.

## Privacy and security of a locally stored key or token

### Takeaway

Provider guidance is generic ("protect your keys"), and common self-hosted practice is a plain PEM file. Electron `safeStorage` is a real improvement on macOS and Windows, but it is not universal on Linux. It also isn't available to reeve's non-Electron surfaces.

### Cited Findings

- Enable Banking requires you to "keep credentials secure, and protect any private keys or tokens". — [Terms](https://enablebanking.com/terms) [official]
- Its API reference says to keep the private key server-side. — [API reference](https://enablebanking.com/docs/api/reference/) [official]
- A token identifies the application and can access all of the application's sessions, so it must not be shared with end users. — [FAQ](https://enablebanking.com/docs/faq/) [official]
- The quick start gives no guidance on secure storage or rotation, and its examples load the PEM from the working directory. — [Quick start](https://enablebanking.com/docs/api/quick-start) [official]
- Project practice:
  - Firefly uses an env var or a UI upload. — [Firefly III](https://docs.firefly-iii.org/tutorials/data-importer/eb/)
  - leggen uses a `key_path` config. — [leggen](https://github.com/elisiariocouto/leggen)
  - The OFX tool suggests the project folder with `.gitignore`. — [Enablebanking-to-ofx](https://github.com/AfwasSysteem/Enablebanking-to-ofx)
  - Home Assistant stores it "in plain text" in `.storage`, and warns about backups. — [ha-enablebanking](https://github.com/SurfHost/ha-enablebanking)
  - Actual stores secrets on the server, outside end-to-end encryption. — [Actual docs](https://actualbudget.org/docs/advanced/bank-sync/)
- SimpleFIN's access URL embeds its Basic Auth credentials, so the URL itself is the secret. — [Developer guide](https://beta-bridge.simplefin.org/info/developers) [official]
- Electron `safeStorage`:
  - macOS keys live in Keychain, preventing other apps loading them without user override.
  - Windows uses DPAPI.
  - Linux depends on kwallet or gnome-libsecret. Without a secret store, data is "encrypted via hardcoded plaintext password" and `getSelectedStorageBackend()` returns `basic_text`.
  - [Electron docs](https://www.electronjs.org/docs/api/safe-storage) [official]

### Inferences

- The key file matters more than session IDs, because it signs tokens for everything the app can reach. A stolen key plus a session ID reads live account data until consent ends, so both need protecting. The transaction history in the book is sensitive too, but it is already at rest there.
- For reeve:
  - Keep secrets out of the book SQLite file, because of `export_book`, backups and undo triggers.
  - Use `safeStorage` in the desktop app and refuse or warn on `basic_text`.
  - Since the server and CLI also run without Electron, a fallback is needed, such as a file with mode 0600 under `<home>`, or an OS keychain call. That choice needs a decision record.
- Keep the JWT signing on the Node server side. Tokens should not reach the browser bundle.

### Gaps

- I did not evaluate Node keychain libraries, or how `safeStorage` behaves when reeve's server runs as a separate process from Electron.
- No provider gave specific guidance for desktop or local apps.

## The redirect step for a loopback-only app

### Takeaway

This is the main design problem. RFC 8252 recommends `http://127.0.0.1`, but banking providers generally do not accept plain HTTP in production. For Enable Banking, the evidence says production needs HTTPS, and a public host is not required. Evidence conflicts on `https://localhost`, so test it first. Paste-back is the simplest workaround shown working, and it needs no extra infrastructure.

### Cited Findings

- The standard for native apps: loopback redirects "use the 'http' scheme" with the loopback IP literal and whatever port the client listens on. — [RFC 8252 §7.3](https://www.rfc-editor.org/rfc/rfc8252.txt) [official]
- **Enable Banking**:
  - `redirect_url` must be one of those registered, and the callback receives `code`, `state`, `error` and `error_description`. — [API reference](https://enablebanking.com/docs/api/reference/) [official]
  - "Production environment requires HTTPS, but the Sandbox environment works with HTTP... The URL does not have to be public." — [Firefly III docs](https://docs.firefly-iii.org/tutorials/data-importer/eb/) [project docs]
  - "Enable Banking rejects plain HTTP here." — [leggen README](https://github.com/elisiariocouto/leggen) [project docs]
  - Official samples use `http://localhost:8080/auth_redirect`, with environment unstated. — [Samples config](https://github.com/enablebanking/enablebanking-api-samples/blob/master/config.json) [official]
  - **Conflict on `https://localhost`**: one tool defaults to `https://localhost/enablebanking/callback`, including for production, with paste-back. — [Enablebanking-to-ofx](https://github.com/AfwasSysteem/Enablebanking-to-ofx) [project docs] An Actual contributor says "you need https, http and localhost will not work". — [PR 5570, Feb 2026](https://github.com/actualbudget/actual/pull/5570) [community]
- **Workarounds in use**:
  - Paste-back with an unrelated HTTPS page: register `https://enablebanking.com/`, then copy `code` from the address bar into the app. — [ha-enablebanking](https://github.com/SurfHost/ha-enablebanking) [project docs]
  - Paste-back with a dead localhost page: no server runs there and the user pastes the full URL. — [Enablebanking-to-ofx](https://github.com/AfwasSysteem/Enablebanking-to-ofx) [project docs]
  - HTTPS reverse proxy: documented by leggen, while Actual's docs ask for an HTTPS redirect on your domain. — [leggen README](https://github.com/elisiariocouto/leggen), [Actual docs](https://actualbudget.org/docs/advanced/bank-sync/enable-banking) [project docs]
  - Tailscale Funnel in front of the Actual desktop app on `localhost:5007`; the author doubts it needs to be public. — [Actual #7799, Sep 2026](https://github.com/actualbudget/actual/issues/7799) [community]
- **Other providers**:
  - Plaid: HTTPS required, localhost over HTTP only on Sandbox, no custom URI schemes in any environment. — [Plaid OAuth docs](https://plaid.com/docs/link/oauth/) [official]
  - TrueLayer: plain `http` accepted only for `localhost`, per a project doc. — [Sure docs](https://github.com/we-promise/sure/blob/main/docs/providers/truelayer.md) [project docs]
  - Akoya: localhost allowed in sandbox but must use HTTPS. — [Akoya docs](https://docs.akoya.com/docs/redirecturi) (via search snippet) [official]
  - Yapily Connect: fixed default `https://auth.yapily.com/`, with a callback URL to return users. The directory route supports `http` and `https` schemes. — [Yapily docs](https://docs.yapily.com/open-banking-flow/handling-redirects/redirect-url.md) [official]
  - SimpleFIN: no redirect at all, setup token only. — [Developer guide](https://beta-bridge.simplefin.org/info/developers) [official]
- **Browser choice**: bank SCA apps may fail to open from a WebView, so it advises a standard browser such as Safari or Chrome. — [Enable Banking FAQ](https://enablebanking.com/docs/faq/) [official]

### Inferences

Untested options for reeve, in order of preference:

1. **Try `https://localhost:<port>/...` first with a real production app.** If registration accepts it, the browser lands on a page nothing can serve unless reeve runs local TLS, and a self-signed certificate brings a browser warning. Even when the page fails, the address bar holds the code, so paste-back still works.
2. **Paste-back as the baseline.** It needs no extra infrastructure and is shown working. The UX is plain but it happens only about twice a year per bank.
3. **A static HTTPS relay page**, such as one on GitHub Pages, that forwards `code` and `state` to `http://127.0.0.1:<port>`. A code alone looks insufficient without the JWT-signing key because `POST /sessions` is authenticated, but this adds a hosted dependency, and browsers may restrict public-to-local requests. Weigh it against the no-server principle, and let each user register the URL.

Other design points:

- Open the system browser, not an Electron `BrowserWindow`, given the WebView warning.
- Verify `state` in every option.
- Omit PSU headers rather than sending a private IP.

### Gaps

- Enable Banking publishes no rule I could find on `https://localhost`, custom URI schemes or `127.0.0.1`. A short test in its Control Panel settles the first. I did not establish where the URL validation happens.
- Redirect rules for Tink, Salt Edge, finAPI and YAXI were not reviewed.
- Whether the relay's browser-to-loopback step works in current Chrome, Safari and Firefox was not tested.

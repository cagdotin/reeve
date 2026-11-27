---
id: REE-119
title: "Bank sync: derive a payee from Erste card lines instead of the whole remittance line"
status: done
priority: high
tags:
  - bank
created: 2026-11-09T07:38:38.792Z
order: aK
---

Erste (Enable Banking) sends card payments with no creditor; the only text is remittance_information[0], so mapLine (engine/src/bank/rows.ts) makes the whole line the payee. 1537 of 1599 payees on the user's Erste account carry the card/date/time tail.

Line shapes seen in a 127-line fetch (2026-08-12..11-09):

- Bankomat short form: `NAME(12 chars) NNNN  K2   DD.MM. HH:MM` e.g. `TABAK TRAFIK 3219  K2   01.11. 22:26`. Name is cut at 12 chars; NNNN is not a merchant id (2362 appears for Tabak Trafik, Friedenthal, Gotaxmira, Tabak Erlach).
- `POS|E-COMM  <amount> <ccy> K2   DD.MM. HH:MM <MERCHANT> <CITY> <ZIP> <ISO numeric country> [SPESEN: x  KURS: y  VOM:d]`
- ATM: `SB-Auszahlung    K2   S30159 02.09/20:56`, `AUTOMAT   00029353 K2   01.09. 14:27`
- Fees: Kontoführung, Kest, Habenzinsen, Abschlussbuchung.
  The enriched name the George app shows (e.g. 'Tabak Trafik Mila') is not in the API payload.

Fix: parse these shapes into a payee (merchant only), keep the full line in notes. Check Actual's GoCardless bank handlers first. Existing payees: offer a cleanup (rename/merge) as a separate, previewed step on the real book.

---
id: REE-133
title: Rules can match a counterparty's account number (IBAN)
status: done
priority: medium
tags:
  - bank
  - rules
created: 2026-11-09T09:58:24.959Z
order: aW
---

[bank rules](../../../docs/rules/bank.md) keeps the bank's full line, IBANs included. A rule condition on the counterparty's IBAN (creditor_account / debtor_account) lets 'money from my other bank is a transfer' work without text matching. Needs REE-125 (stored line) and a field the rules engine can read (look at how Actual's rules expose fields; this departs from Actual).

Evidence from an Erste fetch: every card payment carries one BBAN, 2099000000000000, Erste's own card clearing account, not the shop's; Klarna payments for different shops share Klarna's one IBAN; transfers and direct debits carry the real counterparty IBAN. So an IBAN identifies a bank account, not a payee: match it in rules (many accounts to one payee, one account to one payee), never store it on the payee as its identity. Show the accounts a payee's lines came from on the payee, computed from the stored lines.

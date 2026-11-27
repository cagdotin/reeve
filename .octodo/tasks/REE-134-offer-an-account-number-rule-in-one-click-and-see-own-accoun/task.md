---
id: REE-134
title: Offer an account-number rule in one click, and see own accounts as transfers
status: done
priority: medium
tags:
  - bank
  - rules
  - payees
created: 2026-11-09T10:03:46.934Z
order: aX
---

After REE-125 and REE-133. Deterministic suggestions from stored bank lines: (1) when every line from one counterparty IBAN lands on one payee, offer 'rule: from account X → payee P' in one click; leave out accounts seen under several payee texts (payment processors such as Klarna, a bank's card clearing account such as Erste's 2099000000000000). (2) When a counterparty IBAN is one of the person's own linked accounts (bank_connections.accounts holds each account's iban), offer to make those lines transfers to that account. Evidence: REE-133's notes.

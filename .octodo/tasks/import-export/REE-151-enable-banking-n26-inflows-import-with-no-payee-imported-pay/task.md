---
id: REE-151
title: Enable Banking N26 inflows import with no payee, imported payee or notes, though N26 shows a counterparty
status: todo
priority: medium
tags:
  - bug
created: 2026-11-16T10:18:04.887Z
order: a7
---

From Reeve Bookkeeper. Six inbound N26 transfers from one counterparty arrived via Enable Banking with payee, importedPayee and notes all null, and importedId a derived-* hash (no entry reference). The N26 app shows the counterparty name (the owner confirmed one). Other inflows from the same counterparty in the same period got a name and remittance note. The mapping reads only debtor.name or the remittance text, so the provider likely puts the name in another field for these. get_transaction / transactions show don't expose the stored raw bank line, so it can't be checked without SQLite. Side effect: a payee-is-null rule (see REE-148) caught them. Rows were fixed by hand.

Done when: the raw bank line is readable through CLI and MCP (overlaps REE-126); the field carrying the name for these rows is found from a stored raw line on a scratch REEVE_HOME fixture; the mapping falls back to it for payee/importedPayee and remittance to notes; a fixture test covers it.

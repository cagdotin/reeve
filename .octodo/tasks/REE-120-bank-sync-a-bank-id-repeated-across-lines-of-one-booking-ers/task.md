---
id: REE-120
title: "Bank sync: a bank id repeated across lines of one booking (Erste's quarterly closing) reads as a conflict on every later fetch"
status: done
priority: medium
tags:
  - bank
created: 2026-11-09T07:38:38.998Z
order: aL
---

Erste's quarterly closing books 3-5 lines (Kontoführung, Kest, Habenzinsen, a 0.00 Abschlussbuchung) under one entry_reference (e.g. 201112609302AB1-P29440212800). On the first import all land and only the first keeps the id (mergeInto's idTaken). On every later fetch whose window covers that day, matchRows (engine/src/imports/reconcile.ts) finds the id on the first line with another amount and refuses the rest as 'conflict', so the link shows 'attention: 3 lines could not be taken' though nothing is missing. Repeats each quarter; the current one clears around 2026-12-28 and the 31.12. closing brings it back.

Likely fix: an id repeated within one fetch is not an identity; let those lines fall through to fuzzy matching (strict already limits candidates to postings with no imported id). Test with a fake-enable-banking fixture: fetch twice, expect 0 conflicts and no duplicates.

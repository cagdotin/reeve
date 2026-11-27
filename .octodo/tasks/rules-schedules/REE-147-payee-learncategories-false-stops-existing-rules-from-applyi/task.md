---
id: REE-147
title: "Payee learnCategories: false stops existing rules from applying (McDonalds rows stay uncategorized)"
status: todo
priority: medium
tags:
  - bug
created: 2026-11-14T07:26:26.076Z
order: a8
---

From Reeve Bookkeeper. Two imported N26 rows on the Mcdonalds payee (learnCategories: false) stayed uncategorized though an Eating Out rule exists. Imported names were 'McDonalds 107/224'; the rename list has 'Mcdonalds 107/224', so the cause may instead be a case-sensitive rename match. Related: REE-135.

Done when: root cause found; learnCategories: false only stops learning, existing rules still apply; rename matching is case-insensitive if that was the cause; a test reproduces it.

---
id: REE-80
title: The Tags table's header overlaps on a phone
status: todo
created: 2026-11-05T17:41:00.985Z
order: a5
---

At 390px "Description" and "Transactions" print over each other, because `reports.tags.tsx` keeps a fixed-width row of its own.
The report suggested moving Tags onto `FilterBar`. That, and folding its columns as the other tables do, would fix it.

---
id: REE-85
title: Providers beside hooks lose their context on a hot reload
status: todo
created: 2026-11-05T17:42:39.024Z
order: aA
---

The empty Settings and Docs sidebars came from `SlotsContext` living beside a hook in `app-frame.tsx`: a hot reload created a second context. The Page migration fixes that one.
`lib/book.tsx` has the same pattern: editing it with `app-sidebar.tsx` logged `useBook outside a BookProvider` in dev. `theme-provider.tsx` and `sync-provider.tsx` have the pattern with no failure seen, and `category-dnd.tsx` is untested. Dev only.

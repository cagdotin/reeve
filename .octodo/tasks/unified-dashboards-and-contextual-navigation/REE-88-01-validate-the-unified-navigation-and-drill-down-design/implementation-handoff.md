# REE-88 implementation handoff: unified Home, Dashboards and Reports

Baseline: `bb4bea4`. This handoff maps the approved product choices in REE-87 rounds 1 and 2 onto the
current code. It reopens none of them. Where a technical choice was still open, it gives a default
marked **Default**. The next task can follow a default without asking.

Evidence labels:

- **Read** means checked in the code at `bb4bea4`.
- **Inferred** means reasoned from the code. Nothing was run.

No prototype, mockup or screenshot was made. The user chose to skip design exploration. Width and
theme evidence (desktop, narrow laptop, 390×844, Day and Night) moves to the implementation tasks'
e2e scenarios below and to REE-103. The Actual reference checkout is not on this machine, so the
dashboard and report behavior was not compared with Actual again. The current reeve dashboard
already ports Actual's model: pages, 12-column widgets, the default page "Main", and widgets that
open full reports with `?widget=` (read: `engine/src/reports/dashboard.ts`, `widget-card.tsx`).

## 1. What exists today (read)

- `lib/nav.ts` lists the destinations Home (`/`, no tabs), Budget, Accounts (scoped, 4 tabs), Reports
  (`/reports` with the tabs "Dashboard" and "All reports" at `/reports/library`), Purchases (frozen),
  Docs and Settings. `leadOf` gives the bar either tabs, a back arrow to the tab's list, or nothing.
  So every `/reports/<type>` page shows a **back arrow to `/reports`** today, not tabs.
- `routes/index.tsx` is a fixed Home made of an insight card, categories, money, coming up and recent.
  These are not widgets.
- `routes/reports.index.tsx` is the dashboard. `?page=<id>` picks a dashboard page. The actions are
  a page switcher menu, Add widget, and edit layout and page menus.
- `list_dashboard_pages` **writes on read**: a book with no pages gets "Main" with Actual's default
  widgets (`dashboard.ts:156`). Tables: `dashboard_pages(id, name, sort_order)`,
  `widgets(page_id, type, x, y, width, height, meta)` and `custom_reports(id, name, definition)`.
  There is no default-dashboard field and no saved built-in report.
- Report routes `/reports/<type>?widget=<id>` load the widget's meta (`useWidget`). The routes keep
  a local draft (`useReportState`). `ReportShell` shows a "Save widget" button that writes the
  widget's meta. Custom reports use `/reports/custom?id=<report>&widget=<id>`.
- `AppFrame` scrolls the one scroller to the top whenever the path changes (`place`). Nothing
  restores scroll. The router has no scroll restoration because the scroller is not the window.
- `SplitPanelHost` docks from `lg` (1024px) at a width of 320 to 640px (400 by default, kept per
  browser). Below `lg` it is an overlay. A phone gets the same overlay at `w-[min(28rem,100%)]`.
  The register holds its open transaction in component state. Rules shows matches in a **Dialog**
  (`rule-dialogs.tsx`, `kind: "matches"`).
- History: `HistoryButtons` uses `__TSR_index`. They are hidden on a phone. No `useBlocker` is used
  anywhere.
- Device prefs (`lib/prefs.ts`): sidebar folded, pane width, budget months, collapsed groups and
  launcher recents. Nothing remembers the last page, so a launch opens `/`.
- Breakpoints: `md` 768 is the phone (`useIsMobile`) and `lg` 1024 docks the pane. The dashboard
  grid becomes one column below a container width of 720px (`dashboard-grid.tsx`).

## 2. Navigation model

### Destinations and tabs

| Sidebar  | Tabs (stable, always shown inside Home)   | Contextual selector                                                                             |
| -------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Home     | Dashboards · Reports                      | the dashboard, or the report                                                                    |
| Budget   | none                                      | none                                                                                            |
| Accounts | Transactions · Payees · Rules · Schedules | account scope (unchanged, [panes and alerts rules](../../../../docs/rules/panes-and-alerts.md)) |

- The Reports destination goes away. Home becomes `{ id: "home", to: "/", tabs: [Dashboards, Reports] }`.
- Both tabs are `nested: true`, so every `/reports/<type>` page shows the tabs and **no back arrow**.
  The back arrow stays only for pages that are not a destination's tab (Purchases details). The
  window's history buttons do the rest.
- Naming: the sidebar says "Home", the tabs say "Dashboards" and "Reports", and the selector shows
  the dashboard's name (for example "Today"). Nothing reads "Home / Home". The tab that is
  "Dashboard" today is renamed, and there is no dashboard inside Reports.
- Hotkeys: `h` opens Home and lands on the session's last dashboard (see 3). **Default:** `r` stays,
  as a Home shortcut that opens the Reports tab's session target. The Shortcuts sheet lists it as
  "Reports". `nav.ts` grows a list of extra shortcuts beside the destinations so that `r` survives
  without a destination.

### Routes and URL mapping

Addresses stay flat ([shell rules](../../../../docs/rules/shell.md)) and use search params for the selection. That is how
`?page=` and `?account=` already work.

| Address                       | Shows                                                                 | Notes                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `/`                           | Dashboards tab: the session's last dashboard, else the book's default | the address stays `/`, with no rewrite                                                                  |
| `/?dashboard=<id>`            | Dashboards tab, that dashboard                                        | an unknown id falls back to the default and shows an info `PageAlert` "That dashboard no longer exists" |
| `/reports`                    | Reports tab, **All reports** (the current library)                    | the selector shows "All reports"                                                                        |
| `/reports/<type>`             | Reports tab, a built-in report with its own defaults                  | unchanged route files                                                                                   |
| `/reports/<type>?widget=<id>` | that report with the widget's effective settings                      | unchanged, opened from a widget                                                                         |
| `/reports/custom?id=<report>` | a saved custom report                                                 | unchanged                                                                                               |
| `/reports/library`            | redirect (replace) to `/reports`                                      | old links and bookmarks                                                                                 |
| `/reports?page=<id>`          | redirect (replace) to `/?dashboard=<id>`                              | old dashboard links                                                                                     |

- The Reports tab's `to` is `/reports`. The Dashboards tab's `to` is `/`. The tab links get a
  **session target** (see 3), so `SectionTabs` needs a per-tab `href(session)` instead of the
  static `to`. **Default:** add `resolve?: (session) => LinkOptions` to `Tab`.
- Saved built-in reports, if REE-89 adds them, get `/reports/<type>?report=<id>`. That reads like
  `custom?id=`. **Default:** use `?report=` for every saved report, keep `custom?id=` as an alias
  for the custom ones, and let REE-89 decide whether custom reports migrate into the same table.
- `isPageEnabled`, the launcher's page list, the `findability.e2e.ts` loops and `nav.test.ts` all
  read `nav.ts` and `REPORT_LIBRARY`. They move with the registry. The library's entries keep their
  `to` values.

### Header ownership (one bar, no extra rows)

The desktop bar, left to right: sidebar toggle, search and history, then the **tabs**, then the
**contextual selector** right after the tabs, then a gap, then the **page's actions** at the end.

- The selector belongs to the page, not the frame. It goes through a new `Page` prop `context`
  (portalled like `title` and `actions`) and renders after the tabs. **Default:** add a `context`
  slot to `SlotsContext` and keep `title` for pages with a back arrow. The account scope stays in
  the frame because it outlives the page ([panes and alerts rules](../../../../docs/rules/panes-and-alerts.md)). The selector does not, since each tab
  owns its own selector.
- Dashboards actions: "Edit layout" (a toggle), "Add widget" (a menu, as today), and a "⋯"
  dashboard menu with New dashboard, Rename, Duplicate, Set as default (hidden when it already is
  the default) and Delete (disabled for the last dashboard). The selector lists dashboards; the "⋯"
  menu holds what acts on the current one.
- Reports actions on a report page:
  - **Save** is primary and enabled when dirty. For a linked saved report, it updates the report
    definition, never the placement merely because the report was opened through `?widget=`.
    Placement-only title, size and approved overrides belong to Widget settings. For a built-in
    report without a saved definition, offer Save as new report rather than silently creating a
    placement-local report definition. The UI discloses linked usage before shared edits.
  - A "⋯" menu holds Save as new report…, Add to dashboard…, Duplicate report (an independent
    definition), Widget settings (only with `?widget=`, the placement's own title and size) and
    Delete report. Delete first shows the report's usage, then removes the definition and its
    placements in one undo step (round 1, item 5).
  - Report controls and filters stay in `ReportShell`'s control row inside the page, not in the bar.
- On All reports the bar holds no actions. **Default:** "New custom report" moves there as the
  only action.
- On a phone, as today: the tabs stick to the top of the page, and the selector and actions wrap in
  the row under them (`AppFrame`'s mobile branch). The selector comes first and takes the full
  width, and the actions collapse into the "⋯" menu.

### Selector contents

- **Dashboard selector** (Select, no search, since a book has few dashboards): the dashboards in
  `sort_order`, the default marked "Default", then a separator and "New dashboard…". Picking one
  pushes `/?dashboard=<id>`.
- **Report selector** (Combobox with search, round 2): "All reports" first, then a "Saved reports"
  group (custom reports, and saved built-in reports once REE-89 adds them) sorted by name, then the
  `REPORT_LIBRARY` groups ("Where you stand", "Where it went", …) with their built-in types. Picking
  one pushes that report's own address **with no carried search**: no `?widget=` and no filters.
  Typing filters by name and `about`. An empty search result says "No report matches".
- While the data loads, the selector is a disabled button of the same width showing the last known
  name, else "Dashboard" or "Report" ([shell rules](../../../../docs/rules/shell.md): actions show in every state).

## 3. Entry, return and session state

Each window holds a session store **in memory** per book. It is not in `localStorage`, so a launch
starts empty (round 1, item 2). **Default:** a small module in `apps/web/src/lib/home-session.ts`
holds `{ lastDashboard?: id, lastReport?: href, scroll: Map<historyKey, number> }`, keyed by
book id and cleared when the book changes.

| Event                                                | Result                                                                                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| App launch or reload at `/`                          | the book's default dashboard (Today)                                                                                                         |
| Sidebar Home, `h`, or the Dashboards tab             | push `/?dashboard=<lastDashboard>`, else `/` (the default)                                                                                   |
| The Reports tab or `r`                               | push `lastReport` (the full href, filters included), else `/reports`                                                                         |
| Viewing a dashboard                                  | sets `lastDashboard`                                                                                                                         |
| Viewing a report (any `/reports...` but All reports) | sets `lastReport` to the current href, including `?widget=`. All reports sets `lastReport` to `/reports`                                     |
| A direct link to a report (no history)               | opens it. Reports is the active tab, the selector names it, Back is disabled and there is no back arrow. Dashboards then goes to the default |
| Reload on a report                                   | the same report and URL-encoded exploration. Unsaved definition-editor drafts need not survive reload                                        |
| Book switch                                          | the new book's default dashboard. The session store is reset                                                                                 |

- **Widget drill-down** (round 2): a widget's title or "Open report" pushes
  `/reports/<type>?widget=<id>` (custom: `custom?id=…&widget=…`). Reports becomes active. The
  report starts from the widget's effective settings: the widget's meta, and for a saved report the
  definition plus the placement's overrides (REE-89 defines the overrides). History Back returns
  to the dashboard and its scroll position.
- A `?widget=` whose widget is gone: the report opens with its defaults, no "Save to widget" is
  offered, and an info `PageAlert` says "The widget this report came from was removed."
- **Scroll restoration** (inferred: none exists today). Before navigating away, store the
  scroller's `scrollTop` under the leaving entry's `__TSR_key`. On a POP to that key, restore it
  once the page's main query has data. On PUSH or REPLACE, keep today's scroll to top. **Default:**
  `AppFrame`'s `useLayoutEffect` keyed on `place` becomes this logic, reading the history action
  from `router.history.subscribe`. The pane is not part of history, so restoring never reopens it.
- Back and Forward preserve the dashboard, report identity, effective exploration filters and
  scroll position. Temporary exploration is not a saved-definition edit, but temporary does not
  mean disposable on history navigation. REE-95 stores serializable exploration in the URL or
  history-entry state. Explicit definition-editor drafts use the dirty guard instead.

## 4. Contextual pane

One pane, `SplitPanel` ([panes and alerts rules](../../../../docs/rules/panes-and-alerts.md)), in the frame. Its content can be a list of records or one
editor. It is never a second navigable workspace and never nests.

- **Pane state is not in the address or the history.** Back changes the page and closes the pane,
  after the dirty guard. Escape or the cross closes it, and focus returns to the row or segment that
  opened it. **Default:** keep the register's component-state model, generalised as
  `usePane()` in REE-96.
- **List then record inside one pane**: a pane that shows a list (chart-segment records, rule
  matches) opens a row's editor **in the same pane**, with a "← Matches" (or "← Transactions")
  button in the pane's header to return to the list. That is a one-level stack of at most list →
  record, not navigation.
- **Responsive policy** (round 2; the thresholds are inferred defaults):
  - At **phone width (< `md`, 768px)**, substantial editors and record lists are a full-screen task
    over the inset. They show a header with a close or back control and the title, and the frame's
    phone page bar is hidden while it is open. Closing returns to the same page and scroll. Small
    pickers and confirmations stay sheets or dialogs.
  - At **`md` and wider**, the pane docks when the page would keep at least **640px** beside it,
    and is an overlay otherwise. **Default:** measure the host width
    (`hostWidth - paneWidth - 8 ≥ 640`) instead of the fixed `lg` media query. Reason (inferred):
    at 1024px with the sidebar open (248px), docking a 400px pane leaves the page about 350px,
    narrower than a phone register. With the sidebar folded the same window docks. REE-96 must
    confirm 640 with screenshots at 1024, 1280 and 1440, sidebar open and folded, with a dense
    register.
- **Dirty guard** (round 2): one `useDirtyGuard(dirty, save)` that prompts **Save and continue /
  Discard changes / Keep editing** on close, on Escape, when another record is picked, on a scope
  change, and on navigation (TanStack `useBlocker`, which also covers the history buttons and the
  sidebar). A failed save keeps the editor open with its field errors ([panes and alerts rules](../../../../docs/rules/panes-and-alerts.md): validation
  stays by its field). **Default:** report-page exploration is not guarded, since it is temporary
  and Save shows it is dirty. The guard covers pane editors and the Edit saved report form only.

### Walkthrough 1: Today → Spending widget → full report → transactions → Back (inferred)

1. Launch: `/`, Dashboards active, the selector shows "Today", and the actions are Edit layout, Add
   widget and ⋯.
2. Click the Spending widget's title: push `/reports/spending?widget=<w>`. Reports is active, the
   selector shows the widget's title (or "Spending"), and the report has the widget's filters.
   There is no back arrow. The history Back button is enabled.
3. Click a chart segment (a category's bar): the pane opens "Groceries · Nov 2026" with the
   contributing transactions. Each row's amount is a register-shaped line (REE-97 uses
   `list_transactions` with the report's filters). Clicking a row opens its editor in the pane, and
   "← Transactions" returns to the list.
4. Edit a payee and press Back without saving: the guard prompts. Discard closes the pane and goes
   to `/` with Today at the scroll it had.
5. Press Forward: the report again with the widget's settings, and the pane closed.

### Walkthrough 2: Rules → scoped match preview → edit (inferred)

1. `/rules?account=<checking>`. The Accounts tabs and the account scope are unchanged.
2. A rule's "Matches" opens the **pane**, not today's dialog, titled after the rule, listing
   `preview_rule` rows under the scope. On a phone it is a full-screen task.
3. "Edit rule" in the pane's header swaps the pane to the rule editor; "← Matches" returns. A scope
   change from the header while dirty prompts (save, discard, keep).
4. Saving keeps the pane on the editor and refreshes the matches. The global effect is labelled by
   REE-98 ("Applies to all accounts").

### Walkthrough 3: a direct report link with no history (inferred)

1. Open `/reports/cash-flow` in a fresh window: Reports is active, the selector shows "Cash flow",
   and Back is disabled.
2. Click Dashboards: the default dashboard (Today). Back returns to Cash flow.
3. Click the Reports tab: Cash flow, the session's last report.

## 5. Dashboards, dense layouts and phones

- The grid stays 12 columns. Below a container width of 720px it is one column in `y, x` order
  (read: the current code). A phone shows widgets in one column and retains non-drag arrangement
  controls, such as Move up and Move down. Pointer dragging is not the only way to customize a
  dashboard. Completed moves and resizes save as one undo step each (round 2).
- Each widget handles its own load and failure inside its card ([panes and alerts rules](../../../../docs/rules/panes-and-alerts.md) keeps widget messages
  out of `PageAlert`). The dashboard's own query failure is the page alert, as `Page` does today.
- **Transactions and Payees region** (round 2, REE-100/101): a strip under the page's scope
  controls and above the table head, with no widgets by default. **Default:** on desktop, compact
  widgets of one fixed height (about 160px) in a row of up to 3 that wraps. On a phone, one column,
  and the region starts **collapsed** until the person expands it. The collapsed state is per
  device and per book and page (`reeve:embeds-collapsed:<book>:<page>`). A collapsed region is one
  32px line with the widget count and a chevron. The table head stays sticky at `--sticky-top`
  under it. Check at 390×844 that the register's first row is visible above the fold with the
  region expanded and holding one widget.

## 6. Keyboard and access

- The tabs are links in a `nav aria-label="Section"`, as today. The selector is reachable by Tab
  after them: the dashboard selector is a Select labelled "Dashboard" and the report selector a
  Combobox labelled "Report", which opens on typing or ↓, chooses with Enter and closes with Escape.
- The launcher (⌘K) adds a "Dashboards" group, and its Reports page keeps listing
  `REPORT_LIBRARY` plus saved reports.
- A chart segment that drills down is a button with a name ("Groceries, Nov 2026, $412.30, show
  transactions"). The pane takes focus on open and returns it on close.
- `h` and `r` work as in section 2. Escape closes the pane through the dirty guard.

## 7. Preference ownership

| Where                       | What                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| The book (SQLite, undoable) | dashboards and their order, the **default dashboard id**, placements, saved reports and their definitions, the Transactions and Payees arrangements |
| The device (`lib/prefs.ts`) | sidebar folded, pane width, embed region collapsed (per book and page)                                                                              |
| The window session (memory) | last dashboard, last report href, scroll by history entry, open pane                                                                                |

Persistence notes for REE-89 and REE-90 (inferred):

- `list_dashboard_pages` creating "Main" on read must give way to an explicit, idempotent seed:
  the first call adds Today once, using a book setting such as `todaySeeded`, and leaves existing
  pages alone. Round 1, item 3 says existing books receive Today once. **Default:** Today becomes
  the default dashboard of an existing book too, since round 1 says the default starts as Today.
  Main stays as an ordinary dashboard.
- A new book gets only Today and no Main. That departs from Actual's default page, and the parent
  should record it.
- Deleting the default dashboard makes the first remaining dashboard the default, in the same undo
  step.

## 8. Acceptance scenarios for the implementation tasks

Each scenario is an e2e test in `packages/e2e/test/` on a scratch home, unless it says unit. Each
names its owning task.

1. **Launch** (REE-94): a seeded book opens at `/` on Today. The tabs read Dashboards and Reports,
   and the sidebar has no Reports item.
2. **Home returns to the last dashboard** (REE-94): pick Main, open a report, click Home in the
   sidebar, and Main shows.
3. **Reports tab session target** (REE-94): open Spending with a changed filter saved in the
   address, go to Dashboards, click Reports, and Spending reopens at the same address.
4. **Widget drill-down and Back** (REE-95): scroll Today to its last widget, open it, and Reports
   is active with no back arrow. History Back restores Today and its scroll position within 4px.
5. **Direct link** (REE-94): a fresh page at `/reports/cash-flow` shows Reports active and Back
   disabled. Dashboards shows the default.
6. **Old addresses** (REE-94): `/reports/library` lands on `/reports` showing All reports, and
   `/reports?page=<id>` lands on `/?dashboard=<id>`. Unit test in `nav.test.ts` for the mapping.
7. **Report selector** (REE-94): search "net" and pick Net worth. The address has no `?widget=` and
   none of the previous report's filters.
8. **Segment drill-down** (REE-97): clicking a Spending segment opens the pane with the contributing
   transactions, whose sum equals the segment's figure (reconciled by hand from the seeded
   postings). Opening a row and pressing "← Transactions" returns to the list.
9. **Dirty guard** (REE-96): edit in the pane, then press Escape, the history Back button and a
   sidebar link in turn. Each prompts, and "Keep editing" keeps the edit. A failing save stays in
   the editor.
10. **Rules matches in the pane** (REE-96 or REE-98): under an account scope, Matches lists scoped
    rows in the pane, and Edit rule swaps the pane's content.
11. **Pane responsive** (REE-96): the pane docks at 1440 with the sidebar open and at 1024 with it
    folded, overlays at 1024 with it open, and is a full-screen task at 390×844. Closing returns to
    the same scroll. Screenshots in Day and Night.
12. **Delete in-use report** (REE-90/91): the dialog lists the dashboards using it. Confirm removes
    the report and its widgets, and one undo restores both.
13. **Today seeding** (REE-90/93, engine test): an existing book with Main gets Today once, and
    Today is the default. Calling it again changes nothing ([ledger rules](../../../../docs/rules/ledger.md)). A new book has Today
    alone.
14. **Dense embeds** (REE-101): at 390×844 with one widget expanded, the register's first row shows
    without scrolling. The collapsed state survives a reload on the same device.
15. **One page alert, no scrollers** (REE-103): the existing page-shape test (one scroller, no
    sideways scroll at 390px) passes for `/`, `/reports` and a report with the pane open.

## 9. For the parent: docs and decisions

- A new decision, "Home holds Dashboards and Reports". It replaces the Reports destination of 0038
  and 0045 and the "Dashboard / All reports" tabs. It records the URL mapping, the redirects, the
  session targets of `h`, `r` and the tabs, the in-memory session, "a new book starts with Today
  only" (a departure from Actual's Main), and Today seeded once into existing books as the default.
- Amend 0052's responsive rule: the pane docks by the page width left beside it (640px), not at
  `lg`, and a phone gets a full-screen task. Pane content can be list → record, and the pane is not
  in history.
- Amend 0050: `Page` gains a `context` slot after the tabs for a page-owned selector.
- `AGENTS.md`'s sidebar paragraph ("Home, Budget, Accounts, Reports, Purchases, and Steward") and
  its mention of `ReportShell` need the new destinations and tab names once REE-94 lands.
- 0048 stays as it is. The "widget gone" and "unknown dashboard" notices are info alerts.

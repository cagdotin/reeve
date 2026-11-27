# Shell

The web app's frame and pages: the sidebar, the bars across the window's top and foot, the one
registry of pages, the `Page` component every route renders, the phone layout, Settings and Docs,
the launcher and the pickers. All of it lives in `apps/web/src`.

## One app, one set of routes; the phone layout is below `md`

The phone layout is the same app below Tailwind's `md` (768px). `useIsMobile()` from
`@reeve/ui/hooks/use-media-query` is true below it, as `max-md:` classes are.

- Reflow with `max-md:` classes when a layout only rearranges.
- Switch a whole component on `useIsMobile()` when the phone wants something else, and put the
  phone component in `components/mobile/`.
- Never add a route for the phone.
- Never change the layout at `md` and above for phone work.
- Check a screen at 390x844 and at desktop width, in light and dark.

No page scrolls sideways at 390px. A table that cannot fold scrolls sideways inside a component
through `ScrollArea`, never in a route.

Dragging categories in the budget grid is desktop only; a phone does everything else through the
same row card.

Departure from Actual: Actual ships a separate mobile UI with its own routes. reeve keeps one set
of routes so a page cannot exist on one width and not the other.

Enforced by: `apps/web/src/lib/page-routes.test.ts` (only `accounts.$account.tsx`,
`budget.index.tsx` and `docs.$.tsx` call `useIsMobile(`), `packages/e2e/test/findability.e2e.ts`
("no page scrolls sideways on a phone"), `.oxlintrc.json` (`apps/web/src/routes/**` may not import
`scroll-area`)

## The frame: a sidebar beside a rounded inset, a bar on top, a bar at the foot

`components/app-frame.tsx` draws the window.

- **The sidebar** (`components/app-sidebar.tsx`) runs down the window's left. It holds the book's
  menu, then the destinations from `nav.ts` that have no `sidebar` flag (Home, Budget, Accounts),
  then Steward as a disabled button with no route. Purchases shows only while `FEATURES.purchases`
  is on, and it is off (purchases is frozen). Settings opens from the book's menu.
- **It folds to a rail of icons** from the top bar's toggle or Cmd+B, and remembers that in the
  browser (`reeve:sidebar-collapsed`). A window under 1024px starts folded until a person chooses.
- **The sidebar has no accounts.** The Accounts pages' dropdown is the one list of accounts: it
  selects one, adds one, leads to bank connections and carries the bank link warning. Departure
  from Actual, which keeps accounts in its sidebar: one list instead of three copies.
- **The page is a rounded inset** on the `sidebar` color, holding the one scroller and no header
  of its own.
- **The top bar** holds, from the left: the sidebar's toggle, search and the history buttons (this
  part keeps to the sidebar's width), then the page's tabs or back arrow and title, then the page's
  `context`, and at its end the page's actions and, last, the account scope. Folding the sidebar
  moves neither the toggle nor the inset's top.
- **The foot bar** (`components/app-footer.tsx`) holds Shortcuts and Docs as icons with tooltips
  naming them and their key, and the connection's state on the right, always shown on a computer.
- **No breadcrumbs.** Addresses are flat, so a trail would repeat what the sidebar marks.
- **Drag regions stand down while a popup is open**, because Electron hands a drag region the
  clicks of whatever is drawn over it (`apps/web/src/index.css`).
- **A phone has neither bar nor sidebar.** A bar of pages with search runs along its foot
  (`components/mobile/page-bar.tsx`), the page's tabs stick to its top, the header's contents open
  the page, and the connection shows only when lost.

The `navigation` landmark "Pages" is the sidebar's on a computer and the foot bar's on a phone.

Enforced by: `packages/e2e/test/apps.e2e.ts` (sidebar order and Steward, folding, top bar, drag
regions, account dropdown, book menu), `packages/e2e/test/footer.e2e.ts`,
`apps/web/src/lib/purchases.test.ts` (Purchases is in no navigation while frozen)

## `lib/nav.ts` is the one registry of pages

Every destination and tab is declared once in `apps/web/src/lib/nav.ts`. The sidebar, the phone's
page bar, the foot bar, each page's tabs, the launcher and the findability test all read it.
`leadOf` tells the frame whether a path shows its destination's tabs, a back arrow or nothing.

- A new page goes into `nav.ts` first.
- Never write a second list of pages in a component.

Enforced by: `packages/e2e/test/findability.e2e.ts` (every page is reached by clicking from Home at
both widths, and found by search). It only catches a page its own list names, so start at the
registry.

## Addresses are flat

A page's address names the page, not a section it sits in: `/budget`, `/accounts/$account`,
`/payees`, `/rules`, `/schedules`, `/reports/...`, `/settings/$section`, `/docs/$`. Old addresses
get no redirects, since nothing outside the app links to them. The HTTP API, CLI and MCP tools keep
their own names, which name domains.

The register's filters live in its address, so another page can link to a filtered register.

## Every route renders `Page`

`components/page.tsx` gives the frame a page's `title`, `actions` and `context`, and renders the
one `<main>`. `ReportShell` is `Page` plus a report's controls.

- **No title block.** A page opens on its data. The title is the page's only `h1`: shown beside
  the back arrow, for screen readers under tabs.
- **`width` is `column` or `window`, nothing else.** `column` holds the max width, the gutters and
  `@container`, so cards query the page without a wrapper. `window` holds none: Budget, the
  Accounts tabs (Transactions, Payees, Rules, Schedules), Settings and Docs fill the window. A
  route adds no padding around its content.
- **The gutter is `--page-gutter`**, set on the frame's page. Content of a `window` page that keeps
  to the gutter reads it.
- **Wait on `data === undefined`, never on `isPending`**, so rows kept through a scope change or a
  refresh never turn into a spinner. A page with two queries that matter passes
  `{ data: first.data, error: first.error ?? second.error }`. `QueryBody` is the same wait for one
  region under controls that stay.
- **A failure is a `PageAlert`**: "This could not be loaded" with no data, "This could not be
  refreshed" over kept rows.
- **Actions show in every state.** An action that needs the data sets
  `disabled={query.data === undefined}`; a menu that needs data to draw shows a disabled button of
  the same look until then.
- **State an action opens lives above `Page`** and reaches the content as props, since a render
  function cannot hold hooks.
- Not a `className`, `phone`, `empty` or `toolbar` prop on `Page`: they would bring back per-page
  overrides. Not route `staticData` or layout routes either: actions and titles are dynamic, and a
  layout route cannot see a child's query.

Enforced by: `apps/web/src/lib/page-routes.test.ts` (every page route goes through `Page` or
`ReportShell`, none draws `main`), `.oxlintrc.json` (routes import neither `react-dom`, the
spinner nor `scroll-area`), `packages/e2e/test/findability.e2e.ts` (exactly one `main`, same
content width), `packages/e2e/test/page.e2e.ts`

## A page has one scroller

Everything right of the sidebar scrolls as one, `AppFrame`'s `ScrollArea`, wherever the pointer is,
with no scroll bars. Never give a page a scroller of its own. Only overlays (dialogs, popups,
sheets) scroll themselves, and a wide table or code block scrolls sideways through `ScrollArea`.

What sticks uses `top-(--sticky-top)`, which clears a phone's tabs (0 elsewhere).

Enforced by: `packages/e2e/test/findability.e2e.ts` (one scroller and no scroll bar on every page
at both widths; the page scrolls under the header), `.oxlintrc.json` (no `scroll-area` in routes)

## Settings and Docs replace the sidebar with their own list

Settings and Docs carry `sidebar: true` in `nav.ts`. While open, their list takes the sidebar's
place: "Back to app" to the page they were opened from, a box that filters the list, and the items.
The sidebar cannot fold there, so the toggle goes and Cmd+B does nothing.

- Settings opens on General: `/settings` redirects to `/settings/general`. Its sections are
  General (everything about the open book), Books (create and open books), Banks, Appearance and
  Agents.
- Each section or document opens with `SectionTitle`: a title, a line on where it stands, and an
  object resting on the rule below. It is the one exception to "no title block", and it is not a
  heading; the `h1` is still `Page`'s. A document's first heading is its title.
- Groups in Settings are separated by a line, with no cards and no uppercase labels.
- A phone has no sidebar: Settings' sections are tabs, and Docs lists its documents in a sheet.

Enforced by: `packages/e2e/test/apps.e2e.ts` (Settings lays its list over the sidebar, filters,
cannot fold, leads back), `packages/e2e/test/docs.e2e.ts` (same pane and title as Settings, phone
sheet)

## The docs are built into the bundle

`lib/docs.ts` loads `docs/**/*.md(x)` with Vite's `import.meta.glob`, so a new document appears by
itself and a packaged app, which has no repo, still has them. Links between documents stay in the
app, web addresses open outside, and a link to a file outside `docs/` is plain text. Mermaid loads
with the first diagram, so nothing else pays for its size.

Enforced by: `apps/web/src/lib/doc-paths.test.ts`, `packages/e2e/test/docs.e2e.ts`

## The launcher is search and commands

`components/launcher.tsx` is devl's launcher, owned and adapted; `command-palette.tsx` only says
what it holds. It opens from the top bar's search icon, the phone bar, `/` or Cmd+K, as a modal
dialog.

- The top level stays short: Recent, Go to, Browse and Actions. Accounts, Dashboards, Reports,
  Documents, Books and Settings are pages to step into; Escape or Backspace steps back.
- A search from the top level reaches every page. A row that only opens a page is no result, and
  each result names the page it comes from.
- The last three picks stay in the browser (`reeve:launcher-recent`), a per-viewer convenience.

Enforced by: `packages/e2e/test/apps.e2e.ts` (the launcher steps in, backs out, remembers),
`packages/e2e/test/findability.e2e.ts` (every page and report is a search away)

## Categories are edited in the budget grid

There is no Categories page, drawer or `/categories` address. The grid's first column is the
category list, and the header's New menu adds a category or a group at both widths.

- A row's options button, or on a phone its name, opens a card: name, description, how many rules
  name it, then edit, add, targets, hide or show, delete, and a group's note. Nothing depends on
  hover, so one component serves desktop, phone and keyboard. Income rows get the card too.
- Every category sits in a group, so adding one asks for its group.
- There is one folding, the budget's; expand and collapse all sit in the budget's menu.
- A dropped row takes its figures with it and stays in its own section, expense or income.

Departure from Actual: Actual's budget table shows a context menu and has no descriptions.

Enforced by: `packages/e2e/test/apps.e2e.ts` (categories in the grid, dragging, income card, phone
card, collapse all)

## Pick a name from a list with the register's `Picker`

A value picked from a list of names (a category, a payee, an account) uses the register's picker
family:

- `ChoicePicker` (`components/picker.tsx`) for one id.
- `CategorySelect` (`components/category-select.tsx`) for a category; it is a `ChoicePicker`.
- `ChoicesCombobox` (`components/choice-select.tsx`) for several, as chips.
- A plain `ChoiceSelect` (`components/choice-select.tsx`) only for a short fixed list.

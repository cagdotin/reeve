# Panes and alerts

How the Accounts tabs (Transactions, Payees, Rules, Schedules) narrow to an account, where a
record's details and editors open, and how a page says what a person should know or act on.

## One account scope covers the Accounts tabs

A dropdown in the window's top bar, named "Accounts shown", sets the scope: all accounts, all budget
accounts, all off-budget accounts, or one account (closed ones too). On a phone it opens the page.
`/accounts` redirects to `/accounts/all`; there is no index page.

- The scope lives in the address, so a link and a reload keep it: the register's
  `/accounts/$account`, and `?account=` on `/schedules`, `/payees` and `/rules`, holding an account
  id, `budgeted` or `offbudget`. Read and write it only through `apps/web/src/lib/account-scope.ts`,
  which knows both forms. The register keeps its path form because every link to an account says it.
- Changing the scope is a filter change, not a navigation. Never put a `key` on the page or on
  anything bound to the scope: scoped queries keep their previous data, the scroller stays put, and
  search and other filters stay. Only what belonged to the old scope resets: the row limit, an open
  add or edit form, the selection and the Account filter.
- The server narrows: `schedule_activity`, `payee_activity`, `rule_activity`, `find_schedules`,
  `preview_rule`, `account_activity` and `list_transactions` take `account` and `onBudget`.
  `list_schedules`, `list_payees` and `list_rules` stay the whole book's, because pickers read them.
- A group covers closed accounts' past, as the register does. For Schedules a group leaves out
  closed accounts, as Actual does. A schedule with no account is listed under all accounts alone; a
  scoped page says how many there are and links there.
- A rule with no account condition can act anywhere, so it never reads as absent: it carries a
  globe mark under a scope, and one that matched nothing there folds into a line at the table's foot.
  An `or` with an account condition limits nothing unless every condition is one (`accountLimits` in
  `@reeve/contract/rules`). Conflicts, duplicates, stale names and the quiet mark stay book-wide.
- New schedule and New rule start on the scope's account; the rule also gets an empty condition,
  since a rule on the account alone would match all of it.
- A scoped page says why it lists what it lists, in a line above its table; under all accounts it
  says nothing.

The scope chooses what a page lists, never what an edit changes. A payee's editor, merge and delete
count its transactions across the book (`list_payees`) and say "on every account". A rule's editor
names its reach from its conditions apart from the preview, which counts the whole book. Changing
the scope never rewrites a rule's conditions.

Departure from Actual: Actual's Schedules, Payees and Rules pages are always global (`ManageRules`
narrows by payee only, `ManagePayees` by nothing). reeve narrows them so that looking at one account
does not mean filtering each page by hand.

Enforced by: `packages/e2e/test/account-scope.e2e.ts`, `packages/e2e/test/scope-effects.e2e.ts`,
`packages/engine/test/account-scope.test.ts`, `apps/web/src/lib/account-scope.test.ts`

## Details and editors open in the frame's right-hand pane

A row on an Accounts tab opens its record in the frame's pane: render `SplitPanel`
(`apps/web/src/components/split-panel.tsx`) with a title. Never build a pane, drawer or editor
dialog of the page's own. New and existing transactions, payees, rules and schedules, and a rule's
matches, open there; so does a category's figure on Budget (`FigureRecordsPane`).

- `SplitPanelHost` in `app-frame.tsx` docks the pane beside the page while the page keeps
  `PAGE_MIN` (600px), narrowing to fit before it gives up. With less room it covers the page, which
  goes `inert` while Tab stays in the pane; on a phone it covers the whole screen. It docks by the
  room left, not by window width, because the sidebar takes a varying share.
- Escape closes the innermost thing: a popup in the pane first, then the pane. Closing returns focus
  to what opened it.
- On Rules, a rule's editor and its matches are one pane state, so opening one closes the other
  through the guard.
- Put an editor's buttons in `PaneFooter`, so they stay under its scrolling content: Delete and
  Split at the start, Cancel and the save at the end, through `PaneActions`. Lay the form out from
  `PaneSection`, `PaneField` and `PaneFacts` (`components/pane-form.tsx`), so a transaction, a rule,
  a payee and a schedule read alike. A transaction's pane ends with its Details: what the book holds
  that no field edits (the bank's payee and id, the transaction id, every posting).
- On Transactions, Categorize on the selection bar opens one pane for every selected row, and so
  does a click on a row that is one of several selected: a row stands for the selection it is in,
  so a category saved there goes on every selected row as one `update_transactions` write, one undo
  step. Departure from Actual: Actual's inline cell edits its own row and a selection's category
  comes from the selection menu. reeve edits in a pane, and a row's pane opened over a selection
  read as editing the selection while it saved one row.

Enforced by: `packages/e2e/test/accounts-tables.e2e.ts`, `packages/e2e/test/pane.e2e.ts`,
`packages/e2e/test/register.e2e.ts`

## The pane guards unsaved edits

Every way out of the pane asks "Save your changes?" (Save and continue, Discard changes, Keep
editing) before an editor's changes are lost: the cross, Escape, the scrim, opening another record,
and any change of address (links, history buttons, the scope, a filter kept in the address) through
TanStack Router's `useBlocker`. A reload asks through `beforeunload`, and the desktop app asks in a
native dialog on `will-prevent-unload`.

- An editor in the pane calls `usePaneTask({ dirty, save, done })`, or none of its changes are
  guarded. Its save runs through `paneSaveMachine` (`machines/pane-save.ts`): while it is in flight
  the pane is `aria-busy`, its fields, footer and cross are disabled, every way out waits, and the
  save button shows `task.saving`. The save resolves when the write lands, not when the page's
  queries have refetched. `dirty` compares its fields with how they opened; `save` writes and rejects with what went
  wrong. Cancel discards without asking, because the button is that choice.
- A page that opens another record in the pane wraps the change in `usePaneLeave()`.
- A new rule or schedule draft gets its own form (`draftKey`), so a second draft never shows the
  first one's fields. An open transaction keeps its row when a filter or a change elsewhere drops it
  from the list.
- Save and continue only saves. It never merges a renamed payee into the one already so named;
  that stays the form's own Merge button.
- A failed save, and any `PageAlert` rendered inside the pane, shows in a strip under the pane's
  title. Editors in the pane call `useBookMutation(..., { quiet: true })`, so a failure does not
  also toast.

Report exploration is not a pane editor and is not guarded: the address keeps it.

Enforced by: `packages/e2e/test/pane.e2e.ts`, `packages/e2e/test/scope-effects.e2e.ts`,
`packages/e2e/test/register.e2e.ts`

## The Accounts tables share one row layout

All four tabs render `Page width="window"` and fill the window without page padding or a maximum
width. Use `TableHeader` and `TableRow` from `apps/web/src/components/insights/table.tsx` for rows,
`TableSearch`, `TableToolbar` and `TableFilterActions` from `components/table-controls.tsx` for the
toolbar, and `Facets` for the Filter button and popup. Each domain keeps its own columns, filters and
actions. Container queries fold columns to the room the pane leaves.

Enforced by: `packages/e2e/test/accounts-tables.e2e.ts`

## Dialogs confirm; they never hold a record's form

A record's details and its create or edit form go in the pane. A dialog holds a confirmation
(delete, merge) or work that is not one record: reviewing suggestions
(payees worth a rule, look-alike payees, account numbers), found schedules, an import, and the
account's own actions (rename, reconcile, close). Pickers and menus stay popups.

## An open check is a warning strip that narrows the page

Every open check on the register, Payees, Rules and Schedules is a warning `PageAlert` with a button
that narrows the page to what it is about, like Budget's uncategorized warning. Never give a page a
"Needs attention" card of its own.

## PageAlert is how a page says what to know or act on

`PageAlert` (`apps/web/src/components/page-alert.tsx`) is a slim tinted strip the page's width, with
an icon, a title, an optional description and an optional action. Render it from anywhere in the
page, where the fact is known; it portals into the frame's slot. Its title must name what it is
about, since it sits away from the step it concerns.

- Use it for a failure to load or refresh, a lost connection, bank link problems, a balance off the
  bank, uncategorized money and open checks.
- Not for: a field's validation (it stays by the field), a figure's tone (it stays on the figure), a
  row's own status, a chart's or widget's own message, or a mutation's toast. A dialog that needs the
  same look uses `Alert` from `@reeve/ui` directly, since a page alert would sit behind the dialog.
- A page that waits on a query does it through `Page`'s `query` or `QueryBody`, which show the
  failure as a page alert over whatever the query kept.

Enforced by: `packages/e2e/test/apps.e2e.ts` ("what a person must act on sits at the top of the
page, not in the bar")

## The variant says the state, and strips stack by it

Pick the variant for the state, not for whether there is an action: `error` for a failure,
`warning` for something unresolved, `info` for an optional next step, `success` for something done.
Only an error strip is `role="alert"`, so only a failure interrupts a screen reader; the others are
`role="status"`. Strips stack errors, warnings, info, success, whatever order the page renders them
in. Every strip shows; none is folded into a count or can be dismissed. A description keeps its full
color, so every variant reads at 4.5:1 over its tint in both themes. Tests find a warning by
`getByRole("status")` and a failure by `getByRole("alert")`.

Enforced by: `packages/e2e/test/attention.e2e.ts` (order, roles, contrast in Day and Night)

## A lost connection is said once

While the live connection is reconnecting or offline, a refresh that failed without reaching the
server (no `ApiError`) shows no strip of its own: the connection's strip already says the page may
be out of date. A refresh the server refused, and a first load that left the page empty, still say
so.

Enforced by: `packages/e2e/test/attention.e2e.ts` ("a refresh that fails while the connection is
down says so once, as the connection")

## Strips sit above the scroller

The strips render into `AppFrame`'s slot above the page's one scroller, never inside it and never in
a bar, so scrolling down or sideways (Budget's months) leaves them in view. A strip that comes or
goes moves the scroller's top edge, so tests measure positions from the scroller's top, not the
window's.

Enforced by: `packages/e2e/test/account-scope.e2e.ts`, `packages/e2e/test/apps.e2e.ts`

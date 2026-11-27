### Screen

**You own what the person sees, at both widths and in both themes.** The layout rules are in `docs/rules/shell.md`, `docs/rules/panes-and-alerts.md` and `docs/rules/look.md`.

1. **how** over the nearest existing screen, and copy its patterns. Find how Actual presents the same thing, when it does. The shell is `apps/web/src/components/app-frame.tsx` and `app-sidebar.tsx`, and a page is `Page` in `components/page.tsx` ([shell rules](../../../../docs/rules/shell.md)).
2. Follow the **devl** skill. Components come from `@reeve/ui`, which is coss ui. Look in devl before building a piece from scratch, and install with `npx shadcn@latest add @devl/<slug>` (or `@coss/<name>`) run in `apps/web`. Base UI uses a `render` prop, not `asChild`.
3. Keep data on the server. If the page needs arithmetic, use `@reeve/contract/rules` or a new operation, because the browser bundle imports no engine, Drizzle or Node modules. Stateful flows take a machine in XState rather than a set of booleans (**principle-model-the-domain**).
4. Build it. Everything that scrolls goes through `ScrollArea`. Below `md`, reflow with `max-md:` classes, or switch whole components on `useIsMobile()` with phone components in `apps/web/src/components/mobile/`. Never add a route for phones, and leave the layout above `md` as it is. A table that cannot fold scrolls sideways in `ScrollArea`, inside its own component.
5. Cover the states: empty, loading and error (`Page` and `QueryBody` give these two), one row, many rows, and long names and large amounts in the book's currency format.
6. Give it an end-to-end test in `packages/e2e/test/`. Seed through `app.run`. Pick elements by role and accessible name, and give a control without one an `aria-label` in its component.
7. Look at it. Screenshot at 390×844 and at desktop width, in light and dark, and confirm nothing scrolls sideways at 390px. A passing test does not prove it looks right.
8. Run `pnpm run react-doctor`, then **Landing a change** when the task asks for commits.

**Reply:** what the person can now do, the screenshots at both widths and themes, the end-to-end test, and any visual call you made that they may want to reverse.

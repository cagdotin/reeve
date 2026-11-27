# Code

How code is written here, whatever the package.

## The code is the documentation

A comment signals code that is too complicated or an edge case. Before writing one, try to make it
unnecessary: a better name, a named type or schema, a smaller function, a structure that makes the
invalid case impossible.

- Public functions and schemas may get a one-line doc comment when their types do not say enough.
- What stays: the reason for an edge case or a constraint the code cannot show (a platform or
  library quirk, or where Actual's behavior forces something odd), in one or two lines.
- Never narrate the code, leave commented-out code, write changelog comments ("now uses X"), or put
  phase banners in tests. In a test, the assertion message documents the step.
- When code changes, delete or fix the comments it made wrong. A stale comment is a bug.

## Node runs the TypeScript sources

There is no build step outside the bundles, so imports name their `.ts` extension and syntax stays
erasable: no enums, namespaces or parameter properties.

Enforced by: `tsconfig.json` (`erasableSyntaxOnly`, `allowImportingTsExtensions`), `pnpm typecheck`

## The UI kit is coss ui, through devl

Follow the `devl` skill in `.agents/skills/`. `npx shadcn@latest add @devl/<slug>` (or
`@coss/<name>`), run in `apps/web`, writes the component into `packages/ui`.

- Controls are one height, an input's. Use the `icon-xs` size for an icon in a table row or chip.
- A `Button` sizes its own icon: do not size the icon inside it.
- Pick elements in end-to-end tests by role and accessible name; give a control without one an
  `aria-label` in its component.

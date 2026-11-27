# Look

The app's colors, type and shape, and how the brand stays outside it. The themes live in
`packages/ui/src/styles.css`; the brand lives in `docs/brand/`.

## Day and Night are two themes, each from its own source

Day (`:root`) is coss ui's light values on a white page: page, cards and popovers white, text and
primary `#262626`, secondary, muted and accent black at 4%, borders black at 8%, inputs black at 10%,
muted text `#686868`, the focus ring `#a1a1a1`. Its neutrals carry no tint. Night (`.dark`) is
Fey's: near black with a faint cool tint.

- Never derive a value of one theme from the other, by inverting or otherwise. Day follows the kit
  its components assume (an input and an outline button share one white fill); Night follows Fey.
- Change a color only through the tokens, in both themes.
- A translucent fill cannot hide what scrolls under it, so a sticky header paints `bg-background`,
  never `bg-muted`.

Enforced by: `apps/web/src/lib/theme-tokens.test.ts` (surfaces neutral, text readable on every
surface, composited over the page), `packages/e2e/test/theme.e2e.ts`

## Surfaces stay neutral; color only says something

Green, red and amber mean money and state. Charts have their own hues. Every other surface is a
neutral, so a figure's color stands out.

- A card or panel is a hairline on the page, in Day and in Night (`--card` equals `--background`).
  A near-black panel with white bars is hard on the eyes. The `well` token (near black in Night)
  exists, but no screen uses it.
- Magnitude is not alarm: a ranking of spending draws in the lead series color, not red, because
  every bar red says nothing. Red stays for overspending, dearer prices and money out beside money
  in.
- Color app code through the tokens, not hex, `rgb()` or Tailwind palette classes (`text-red-500`).
  The brand blocks (`components/brand/`), `chart-colors.ts` and Settings' illustrations
  (`components/settings/objects.tsx`) draw their own colors.

Enforced by: `apps/web/src/lib/theme-tokens.test.ts` ("keeps %s neutral, so no brand color tints
the app")

## Charts draw in the theme's colors

`apps/web/src/components/reports/chart-colors.ts` holds the series slots, in a fixed order stepped
separately for each theme, and the chart chrome. The lead series is ink (the text color), then
orange; a series keeps its slot whatever else is shown. Most charts draw only the first slot, so a
brand green there would color the whole app. The chrome (surface, ink, ticks, money out) equals the
theme's tokens.

Enforced by: `apps/web/src/lib/theme-tokens.test.ts` ("draws charts in the theme's own colors")

## Geist sets the type

Geist sets words and figures, from `@fontsource-variable/geist`; Geist Mono sets code, from
`@fontsource-variable/geist-mono`. Fontsource names the family `Geist Variable`, which is what
`--font-sans` and `--font-heading` load. Money uses `tabular-nums`, so columns align. Fontsource has
no Geist Serif, so its one file ships from `packages/ui/src/fonts/` with its license, as
`--font-serif`; no screen uses it yet.

Enforced by: `packages/e2e/test/theme.e2e.ts` ("the page has its neutral surface and is set in
Geist")

## The radius is .5rem, and a control may be a pill

`--radius` is `.5rem` in Day and in Night (coss ui has `.625rem`; rounder looked soft), and the
`--radius-*` steps derive from it. A control may be a pill; the tabs keep the kit's corners.

## The brand's colors stay out of the app

The icon, logo files and brand page keep the brand's own colors. Inside the app the mark
(`AppMark` in `apps/web/src/components/app-logo.tsx`) takes the theme's text color, and no token
carries a brand color. A whole window in the brand's green tired the eye and left positive amounts
nothing to stand out against.

Enforced by: `apps/web/src/lib/theme-tokens.test.ts` (surfaces neutral)

## Every logo and icon comes from one set of vectors

`pnpm brand:generate` (`scripts/generate-brand.ts`) draws every logo and icon into `docs/brand/`,
`apps/web/public/` and `apps/desktop/build/`. Never edit those files by hand; change the generator.

- There is one mark at every size, with no heavier version for small sizes: its light lines are
  the brand, so they stay light down to 16px.
- The wordmark is Nunito Bold and its tagline Inter Medium, and only there. Both are outlines in
  `scripts/brand-outlines.json`, so no logo needs a font installed and the app ships neither font.

## The brand page is MDX that imports nothing

`docs/brand/README.mdx` holds the words. Its blocks live in `apps/web/src/components/brand/`, and the
docs app hands them to the page by name, so the document imports nothing and stays readable as text
in the repo. Any `.mdx` under `docs/` compiles and renders the same way.

- Every file in `docs/brand/{svg,png,tokens}` lists itself on the page by glob, with a preview and a
  download, beside a zip of them all. Add a brand file there and it appears.
- `docs/brand/tokens/colors.json` is the one source of the brand's colors: it feeds the page, the
  generator and `colors.css`. `packages/ui/src/styles.css` keeps its own values, since the app's
  themes are not the brand.
- The page's panels use the brand's colors directly, not the theme's tokens, so they read the same in
  Day and Night. Contrast figures are computed from the colors, never written down.

Enforced by: `packages/e2e/test/docs.e2e.ts` (the brand page and its kit)

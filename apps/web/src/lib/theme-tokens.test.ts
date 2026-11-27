import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHART_CHROME } from "../components/reports/chart-colors.ts";
import { contrast } from "./contrast.ts";

const css = readFileSync(
  new URL("../../../../packages/ui/src/styles.css", import.meta.url),
  "utf8",
);

/** A translucent token as it shows on the page, since the test's arithmetic reads solid colors. */
const overPage = (value: string, page: string) => {
  const translucent = /^rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)$/.exec(value);
  if (translucent === null) return value;
  const alpha = Number(translucent[4]) / 100;
  const channel = (at: number) => {
    const under = Number.parseInt(page.slice(1 + (at - 1) * 2, 3 + (at - 1) * 2), 16);
    const mixed = Math.round(Number(translucent[at]) * alpha + under * (1 - alpha));
    return mixed.toString(16).padStart(2, "0");
  };
  return `#${channel(1)}${channel(2)}${channel(3)}`;
};

const tokensOf = (selector: string) => {
  const block = css.slice(css.indexOf(`\n${selector} {`));
  const body = block.slice(0, block.indexOf("\n}"));
  const raw = new Map(
    [...body.matchAll(/--([a-z-]+): ([^;]+);/g)].map((match) => [match[1]!, match[2]!]),
  );
  const direct = (name: string) => {
    const value = raw.get(name)!;
    return value.startsWith("var(--") ? raw.get(value.slice(6, -1))! : value;
  };
  return (name: string) => overPage(direct(name), direct("background"));
};

const THEMES = [
  ["Day", tokensOf(":root"), CHART_CHROME.light],
  ["Night", tokensOf(".dark"), CHART_CHROME.dark],
] as const;

const SURFACES = [
  "background",
  "chrome",
  "card",
  "well",
  "popover",
  "secondary",
  "muted",
  "accent",
  "band",
  "row-hover",
];

const AA_TEXT = 4.5;
const MOST_A_NEUTRAL_MAY_LEAN = 8;

const lean = (hex: string) => {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  return Math.max(...channels) - Math.min(...channels);
};

describe.each(THEMES)("the %s theme", (_name, token, chart) => {
  it.each(SURFACES)("keeps %s neutral, so no brand color tints the app", (surface) => {
    expect(lean(token(surface))).toBeLessThanOrEqual(MOST_A_NEUTRAL_MAY_LEAN);
  });

  it.each(["foreground", "muted-foreground", "destructive-foreground", "warning-foreground"])(
    "keeps %s readable on every surface",
    (text) => {
      for (const surface of SURFACES)
        expect(
          contrast(token(text), token(surface)),
          `${text} on ${surface}`,
        ).toBeGreaterThanOrEqual(AA_TEXT);
    },
  );

  it.each(["success-foreground", "info-foreground"])("keeps %s readable on the page", (text) => {
    expect(contrast(token(text), token("background"))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("keeps the primary button's label readable", () => {
    expect(contrast(token("primary-foreground"), token("primary"))).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("draws charts in the theme's own colors", () => {
    expect(chart.surface).toBe(token("background"));
    expect(chart.ink).toBe(token("foreground"));
    expect(chart.tick).toBe(token("muted-foreground"));
    expect(chart.out).toBe(token("destructive"));
  });
});

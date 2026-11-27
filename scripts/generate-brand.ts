/**
 * Draws every reeve logo and icon from one set of vectors into `docs/brand/`, `apps/web/public/`
 * and `apps/desktop/build/`: `pnpm brand:generate`. Rendering needs a Chromium (see
 * `packages/e2e/src/browser.ts`) and the `.icns` needs macOS's `iconutil`.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium } from "playwright-core";
import { browserPath } from "../packages/e2e/src/browser.ts";

const colors = JSON.parse(
  readFileSync(new URL("../docs/brand/tokens/colors.json", import.meta.url), "utf8"),
) as ReadonlyArray<{ name: string; hex: string }>;
const color = (name: string) => colors.find((entry) => entry.name === name)!.hex;

const FOREST = color("Forest");
const PARCHMENT = color("Parchment");
const SAGE = color("Sage");

const MARK_WIDTH = 632;
const MARK_HEIGHT = 584;

/** A ledger page that becomes an R: heavy outline, light rules, on the board's measured grid. */
const markStrokes = (
  color: string,
  stem = 224.5,
) => `<g fill="none" stroke="${color}" stroke-linejoin="miter">
<path stroke-width="26" d="M${stem} 13H13V571H${stem}ZM${stem} 13H406.5A167.5 167.5 0 0 1 406.5 348H${stem}M305 348L465.6 571H606L445 348"/>
<path stroke-width="18" stroke-linecap="butt" d="M13 124.6H${stem}M13 236.2H${stem}M13 348H${stem}M13 459.4H${stem}"/>
<path stroke-width="18" stroke-linecap="round" d="M${stem} 124.6H456M${stem} 236.2H456"/>
</g>`;

/** The height of a ledger row. The five rows fill the mark, top line to bottom line. */
const ROW = 111.6;

/**
 * The mark on a 1024 canvas. A PNG of `pixels` with rows under 8 pixels is the same drawing a touch
 * larger, its rows a whole number of pixels and its lines on pixel centres: between two pixels, one
 * line would come out dark and the next grey.
 */
const placedMark = (
  color: string,
  at: { x: number; y: number; scale: number },
  pixels?: number,
) => {
  const pixel = (pixels ?? 1024) / 1024;
  const placed = (x: number, y: number, scale: number, stem?: number) =>
    `<g transform="translate(${x} ${y}) scale(${scale})">${markStrokes(color, stem)}</g>`;
  if (pixels === undefined || at.scale * ROW * pixel >= 8) return placed(at.x, at.y, at.scale);
  const scale = Math.ceil(at.scale * ROW * pixel) / (ROW * pixel);
  const onPixel = (value: number) => (Math.floor(value * pixel) + 0.5) / pixel;
  const origin = (start: number, length: number) =>
    onPixel(start + (length / 2) * (at.scale - scale) + 13 * scale) - 13 * scale;
  return placed(
    origin(at.x, MARK_WIDTH),
    origin(at.y, MARK_HEIGHT),
    scale,
    13 + Math.round(211.5 * scale * pixel) / (scale * pixel),
  );
};

/** "reeve" in Nunito Bold and the tagline in Inter Medium, as outlines at 100 units per em. */
const outlines = JSON.parse(
  readFileSync(new URL("./brand-outlines.json", import.meta.url), "utf8"),
) as Record<"word" | "tagline", { d: string; width: number }>;

const svg = (width: number, height: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n${body}\n</svg>\n`;

const mark = (color: string) => svg(MARK_WIDTH, MARK_HEIGHT, markStrokes(color));

type Plate = "light" | "dark";

const plateFill = {
  light: { fill: PARCHMENT, ink: FOREST },
  dark: { fill: FOREST, ink: PARCHMENT },
} as const;

/** The app icon on a 1024 canvas; the mark sits a little right of centre, as on the board. */
const icon = (plate: Plate, pixels?: number) =>
  svg(
    1024,
    1024,
    `<rect width="1024" height="1024" rx="229" fill="${plateFill[plate].fill}"/>
${placedMark(plateFill[plate].ink, { x: 208, y: 220, scale: 1 }, pixels)}`,
  );

/** The icon as macOS wants it: an 824 plate with a soft shadow on a clear 1024 canvas. */
const macIcon = (pixels?: number) =>
  svg(
    1024,
    1024,
    `<defs><filter id="shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity="0.28"/></filter></defs>
<rect x="100" y="100" width="824" height="824" rx="185" fill="${plateFill.light.fill}" filter="url(#shadow)"/>
${placedMark(FOREST, { x: 256.5, y: 277, scale: 0.81 }, pixels)}`,
  );

/** Android crops a maskable icon to a circle: full-bleed plate, the mark inside the safe zone. */
const maskable = svg(
  1024,
  1024,
  `<rect width="1024" height="1024" fill="${PARCHMENT}"/><g transform="translate(275 293) scale(0.75)">${markStrokes(FOREST)}</g>`,
);

/** Nunito's x-height at 100 units per em: the name is all lowercase, so this is its height. */
const X_HEIGHT = 49.7;

/** Mark and wordmark, the word's x-height centred on the mark. */
const lockup = (color: string) => {
  const scale = 5.05;
  const gap = 110;
  const baseline = (MARK_HEIGHT + X_HEIGHT * scale) / 2;
  return svg(
    Math.ceil(MARK_WIDTH + gap + outlines.word.width * scale),
    MARK_HEIGHT,
    `${markStrokes(color)}
<path fill="${color}" transform="translate(${MARK_WIDTH + gap} ${baseline}) scale(${scale})" d="${outlines.word.d}"/>`,
  );
};

/** The name alone, with room above and below for the round letters' overshoot. */
const wordmark = (color: string) => {
  const scale = 4.23;
  const overshoot = 6;
  const height = X_HEIGHT * scale;
  return svg(
    Math.ceil(outlines.word.width * scale),
    Math.ceil(height + overshoot * 2),
    `<path fill="${color}" transform="translate(0 ${height + overshoot}) scale(${scale})" d="${outlines.word.d}"/>`,
  );
};

/** The link preview a site shows: the board's hero, with icon, name and line. */
const socialCard = svg(
  1200,
  630,
  `<rect width="1200" height="630" fill="${FOREST}"/>
<g fill="none" stroke="${SAGE}" stroke-opacity="0.16" stroke-width="2"><path d="M1200 40C1010 150 880 340 830 630"/><path d="M1200 170C1070 260 980 420 950 630"/></g>
<g transform="translate(110 175) scale(0.273)">${icon("light").replace(/<\/?svg[^>]*>/g, "")}</g>
<path fill="${PARCHMENT}" transform="translate(440 322) scale(2.31)" d="${outlines.word.d}"/>
<path fill="${PARCHMENT}" fill-opacity="0.85" transform="translate(444 392) scale(0.26)" d="${outlines.tagline.d}"/>`,
);

const render = async (
  browser: Browser,
  source: string,
  width: number,
  height: number,
): Promise<Buffer> => {
  const page = await browser.newPage({ viewport: { width, height } });
  const sized = source.replace(
    /width="\d+" height="\d+" viewBox/,
    'width="100%" height="100%" viewBox',
  );
  await page.setContent(
    `<!doctype html><html style="margin:0;background:transparent"><body style="margin:0;background:transparent;width:${width}px;height:${height}px">${sized}</body></html>`,
  );
  const png = await page.screenshot({ omitBackground: true, type: "png" });
  await page.close();
  return png;
};

/** An `.ico` holding PNGs, which every browser since Vista reads. */
const ico = (images: ReadonlyArray<{ size: number; png: Buffer }>): Buffer => {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size % 256, entry);
    header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.png)]);
};

const root = new URL("..", import.meta.url).pathname;
const brand = join(root, "docs/brand");
const web = join(root, "apps/web/public");
const desktop = join(root, "apps/desktop/build");
mkdirSync(join(brand, "svg"), { recursive: true });
mkdirSync(join(brand, "png"), { recursive: true });

const svgs: Record<string, string> = {
  "mark.svg": mark(FOREST),
  "mark-parchment.svg": mark(PARCHMENT),
  "logo-light.svg": lockup(FOREST),
  "logo-dark.svg": lockup(PARCHMENT),
  "wordmark.svg": wordmark(FOREST),
  "wordmark-parchment.svg": wordmark(PARCHMENT),
  "icon-light.svg": icon("light"),
  "icon-dark.svg": icon("dark"),
  "social-card.svg": socialCard,
};
for (const [name, source] of Object.entries(svgs)) writeFileSync(join(brand, "svg", name), source);
writeFileSync(
  join(brand, "tokens/colors.css"),
  `:root {\n${colors.map((entry) => `  --reeve-${entry.name.toLowerCase()}: ${entry.hex.toLowerCase()};`).join("\n")}\n}\n`,
);

const browser = await chromium.launch({ executablePath: browserPath() });
try {
  const png = (source: string, width: number, height = width) =>
    render(browser, source, width, height);

  for (const plate of ["light", "dark"] as const)
    for (const size of [16, 32, 64, 128, 256, 512, 1024])
      writeFileSync(
        join(brand, "png", `icon-${plate}-${size}.png`),
        await png(icon(plate, size), size),
      );
  writeFileSync(join(brand, "png", "mark-1024.png"), await png(mark(FOREST), 1024, 946));
  writeFileSync(
    join(brand, "png", "mark-parchment-1024.png"),
    await png(mark(PARCHMENT), 1024, 946),
  );
  const logoWidth = Number(/width="(\d+)"/.exec(lockup(FOREST))?.[1]);
  const logoHeight = 240;
  const logoPixels = Math.round((logoWidth * logoHeight) / MARK_HEIGHT);
  writeFileSync(
    join(brand, "png", "logo-light.png"),
    await png(lockup(FOREST), logoPixels, logoHeight),
  );
  writeFileSync(
    join(brand, "png", "logo-dark.png"),
    await png(lockup(PARCHMENT), logoPixels, logoHeight),
  );
  const wordWidth = Number(/width="(\d+)"/.exec(wordmark(FOREST))?.[1]);
  const wordHeight = Number(/height="(\d+)"/.exec(wordmark(FOREST))?.[1]);
  const wordPixels = Math.round((wordWidth * logoHeight) / wordHeight);
  writeFileSync(
    join(brand, "png", "wordmark.png"),
    await png(wordmark(FOREST), wordPixels, logoHeight),
  );
  writeFileSync(
    join(brand, "png", "wordmark-parchment.png"),
    await png(wordmark(PARCHMENT), wordPixels, logoHeight),
  );
  const card = await png(socialCard, 1200, 630);
  writeFileSync(join(brand, "png", "social-card.png"), card);
  writeFileSync(join(web, "social-card.png"), card);

  writeFileSync(join(web, "favicon.svg"), icon("light"));
  const small = await Promise.all(
    [16, 32, 48].map(async (size) => ({ size, png: await png(icon("light", size), size) })),
  );
  writeFileSync(join(web, "favicon.ico"), ico(small));
  writeFileSync(join(web, "favicon-16.png"), small[0]!.png);
  writeFileSync(join(web, "favicon-32.png"), small[1]!.png);
  writeFileSync(join(web, "apple-touch-icon.png"), await png(maskable, 180));
  writeFileSync(join(web, "icon-192.png"), await png(icon("light"), 192));
  writeFileSync(join(web, "icon-512.png"), await png(icon("light"), 512));
  writeFileSync(join(web, "icon-maskable-512.png"), await png(maskable, 512));

  const appIcon = await png(macIcon(), 1024);
  writeFileSync(join(desktop, "icon.png"), appIcon);
  const temp = mkdtempSync(join(tmpdir(), "reeve-iconset-"));
  const iconset = join(temp, "icon.iconset");
  mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    writeFileSync(join(iconset, `icon_${size}x${size}.png`), await png(macIcon(size), size));
    writeFileSync(
      join(iconset, `icon_${size}x${size}@2x.png`),
      await png(macIcon(size * 2), size * 2),
    );
  }
  execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(desktop, "icon.icns")]);
  rmSync(temp, { recursive: true });
} finally {
  await browser.close();
}

// The kit, with fixed file times, so a rebuilt zip differs only where a file does. Chromium does not always paint a
// PNG byte for byte the same, so a rebuild can still change one.
const kitTemp = mkdtempSync(join(tmpdir(), "reeve-kit-"));
const kit = join(kitTemp, "reeve-brand-kit");
for (const folder of ["svg", "png", "tokens"])
  cpSync(join(brand, folder), join(kit, folder), { recursive: true });
const epoch = new Date("2026-01-01T00:00:00Z");
const touch = (path: string) => {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) touch(child);
    utimesSync(child, epoch, epoch);
  }
};
touch(kit);
utimesSync(kit, epoch, epoch);
rmSync(join(web, "reeve-brand-kit.zip"), { force: true });
execFileSync("zip", ["-X", "-q", "-r", join(web, "reeve-brand-kit.zip"), "reeve-brand-kit"], {
  cwd: kitTemp,
  env: { ...process.env, TZ: "UTC" },
});
rmSync(kitTemp, { recursive: true });

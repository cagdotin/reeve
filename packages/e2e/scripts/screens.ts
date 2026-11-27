import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { browserPath } from "../src/browser.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: "string" },
    out: { type: "string" },
    widths: { type: "string", default: "1440,390" },
    themes: { type: "string", default: "dark,light" },
    wait: { type: "string", default: "900" },
    full: { type: "boolean", default: false },
  },
});
if (values.url === undefined || values.out === undefined)
  throw new Error(
    "Usage: node screens.ts --url <web> --out <dir> [--widths] [--themes] [paths...]",
  );

const browser = await chromium.launch({ executablePath: browserPath(), headless: true });
mkdirSync(values.out, { recursive: true });
const slug = (path: string) =>
  path
    .replace(/^\/$/, "home")
    .replace(/^\//, "")
    .replace(/[/?=&]/g, "_");
const overflow: Array<string> = [];

for (const theme of values.themes.split(",")) {
  for (const width of values.widths.split(",").map(Number)) {
    const context = await browser.newContext({
      viewport: { width, height: width < 768 ? 844 : 900 },
      colorScheme: theme as "dark" | "light",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.error(`pageerror ${page.url()}: ${error.message}`));
    for (const path of positionals.length > 0 ? positionals : ["/"]) {
      await page.goto(`${values.url}${path}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(Number(values.wait));
      const sideways = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      if (sideways) overflow.push(`${path} at ${width}`);
      await page.screenshot({
        path: join(values.out, `${slug(path)}.${width}.${theme}.png`),
        fullPage: values.full,
      });
    }
    await context.close();
  }
}
await browser.close();
if (overflow.length > 0) console.log(`scrolls sideways: ${overflow.join(", ")}`);
console.log("done");

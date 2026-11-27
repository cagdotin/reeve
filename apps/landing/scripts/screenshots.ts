import { createOperations } from "@reeve/contract/operations";
import { startServer } from "@reeve/server";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { browserPath } from "../../../packages/e2e/src/browser.ts";
import { seed } from "../../../packages/e2e/scripts/seed.ts";

/** The app pages the landing page shows, by the file name each screenshot gets. */
const SHOTS = {
  home: "/",
  budget: "/budget",
  transactions: "/accounts/all",
  sankey: "/reports/sankey",
  "net-worth": "/reports/net-worth",
} as const;

const out = join(import.meta.dirname, "../public/screens");
const webDir = mkdtempSync(join(tmpdir(), "reeve-landing-web-"));
const home = mkdtempSync(join(tmpdir(), "reeve-landing-home-"));
execFileSync(
  "pnpm",
  ["--filter", "@reeve/web", "exec", "vite", "build", "--outDir", webDir, "--emptyOutDir"],
  { stdio: ["ignore", "ignore", "inherit"] },
);
const server = await startServer({ home, port: 0, webDir });
const browser = await chromium.launch({ executablePath: browserPath(), headless: true });
try {
  await seed(createOperations(server.url).run);
  mkdirSync(out, { recursive: true });
  for (const theme of ["light", "dark"] as const) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: theme,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    for (const [name, path] of Object.entries(SHOTS)) {
      await page.goto(`${server.url}${path}`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(out, `${name}-${theme}.png`) });
      console.log(`${name}-${theme}.png`);
    }
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(webDir, { recursive: true, force: true });
}

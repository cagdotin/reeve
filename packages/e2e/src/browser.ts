import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { chromium } from "playwright-core";

/**
 * Chromium to drive: `REEVE_E2E_BROWSER` when set, else Playwright's own download if one is
 * installed, else a Chromium-based browser already on the machine. The suite never downloads one.
 */
export const browserPath = (): string => {
  const fromEnv = process.env["REEVE_E2E_BROWSER"];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  const candidates = [
    chromium.executablePath(),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    `${homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ];
  const found = candidates.find((path) => existsSync(path));
  if (found === undefined)
    throw new Error(
      "No Chromium found for the e2e tests: set REEVE_E2E_BROWSER to a Chromium-based browser's executable.",
    );
  return found;
};

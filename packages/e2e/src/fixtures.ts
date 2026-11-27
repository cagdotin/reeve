import { createOperations, type Operations } from "@reeve/contract/operations";
import { startServer } from "@reeve/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright-core";
import { expect, inject, test as base } from "vitest";
import { browserPath } from "./browser.ts";

export interface App {
  /** The server's origin, as `http://127.0.0.1:<port>`. */
  readonly url: string;
  /** Runs an operation on the test's server, to seed data faster than the UI could. */
  readonly run: Operations["run"];
  readonly page: Page;
}

/**
 * `app`: a reeve server on a free port with a fresh scratch home, serving the built web app, and a
 * page in a new browser context. Each test gets its own, so tests share nothing but the browser.
 */
export const test = base.extend<{ browser: Browser; app: App }>({
  browser: [
    // oxlint-disable-next-line no-empty-pattern -- Vitest reads a fixture's dependencies from this pattern.
    async ({}, use) => {
      const browser = await chromium.launch({ executablePath: browserPath(), headless: true });
      await use(browser);
      await browser.close();
    },
    { scope: "file" },
  ],
  app: async ({ browser, task }, use) => {
    const home = mkdtempSync(join(tmpdir(), "reeve-e2e-home-"));
    const server = await startServer({ home, port: 0, webDir: inject("webDir") });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    context.setDefaultTimeout(10_000);
    const page = await context.newPage();
    const errors: Array<string> = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await use({ url: server.url, run: createOperations(server.url).run, page });
      if (task.result?.state === "fail") {
        const snapshot = await page.locator("body").ariaSnapshot({ timeout: 2_000 }).catch(String);
        console.error(`The page at ${page.url()} when the test failed:\n${snapshot}`);
      }
      if (errors.length > 0) throw new Error(`Uncaught errors in the page:\n${errors.join("\n")}`);
    } finally {
      await context.close();
      await server.close();
      rmSync(home, { recursive: true, force: true });
    }
  },
});

const poll = { timeout: 10_000 };

/** Waits until the locator's text is `text`, trimmed, as the page settles after a change. */
export async function expectText(locator: Locator, text: string) {
  await expect.poll(async () => (await locator.innerText()).trim(), poll).toBe(text);
}

/** Waits until the locator matches an element that is visible. */
export async function expectVisible(locator: Locator) {
  await expect.poll(() => locator.first().isVisible(), poll).toBe(true);
}

/** Waits until the locator matches no visible element. */
export async function expectHidden(locator: Locator) {
  await expect.poll(() => locator.first().isVisible(), poll).toBe(false);
}

/** Waits until the locator matches `count` elements. */
export async function expectCount(locator: Locator, count: number) {
  await expect.poll(() => locator.count(), poll).toBe(count);
}

/** Waits until `read` resolves to `value`, as the server settles after a change. */
export async function expectEventually<T>(read: () => Promise<T>, value: T) {
  await expect.poll(read, poll).toEqual(value);
}

/** Waits until the inputs the locator matches hold `values`, in order. */
export async function expectValues(locator: Locator, values: ReadonlyArray<string>) {
  const read = () =>
    locator.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  await expect.poll(read, poll).toEqual(values);
}

/** Waits until the register, scoped to the account `name`, says it holds `balance`. */
export async function expectAccountBalance(page: Page, name: string, balance: string) {
  await expectVisible(page.getByRole("button", { name: `Accounts shown: ${name}` }));
  const shown = async () => {
    const text = await page
      .getByRole("main")
      .innerText()
      .catch(() => "");
    return /\bBalance\s+(-?[\d,.]+)/.exec(text)?.[1];
  };
  await expect.poll(shown, poll).toBe(balance);
}

/** Goes to an account from wherever the page is, as a person does: the rail, then its card. */
export async function openAccount(page: Page, name: string, balance: string) {
  await page
    .getByRole("navigation", { name: "Pages" })
    .getByRole("link", { name: "Accounts", exact: true })
    .click();
  await page.getByRole("button", { name: /^Accounts shown: / }).click();
  await page.getByRole("menuitemradio", { name: new RegExp(`^${name} ${balance}`) }).click();
}

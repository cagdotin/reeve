import { addDays, today } from "@reeve/contract/rules";
import assert from "node:assert/strict";
import type { Locator, Page, Route } from "playwright-core";
import {
  expectCount,
  expectEventually,
  expectHidden,
  expectVisible,
  test,
} from "../src/fixtures.ts";
import type { App } from "../src/fixtures.ts";

const REGISTER = "**/api/books/*/transactions**";
const ACTIVITY = "**/api/books/*/rules/activity**";

const strips = (page: Page) => page.locator('[data-slot="page-alerts"] > [data-variant]');

const failed = (route: Route) =>
  route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ _tag: "StorageError", message: "The disk is gone" }),
  });

const missedRent = async (run: App["run"]) => {
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  await run("create_schedule", {
    name: "Rent",
    account: checking.id,
    amount: -50_000,
    amountOp: "is",
    date: addDays(today(), -4),
    dateOp: "is",
    payee: "Landlord",
  });
  return checking;
};

const top = async (locator: Locator) => (await locator.boundingBox())!.y;

test("a failure stacks above a warning, and only the failure interrupts", async ({ app }) => {
  const { page, run } = app;
  const checking = await missedRent(run);
  await page.goto(`${app.url}/accounts/${checking.id}`);
  const missed = page.getByRole("status").filter({ hasText: "1 missed schedule" });
  await expectVisible(missed);
  const kept = page.getByRole("main").getByText("Starting Balance").first();
  await expectVisible(kept);

  await page.route(REGISTER, failed);
  await run("create_transaction", { account: checking.id, date: today(), amount: -100 });
  const failure = page.getByRole("alert").filter({ hasText: "This could not be refreshed" });
  await expectVisible(failure);
  await expectVisible(kept);
  await expectVisible(missed);
  await expectEventually(async () => (await top(failure)) < (await top(missed)), true);
  await expectEventually(
    () =>
      strips(page).evaluateAll((all) => [
        ...new Set(
          all.map((each) => `${each.getAttribute("data-variant")} ${each.getAttribute("role")}`),
        ),
      ]),
    ["warning status", "error alert"],
  );

  await page.unroute(REGISTER);
  await run("create_transaction", { account: checking.id, date: today(), amount: -200 });
  await expectHidden(failure);
  await expectVisible(missed);
});

test("a refresh that fails while the connection is down says so once, as the connection", async ({
  app,
}) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  await run("create_account", { name: "Savings", balance: 50_000, onBudget: false });
  for (const notes of ["kept rule", "doomed rule"])
    await run("create_rule", {
      conditions: [{ field: "account", op: "is", value: checking.id }],
      actions: [{ op: "set", field: "notes", value: notes }],
      recategorize: false,
    });
  await page.route("**/api/events**", (route) => route.abort("connectionrefused"));
  await page.goto(`${app.url}/rules`);
  const kept = page.getByRole("main").getByText("kept rule").first();
  await expectVisible(kept);
  const connection = page.getByRole("status").filter({ hasText: "Reconnecting…" });
  await expectVisible(connection);

  let refusals = 0;
  await page.route(ACTIVITY, (route) => {
    refusals += 1;
    return route.abort("connectionrefused");
  });
  await page.getByRole("button", { name: /doomed rule/ }).hover();
  await page.getByRole("button", { name: "Rule 2 options" }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await page
    .getByRole("dialog", { name: "Delete this rule?" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expectEventually(async () => refusals >= 4, true);
  await page.waitForTimeout(500);

  await expectVisible(kept);
  await expectVisible(connection);
  await expectCount(page.getByText("This could not be refreshed"), 0);
});

/** Each strip's variant and the contrast of its words over its tint, composited on the surface behind it. */
const contrasts = (strips: Array<Element>) => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const paint = (...layers: Array<[string, number]>) => {
    context.clearRect(0, 0, 1, 1);
    for (const [color, alpha] of layers) {
      context.globalAlpha = alpha;
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
    }
    return [...context.getImageData(0, 0, 1, 1).data];
  };
  const opaque = (element: Element) =>
    paint([getComputedStyle(element).backgroundColor, 1])[3] === 255;
  const luminance = (rgb: Array<number>) => {
    const [r, g, b] = rgb.map((channel) => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  return strips.map((strip) => {
    let backdrop: Element = strip.parentElement ?? document.body;
    while (!opaque(backdrop) && backdrop.parentElement !== null) backdrop = backdrop.parentElement;
    const surface: Array<[string, number]> = [
      [getComputedStyle(backdrop).backgroundColor, 1],
      [getComputedStyle(strip).backgroundColor, 1],
    ];
    const paper = luminance(paint(...surface));
    const ratios = [...strip.querySelectorAll("p > span")].map((text) => {
      const { color, opacity } = getComputedStyle(text);
      const ink = luminance(paint(...surface, [color, Number(opacity)]));
      return (Math.max(ink, paper) + 0.05) / (Math.min(ink, paper) + 0.05);
    });
    return [strip.getAttribute("data-variant") ?? "", ratios] as const;
  });
};

for (const colorScheme of ["light", "dark"] as const)
  test(`in ${colorScheme}, every strip's words read at 4.5:1 over its tint`, async ({ app }) => {
    const { page, run } = app;
    await page.emulateMedia({ colorScheme });
    const checking = await missedRent(run);
    await page.goto(`${app.url}/accounts/${checking.id}`);
    await expectVisible(page.getByRole("status").filter({ hasText: "1 missed schedule" }));
    await page.route(REGISTER, failed);
    await run("create_transaction", { account: checking.id, date: today(), amount: -100 });
    await expectVisible(page.getByRole("alert").filter({ hasText: "This could not be refreshed" }));
    const onAccount = await strips(page).evaluateAll(contrasts);

    await page.goto(`${app.url}/?dashboard=gone`);
    const notice = page.getByRole("status").filter({ hasText: "That dashboard no longer exists" });
    await expectVisible(notice);
    const measured = [...onAccount, ...(await notice.evaluateAll(contrasts))];
    assert.deepEqual(
      new Set(measured.map(([variant]) => variant)),
      new Set(["error", "info", "warning"]),
      "each variant in use was measured",
    );
    for (const [variant, each] of measured)
      for (const value of each)
        assert.ok(value >= 4.5, `${variant} reads at ${value.toFixed(2)}:1 in ${colorScheme}`);
  });

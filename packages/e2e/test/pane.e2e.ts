import { today } from "@reeve/contract/rules";
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import {
  type App,
  expectEventually,
  expectHidden,
  expectText,
  expectVisible,
  test,
} from "../src/fixtures.ts";

const PHONE = { width: 390, height: 844 };

const panelOf = (page: Page) => page.getByRole("region", { name: "Panel", exact: true });
const prompt = (page: Page) => page.getByRole("alertdialog", { name: "Save your changes?" });
const modeOf = (page: Page) => panelOf(page).getAttribute("data-mode");
const payeeNames = async (run: App["run"]) =>
  (await run("list_payees", {})).map((each) => each.name);

async function seedPayees(run: App["run"]) {
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  const savings = await run("create_account", { name: "Savings", balance: 50_000 });
  for (const [account, payee] of [
    [checking.id, "Grocer"],
    [checking.id, "Bakery"],
    [savings.id, "Bank"],
  ] as const)
    await run("create_transaction", { account, date: today(), amount: -1_000, payee });
  return { checking, savings };
}

async function editGrocer(page: Page, name: string) {
  await page.getByRole("button", { name: "Grocer", exact: true }).click();
  const panel = panelOf(page);
  await expectVisible(panel.getByRole("heading", { name: "Edit Grocer" }));
  await panel.getByRole("textbox").first().fill(name);
  return panel;
}

test("an edited payee asks before Escape, the cross, the sidebar or Back can lose it", async ({
  app,
}) => {
  const { page, run } = app;
  await seedPayees(run);
  await page.goto(`${app.url}/accounts/all`);
  await page
    .getByRole("navigation", { name: "Section" })
    .getByRole("link", { name: "Payees" })
    .click();
  const panel = await editGrocer(page, "Grocery store");

  await page.keyboard.press("Escape");
  await expectVisible(prompt(page));
  await prompt(page).getByRole("button", { name: "Keep editing" }).click();
  await expectHidden(prompt(page));
  await expectEventually(() => panel.getByRole("textbox").first().inputValue(), "Grocery store");

  await panel.getByRole("button", { name: "Close panel" }).click();
  await prompt(page).getByRole("button", { name: "Discard changes" }).click();
  await expectHidden(panel);
  assert.ok((await payeeNames(run)).includes("Grocer"), "Discard leaves the payee as it was");

  await editGrocer(page, "Grocery store");
  await page
    .getByRole("navigation", { name: "Pages" })
    .getByRole("link", { name: "Budget", exact: true })
    .click();
  await expectVisible(prompt(page));
  await prompt(page).getByRole("button", { name: "Keep editing" }).click();
  assert.match(page.url(), /\/payees/, "Keep editing stays on the page");

  await page.getByRole("button", { name: "Go back", exact: true }).click();
  await prompt(page).getByRole("button", { name: "Save and continue" }).click();
  await page.waitForURL(`${app.url}/accounts/all`);
  await expectEventually(async () => (await payeeNames(run)).includes("Grocery store"), true);
});

test("a clean editor closes and opens another row without asking", async ({ app }) => {
  const { page, run } = app;
  await seedPayees(run);
  await page.goto(`${app.url}/payees`);
  await page.getByRole("button", { name: "Grocer", exact: true }).click();
  await expectVisible(panelOf(page).getByRole("heading", { name: "Edit Grocer" }));
  await page.getByRole("button", { name: "Bakery", exact: true }).click();
  await expectVisible(panelOf(page).getByRole("heading", { name: "Edit Bakery" }));
  await page.keyboard.press("Escape");
  await expectHidden(panelOf(page));
  await expectHidden(prompt(page));
});

test("picking another transaction or account asks first, and Save and continue saves", async ({
  app,
}) => {
  const { page, run } = app;
  const { checking } = await seedPayees(run);
  await page.goto(`${app.url}/accounts/${checking.id}`);
  await page.getByRole("button", { name: "Grocer", exact: true }).click();
  const panel = panelOf(page);
  await panel.getByRole("textbox", { name: "Notes" }).fill("Weekly shop");

  await page.getByRole("button", { name: "Bakery", exact: true }).click();
  await prompt(page).getByRole("button", { name: "Save and continue" }).click();
  await expectEventually(
    () => panel.getByRole("combobox", { name: "Payee" }).inputValue(),
    "Bakery",
  );
  const { rows } = await run("list_transactions", { account: checking.id });
  assert.equal(rows.find((row) => row.payee === "Grocer")?.notes, "Weekly shop");

  await panel.getByRole("textbox", { name: "Notes" }).fill("Bread");
  await page.getByRole("button", { name: /^Accounts shown: / }).click();
  await page.getByRole("menuitemradio", { name: /^Savings/ }).click();
  await expectVisible(prompt(page));
  await prompt(page).getByRole("button", { name: "Keep editing" }).click();
  assert.match(page.url(), new RegExp(checking.id), "the scope stays while editing");
  await expectEventually(() => panel.getByRole("textbox", { name: "Notes" }).inputValue(), "Bread");
});

test("a save that fails keeps the editor open with the error inside the pane", async ({ app }) => {
  const { page, run } = app;
  const { checking } = await seedPayees(run);
  await page.goto(`${app.url}/accounts/${checking.id}`);
  await page.getByRole("button", { name: "Grocer", exact: true }).click();
  const panel = panelOf(page);
  await panel.getByRole("textbox", { name: "Payment" }).fill("lots");
  await panel.getByRole("button", { name: "Close panel" }).click();
  await prompt(page).getByRole("button", { name: "Save and continue" }).click();

  await expectText(panel.getByRole("alert"), "The amount is not a number");
  await expectHidden(
    page.locator("[data-slot=page-alerts]").getByText("The amount is not a number"),
  );
  await expectEventually(
    () => panel.getByRole("textbox", { name: "Payment" }).inputValue(),
    "lots",
  );
});

test("Escape closes a popup in the pane before the pane, and focus returns to the row", async ({
  app,
}) => {
  const { page, run } = app;
  const { checking } = await seedPayees(run);
  await page.goto(`${app.url}/accounts/${checking.id}`);
  const row = page.getByRole("button", { name: "Grocer", exact: true });
  await row.focus();
  await page.keyboard.press("Enter");
  const panel = panelOf(page);
  await expectVisible(panel.getByRole("heading", { name: "Transaction" }));

  await panel.getByRole("combobox", { name: "Payee" }).click();
  await expectVisible(page.getByRole("listbox"));
  await page.keyboard.press("Escape");
  await expectHidden(page.getByRole("listbox"));
  await expectVisible(panel);

  await page.keyboard.press("Escape");
  await expectHidden(panel);
  await expectEventually(() => row.evaluate((element) => element === document.activeElement), true);
});

test("the handle resizes the docked pane from the keyboard, within the room the page leaves", async ({
  app,
}) => {
  const { page, run } = app;
  await seedPayees(run);
  await page.goto(`${app.url}/payees`);
  await page.getByRole("button", { name: "Grocer", exact: true }).click();
  await expectEventually(() => modeOf(page), "docked");
  const handle = page.getByRole("separator", { name: "Resize panel" });
  const now = async () => Number(await handle.getAttribute("aria-valuenow"));
  await handle.focus();
  await page.keyboard.press("Enter");
  await expectEventually(now, 400);
  await page.keyboard.press("ArrowLeft");
  await expectEventually(now, 416);
  await page.keyboard.press("Home");
  const max = Number(await handle.getAttribute("aria-valuemax"));
  await expectEventually(now, max);
  const inset = await page
    .locator("main")
    .evaluate((element) => element.closest("[data-slot=pane-page]")!.getBoundingClientRect().width);
  assert.ok(inset >= 600, `the page keeps ${inset}px beside the widest pane`);
});

for (const [label, viewport, fold, mode] of [
  ["a wide window", { width: 1440, height: 900 }, false, "docked"],
  ["a narrow laptop with the sidebar folded", { width: 1280, height: 800 }, true, "docked"],
  ["a narrow laptop with the sidebar open", { width: 1024, height: 768 }, false, "overlay"],
  ["a phone", PHONE, false, "screen"],
] as const)
  test(`on ${label} the pane is ${mode}, and closing it keeps the page where it was`, async ({
    app,
  }) => {
    const { page, run } = app;
    await seedPayees(run);
    await page.setViewportSize(viewport);
    await page.goto(`${app.url}/payees`);
    if (fold) await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await page.getByRole("button", { name: "Grocer", exact: true }).click();
    await expectEventually(() => modeOf(page), mode);
    const covering = mode !== "docked";
    await expectEventually(
      () => page.locator("main").evaluate((element) => element.closest("[inert]") !== null),
      covering,
    );
    if (covering) {
      for (let step = 0; step < 12; step++) await page.keyboard.press("Tab");
      await expectEventually(
        () => panelOf(page).evaluate((element) => element.contains(document.activeElement)),
        true,
      );
    }
    await panelOf(page).getByRole("button", { name: "Close panel" }).click();
    await expectHidden(panelOf(page));
    await expectVisible(page.getByRole("button", { name: "Grocer", exact: true }));
  });

test("the scrim behind an overlay closes it through the guard", async ({ app }) => {
  const { page, run } = app;
  await seedPayees(run);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(`${app.url}/payees`);
  await editGrocer(page, "Grocery store");
  await expectEventually(() => modeOf(page), "overlay");
  await page.mouse.click(300, 400);
  await expectVisible(prompt(page));
  await prompt(page).getByRole("button", { name: "Discard changes" }).click();
  await expectHidden(panelOf(page));
});

test("folding the sidebar, which turns an overlay into a docked pane, keeps what was typed", async ({
  app,
}) => {
  const { page, run } = app;
  await seedPayees(run);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(`${app.url}/payees`);
  const panel = await editGrocer(page, "Grocery store");
  await expectEventually(() => modeOf(page), "overlay");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expectEventually(() => modeOf(page), "docked");
  await expectEventually(() => panel.getByRole("textbox").first().inputValue(), "Grocery store");
});

test("a row that leaves the list after a change elsewhere stays open with its edits", async ({
  app,
}) => {
  const { page, run } = app;
  const { checking } = await seedPayees(run);
  await page.goto(`${app.url}/accounts/${checking.id}`);
  await page.getByRole("searchbox", { name: "Search transactions" }).fill("Grocer");
  await page.getByRole("button", { name: "Grocer", exact: true }).click();
  const panel = panelOf(page);
  await panel.getByRole("textbox", { name: "Notes" }).fill("Weekly shop");
  const { rows } = await run("list_transactions", { account: checking.id });
  const grocer = rows.find((row) => row.payee === "Grocer")!;
  await run("update_transaction", { id: grocer.transactionId, payee: "Market" });
  await expectHidden(page.getByRole("main").getByRole("button", { name: "Grocer", exact: true }));
  await expectEventually(
    () => panel.getByRole("textbox", { name: "Notes" }).inputValue(),
    "Weekly shop",
  );
});

test("Save and continue never merges a renamed payee into another", async ({ app }) => {
  const { page, run } = app;
  await seedPayees(run);
  await page.goto(`${app.url}/payees`);
  const panel = await editGrocer(page, "Bakery");
  await page.keyboard.press("Escape");
  await prompt(page).getByRole("button", { name: "Save and continue" }).click();
  await expectText(
    panel.getByRole("alert"),
    "Merging into Bakery takes its own button in the form.",
  );
  assert.ok((await payeeNames(run)).includes("Grocer"), "both payees remain");
});

test("while a save is in flight the pane says so and nothing closes it", async ({ app }) => {
  const { page, run } = app;
  const { checking } = await seedPayees(run);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/books/*/transactions/*", async (route) => {
    if (route.request().method() === "PATCH") await held;
    await route.fallback();
  });
  await page.goto(`${app.url}/accounts/${checking.id}`);
  await page.getByRole("button", { name: "Grocer", exact: true }).click();
  const panel = panelOf(page);
  await panel.getByRole("textbox", { name: "Notes" }).fill("weekly shop");
  await panel.getByRole("button", { name: "Save" }).click();

  await expectVisible(panel.locator("[aria-busy=true]"));
  assert.equal(
    await panel.getByRole("button", { name: "Close panel" }).isDisabled(),
    true,
    "the cross waits for the save",
  );
  assert.equal(
    await panel.getByRole("textbox", { name: "Notes" }).isDisabled(),
    true,
    "the fields take no input while saving",
  );
  await page.keyboard.press("Escape");
  await expectHidden(prompt(page));
  await expectVisible(panel.getByRole("heading", { name: "Transaction" }));

  release();
  await expectHidden(panel.getByRole("heading", { name: "Transaction" }));
  await expectEventually(
    async () =>
      (await run("list_transactions", { account: checking.id })).rows.some(
        (row) => row.notes === "weekly shop",
      ),
    true,
  );
});

import type { Page } from "playwright-core";
import {
  expectCount,
  expectEventually,
  expectHidden,
  expectText,
  expectVisible,
  test,
  type App,
} from "../src/fixtures.ts";

const PHONE = { width: 390, height: 844 };
const tabs = (page: Page) => page.getByRole("navigation", { name: "Section" });
const currentTab = (page: Page) => tabs(page).locator('[aria-current="page"]');
const alert = (page: Page) => page.getByRole("alert");
const notice = (page: Page) => page.getByRole("status");
const average = (page: Page) => page.getByRole("button", { name: "Average", exact: true });
const explored = (page: Page) => new URL(page.url()).searchParams.get("explore");

const scroller = (page: Page) =>
  page.locator('[data-slot="scroll-area-viewport"]:has([data-slot="page"])');
const scrollTop = (page: Page) => scroller(page).evaluate((element) => element.scrollTop);

/** Today with enough widgets to scroll, a spending widget last. */
const seedTallToday = async ({ run }: App) => {
  await run("create_account", { name: "Checking", balance: 250_000 });
  const pageId = (await run("list_dashboard_pages", {}))[0]!.id;
  for (let row = 0; row < 4; row++)
    await run("add_widget", { pageId, type: "net-worth-card", width: 12, height: 3 });
  const spending = await run("add_widget", {
    pageId,
    type: "spending-card",
    report: { name: "Groceries pace" },
    width: 12,
    height: 3,
  });
  return { pageId, spending };
};

const openSpendingFromToday = async (app: App) => {
  const { page } = app;
  const widget = page.getByRole("region", { name: "Groceries pace", exact: true });
  await widget.scrollIntoViewIfNeeded();
  await expectEventually(async () => (await scrollTop(page)) > 200, true);
  const before = await scrollTop(page);
  await widget.getByRole("link", { name: "Groceries pace" }).click();
  await page.waitForURL(/\/reports\/spending\?report=/);
  await expectText(currentTab(page), "Reports");
  return before;
};

test("Back from a widget's report restores the dashboard's scroll, Forward the explored report", async ({
  app,
}) => {
  const { page } = app;
  await seedTallToday(app);
  await page.goto(`${app.url}/`);
  const before = await openSpendingFromToday(app);
  await expectEventually(() => scrollTop(page), 0);

  await average(page).click();
  await expectEventually(async () => explored(page) !== null, true);
  const length = await page.evaluate(() => history.length);
  await page.getByRole("button", { name: "Budgeted", exact: true }).click();
  await average(page).click();
  await expectEventually(() => page.evaluate(() => history.length), length);

  await page.getByRole("button", { name: "Go back" }).click();
  await page.waitForURL(`${app.url}/`);
  await expectText(currentTab(page), "Dashboards");
  await expectEventually(async () => Math.abs((await scrollTop(page)) - before) <= 4, true);

  await page.getByRole("button", { name: "Go forward" }).click();
  await page.waitForURL(/explore=/);
  await expectEventually(() => average(page).getAttribute("aria-pressed"), "true");

  await page.getByRole("combobox", { name: /^Report: / }).click();
  await page.getByRole("combobox", { name: "Search reports" }).fill("cash");
  await page.getByRole("option", { name: "Cash flow", exact: true }).click();
  await page.waitForURL(`${app.url}/reports/cash-flow`);
  await page.getByRole("button", { name: "Go back" }).click();
  await page.waitForURL(/explore=/);
  await expectEventually(() => average(page).getAttribute("aria-pressed"), "true");
});

test("explored settings survive a reload and a failed refresh, and never save by themselves", async ({
  app,
}) => {
  const { page, run } = app;
  const { spending } = await seedTallToday(app);
  await page.goto(`${app.url}/reports/spending?report=${spending.reportId}`);
  await average(page).click();
  await expectEventually(async () => explored(page) !== null, true);

  let failing = true;
  await page.route("**/reports/spending", (route) =>
    failing
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ _tag: "StorageError", message: "Spending is unavailable" }),
        })
      : route.continue(),
  );
  await page.reload();
  await expectVisible(alert(page).filter({ hasText: "Spending is unavailable" }));
  await expectEventually(async () => explored(page) !== null, true);
  failing = false;
  await page.unroute("**/reports/spending");
  await page.reload();
  await expectEventually(() => average(page).getAttribute("aria-pressed"), "true");

  const savedMode = async () => {
    const saved = await run("get_saved_report", { id: spending.reportId! });
    return "definition" in saved ? (saved.definition.settings as { mode?: string }).mode : null;
  };
  await expectEventually(async () => (await savedMode()) === "average", false);

  await page.getByRole("button", { name: "Save report" }).click();
  const confirm = page.getByRole("alertdialog");
  await expectVisible(confirm.getByText("Today: Groceries pace"));
  await confirm.getByRole("button", { name: "Save report" }).click();
  await expectEventually(async () => explored(page), null);
  await expectEventually(savedMode, "average");
  await expectEventually(() => average(page).getAttribute("aria-pressed"), "true");
});

test("a built-in report's exploration saves as a new report, and a direct link has no Back", async ({
  app,
}) => {
  const { page, run } = app;
  const settings = encodeURIComponent(JSON.stringify({ isLive: true, mode: "average" }));
  await page.goto(`${app.url}/reports/spending?explore=${settings}`);
  await expectEventually(() => average(page).getAttribute("aria-pressed"), "true");
  await expectEventually(() => page.getByRole("button", { name: "Go back" }).isDisabled(), true);

  await page.getByRole("button", { name: "Save as new report" }).click();
  const dialog = page.getByRole("dialog", { name: "Save as new report" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("Average spending");
  await dialog.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/\/reports\/spending\?report=[^&]+$/);
  await expectEventually(async () => {
    const saved = (await run("list_saved_reports", {})).find(
      (each) => each.name === "Average spending",
    );
    return saved !== undefined && "definition" in saved
      ? (saved.definition.settings as { mode?: string }).mode
      : null;
  }, "average");
  await expectEventually(() => page.getByRole("button", { name: "Go back" }).isDisabled(), true);
});

test("a deleted saved report or dashboard leaves a clear page behind on Back", async ({ app }) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 250_000 });
  const bills = await run("create_dashboard_page", { name: "Bills" });
  const widget = await run("add_widget", {
    pageId: bills.id,
    type: "spending-card",
    report: { name: "Bills spending" },
  });
  await page.goto(`${app.url}/?dashboard=${bills.id}`);
  await page
    .getByRole("region", { name: "Bills spending", exact: true })
    .getByRole("link", { name: "Bills spending" })
    .click();
  await page.waitForURL(/report=/);
  await average(page).click();
  await expectEventually(async () => explored(page) !== null, true);

  await run("delete_saved_report", { id: widget.reportId!, expectedPlacementIds: [widget.id] });
  await page.reload();
  await expectVisible(notice(page).filter({ hasText: "That saved report no longer exists" }));
  await expectEventually(() => average(page).getAttribute("aria-pressed"), "true");
  await expectVisible(page.getByRole("button", { name: "Save as new report" }));

  await run("delete_dashboard_page", { id: bills.id });
  await page.getByRole("button", { name: "Go back" }).click();
  await page.waitForURL(`${app.url}/?dashboard=${bills.id}`);
  await expectVisible(notice(page).filter({ hasText: "That dashboard no longer exists" }));
});

test("another book's report address shows this book's report, not the last book's", async ({
  app,
}) => {
  const { page, run } = app;
  const { spending } = await seedTallToday(app);
  const second = await run("create_book", { name: "Second" });
  await page.goto(`${app.url}/reports/spending?report=${spending.reportId}`);
  await expectVisible(page.getByRole("combobox", { name: "Report: Groceries pace" }));

  await page.evaluate((id) => localStorage.setItem("reeve:book", id), second.id);
  await page.goto(`${app.url}/reports/spending?report=${spending.reportId}`);
  await expectVisible(page.getByRole("button", { name: "Book: Second" }).first());
  await expectVisible(notice(page).filter({ hasText: "That saved report no longer exists" }));
  await expectCount(page.getByText("Groceries pace"), 0);
});

test("on a phone, the browser's Back returns to the dashboard where it was", async ({ app }) => {
  const { page } = app;
  await page.setViewportSize(PHONE);
  await seedTallToday(app);
  await page.goto(`${app.url}/`);
  const before = await openSpendingFromToday(app);
  await average(page).click();
  await expectEventually(async () => explored(page) !== null, true);
  await page.goBack();
  await page.waitForURL(`${app.url}/`);
  await expectEventually(async () => Math.abs((await scrollTop(page)) - before) <= 4, true);
  await page.goForward();
  await expectEventually(() => average(page).getAttribute("aria-pressed"), "true");
  await expectHidden(notice(page).filter({ hasText: "no longer exists" }));
});

import type { Page } from "playwright-core";
import {
  expectCount,
  expectEventually,
  expectHidden,
  expectVisible,
  test,
  type App,
} from "../src/fixtures.ts";

const TODAY = ["This month", "Categories", "Accounts", "Coming up", "Latest transactions"];

const card = (page: Page, name: string) => page.getByRole("region", { name, exact: true });
const selector = (page: Page) => page.getByRole("button", { name: /^Dashboard: / });
const actions = (page: Page) => page.getByRole("button", { name: "Dashboard actions" });
const menuItem = (page: Page, name: string | RegExp) => page.getByRole("menuitem", { name });

const dashboards = async ({ run }: App) => run("list_dashboard_pages", {});

/** The widget types of a dashboard in reading order, which is the order on a narrow screen. */
const readingOrder = async (app: App, name: string) =>
  (await dashboards(app))
    .find((each) => each.name === name)!
    .widgets.toSorted((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1))
    .map((widget) => widget.type);

const regionNames = (page: Page) =>
  page
    .getByRole("main")
    .getByRole("region")
    .evaluateAll((regions) => regions.map((region) => region.getAttribute("aria-label")));

test("a new book opens Today, whole, without any setup", async ({ app }) => {
  const { page } = app;
  await page.goto(`${app.url}/`);
  await expectVisible(selector(page).getByText("Today"));
  for (const name of TODAY) await expectVisible(card(page, name));
  await expectEventually(
    async () => (await dashboards(app)).map((each) => [each.name, each.isDefault]),
    [["Today", true]],
  );
  await actions(page).click();
  await expectVisible(menuItem(page, "Opens by default"));
  await expectEventually(() => menuItem(page, "Delete…").getAttribute("aria-disabled"), "true");
});

test("a second dashboard is made, filled, kept over a reload and opened by default", async ({
  app,
}) => {
  const { page } = app;
  await page.goto(`${app.url}/`);
  await selector(page).click();
  await menuItem(page, "New dashboard…").click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill("Bills");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expectVisible(selector(page).getByText("Bills"));
  await expectVisible(page.getByText("This dashboard is empty"));

  await page.getByRole("button", { name: "Add widget" }).click();
  await menuItem(page, "Coming up").click();
  await expectVisible(card(page, "Coming up"));
  await page.reload();
  await expectVisible(selector(page).getByText("Bills"));
  await expectVisible(card(page, "Coming up"));

  await page.goto(`${app.url}/`);
  await expectVisible(selector(page).getByText("Today"));
  await selector(page).click();
  await menuItem(page, /Bills/).click();
  await page.getByRole("link", { name: "Budget", exact: true }).first().click();
  await page.waitForURL(`${app.url}/budget`);
  await page.getByRole("link", { name: "Home", exact: true }).first().click();
  await expectVisible(selector(page).getByText("Bills"));

  await actions(page).click();
  await menuItem(page, "Open by default").click();
  await expectEventually(
    async () => (await dashboards(app)).find((each) => each.isDefault)?.name,
    "Bills",
  );
  await actions(page).click();
  await menuItem(page, "Move earlier").click();
  await expectEventually(
    async () => (await dashboards(app)).map((each) => each.name),
    ["Bills", "Today"],
  );
  await page.goto(`${app.url}/`);
  await expectVisible(selector(page).getByText("Bills"));

  await actions(page).click();
  await menuItem(page, "Duplicate…").click();
  await expectEventually(
    () => page.getByRole("dialog").getByRole("textbox", { name: "Name" }).inputValue(),
    "Bills copy",
  );
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expectVisible(selector(page).getByText("Bills copy"));
  await expectVisible(card(page, "Coming up"));
  await actions(page).click();
  await menuItem(page, "Rename…").click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill("Later bills");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expectVisible(selector(page).getByText("Later bills"));
  await expectEventually(
    async () => (await dashboards(app)).map((each) => each.name),
    ["Bills", "Today", "Later bills"],
  );
});

test("the arrow keys move and resize a widget, each step saved and undone alone", async ({
  app,
}) => {
  const { page } = app;
  const latest = async () =>
    (await dashboards(app))[0]!.widgets.find((each) => each.type === "recent-transactions")!;
  await page.goto(`${app.url}/`);
  await expectVisible(card(page, "Latest transactions"));
  await page.getByRole("button", { name: "Arrange widgets" }).click();
  const handle = page.getByRole("button", { name: "Arrange Latest transactions" });
  await handle.focus();
  await page.keyboard.press("Shift+ArrowDown");
  await expectEventually(async () => (await latest()).height, 4);
  await page.keyboard.press("ArrowUp");
  await expectEventually(async () => (await latest()).y, 3);
  await expectEventually(
    () => handle.evaluate((element) => element === document.activeElement),
    true,
  );
  await expectVisible(page.getByText("Row 4, column 7, 6 columns wide, 4 rows tall"));

  await page.keyboard.press("ControlOrMeta+z");
  await expectEventually(async () => {
    const { y, height } = await latest();
    return [y, height];
  }, [6, 4]);
  await page.keyboard.press("ControlOrMeta+z");
  await expectEventually(async () => (await latest()).height, 3);
});

test("a phone moves widgets up and down in its one column", async ({ app }) => {
  const { page } = app;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${app.url}/`);
  await expectVisible(card(page, "This month"));
  await page.getByRole("button", { name: "Arrange widgets" }).click();
  await expectVisible(page.getByRole("button", { name: "Move This month up" }));
  await expectEventually(
    () => page.getByRole("button", { name: "Move This month up" }).isDisabled(),
    true,
  );
  const down = page.getByRole("button", { name: "Move This month down" });
  await down.click();
  await expectEventually(
    async () => (await readingOrder(app, "Today")).slice(0, 2),
    ["category-pace", "home-insight"],
  );
  await expectEventually(
    async () => (await regionNames(page)).slice(0, 2),
    ["Categories", "This month"],
  );
  await expectEventually(
    () => down.evaluate((element) => element === document.activeElement),
    true,
  );
  await page.keyboard.press("Enter");
  await expectEventually(
    async () => (await readingOrder(app, "Today")).slice(0, 3),
    ["category-pace", "account-balances", "home-insight"],
  );
  await expectEventually(
    () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
});

test("deleting the dashboard in view, or following a stale link, lands on the default", async ({
  app,
}) => {
  const { page, run } = app;
  const bills = await run("create_dashboard_page", { name: "Bills" });
  await page.goto(`${app.url}/?dashboard=${bills.id}`);
  await expectVisible(selector(page).getByText("Bills"));
  await actions(page).click();
  await menuItem(page, "Delete…").click();
  await expectVisible(page.getByText("The empty dashboard is deleted"));
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expectVisible(selector(page).getByText("Today"));
  await expectCount(card(page, "Coming up"), 1);

  const old = await run("create_dashboard_page", { name: "Old" });
  await page.goto(`${app.url}/?dashboard=${old.id}`);
  await expectVisible(selector(page).getByText("Old"));
  await run("delete_dashboard_page", { id: old.id });
  await expectVisible(selector(page).getByText("Today"));
  await expectVisible(page.getByRole("status").getByText("That dashboard no longer exists"));
});

test("reset asks first, says what it replaces, and undoes in one step", async ({ app }) => {
  const { page, run } = app;
  const today = (await dashboards(app))[0]!;
  await run("remove_widget", {
    id: today.widgets.find((each) => each.type === "account-balances")!.id,
  });
  await page.goto(`${app.url}/`);
  await expectVisible(card(page, "This month"));
  await expectHidden(card(page, "Accounts"));
  await actions(page).click();
  await menuItem(page, "Reset to Today’s widgets…").click();
  await expectVisible(page.getByText("Its 5 widgets are replaced"));
  await page.getByRole("button", { name: "Cancel" }).click();
  await expectHidden(card(page, "Accounts"));

  await actions(page).click();
  await menuItem(page, "Reset to Today’s widgets…").click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expectVisible(card(page, "Accounts"));
  await expectEventually(async () => (await dashboards(app))[0]!.widgets.length, 6);
  await page.keyboard.press("ControlOrMeta+z");
  await expectHidden(card(page, "Accounts"));
  await expectEventually(
    async () => (await dashboards(app))[0]!.widgets.map((each) => each.id).toSorted(),
    today.widgets
      .filter((each) => each.type !== "account-balances")
      .map((each) => each.id)
      .toSorted(),
  );
});

test("another book shows its own dashboards, never the last book's", async ({ app }) => {
  const { page, run } = app;
  const bills = await run("create_dashboard_page", { name: "Bills" });
  const second = await run("create_book", { name: "Second" });
  await page.goto(`${app.url}/?dashboard=${bills.id}`);
  await expectVisible(selector(page).getByText("Bills"));

  await page.evaluate((id) => localStorage.setItem("reeve:book", id), second.id);
  await page.goto(`${app.url}/?dashboard=${bills.id}`);
  await expectVisible(selector(page).getByText("Today"));
  await selector(page).click();
  await expectHidden(menuItem(page, /Bills/));
});

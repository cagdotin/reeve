import type { Page } from "playwright-core";
import { expectCount, expectEventually, expectText, expectVisible, test } from "../src/fixtures.ts";

const PHONE = { width: 390, height: 844 };
const pathAndQuery = (page: Page) => {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
};
const tabs = (page: Page) => page.getByRole("navigation", { name: "Section" });
const currentTab = (page: Page) => tabs(page).locator('[aria-current="page"]');
const dashboardSelector = (page: Page) => page.getByRole("button", { name: /^Dashboard: / });
const reportSelector = (page: Page) => page.getByRole("combobox", { name: /^Report: / });

const pickReport = async (page: Page, search: string, name: string) => {
  await reportSelector(page).click();
  await page.getByRole("combobox", { name: "Search reports" }).fill(search);
  await page.getByRole("option", { name, exact: true }).click();
};

test("Home opens Today under the Dashboards and Reports tabs, with no Reports destination", async ({
  app,
}) => {
  const { page } = app;
  await page.goto(`${app.url}/`);
  await expectVisible(dashboardSelector(page).getByText("Today"));
  await expectEventually(
    () => tabs(page).getByRole("link").allTextContents(),
    ["Dashboards", "Reports"],
  );
  await expectText(currentTab(page), "Dashboards");
  const rail = page.getByRole("navigation", { name: "Pages" });
  await expectCount(rail.getByRole("link", { name: "Reports", exact: true }), 0);
  await expectEventually(
    () => rail.getByRole("link", { name: "Home", exact: true }).getAttribute("aria-current"),
    "page",
  );
});

test("Home and its tabs return to the dashboard and report last shown, a reload starts over", async ({
  app,
}) => {
  const { page, run } = app;
  const bills = await run("create_dashboard_page", { name: "Bills" });
  await page.goto(`${app.url}/`);
  await dashboardSelector(page).click();
  await page.getByRole("menuitem", { name: /Bills/ }).click();
  await page.waitForURL(`${app.url}/?dashboard=${bills.id}`);

  await tabs(page).getByRole("link", { name: "Reports" }).click();
  await page.waitForURL(`${app.url}/reports`);
  await expectText(currentTab(page), "Reports");
  await pickReport(page, "spend", "Spending");
  await page.waitForURL(`${app.url}/reports/spending`);
  await expectText(currentTab(page), "Reports");

  const rail = page.getByRole("navigation", { name: "Pages" });
  await rail.getByRole("link", { name: "Home", exact: true }).click();
  await page.waitForURL(`${app.url}/?dashboard=${bills.id}`);
  await expectVisible(dashboardSelector(page).getByText("Bills"));

  await tabs(page).getByRole("link", { name: "Reports" }).click();
  await page.waitForURL(`${app.url}/reports/spending`);
  await rail.getByRole("link", { name: "Budget", exact: true }).click();
  await page.waitForURL(`${app.url}/budget`);
  await page.keyboard.press("r");
  await page.waitForURL(`${app.url}/reports/spending`);
  await page.keyboard.press("h");
  await page.waitForURL(`${app.url}/?dashboard=${bills.id}`);

  await page.goto(`${app.url}/reports/net-worth`);
  await tabs(page).getByRole("link", { name: "Dashboards" }).click();
  await page.waitForURL(`${app.url}/`);
  await expectVisible(dashboardSelector(page).getByText("Today"));
});

test("a direct link to a report opens it with Reports current, nothing to go back to and no arrow", async ({
  app,
}) => {
  const { page } = app;
  await page.goto(`${app.url}/reports/cash-flow`);
  await expectVisible(reportSelector(page));
  await expectText(currentTab(page), "Reports");
  await expectText(page.getByRole("heading", { level: 1 }), "Cash Flow");
  await expectEventually(() => page.getByRole("button", { name: "Go back" }).isDisabled(), true);
  await expectCount(page.getByRole("button", { name: "Back", exact: true }), 0);

  await tabs(page).getByRole("link", { name: "Dashboards" }).click();
  await expectVisible(dashboardSelector(page).getByText("Today"));
  await page.getByRole("button", { name: "Go back" }).click();
  await page.waitForURL(`${app.url}/reports/cash-flow`);
  await page.reload();
  await expectText(currentTab(page), "Reports");
  await expectVisible(reportSelector(page));
});

test("old addresses land on All reports and on the dashboard they named", async ({ app }) => {
  const { page, run } = app;
  const bills = await run("create_dashboard_page", { name: "Bills" });
  await page.goto(`${app.url}/reports/library`);
  await page.waitForURL(`${app.url}/reports`);
  await expectText(page.getByRole("heading", { level: 1 }), "All reports");
  await page.goto(`${app.url}/reports?page=${bills.id}`);
  await page.waitForURL(`${app.url}/?dashboard=${bills.id}`);
  await expectVisible(dashboardSelector(page).getByText("Bills"));
});

test("the report selector finds a report by name and opens it with its own settings", async ({
  app,
}) => {
  const { page, run } = app;
  const pageId = (await run("list_dashboard_pages", {}))[0]!.id;
  const widget = await run("add_widget", {
    pageId,
    type: "net-worth-card",
    report: { name: "Family net worth" },
  });
  await page.goto(`${app.url}/reports/cash-flow`);
  await reportSelector(page).click();
  const search = page.getByRole("combobox", { name: "Search reports" });
  await expectVisible(page.getByRole("option", { name: "All reports" }));
  await expectVisible(page.getByRole("group", { name: "Saved reports" }));
  await search.fill("no such report");
  await expectVisible(page.getByText("No report matches"));
  await search.fill("net");
  await page.getByRole("option", { name: "Net worth", exact: true }).click();
  await expectEventually(() => Promise.resolve(pathAndQuery(page)), "/reports/net-worth");

  await reportSelector(page).click();
  await page.getByRole("combobox", { name: "Search reports" }).fill("family");
  await page.getByRole("option", { name: /^Family net worth/ }).click();
  await expectEventually(
    () => Promise.resolve(pathAndQuery(page)),
    `/reports/net-worth?report=${widget.reportId}`,
  );
  await expectVisible(reportSelector(page).getByText("Family net worth"));
  await pickReport(page, "all", "All reports");
  await page.waitForURL(`${app.url}/reports`);
});

test("opening a widget's report makes Reports the current tab, and Back returns to the dashboard", async ({
  app,
}) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 250_000 });
  const pageId = (await run("list_dashboard_pages", {}))[0]!.id;
  const widget = await run("add_widget", { pageId, type: "net-worth-card", width: 6, height: 3 });
  await page.goto(`${app.url}/`);
  await page
    .getByRole("region", { name: "Net Worth", exact: true })
    .getByRole("link", { name: "Net Worth" })
    .click();
  await page.waitForURL(`${app.url}/reports/net-worth?report=${widget.reportId}`);
  await expectText(currentTab(page), "Reports");
  await page.getByRole("button", { name: "Go back" }).click();
  await page.waitForURL(`${app.url}/`);
  await expectText(currentTab(page), "Dashboards");
});

test("on a phone, a report keeps Home's tabs and its selector, and the shortcuts list Reports", async ({
  app,
}) => {
  const { page } = app;
  await page.setViewportSize(PHONE);
  await page.goto(`${app.url}/reports/spending`);
  await expectText(currentTab(page), "Reports");
  await expectVisible(reportSelector(page));
  await expectEventually(
    () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Shortcuts" }).click();
  const sheet = page.getByRole("dialog", { name: "Shortcuts" });
  const keys = sheet.getByRole("listitem");
  await expectText(keys.filter({ hasText: /^Reports/ }), "Reports\nR");
  await expectText(keys.filter({ hasText: /^Home/ }), "Home\nH");
});

test("leaving a report for Dashboards slides the pill, since the tabs stay mounted", async ({
  app,
}) => {
  const { page } = app;
  await page.goto(`${app.url}/reports/cash-flow`);
  await expectVisible(tabs(page).locator(".bg-primary").last());
  const positions = await page.evaluate(
    () =>
      new Promise<ReadonlyArray<number>>((resolve) => {
        const seen = new Set<number>();
        const started = performance.now();
        const tick = () => {
          const pill = [
            ...document.querySelectorAll('nav[aria-label="Section"] .bg-primary'),
          ].pop();
          if (pill !== undefined)
            seen.add(Math.round(new DOMMatrix(getComputedStyle(pill).transform).m41));
          if (performance.now() - started < 1500) requestAnimationFrame(tick);
          else resolve([...seen]);
        };
        tick();
        document.querySelector<HTMLElement>('nav[aria-label="Section"] a')?.click();
      }),
  );
  await expectEventually(async () => positions.length > 5, true);
  await expectText(currentTab(page), "Dashboards");
});

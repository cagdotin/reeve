import { today } from "@reeve/contract/rules";
import type { Page } from "playwright-core";
import { expectEventually, expectHidden, expectVisible, test, type App } from "../src/fixtures.ts";

const placement = { version: 1, title: null, presentation: {} } as const;
const inherit = { accounts: { mode: "inherit" } } as const;

/** A dashboard with a report widget, a summary widget and a work list, opened in the page. */
const seedDashboard = async ({ page, run, url }: App) => {
  const checking = await run("create_account", { name: "Checking", balance: 250_000 });
  const dashboard = await run("create_dashboard_page", { name: "Widgets" });
  const netWorth = await run("add_widget", {
    pageId: dashboard.id,
    type: "net-worth-card",
    width: 6,
    height: 3,
  });
  const summary = await run("add_widget", {
    pageId: dashboard.id,
    type: "summary-card",
    report: { name: "All money", settings: { content: { type: "sum" } } },
  });
  const recent = await run("add_widget", {
    pageId: dashboard.id,
    type: "recent-transactions",
    config: { ...placement, scope: inherit, settings: {} },
    height: 3,
  });
  await page.goto(`${url}/?dashboard=${dashboard.id}`);
  return { checking, dashboard, netWorth, summary, recent };
};

const card = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

for (const viewport of ["desktop", "phone"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`report, summary and work-list widgets render on ${viewport} in ${theme}`, async ({
      app,
    }) => {
      const { page } = app;
      await page.setViewportSize(
        viewport === "phone" ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      );
      await page.emulateMedia({ colorScheme: theme });
      const { netWorth } = await seedDashboard(app);
      await expectVisible(card(page, "Net Worth").getByText("2,500.00").first());
      await expectVisible(card(page, "All money").getByText("2,500.00"));
      await expectVisible(card(page, "Latest transactions").getByText("Starting Balance"));
      await expectEventually(
        () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
      );
      await card(page, "Net Worth").getByRole("link", { name: "Net Worth" }).click();
      await page.waitForURL(`${app.url}/reports/net-worth?report=${netWorth.reportId}`);
    });
  }
}

test("a failed widget keeps its neighbours and recovers on retry", async ({ app }) => {
  const { page } = app;
  let failing = true;
  await page.route("**/reports/net-worth", (route) =>
    failing
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ _tag: "StorageError", message: "Net worth is unavailable" }),
        })
      : route.continue(),
  );
  await seedDashboard(app);
  const netWorth = card(page, "Net Worth");
  await expectVisible(netWorth.getByText("This widget could not be loaded."));
  await expectVisible(card(page, "All money").getByText("2,500.00"));
  await expectVisible(card(page, "Latest transactions").getByText("Starting Balance"));
  failing = false;
  await netWorth.getByRole("button", { name: "Retry" }).click();
  await expectVisible(netWorth.getByText("2,500.00").first());
  await expectHidden(netWorth.getByText("This widget could not be loaded."));
});

test("a failed refresh keeps the figures it had and says so", async ({ app }) => {
  const { page, run } = app;
  const { checking } = await seedDashboard(app);
  const summary = card(page, "All money");
  await expectVisible(summary.getByText("2,500.00"));
  await page.route("**/reports/summary", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ _tag: "StorageError", message: "Summary is unavailable" }),
    }),
  );
  await run("create_transaction", {
    date: today(),
    account: checking.id,
    amount: -1_000,
    payee: "Cafe",
  });
  await expectVisible(summary.getByText("Could not refresh. Showing earlier figures."));
  await expectVisible(summary.getByText("2,500.00"));
  await expectVisible(card(page, "Latest transactions").getByText("Cafe"));
  await page.unroute("**/reports/summary");
  await summary.getByRole("button", { name: "Retry" }).click();
  await expectVisible(summary.getByText("2,490.00"));
  await expectHidden(summary.getByText("Could not refresh. Showing earlier figures."));
});

test("empty and unsupported widgets say so and offer what they can", async ({ app }) => {
  const { page, run } = app;
  const dashboard = await run("create_dashboard_page", { name: "Empty" });
  await run("add_widget", {
    pageId: dashboard.id,
    type: "recent-transactions",
    config: { ...placement, scope: inherit, settings: {} },
  });
  const budgetedOnly = await run("add_widget", {
    pageId: dashboard.id,
    type: "net-worth-card",
    report: { name: "Budget net worth" },
  });
  await run("update_saved_report", {
    id: budgetedOnly.reportId!,
    scope: { accounts: { mode: "budgeted" } },
  });
  const scoped = await run("add_widget", {
    pageId: dashboard.id,
    type: "custom-report",
    report: { name: "Budget spending" },
    config: { ...placement, scope: { accounts: { mode: "fixed", value: { mode: "budgeted" } } } },
  });
  await run("update_saved_report", {
    id: scoped.reportId!,
    settings: { balanceType: "Budgeted" },
  });
  await page.goto(`${app.url}/?dashboard=${dashboard.id}`);
  await expectVisible(card(page, "Latest transactions").getByText("No transactions yet."));
  await expectVisible(
    card(page, "Budget net worth").getByRole("link", { name: "Budget net worth" }),
  );
  const unsupported = card(page, "Budget spending");
  await expectVisible(unsupported.getByText("This widget cannot be shown in reeve yet."));
  await expectHidden(unsupported.getByRole("link"));
  await unsupported.getByRole("button", { name: "Remove widget" }).click();
  await expectHidden(unsupported);
  await expectEventually(
    async () =>
      (await run("list_dashboard_pages", {}))
        .find((each) => each.id === dashboard.id)
        ?.widgets.some((widget) => widget.id === scoped.id),
    false,
  );
});

test("widget settings change one placement without remounting the others", async ({ app }) => {
  const { page, run } = app;
  const { summary } = await seedDashboard(app);
  const recent = card(page, "Latest transactions");
  await expectVisible(recent.getByText("Starting Balance"));
  await recent.evaluate((element) => element.setAttribute("data-mounted", "before-edit"));
  await card(page, "All money").hover();
  await page.getByRole("button", { name: "Actions for All money" }).click();
  await page.getByRole("menuitem", { name: "Widget settings…" }).click();
  const dialog = page.getByRole("dialog", { name: "Widget settings" });
  await dialog.getByRole("textbox", { name: "Title" }).fill("Cash on hand");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expectVisible(card(page, "Cash on hand").getByText("2,500.00"));
  await expectEventually(() => recent.getAttribute("data-mounted"), "before-edit");
  await expectEventually(
    async () => (await run("get_saved_report", { id: summary.reportId! })).name,
    "All money",
  );
});

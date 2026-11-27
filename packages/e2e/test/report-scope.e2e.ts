import type { Page } from "playwright-core";
import { expectEventually, expectHidden, expectVisible, test, type App } from "../src/fixtures.ts";

const offBudget = { mode: "offbudget" } as const;

/** Checking (1,000.00) on budget, Brokerage (5,000.00) off it, and a widget fixed to the latter. */
const seed = async ({ page, run, url }: App) => {
  await run("create_account", { name: "Checking", balance: 100_000 });
  await run("create_account", { name: "Brokerage", balance: 500_000, onBudget: false });
  const dashboard = await run("create_dashboard_page", { name: "Scoped" });
  const widget = await run("add_widget", {
    pageId: dashboard.id,
    type: "net-worth-card",
    width: 6,
    height: 3,
    config: {
      version: 1,
      title: "Investments",
      presentation: {},
      scope: { accounts: { mode: "fixed", value: offBudget } },
    },
  });
  await page.goto(`${url}/?dashboard=${dashboard.id}`);
  return { widget };
};

const card = (page: Page) => page.getByRole("region", { name: "Investments", exact: true });
const scopeParam = (page: Page) => new URL(page.url()).searchParams.get("scope");

for (const viewport of ["desktop", "phone"] as const)
  test(`a fixed scope shows on its widget and opens its report on ${viewport}`, async ({ app }) => {
    const { page, run } = app;
    if (viewport === "phone") await page.setViewportSize({ width: 390, height: 844 });
    const { widget } = await seed(app);
    await expectVisible(card(page).getByText("Off-budget accounts · Fixed"));
    await expectVisible(card(page).getByText("5,000.00").first());
    await expectHidden(card(page).getByText("6,000.00"));

    await card(page).getByRole("link", { name: "Investments" }).click();
    await page.waitForURL(/\/reports\/net-worth\?/);
    await expectEventually(async () => scopeParam(page), JSON.stringify(offBudget));
    const alert = page.getByRole("status").filter({ hasText: "Showing off-budget accounts" });
    await expectVisible(alert);
    await expectVisible(page.getByText("5,000.00").first());

    await alert.getByRole("button", { name: "Use saved accounts" }).click();
    await expectEventually(async () => scopeParam(page), null);
    await expectHidden(alert);
    await expectVisible(page.getByText("6,000.00").first());

    await expectEventually(async () => {
      const saved = await run("get_saved_report", { id: widget.reportId! });
      return "definition" in saved && saved.definition.scope.accounts.mode;
    }, "all");
  });

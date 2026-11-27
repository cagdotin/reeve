import { addDays, currentMonth, today } from "@reeve/contract/rules";
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { expectEventually, expectHidden, expectVisible, test, type App } from "../src/fixtures.ts";

const card = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

const money = (cents: number) =>
  `${cents < 0 ? "-" : ""}${(Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

/** A month with a budgeted category, spending in it, an uncategorized line and two schedules. */
const seedMonth = async ({ run }: App) => {
  const checking = await run("create_account", { name: "Checking", balance: 250_000 });
  await run("create_account", { name: "Savings", balance: 100_000, onBudget: false });
  const { id: groupId } = await run("create_category_group", { name: "Usual" });
  const groceries = await run("create_category", { name: "Groceries", groupId });
  await run("set_budget", { month: currentMonth(), category: groceries.id, amount: 30_000 });
  await run("create_transaction", {
    date: today(),
    account: checking.id,
    amount: -4_500,
    payee: "Market",
    category: groceries.id,
  });
  await run("create_transaction", {
    date: today(),
    account: checking.id,
    amount: -1_000,
    payee: "Kiosk",
  });
  const schedule = (name: string, days: number) =>
    run("create_schedule", {
      name,
      account: checking.id,
      amount: -12_000,
      amountOp: "is",
      date: addDays(today(), days),
    });
  await schedule("Phone bill", 5);
  await schedule("Car insurance", 60);
  return { checking, groceries };
};

test("a book with no accounts starts with one, then shows the month", async ({ app }) => {
  const { page, run } = app;
  await page.goto(app.url);
  await expectVisible(page.getByText("Start with an account"));
  await expectVisible(page.getByRole("button", { name: "Add account" }));
  await run("create_account", { name: "Checking", balance: 50_000 });
  await expectVisible(card(page, "Accounts").getByText("Checking"));
  await expectVisible(
    card(page, "Categories").getByText("Nothing budgeted or spent this month yet."),
  );
  await expectVisible(card(page, "Coming up").getByText("Nothing due in the next 31 days."));
  await expectVisible(page.getByText("Nothing is budgeted this month."));
});

for (const viewport of ["desktop", "phone"] as const)
  for (const theme of ["light", "dark"] as const)
    test(`Home's figures match the operations on ${viewport} in ${theme}`, async ({ app }) => {
      const { page, run } = app;
      await page.setViewportSize(
        viewport === "phone" ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      );
      await page.emulateMedia({ colorScheme: theme });
      await seedMonth(app);
      const budget = await run("get_budget", { month: currentMonth(), count: 1 });
      const summary = budget.months[0]!.summary;
      const accounts = await run("list_accounts", {});
      const net = accounts.reduce((sum, account) => sum + account.balance, 0);
      if (summary.type !== "envelope") throw new Error("The book should budget in envelopes");
      await page.goto(app.url);

      const text = (name: RegExp) => async () =>
        (await page.getByRole("link", { name }).first().textContent())?.replace(/\s+/g, " ");
      await expectEventually(text(/^To budget/), `To budget ${money(summary.toBudget)}`);
      await expectEventually(text(/^Uncategorized/), `Uncategorized ${budget.uncategorized.count}`);
      await expectVisible(card(page, "Categories").getByRole("button", { name: /Groceries 15%/ }));
      const balances = card(page, "Accounts");
      await expectVisible(balances.getByText(money(net), { exact: true }));
      await expectVisible(balances.getByRole("link", { name: /^Savings.*1,000\.00$/ }));
      const coming = card(page, "Coming up");
      await expectVisible(coming.getByText("Phone bill"));
      await expectHidden(coming.getByText("Car insurance"));
      await expectVisible(card(page, "Latest transactions").getByText("Kiosk"));
      await expectEventually(
        () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
      );

      await card(page, "Categories")
        .getByRole("button", { name: /Groceries/ })
        .click();
      const panel = page.getByRole("region", { name: "Panel", exact: true });
      await expectVisible(panel.getByText(/^Spent from Groceries in /));
      assert.equal(new URL(page.url()).pathname, "/", "a category opens its month in the pane");
    });

test("each Home card fails on its own and recovers on retry", async ({ app }) => {
  const { page } = app;
  await seedMonth(app);
  let failing = true;
  await page.route(/\/budget(\?|$)/, (route) =>
    failing
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ _tag: "StorageError", message: "The budget is unavailable" }),
        })
      : route.continue(),
  );
  await page.route(/\/scheduled-transactions(\?|$)/, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ _tag: "StorageError", message: "Schedules are unavailable" }),
    }),
  );
  await page.goto(app.url);
  const categories = card(page, "Categories");
  await expectVisible(categories.getByText("This widget could not be loaded."));
  await expectVisible(card(page, "Coming up").getByText("Schedules are unavailable"));
  await expectHidden(card(page, "Coming up").getByText(/Nothing due/));
  await expectVisible(card(page, "Accounts").getByText("Checking"));
  await expectVisible(card(page, "Latest transactions").getByText("Kiosk"));
  failing = false;
  await categories.getByRole("button", { name: "Retry" }).click();
  await expectVisible(categories.getByRole("button", { name: /Groceries 15%/ }));
});

test("the Today dashboard shows every Home widget and its settings", async ({ app }) => {
  const { page, run } = app;
  await seedMonth(app);
  const [today] = await run("list_dashboard_pages", {});
  await page.goto(`${app.url}/?dashboard=${today!.id}`);
  for (const name of ["This month", "Categories", "Accounts", "Coming up", "Latest transactions"])
    await expectHidden(card(page, name).getByText("This widget cannot be shown in reeve yet."));
  await expectVisible(card(page, "This month").getByRole("link", { name: /^To budget/ }));
  await expectVisible(card(page, "Categories").getByRole("button", { name: /Groceries 15%/ }));
  await expectVisible(card(page, "Accounts").getByRole("link", { name: /Checking/ }));
  const coming = card(page, "Coming up");
  await expectVisible(coming.getByText("Phone bill"));
  await expectHidden(coming.getByText("Car insurance"));

  await coming.hover();
  await page.getByRole("button", { name: "Actions for Coming up" }).click();
  await page.getByRole("menuitem", { name: "Widget settings…" }).click();
  const dialog = page.getByRole("dialog", { name: "Widget settings" });
  await dialog.getByRole("spinbutton", { name: "Days ahead" }).fill("90");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expectVisible(coming.getByText("Car insurance"));
  await expectEventually(
    async () => {
      const config = (await run("list_dashboard_pages", {}))[0]!.widgets.find(
        (widget) => widget.type === "upcoming-transactions",
      )?.config;
      return config && "settings" in config ? config.settings : undefined;
    },
    { daysAhead: 90 },
  );
  await coming.getByText("Phone bill").click();
  await page.waitForURL(`${app.url}/schedules`);
});

test("Home widgets can be added to and removed from any dashboard", async ({ app }) => {
  const { page, run } = app;
  await seedMonth(app);
  const dashboard = await run("create_dashboard_page", { name: "Mine" });
  await page.goto(`${app.url}/?dashboard=${dashboard.id}`);
  const added = ["This month", "Category pace", "Account balances", "Coming up"];
  for (const label of added) {
    await page.getByRole("button", { name: "Add widget" }).click();
    await page.getByRole("menuitem", { name: label, exact: true }).click();
  }
  await expectVisible(card(page, "Categories").getByRole("button", { name: /Groceries/ }));
  await expectVisible(card(page, "Accounts").getByRole("link", { name: /Checking/ }));
  await card(page, "Accounts").hover();
  await page.getByRole("button", { name: "Actions for Accounts" }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await expectHidden(card(page, "Accounts"));
  await expectVisible(card(page, "Categories"));
  await expectEventually(
    async () =>
      (await run("list_dashboard_pages", {}))
        .find((each) => each.id === dashboard.id)
        ?.widgets.map((widget) => widget.type)
        .toSorted(),
    ["category-pace", "home-insight", "upcoming-transactions"],
  );
});

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

const thisMonth = new Date().toISOString().slice(0, 7);
const monthName = new Date(`${thisMonth}-15`).toLocaleString("en-US", {
  month: "long",
  year: "numeric",
});
const pane = (page: Page) => page.locator('[data-slot="pane-title"]');
const records = (page: Page) =>
  page.getByRole("list", { name: "Transactions" }).getByRole("button");
const foodCell = (page: Page) =>
  page.getByRole("button", { name: /^Food, .*, show transactions$/ }).first();

/** Today with a spending widget, and this month's food bought plainly, in a split and on a card. */
const seed = async ({ run }: App) => {
  const groups = await run("list_categories", {});
  const category = (name: string) =>
    groups.flatMap((group) => group.categories).find((each) => each.name === name)!;
  const food = category("Food");
  const bills = category("Bills");
  const checking = await run("create_account", {
    name: "Checking",
    balance: 250_000,
    date: `${thisMonth}-01`,
  });
  const card = await run("create_account", { name: "Visa", type: "liability" });
  const day = `${thisMonth}-01`;
  await run("create_transaction", {
    account: checking.id,
    date: day,
    amount: -4200,
    payee: "Grocer",
    category: food.id,
  });
  await run("create_transaction", {
    account: checking.id,
    date: day,
    amount: -10000,
    payee: "Market",
    splits: [
      { amount: -5500, category: food.id },
      { amount: -4500, category: bills.id },
    ],
  });
  await run("create_transaction", {
    account: card.id,
    date: day,
    amount: -1800,
    payee: "Bakery",
    category: food.id,
  });
  const pageId = (await run("list_dashboard_pages", {}))[0]!.id;
  await run("add_widget", {
    pageId,
    type: "spending-card",
    report: { name: "Food pace" },
    width: 12,
    height: 3,
  });
  return { pageId, card };
};

test("a Spending figure opens its transactions in the pane, a row its editor, and an edit updates the figure", async ({
  app,
}) => {
  const { page } = app;
  await seed(app);
  await page.goto(`${app.url}/`);
  await page
    .getByRole("region", { name: "Food pace", exact: true })
    .getByRole("link", { name: "Food pace" })
    .click();
  await page.waitForURL(/\/reports\/spending\?report=/);
  const reportUrl = page.url();

  await expectText(foodCell(page), "-115.00");
  await foodCell(page).click();
  await expectText(pane(page), `Food · ${monthName}`);
  await expectCount(records(page), 3);
  await expectVisible(page.getByText(/of -\$?100\.00 split/));
  await expectVisible(page.getByText(/Spent on Food in .*115\.00/));

  await records(page).filter({ hasText: "Grocer" }).click();
  await expectVisible(page.getByRole("textbox", { name: "Payment" }));
  await page.getByRole("button", { name: "Back to transactions" }).click();
  await expectCount(records(page), 3);

  await records(page).filter({ hasText: "Grocer" }).click();
  const payment = page.getByRole("textbox", { name: "Payment" });
  await payment.fill("50.00");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expectCount(records(page), 3);
  await expectText(foodCell(page), "-123.00");
  await expectVisible(page.getByText(/Spent on Food in .*123\.00/));
  await expectVisible(page.getByRole("button", { name: "Average", exact: true }));
  await expectEventually(async () => page.url(), reportUrl);

  await page.getByRole("link", { name: "Open in register" }).click();
  await page.waitForURL(/\/accounts\/budgeted\?/);
  await expectEventually(async () => new URL(page.url()).searchParams.get("month"), thisMonth);
  await expectVisible(page.getByText("Grocer").first());
  await expectVisible(page.getByText("Market").first());
  await expectVisible(page.getByText("Bakery").first());

  await page.getByRole("button", { name: "Go back" }).click();
  await page.waitForURL(reportUrl);
  await expectHidden(pane(page));
  await expectText(foodCell(page), "-123.00");
});

test("a filtered report offers no register handoff, since the register cannot express its filters", async ({
  app,
}) => {
  const { page, run } = app;
  const { pageId, card } = await seed(app);
  const widget = await run("add_widget", {
    pageId,
    type: "spending-card",
    report: {
      name: "Card food",
      settings: { conditions: [{ field: "account", op: "is", value: card.id }] },
    },
    width: 12,
    height: 3,
  });
  await page.goto(`${app.url}/reports/spending?report=${widget.reportId}`);
  await expectText(foodCell(page), "-18.00");
  await foodCell(page).click();
  await expectCount(records(page), 1);
  await expectVisible(page.getByText(/under the report's filters/));
  await expectHidden(page.getByRole("link", { name: "Open in register" }));
});

test("a budget cell's spent figure opens its transactions in the pane, and an edit there updates the cell", async ({
  app,
}) => {
  const { page } = app;
  await seed(app);
  await page.goto(`${app.url}/budget`);
  await expectVisible(page.getByLabel(`Food spent in ${thisMonth}: -115.00`));
  await page.getByLabel(`Food spent in ${thisMonth}`).click();
  await expectText(pane(page), `Food · ${monthName}`);
  await expectCount(records(page), 3);
  await expectVisible(page.getByText(/Spent from Food in .*115\.00/));
  await expectVisible(page.getByText(/of -\$?100\.00 split/));

  await records(page).filter({ hasText: "Grocer" }).click();
  await page.getByRole("textbox", { name: "Payment" }).fill("50.00");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expectCount(records(page), 3);
  await expectVisible(page.getByLabel(`Food spent in ${thisMonth}: -123.00`));
  await expectVisible(page.getByText(/Spent from Food in .*123\.00/));
});

test("a parent category's cell lists its subcategories' transactions too, and a group's total every category's", async ({
  app,
}) => {
  const { page, run } = app;
  await seed(app);
  const groups = await run("list_categories", {});
  const usual = groups.find((group) => group.categories.some((each) => each.name === "Food"))!;
  const food = usual.categories.find((each) => each.name === "Food")!;
  const fruit = await run("create_category", { name: "Fruit", parent: food.id });
  const checking = (await run("list_accounts", {})).find((each) => each.name === "Checking")!;
  await run("create_transaction", {
    account: checking.id,
    date: `${thisMonth}-01`,
    amount: -700,
    payee: "Orchard",
    category: fruit.id,
  });

  await page.goto(`${app.url}/budget`);
  await page.getByLabel(`Food spent in ${thisMonth}`).click();
  await expectCount(records(page), 4);
  await expectVisible(page.getByText(/Spent from Food and its subcategories in .*122\.00/));
  await expectVisible(records(page).filter({ hasText: "Orchard" }).getByText(/Fruit/));

  await page.getByRole("button", { name: "Close panel" }).click();
  await page.getByLabel(`${usual.name} spent in ${thisMonth}`).click();
  await expectText(pane(page), `${usual.name} · ${monthName}`);
  await expectCount(records(page), 4);
  await expectVisible(
    page.getByText(new RegExp(`Spent from the ${usual.name} group in .*167\\.00`)),
  );
  await expectVisible(records(page).filter({ hasText: "Market" }).getByText("-100.00"));
});

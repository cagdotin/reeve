import { FEATURES, isPageEnabled } from "@reeve/contract/features";
import { today } from "@reeve/contract/rules";
import type { Page, Route } from "playwright-core";
import {
  expectCount,
  expectEventually,
  expectHidden,
  expectVisible,
  test,
} from "../src/fixtures.ts";
import type { App } from "../src/fixtures.ts";

const ACTIVITY = "**/api/books/*/rules/activity**";
const SPINNER = '[role="status"][aria-label="Loading"]';

const seed = async (run: App["run"]) => {
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  await run("create_account", { name: "Savings", balance: 50_000, onBudget: false });
  await run("create_transaction", {
    account: checking.id,
    date: today(),
    amount: -1_000,
    payee: "Grocer",
  });
  const rule = (notes: string) =>
    run("create_rule", {
      conditions: [{ field: "account", op: "is", value: checking.id }],
      actions: [{ op: "set", field: "notes", value: notes }],
      recategorize: false,
    });
  await rule("kept rule");
  return rule;
};

const failed = (route: Route) =>
  route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ _tag: "StorageError", message: "The disk is gone" }),
  });

const failActivity = (page: Page) => page.route(ACTIVITY, failed);

const countSpinners = (page: Page) =>
  page.evaluate((spinner) => {
    const state = window as unknown as { spinners: number };
    state.spinners = 0;
    new MutationObserver(() => {
      if (document.querySelector(spinner)) state.spinners += 1;
    }).observe(document.body, { childList: true, subtree: true });
  }, SPINNER);

const spinnersSeen = (page: Page) =>
  page.evaluate(() => (window as unknown as { spinners: number }).spinners);

const alert = (page: Page) => page.getByRole("alert");
const newRule = (page: Page) => page.getByRole("button", { name: "New rule" });

test("a page that cannot load says so in its alert, with its action shown and disabled", async ({
  app,
}) => {
  const { page, run } = app;
  await seed(run);
  await failActivity(page);
  await page.goto(`${app.url}/rules`);

  await expectVisible(newRule(page));
  await expectEventually(() => newRule(page).isDisabled(), true);
  await expectVisible(alert(page).filter({ hasText: "This could not be loaded" }));
  await expectCount(page.locator(SPINNER), 0);
  await expectEventually(() => newRule(page).isDisabled(), true);
});

test("an action waits, disabled, while the page's data is on its way", async ({ app }) => {
  const { page, run } = app;
  await seed(run);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(ACTIVITY, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(`${app.url}/rules`);

  await expectVisible(page.locator(SPINNER));
  await expectVisible(newRule(page));
  await expectEventually(() => newRule(page).isDisabled(), true);

  release();
  await expectEventually(() => newRule(page).isEnabled(), true);
  await expectHidden(page.locator(SPINNER));
});

for (const [address, api, action] of [
  ["/payees", "payees/activity", "New payee"],
  ["/schedules", "schedule-activity", "New schedule"],
  ["/receipts", "receipts/activity", "New receipt"],
  ["/products", "products/activity", "New product"],
  ["/", "dashboard", "Add widget"],
  ["/reports/tags", "tags", "New tag"],
] as const)
  test.skipIf(!isPageEnabled(address))(
    `${address} shows ${action} disabled until its data comes`,
    async ({ app }) => {
      const { page } = app;
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(`**/api/books/*/${api}**`, async (route) => {
        await held;
        await route.continue();
      });
      await page.goto(`${app.url}${address}`);
      const button = page.getByRole("button", { name: action, exact: true });

      await expectVisible(button);
      await expectEventually(() => button.isDisabled(), true);
      release();
      await expectEventually(() => button.isEnabled(), true);
    },
  );

test.skipIf(!FEATURES.purchases)(
  "a receipt's and a product's menus show disabled until they load",
  async ({ app }) => {
    const { page, run } = app;
    const { receipt } = await run("create_receipt", {
      date: today(),
      payee: "Corner Grocer",
      total: 1_500,
      lines: [{ text: "Bread", lineTotal: 1_500 }],
    });
    const product = await run("create_product", { name: "Bread" });
    for (const [address, api, menu] of [
      [`/receipts/${receipt.id}`, `receipts/${receipt.id}`, "Receipt actions"],
      [`/products/${product.id}`, `products/${product.id}`, "Product actions"],
    ] as const) {
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(`**/api/books/*/${api}`, async (route) => {
        await held;
        await route.continue();
      });
      await page.goto(`${app.url}${address}`);
      const button = page.getByRole("button", { name: menu });

      await expectVisible(button);
      await expectEventually(() => button.isDisabled(), true);
      release();
      await expectEventually(() => button.isEnabled(), true);
    }
  },
);

test("a failed refresh shows the alert over the rows it kept, and leaves when one succeeds", async ({
  app,
}) => {
  const { page, run } = app;
  const rule = await seed(run);
  await page.goto(`${app.url}/rules`);
  const kept = page.getByRole("main").getByText("kept rule").first();
  await expectVisible(kept);
  await countSpinners(page);

  await failActivity(page);
  await rule("first new rule");
  await expectVisible(alert(page).filter({ hasText: "This could not be refreshed" }));
  await expectVisible(kept);
  await expectEventually(() => newRule(page).isEnabled(), true);
  await expectEventually(() => spinnersSeen(page), 0);

  await page.unroute(ACTIVITY);
  await rule("second new rule");
  await expectHidden(alert(page).filter({ hasText: "This could not be refreshed" }));
  await expectVisible(page.getByRole("main").getByText("second new rule").first());
  await expectEventually(() => spinnersSeen(page), 0);
});

test("a scope change keeps the rows on the page until the next ones come, with no spinner", async ({
  app,
}) => {
  const { page, run } = app;
  await seed(run);
  await page.goto(`${app.url}/rules`);
  const kept = page.getByRole("main").getByText("kept rule").first();
  await expectVisible(kept);
  await countSpinners(page);

  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(ACTIVITY, async (route) => {
    await held;
    await route.continue();
  });
  await page.getByRole("button", { name: /^Accounts shown: / }).click();
  await page.getByRole("menuitemradio", { name: /^Checking/ }).click();
  await expectVisible(page.getByRole("button", { name: "Accounts shown: Checking" }));

  await expectVisible(kept);
  await expectEventually(() => newRule(page).isEnabled(), true);
  release();
  await expectEventually(() => spinnersSeen(page), 0);
});

test("an account page whose register cannot load says so, and shows it once one can", async ({
  app,
}) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  const register = "**/api/books/*/transactions**";
  await page.route(register, failed);
  await page.goto(`${app.url}/accounts/${checking.id}`);

  await expectVisible(alert(page).filter({ hasText: "This could not be loaded" }));
  await expectCount(page.locator(SPINNER), 0);
  await expectVisible(page.getByRole("button", { name: "Account actions" }));

  await page.unroute(register);
  await page.reload();
  await expectVisible(page.getByRole("main").getByText("Starting Balance").first());
  await expectCount(alert(page), 0);
});

test("an account's actions show disabled until the account loads", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/books/*/accounts**", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(`${app.url}/accounts/${checking.id}`);
  const menu = page.getByRole("button", { name: "Account actions" });

  await expectVisible(menu);
  await expectEventually(() => menu.isDisabled(), true);
  await expectEventually(() => page.getByRole("button", { name: "Add note" }).isDisabled(), true);
  release();
  await expectEventually(() => menu.isEnabled(), true);
  await expectEventually(() => page.getByRole("button", { name: "Add note" }).isEnabled(), true);
});

test("Budget fills the window while it loads, with its actions in the top bar, also on return", async ({
  app,
}) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/books/*/budget**", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(`${app.url}/budget`);
  const bar = page.getByRole("banner");
  const create = bar.getByRole("button", { name: "New", exact: true });
  const view = bar.getByRole("button", { name: /^Budget view/ });

  await expectVisible(create);
  await expectVisible(view);
  await expectEventually(() => create.isDisabled(), true);
  await expectEventually(
    () => page.getByRole("main").evaluate((main) => getComputedStyle(main).paddingLeft),
    "0px",
  );
  release();
  await expectEventually(() => create.isEnabled(), true);

  const rail = page.getByRole("navigation", { name: "Pages" });
  await rail.getByRole("link", { name: "Home", exact: true }).click();
  await expectCount(create, 0);
  await rail.getByRole("link", { name: "Budget", exact: true }).click();
  await expectEventually(() => create.isEnabled(), true);
  await expectVisible(view);
});

test("a budget that cannot load says so in its alert, not in a spinner", async ({ app }) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  await page.route("**/api/books/*/budget**", failed);
  await page.goto(`${app.url}/budget`);

  await expectVisible(alert(page).filter({ hasText: "This could not be loaded" }));
  await expectCount(page.locator(SPINNER), 0);
  await expectVisible(page.getByRole("button", { name: "New", exact: true }));
});

for (const [address, list, count] of [
  ["/settings/general", "Section", 5],
  ["/docs", "Documents", 0],
] as const)
  for (const folded of [false, true])
    test(`${address} lists its pages in the sidebar, opened directly with the sidebar ${folded ? "folded" : "open"}`, async ({
      app,
    }) => {
      const { page } = app;
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${app.url}/budget`);
      await page.evaluate(
        (value) => localStorage.setItem("reeve:sidebar-collapsed", value),
        folded ? "1" : "0",
      );
      await page.goto(`${app.url}${address}`);

      const sidebar = page.getByRole("complementary", { name: "Sidebar" });
      const links = sidebar.getByRole("navigation", { name: list }).getByRole("link");
      await expectVisible(links.first());
      if (count > 0) await expectCount(links, count);
      await expectVisible(sidebar.getByRole("button", { name: "Back to app" }));
    });

test("an address with no page still has a page's title and main", async ({ app }) => {
  const { page } = app;
  await page.goto(`${app.url}/no-such-page`);
  await expectVisible(page.getByRole("main").getByText("There is no such page."));
  await expectCount(page.getByRole("heading", { level: 1, name: "Not found" }), 1);
  await expectCount(page.getByRole("main"), 1);
});

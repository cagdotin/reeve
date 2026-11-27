import { today } from "@reeve/contract/rules";
import {
  expectCount,
  expectEventually,
  expectHidden,
  expectVisible,
  test,
} from "../src/fixtures.ts";
import type { Page } from "playwright-core";
import type { App } from "../src/fixtures.ts";

const PHONE = { width: 390, height: 844 };

const seed = async (run: App["run"]) => {
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  const savings = await run("create_account", {
    name: "Savings",
    balance: 50_000,
    onBudget: false,
  });
  const date = today();
  await run("create_transaction", { account: checking.id, date, amount: -1_000, payee: "Grocer" });
  await run("create_transaction", { account: savings.id, date, amount: -2_000, payee: "Broker" });
  const schedule = (name: string, account: string) =>
    run("create_schedule", { name, account, amount: -500, amountOp: "is", date });
  await schedule("Rent", checking.id);
  await schedule("Fund fee", savings.id);
  const everywhere = (notes: string, value: string) =>
    run("create_rule", {
      conditions: [{ field: "imported_payee", op: "is", value }],
      actions: [{ op: "set", field: "notes", value: notes }],
      recategorize: false,
    });
  await run("create_rule", {
    conditions: [{ field: "account", op: "is", value: checking.id }],
    actions: [{ op: "set", field: "notes", value: "checking rule" }],
    recategorize: false,
  });
  await run("create_rule", {
    conditions: [{ field: "account", op: "is", value: savings.id }],
    actions: [{ op: "set", field: "notes", value: "savings rule" }],
    recategorize: false,
  });
  await everywhere("never here", "Nobody");
  return { checking, savings };
};

const choose = async (page: Page, name: string) => {
  await page.getByRole("button", { name: /^Accounts shown: / }).click();
  await page.getByRole("menuitemradio", { name: new RegExp(`^${name}`) }).click();
};

const tab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Section" }).getByRole("link", { name, exact: true });

test("Accounts lands on all transactions and the old address follows", async ({ app }) => {
  const { page, run } = app;
  await seed(run);
  await page.goto(`${app.url}/`);
  await page
    .getByRole("navigation", { name: "Pages" })
    .getByRole("link", { name: "Accounts", exact: true })
    .click();
  await page.waitForURL(`${app.url}/accounts/all`);
  await expectVisible(page.getByRole("button", { name: "Accounts shown: All accounts" }));
  await expectVisible(page.getByRole("button", { name: "Grocer", exact: true }));
  await expectVisible(page.getByRole("button", { name: "Broker", exact: true }));

  await page.goto(`${app.url}/accounts`);
  await page.waitForURL(`${app.url}/accounts/all`);
});

test("the scope narrows all four tabs, stays set across them and survives a reload", async ({
  app,
}) => {
  const { page, run } = app;
  const { checking } = await seed(run);
  await page.goto(`${app.url}/accounts/all`);
  await choose(page, "Checking");
  await page.waitForURL(`${app.url}/accounts/${checking.id}`);
  await expectVisible(page.getByRole("button", { name: "Grocer", exact: true }));
  await expectHidden(page.getByRole("button", { name: "Broker", exact: true }));
  const label = page.getByRole("button", { name: "Accounts shown: Checking" });

  await tab(page, "Schedules").click();
  await page.waitForURL(`${app.url}/schedules?account=${checking.id}`);
  await expectVisible(label);
  await expectVisible(page.getByText("Rent").first());
  await expectCount(page.getByText("Fund fee"), 0);

  await tab(page, "Payees").click();
  await page.waitForURL(`${app.url}/payees?account=${checking.id}`);
  await expectVisible(label);
  await expectVisible(page.getByText("Grocer").first());
  await expectCount(page.getByText("Broker"), 0);

  await tab(page, "Rules").click();
  await page.waitForURL(`${app.url}/rules?account=${checking.id}`);
  await expectVisible(label);
  await expectCount(page.getByText("savings rule"), 0);
  await expectCount(page.getByText("never here"), 0);
  await expectVisible(page.getByText(/rule for every account has matched nothing here/));
  await page.getByRole("button", { name: "Show them" }).click();
  await expectVisible(page.getByText("never here").first());
  await expectVisible(page.getByLabel("Applies to every account").first());

  await page.reload();
  await expectVisible(label);
  await expectEventually(async () => new URL(page.url()).searchParams.get("account"), checking.id);
  await expectCount(page.getByText("savings rule"), 0);

  await choose(page, "All off-budget accounts");
  await expectVisible(
    page.getByRole("button", { name: "Accounts shown: All off-budget accounts" }),
  );
  await expectVisible(page.getByText("savings rule").first());

  await tab(page, "Transactions").click();
  await page.waitForURL(`${app.url}/accounts/offbudget`);
  await expectVisible(page.getByRole("button", { name: "Broker", exact: true }));
  await expectHidden(page.getByRole("button", { name: "Grocer", exact: true }));
});

for (const [tabName, box, before, after, term] of [
  ["Transactions", "Search transactions", "Grocer", "Broker", "ro"],
  ["Schedules", "Search schedules", "Rent", "Fund fee", "e"],
  ["Payees", "Search payees", "Grocer", "Broker", "ro"],
  ["Rules", "Search rules", "checking rule", "savings rule", "rule"],
] as const)
  test(`changing the account on ${tabName} swaps what is shown and nothing else`, async ({
    app,
  }) => {
    const { page, run } = app;
    const { checking, savings } = await seed(run);
    // Enough matching rows that the page scrolls, as scroll anchoring needs.
    if (tabName === "Transactions")
      for (let i = 0; i < 12; i += 1)
        for (const [account, payee] of [
          [checking.id, `Grocer ${i}`],
          [savings.id, `Broker ${i}`],
        ] as const)
          await run("create_transaction", { account, date: today(), amount: -100, payee });
    await page.setViewportSize({ width: 1440, height: 500 });
    await page.goto(`${app.url}/accounts/${checking.id}`);
    await tab(page, tabName).click();
    const search = page.getByRole("main").getByRole("searchbox", { name: box, exact: true });
    const trigger = page.getByRole("button", { name: /^Accounts shown: / });
    await search.fill(term);
    const row = (text: string) => page.getByRole("main").getByText(text).first();
    await expectVisible(row(before));

    await page.evaluate(() => {
      const state = window as unknown as { spinners: number };
      state.spinners = 0;
      new MutationObserver(() => {
        if (document.querySelector('[role="status"][aria-label="Loading"]')) state.spinners += 1;
      }).observe(document.body, { childList: true, subtree: true });
    });
    const mark = (element: Element) => {
      (element as unknown as { kept: boolean }).kept = true;
    };
    await search.evaluate(mark);
    await trigger.evaluate(mark);
    const scroller = page.locator('[data-slot="scroll-area-viewport"]:has([data-slot="page"])');
    await scroller.evaluate((node) => {
      node.scrollTop = 60;
    });
    // Measured from the scroller's top, since the alerts above it come and go with the scope.
    const place = async () =>
      Math.round(
        (await search.evaluate((element) => element.getBoundingClientRect().top)) -
          (await scroller.evaluate((node) => node.getBoundingClientRect().top)),
      );
    const placed = await place();

    await page.route("**/api/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.continue();
    });
    await choose(page, "All off-budget accounts");
    await expectVisible(row(before));
    await expectVisible(row(after));
    await expectCount(page.getByRole("main").getByText(before), 0);

    const kept = (element: Element) => (element as unknown as { kept?: boolean }).kept === true;
    await expectEventually(() => search.evaluate(kept), true);
    await expectEventually(() => trigger.evaluate(kept), true);
    await expectEventually(() => search.inputValue(), term);
    await expectEventually(
      () => page.evaluate(() => (window as unknown as { spinners: number }).spinners),
      0,
    );
    await expectEventually(place, placed);
  });

test("a new schedule on an account's page starts on that account", async ({ app }) => {
  const { page, run } = app;
  const { checking } = await seed(run);
  await page.goto(`${app.url}/schedules?account=${checking.id}`);
  await page.getByRole("button", { name: "New schedule" }).click();
  const panel = page.getByRole("region", { name: "Panel" });
  await expectVisible(panel.getByText("Checking").first());
});

test("the uncategorized queue reads as such and hands the other tabs the budget accounts", async ({
  app,
}) => {
  const { page, run } = app;
  await seed(run);
  await page.goto(`${app.url}/accounts/uncategorized`);
  await expectVisible(page.getByRole("button", { name: "Accounts shown: Uncategorized" }));
  await tab(page, "Payees").click();
  await page.waitForURL(`${app.url}/payees?account=budgeted`);
  await expectVisible(page.getByRole("button", { name: "Accounts shown: All budget accounts" }));
});

const slowly = (page: Page, url: string) =>
  page.route(url, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });

for (const [device, viewport] of [
  ["a desktop", { width: 1440, height: 900 }],
  ["a phone", PHONE],
] as const) {
  test(`on ${device}, the menu stays open while the page it was opened over arrives`, async ({
    app,
  }) => {
    const { page, run } = app;
    await run("create_account", { name: "Checking", balance: 100_000 });
    await page.setViewportSize(viewport);
    await page.goto(`${app.url}/budget`);
    const accounts = page
      .getByRole("navigation", { name: "Pages" })
      .getByRole("link", { name: "Accounts", exact: true });
    await expectVisible(accounts);
    await slowly(page, "**/assets/**");

    await accounts.click();
    await page.getByRole("button", { name: /^Accounts shown: / }).click();
    await expectVisible(page.getByRole("button", { name: "Add transaction" }));

    await page.getByRole("menuitemradio", { name: /^Checking/ }).click();
    await expectVisible(page.getByRole("button", { name: "Accounts shown: Checking" }));
  });

  test(`on ${device}, the menu stays open while a tab's data arrives`, async ({ app }) => {
    const { page, run } = app;
    await run("create_account", { name: "Checking", balance: 100_000 });
    await page.setViewportSize(viewport);
    await slowly(page, "**/api/**");
    await page.goto(`${app.url}/schedules`);

    await page.getByRole("button", { name: /^Accounts shown: / }).click();
    await expectEventually(
      () => page.getByRole("button", { name: "New schedule" }).isEnabled(),
      true,
    );

    await page.getByRole("menuitemradio", { name: /^Checking/ }).click();
    await expectVisible(page.getByRole("button", { name: "Accounts shown: Checking" }));
  });
}

test("an empty book offers its first account", async ({ app }) => {
  const { page } = app;
  await page.goto(`${app.url}/accounts/all`);
  await expectVisible(page.getByRole("button", { name: "Add your first account" }));
});

test("on a phone the scope is one menu away, with the book, the connection and Add account behind it", async ({
  app,
}) => {
  const { page, run } = app;
  const { checking } = await seed(run);
  await page.setViewportSize(PHONE);
  await page.goto(`${app.url}/accounts/all`);
  await choose(page, "Checking");
  await page.waitForURL(`${app.url}/accounts/${checking.id}`);
  await tab(page, "Schedules").click();
  await page.waitForURL(`${app.url}/schedules?account=${checking.id}`);

  await page.getByRole("button", { name: /^Accounts shown: / }).click();
  await expectVisible(page.getByRole("menuitem", { name: "Add account…" }));
  await page.getByRole("menuitem", { name: "Bank connections" }).click();
  await page.waitForURL(`${app.url}/settings/banks`);
});

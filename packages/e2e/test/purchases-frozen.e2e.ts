import { expectCount, expectEventually, expectVisible, test } from "../src/fixtures.ts";

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
])
  test(`purchases is absent at ${viewport.width}px, including direct links and background queries`, async ({
    app,
  }) => {
    const { page, run } = app;
    const account = await run("create_account", { name: "Checking", balance: 10000 });
    await run("create_transaction", {
      account: account.id,
      date: "2026-01-02",
      amount: -1000,
      payee: "Grocer",
    });
    const purchaseRequests: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/api/") && /receipt|product|item-categor|item-spending/.test(path))
        purchaseRequests.push(path);
    });
    await page.setViewportSize(viewport);
    await page.goto(`${app.url}/accounts/${account.id}`);
    await expectVisible(page.getByRole("main").getByText("Grocer", { exact: true }));
    await expectCount(page.getByRole("link", { name: "Purchases", exact: true }), 0);
    await expectCount(page.getByRole("button", { name: "Transaction actions" }), 0);
    await expectCount(page.getByRole("link", { name: /^Receipt,/ }), 0);

    await page.keyboard.press("ControlOrMeta+k");
    const search = page.getByPlaceholder(/Search pages, accounts/);
    await expectVisible(search);
    for (const term of [
      "Receipts",
      "Products",
      "Unassigned receipt lines",
      "Price changes",
      "Item spending",
    ]) {
      await search.fill(term);
      await expectCount(page.getByRole("option", { name: new RegExp(`^${term}`) }), 0);
    }
    await page.keyboard.press("Escape");

    await page.goto(`${app.url}/settings/general`);
    await expectVisible(page.getByRole("heading", { name: "Book", exact: true }));
    await expectCount(page.getByLabel("Apply receipts automatically"), 0);
    await page.goto(`${app.url}/reports`);
    await expectVisible(page.getByRole("heading", { level: 1, name: "All reports", exact: true }));
    await expectCount(page.getByRole("link", { name: /^Item spending/ }), 0);
    await page.getByRole("combobox", { name: "Report: All reports" }).click();
    await page.getByRole("combobox", { name: "Search reports" }).fill("Item");
    await expectVisible(page.getByText("No report matches"));
    await page.keyboard.press("Escape");

    for (const path of [
      "/receipts",
      "/receipts/old",
      "/products",
      "/products/old",
      "/reports/items",
    ]) {
      await page.goto(`${app.url}${path}`);
      await expectVisible(page.getByRole("main").getByText("There is no such page."));
      await expectCount(page.getByRole("heading", { level: 1, name: "Not found" }), 1);
    }
    await expectEventually(async () => purchaseRequests, []);
  });

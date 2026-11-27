import { FEATURES } from "@reeve/contract/features";
import {
  expectEventually,
  expectHidden,
  expectText,
  expectVisible,
  test as featureTest,
  type App,
} from "../src/fixtures.ts";

const test = featureTest.skipIf(!FEATURES.purchases);

const daysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** Milk (with a kind) dearer at Hofer and cheaper at Billa, plus things to fix. */
const seed = async ({ run }: App) => {
  const dairy = await run("create_item_category", { name: "Dairy" });
  const milk = await run("create_product", {
    name: "Milk",
    unit: "l",
    size: 1,
    sizeUnit: "l",
    itemCategoryId: dairy.id,
  });
  const oat = await run("create_product", { name: "Oat drink", unit: "l", parentId: milk.id });
  const rice = await run("create_product", { name: "Rice", unit: "kg", itemCategoryId: dairy.id });
  const bare = await run("create_product", { name: "Bare thing" });
  const twin = await run("create_product", { name: "bare-thing" });
  const jam = await run("create_product", { name: "Old jam" });
  const buy = (date: string, payee: string, lines: ReadonlyArray<Record<string, unknown>>) =>
    run("create_receipt", {
      date,
      payee,
      total: lines.reduce((sum, line) => sum + (line["lineTotal"] as number), 0),
      lines: lines as never,
    });
  await buy(daysAgo(120), "Hofer", [
    { text: "Milk", productId: milk.id, quantity: 1, lineTotal: 100 },
    { text: "Rice", productId: rice.id, quantity: 1, unit: "kg", lineTotal: 400 },
    { text: "Jam", productId: jam.id, lineTotal: 300 },
  ]);
  await buy(daysAgo(20), "Hofer", [
    { text: "Milk", productId: milk.id, quantity: 1, lineTotal: 150 },
    { text: "Rice", productId: rice.id, quantity: 2, unit: "kg", lineTotal: 600 },
    { text: "Bare", productId: bare.id, lineTotal: 90 },
    { text: "Oat", productId: oat.id, quantity: 1, unit: "l", lineTotal: 210 },
  ]);
  await buy(daysAgo(10), "Billa", [
    { text: "Milk", productId: milk.id, quantity: 1, lineTotal: 170 },
    { text: "PFAND", lineTotal: 25 },
    { text: "Butter block", lineTotal: 300 },
  ]);
  await buy(daysAgo(5), "Billa", [
    { text: "PFAND", lineTotal: 25 },
    { text: "Mystery", lineTotal: 75 },
  ]);
  return { dairy, milk, oat, rice, bare, twin };
};

test("the page says what got dearer, what it costs and what is open, each a way into the table", async ({
  app,
}) => {
  const { page, run } = app;
  await seed(app);
  await page.goto(`${app.url}/products`);

  const summary = page.getByRole("region", { name: "Summary" });
  await expectVisible(summary.getByText("Price movers"));
  const changes = page.getByRole("region", { name: "Price changes" });
  await expectVisible(changes.getByText("Dearer"));
  await expectVisible(changes.getByRole("button", { name: /^Milk/ }));
  await expectVisible(changes.getByRole("button", { name: /^Rice/ }));

  const row = (name: string) => page.getByRole("checkbox", { name: `Select ${name}` });
  await expectVisible(row("Milk"));
  await expectHidden(row("Oat drink"));
  await page.getByRole("button", { name: "Show the kinds of Milk" }).click();
  await expectVisible(row("Oat drink"));

  // A ranked row narrows the table, and again clears it.
  const products = page.getByRole("region", { name: "Top products" });
  const bar = products.getByRole("button", { name: /^Rice/ });
  await bar.click();
  await expectHidden(row("Milk"));
  await expectEventually(() => bar.getAttribute("aria-pressed"), "true");
  await bar.click();
  await expectVisible(row("Milk"));

  const categories = page.getByRole("region", { name: "Item categories" });
  await categories.getByRole("button", { name: /^No item category/ }).click();
  await expectHidden(row("Rice"));
  await categories.getByRole("button", { name: /^No item category/ }).click();

  // A check lists what it found, and the selection merges it away.
  const attention = page.getByRole("status");
  await attention.getByRole("button", { name: /likely duplicates/ }).click();
  await expectVisible(row("bare-thing"));
  await expectHidden(row("Milk"));
  await row("Bare thing").click();
  await row("bare-thing").click();
  await page.getByRole("button", { name: "Merge…" }).click();
  const dialog = page.getByRole("dialog");
  await expectText(dialog.getByRole("heading"), "Merge 2 products");
  await dialog.getByRole("combobox").click();
  await page.getByRole("option", { name: "Bare thing", exact: true }).click();
  await dialog.getByRole("button", { name: "Merge" }).click();
  await page.waitForURL(/\/products\/[^/?]+$/);
  await expectEventually(
    async () =>
      (await run("list_products", {})).products.some((each) => each.name === "bare-thing"),
    false,
  );

  // The range hides what was bought before it, and a search still finds it.
  await page.goto(`${app.url}/products`);
  await expectVisible(row("Milk"));
  await expectHidden(row("Old jam"));
  await expectVisible(page.getByText("1 more bought before this range"));
  await page.getByRole("searchbox", { name: "Search products" }).fill("jam");
  await expectVisible(row("Old jam"));
  await page.getByRole("searchbox", { name: "Search products" }).fill("");
  await page.getByRole("button", { name: "Show all time" }).click();
  await expectVisible(row("Old jam"));
  await expectText(page.getByRole("combobox", { name: "Date range" }), "All time");
  await page.getByRole("link", { name: "Item spending" }).click();
  await page.waitForURL(/\/reports\/items/);
});

test("the old addresses still lead to the moved prices and the unassigned lines", async ({
  app,
}) => {
  const { page } = app;
  await seed(app);
  await page.goto(`${app.url}/products?tab=changes`);
  await expectVisible(page.getByRole("button", { name: "Show all products" }));
  await expectVisible(page.getByRole("checkbox", { name: "Select Rice" }));
  await expectHidden(page.getByRole("checkbox", { name: "Select Bare thing" }));
  await page.getByRole("button", { name: "Show all products" }).click();
  await page.waitForURL(`${app.url}/products`);
  await expectVisible(page.getByRole("checkbox", { name: "Select Bare thing" }));

  await page.goto(`${app.url}/products?tab=unassigned`);
  await expectVisible(page.getByRole("button", { name: "Back to all products" }));
  await expectVisible(page.getByText("Mystery"));
  await page.getByRole("button", { name: "Back to all products" }).click();
  await page.waitForURL(`${app.url}/products`);
});

test("assigning a line takes a click, and lines printed alike go with it", async ({ app }) => {
  const { page, run } = app;
  const { rice } = await seed(app);
  await run("create_alias", { productId: rice.id, text: "Mystery" });
  await page.goto(`${app.url}/products`);

  await page
    .getByRole("region", { name: "Summary" })
    .getByRole("button", { name: "4 unassigned lines" })
    .click();
  await page.waitForURL(/tab=unassigned/);
  await expectVisible(page.getByText("× 2"));

  await page.getByRole("button", { name: "Assign Rice to Mystery" }).click();
  await expectHidden(page.getByText("Mystery"));
  await expectEventually(async () => (await run("list_unassigned_lines", {})).total, 3);

  // The picker makes a new product; it fills in the line printed alike at that store.
  await page.getByRole("button", { name: "Assign a product" }).first().click();
  await page.getByRole("searchbox", { name: "Search products" }).fill("Deposit");
  await page.getByRole("button", { name: "Create “Deposit”" }).click();
  await expectEventually(
    async () => (await run("list_products", { query: "Deposit" })).products.length,
    1,
  );
  await expectEventually(async () => (await run("list_unassigned_lines", {})).total < 3, true);
});

test("a product's page says where to buy, and its fields, aliases and kinds are easy to edit", async ({
  app,
}) => {
  const { page, run } = app;
  const { milk, dairy } = await seed(app);
  await run("create_alias", { productId: milk.id, text: "VOLLMILCH" });
  await page.goto(`${app.url}/products/${milk.id}`);

  const price = page.getByRole("region", { name: "Price" });
  await expectVisible(price.getByText("Latest price"));
  await expectVisible(price.getByText(/Buy at Billa/));
  const stores = page.getByRole("region", { name: "Cheapest stores" });
  const billa = stores.getByRole("button", { name: /^Billa/ });
  await billa.click();
  await expectVisible(page.getByRole("button", { name: "Show every store" }));
  await expectVisible(page.getByRole("link", { name: /^Receipt of / }).first());
  await page.getByRole("button", { name: "Show every store" }).click();
  await page
    .getByRole("link", { name: /^Receipt of / })
    .first()
    .click();
  await page.waitForURL(/\/receipts\//);

  await page.goto(`${app.url}/products/${milk.id}`);
  const details = page.getByRole("region", { name: "Details" });
  await expectVisible(details.getByText("Dairy"));
  await details.getByRole("button", { name: "Edit…" }).click();
  const form = page.getByRole("dialog");
  await form.getByRole("textbox", { name: "Notes" }).fill("Fresh only");
  await form.getByRole("textbox", { name: "Notes" }).press("Enter");
  await form.getByRole("button", { name: "Done" }).click();
  await expectVisible(details.getByText("Fresh only"));
  await expectEventually(
    async () => (await run("get_product", { id: milk.id })).itemCategoryId,
    dairy.id,
  );

  const names = page.getByRole("region", { name: "Names" });
  await names.getByRole("button", { name: "Aliases", exact: true }).click();
  await expectVisible(names.getByText("VOLLMILCH"));
  await names.getByRole("button", { name: "Add alias" }).click();
  await page.getByRole("textbox", { name: "Alias text" }).fill("MILCH 1L");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expectVisible(names.getByText("MILCH 1L"));
  await names.getByRole("button", { name: "Reject VOLLMILCH" }).click();
  await expectEventually(
    async () =>
      (await run("get_product", { id: milk.id })).aliases.find((each) => each.text === "VOLLMILCH")
        ?.rejected,
    true,
  );
  await names.getByRole("button", { name: "Delete MILCH 1L" }).click();
  await expectHidden(names.getByText("MILCH 1L"));

  await names.getByRole("button", { name: "Kinds", exact: true }).click();
  await expectVisible(names.getByRole("link", { name: "Oat drink" }));
  await names.getByRole("button", { name: "Take Oat drink out" }).click();
  await expectHidden(names.getByRole("link", { name: "Oat drink" }));
  await names.getByRole("combobox").click();
  await page.getByRole("option", { name: "Oat drink" }).click();
  await expectVisible(names.getByRole("link", { name: "Oat drink" }));
});

test("deleting a product says what becomes of its lines, and they do go back", async ({ app }) => {
  const { page, run } = app;
  const { oat, milk } = await seed(app);
  const before = (await run("list_unassigned_lines", {})).total;
  await page.goto(`${app.url}/products/${milk.id}`);
  await page.getByRole("button", { name: "Product actions" }).click();
  await page.getByRole("menuitem", { name: "Delete product…" }).click();
  const dialog = page.getByRole("dialog");
  await expectVisible(dialog.getByText(/3 purchase lines stay on their receipts/));
  await expectVisible(dialog.getByText(/go back to the unassigned lines/));
  await expectVisible(dialog.getByText(/1 purchase line on its kinds stays on its kind/));
  await expectVisible(dialog.getByText(/Any without an item category of its own loses Dairy/));
  await expectVisible(dialog.getByText("You can undo this."));

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expectEventually(async () => (await run("get_product", { id: milk.id })).name, "Milk");

  await page.getByRole("button", { name: "Product actions" }).click();
  await page.getByRole("menuitem", { name: "Delete product…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await page.waitForURL(`${app.url}/products`);
  await expectEventually(async () => (await run("list_unassigned_lines", {})).total, before + 3);
  await expectEventually(async () => (await run("get_product", { id: oat.id })).parentId, null);
  await run("undo", {});
  await expectEventually(async () => (await run("get_product", { id: milk.id })).name, "Milk");
});

test("new products, archiving, and the item category tree", async ({ app }) => {
  const { page, run } = app;
  const { rice } = await seed(app);
  await page.goto(`${app.url}/products`);

  const rows = (name: string) => page.getByRole("checkbox", { name: `Select ${name}` });
  await page.getByRole("button", { name: `Rice options` }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expectHidden(rows("Rice"));
  await expectEventually(async () => (await run("get_product", { id: rice.id })).archived, true);
  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByRole("button", { name: "Status" }).click();
  await page.getByRole("checkbox", { name: /^Archived/ }).click();
  await page.keyboard.press("Escape");
  await expectVisible(rows("Rice"));

  await page.getByRole("button", { name: "Item categories" }).click();
  const tree = page.getByRole("dialog");
  await expectVisible(tree.getByText("Dairy"));
  await page.keyboard.press("Escape");
  await expectHidden(tree);

  await page.getByRole("button", { name: "New product" }).click();
  const form = page.getByRole("dialog");
  await form.getByRole("textbox", { name: "Name" }).fill("Saffron");
  await form.getByRole("button", { name: "Create product" }).click();
  await page.waitForURL(/\/products\/[^/?]+$/);
  await expectVisible(page.getByText(/No purchases yet/).first());
});

test("a search finds aliases, and Archive on a mixed selection archives all of it", async ({
  app,
}) => {
  const { page, run } = app;
  const { milk, oat, rice } = await seed(app);
  await run("create_alias", { productId: rice.id, text: "BASMATI 1KG" });
  await run("update_product", { id: milk.id, archived: true });
  await page.goto(`${app.url}/products`);
  const search = page.getByRole("searchbox", { name: "Search products" });
  await search.fill("basmati");
  await expectVisible(page.getByRole("link", { name: "Rice", exact: true }));
  await expectHidden(page.getByRole("link", { name: "Bare thing", exact: true }));
  await search.fill("");

  await page.getByRole("button", { name: "Show the kinds of Milk" }).click();
  await page.getByRole("checkbox", { name: "Select Milk" }).click();
  await page.getByRole("checkbox", { name: "Select Oat drink" }).click();
  await expectVisible(page.getByRole("button", { name: "Unarchive" }));
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await expectEventually(async () => (await run("get_product", { id: oat.id })).archived, true);
  await expectEventually(async () => (await run("get_product", { id: milk.id })).archived, true);
});

import { today } from "@reeve/contract/rules";
import { FEATURES } from "@reeve/contract/features";
import {
  expectEventually,
  expectHidden,
  expectText,
  expectValues,
  expectVisible,
  openAccount,
  test as featureTest,
} from "../src/fixtures.ts";

const test = featureTest.skipIf(!FEATURES.purchases);

test("a receipt linked to a transaction and applied splits it in the register", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  await run("create_transaction", {
    account: checking.id,
    date: today(),
    amount: -3_000,
    payee: "Corner Grocer",
  });

  await page.goto(`${app.url}/receipts`);
  await page.getByRole("button", { name: "New receipt" }).click();
  const create = page.getByRole("dialog", { name: "New receipt" });
  await create.getByRole("combobox", { name: "Store" }).fill("Corner Grocer");
  await page.keyboard.press("Tab");
  await create.getByRole("textbox", { name: "Total paid" }).fill("30.00");
  await create.getByRole("button", { name: "Create receipt" }).click();

  const addLine = async (text: string, total: string) => {
    await page.getByRole("textbox", { name: "New line text" }).fill(text);
    await page.getByRole("textbox", { name: "New line total" }).fill(total);
    await page.getByRole("textbox", { name: "New line total" }).press("Enter");
    await expectVisible(page.getByRole("group", { name: text }));
  };
  const budgetCategory = async (line: string, category: string) => {
    const select = page
      .getByRole("group", { name: line })
      .getByRole("combobox", { name: "Budget category" });
    await select.click();
    await page.getByRole("option", { name: category, exact: true }).click();
    await expectText(select, category);
  };
  await addLine("Bread", "10.00");
  await addLine("Dish soap", "20.00");
  await budgetCategory("Bread", "Food");
  await budgetCategory("Dish soap", "General");

  await page.getByRole("button", { name: "Link", exact: true }).click();
  await expectVisible(page.getByRole("button", { name: "Unlink" }));
  await page.getByRole("button", { name: "Apply to transaction" }).click();
  await expectVisible(page.getByText("The transaction carries this split."));

  await openAccount(page, "Checking", "970.00");
  await expectVisible(page.getByRole("button", { name: "Split (2)" }));

  // Opening the row shows the split lines the receipt wrote.
  await page.getByRole("button", { name: "Split (2)" }).click();
  await expectValues(page.getByLabel("Split category", { exact: true }), ["Food", "General"]);
  await expectValues(page.getByLabel("Split amount", { exact: true }), ["-10.00", "-20.00"]);
});

test("with the setting on, a receipt applies itself when it is ready", async ({ app }) => {
  const { page, run } = app;
  await page.goto(`${app.url}/settings/general`);
  const toggle = page.getByRole("switch", { name: "Apply receipts automatically" });
  await toggle.click();
  await expectVisible(
    page.getByRole("switch", { name: "Apply receipts automatically", checked: true }),
  );

  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  const tx = await run("create_transaction", {
    account: checking.id,
    date: today(),
    amount: -1_500,
    payee: "Corner Grocer",
  });
  const groups = await run("list_categories", {});
  const food = groups[0]!.categories.find((category) => category.name === "Food");
  const { receipt } = await run("create_receipt", {
    date: today(),
    payee: "Corner Grocer",
    total: 1_500,
    lines: [{ text: "Bread", lineTotal: 1_500, budgetCategoryId: food!.id }],
    payments: [{ transactionId: tx.id }],
  });

  await page.goto(`${app.url}/receipts/${receipt.id}`);
  await expectVisible(page.getByText("Applied automatically: the transaction carries this split."));
});

test("the pipeline, checks and cards narrow the list, on the server", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  const groups = await run("list_categories", {});
  const food = groups[0]!.categories.find((category) => category.name === "Food")!;
  await run("create_receipt", {
    date: today(),
    payee: "Corner Grocer",
    total: 1000,
    lines: [{ text: "Bread", lineTotal: 880, budgetCategoryId: food.id }],
  });
  await run("create_receipt", {
    date: today(),
    payee: "Hardware Barn",
    total: 500,
    lines: [{ text: "Screws", lineTotal: 500, budgetCategoryId: food.id }],
  });
  const tx = await run("create_transaction", {
    account: checking.id,
    date: today(),
    amount: -700,
    payee: "Corner Grocer",
  });
  await run("create_receipt", {
    date: today(),
    payee: "Corner Grocer",
    total: 700,
    lines: [{ text: "Tea", lineTotal: 700, budgetCategoryId: food.id }],
    payments: [{ transactionId: tx.id }],
  });

  await page.goto(`${app.url}/receipts`);
  const filters = page.getByTestId("receipt-filters");
  await expectVisible(filters.getByText("3 of 3"));

  const toMatch = page.getByRole("button", { name: "1 match next" });
  await toMatch.click();
  await expectVisible(filters.getByText("1 of 1"));
  await expectVisible(page.getByRole("link", { name: "Hardware Barn" }));
  await toMatch.click();
  await expectVisible(filters.getByText("3 of 3"));

  await page.getByRole("button", { name: /1 don't add up/ }).click();
  await expectVisible(filters.getByText("1 of 1"));
  await expectVisible(page.getByRole("button", { name: "Stop showing doesn't add up" }));
  await page.getByRole("button", { name: "Stop showing doesn't add up" }).click();
  await expectVisible(filters.getByText("3 of 3"));

  await page.getByRole("button", { name: /^Hardware Barn, / }).click();
  await expectVisible(filters.getByText("1 of 1"));
  await page.getByRole("button", { name: /^Hardware Barn, / }).click();

  await page.getByRole("searchbox", { name: "Search lines, notes, stores" }).fill("tea");
  await expectVisible(filters.getByText("1 of 1"));
  await page.getByRole("searchbox", { name: "Search lines, notes, stores" }).fill("");
  await expectVisible(filters.getByText("3 of 3"));

  await page.getByRole("button", { name: "Sort by Total" }).click();
  const first = page.getByTestId("receipt-filters").locator("~ div").first();
  await expectVisible(first.getByText("10.00"));

  // The steps are in words on the mark.
  await expectVisible(
    page.getByRole("button", { name: "Unbalanced, Unmatched, Categorized, Not applied" }),
  );

  await page.keyboard.press("n");
  await expectVisible(page.getByRole("dialog", { name: "New receipt" }));
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Auto-match" }).click();
  await expectVisible(page.getByText("Linked 0 receipts"));

  const row = page.getByRole("button", { name: /^Options for Hardware Barn/ });
  await row.click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await expectVisible(page.getByRole("dialog").getByText(/the ledger does not change/));
  await page.getByRole("dialog").getByRole("button", { name: "Delete receipt" }).click();
  await expectVisible(filters.getByText("2 of 2"));
});

test("a receipt's summary follows the typing, and adjusting balances it", async ({ app }) => {
  const { page, run } = app;
  const { receipt } = await run("create_receipt", {
    date: today(),
    payee: "Corner Grocer",
    total: 1000,
    lines: [{ text: "Bread", lineTotal: 1000 }],
  });
  await page.goto(`${app.url}/receipts/${receipt.id}`);
  const summary = page.getByRole("region", { name: "Summary" });
  await expectVisible(summary.getByRole("heading", { name: "Link a payment" }));

  const total = page.getByRole("group", { name: "Bread" }).getByRole("textbox", {
    name: "Line total",
  });
  await total.fill("8.80");
  await expectVisible(summary.getByRole("heading", { name: "1.20 off" }));
  await total.press("Enter");

  await expectVisible(page.getByText("1.20 missing from the total."));
  await page.getByRole("button", { name: "Balance with an adjustment" }).click();
  await expectVisible(page.getByText("The lines and adjustments add up to the total."));
  await expectVisible(summary.getByRole("heading", { name: "Link a payment" }));
});

test("a photo can be added, opened and removed", async ({ app }) => {
  const { page, run } = app;
  const { receipt } = await run("create_receipt", { date: today(), total: 100 });
  await page.goto(`${app.url}/receipts/${receipt.id}`);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/7yMK/gAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.getByLabel("Photo file").setInputFiles({
    name: "till.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expectVisible(page.getByRole("img", { name: "till.png" }));
  await page.getByRole("img", { name: "till.png" }).click();
  await expectVisible(page.getByRole("button", { name: "Zoom in" }));
  await page.keyboard.press("Escape");
  await page.getByRole("region", { name: "Photo" }).hover();
  await page.getByRole("button", { name: "Delete photo" }).click();
  await expectVisible(page.getByText("No photo of this receipt."));
});

test("deleting asks first, says the split stays, and leaves the split", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  const tx = await run("create_transaction", {
    account: checking.id,
    date: today(),
    amount: -3_000,
    payee: "Corner Grocer",
  });
  const groups = await run("list_categories", {});
  const named = (name: string) => groups[0]!.categories.find((each) => each.name === name)!.id;
  const { receipt } = await run("create_receipt", {
    date: today(),
    payee: "Corner Grocer",
    total: 3_000,
    lines: [
      { text: "Bread", lineTotal: 1_000, budgetCategoryId: named("Food") },
      { text: "Soap", lineTotal: 2_000, budgetCategoryId: named("General") },
    ],
    payments: [{ transactionId: tx.id }],
  });
  await run("apply_receipt_to_transaction", { id: receipt.id });

  await page.goto(`${app.url}/receipts/${receipt.id}`);
  await page.getByRole("button", { name: "Receipt actions" }).click();
  await page.getByRole("menuitem", { name: "Delete receipt…" }).click();
  const dialog = page.getByRole("dialog");
  await expectVisible(dialog.getByText(/keeps the split this receipt wrote/));
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expectVisible(page.getByRole("heading", { name: "Finished" }));

  await page.getByRole("button", { name: "Receipt actions" }).click();
  await page.getByRole("menuitem", { name: "Delete receipt…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete receipt" }).click();
  await page.waitForURL(`${app.url}/receipts`);
  await expectVisible(page.getByText(/Receipts itemize what a transaction bought/));

  await expectEventually(async () => {
    const { rows } = await run("list_transactions", { account: checking.id, limit: 10 });
    const row = rows.find((each) => each.transactionId === tx.id);
    return JSON.stringify(row).includes("Food");
  }, true);
});

test("a search looks across all time, and filters offer it", async ({ app }) => {
  const { page, run } = app;
  const old = new Date(Date.parse(today()) - 200 * 86_400_000).toISOString().slice(0, 10);
  await run("create_receipt", {
    date: old,
    payee: "Corner Grocer",
    total: 500,
    lines: [{ text: "Old cheese", lineTotal: 500 }],
  });
  await run("create_receipt", {
    date: today(),
    payee: "Hardware Barn",
    total: 900,
    lines: [{ text: "Screws", lineTotal: 900 }],
  });
  await page.goto(`${app.url}/receipts`);
  const filters = page.getByTestId("receipt-filters");
  await expectVisible(filters.getByText("1 of 1"));

  const search = page.getByRole("searchbox", { name: "Search lines, notes, stores" });
  await search.fill("cheese");
  await expectVisible(page.getByRole("link", { name: "Corner Grocer" }));
  await expectVisible(filters.getByText("Searching all time"));
  await search.fill("nothing like this");
  await expectVisible(page.getByText("No receipt matches, in all time."));
  await search.fill("");
  await expectHidden(filters.getByText("Searching all time"));

  await page.getByRole("button", { name: "Hardware Barn, " }).first().waitFor();
  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByRole("checkbox", { name: "Matched, not applied" }).click();
  await page.keyboard.press("Escape");
  await expectVisible(page.getByText("No receipt matches in this range."));
  await page.getByRole("button", { name: "Show all time" }).click();
  await expectVisible(filters.getByText("0 of 0"));
  await expectHidden(page.getByRole("button", { name: "Show all time" }));
});

test("a receipt's total can't be zero, wherever it is typed", async ({ app }) => {
  const { page, run } = app;
  const refused = await run("create_receipt", { date: today(), total: 0 }).then(
    () => "created",
    (error: unknown) => String(error),
  );
  if (!refused.includes("can't be zero"))
    throw new Error(`A zero total was not refused: ${refused}`);

  const { receipt } = await run("create_receipt", { date: today(), total: 100 });
  await page.goto(`${app.url}/receipts/${receipt.id}`);
  await expectVisible(page.getByText("A cash purchase needs a transaction on a cash account"));
  const total = page.getByRole("textbox", { name: "Total paid" });
  await total.fill("0");
  await total.press("Enter");
  await expectVisible(page.getByText("A receipt's total can't be zero: enter what was paid"));
  await expectEventually(async () => (await run("get_receipt", { id: receipt.id })).total, 100);

  await page.goto(`${app.url}/receipts`);
  await page.getByRole("button", { name: "New receipt" }).click();
  await page.getByPlaceholder("0.00").fill("0");
  await expectVisible(page.getByRole("button", { name: "Create receipt", disabled: true }));
  await page.getByPlaceholder("0.00").fill("1.50");
  await expectVisible(page.getByRole("button", { name: "Create receipt", disabled: false }));
});

test("custom dates narrow the table and the figures over it", async ({ app }) => {
  const { page, run } = app;
  await run("create_receipt", { date: "2024-02-10", payee: "Old Shop", total: 1200 });
  await run("create_receipt", { date: "2024-06-10", payee: "Later Shop", total: 3400 });
  await page.goto(`${app.url}/receipts`);
  const filters = page.getByTestId("receipt-filters");
  await page.getByRole("combobox", { name: "Date range" }).click();
  await page.getByRole("option", { name: "Custom dates" }).click();
  await filters.getByRole("textbox", { name: "From" }).fill("2024-02-01");
  await filters.getByRole("textbox", { name: "To" }).fill("2024-02-29");
  await expectVisible(filters.getByText("1 of 1"));
  await expectVisible(page.getByRole("link", { name: "Old Shop" }));
  await expectHidden(page.getByRole("link", { name: "Later Shop" }));

  await page.getByRole("combobox", { name: "Date range" }).click();
  await page.getByRole("option", { name: "All time" }).click();
  await expectHidden(filters.getByRole("textbox", { name: "From" }));
  await expectVisible(filters.getByText("2 of 2"));
});

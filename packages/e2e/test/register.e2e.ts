import { addDays, addMonths, currentMonth, today } from "@reeve/contract/rules";
import assert from "node:assert/strict";
import {
  expectAccountBalance,
  expectCount,
  expectEventually,
  expectHidden,
  expectVisible,
  test,
} from "../src/fixtures.ts";

const monthLabelOf = (month: string) =>
  new Date(`${month}-15T12:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

test("a starting balance takes a new amount and stays a starting balance", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  const { transactionId } = (await run("list_transactions", { account: checking.id })).rows[0]!;

  await page.goto(`${app.url}/accounts/${checking.id}`);
  await expectAccountBalance(page, "Checking", "1,000.00");
  await page.getByRole("button", { name: "Opening Balances" }).click();
  await page.getByRole("textbox", { name: "Deposit" }).fill("1,250.00");
  await page.getByRole("button", { name: "Save" }).click();

  await expectAccountBalance(page, "Checking", "1,250.00");
  await expectVisible(page.getByRole("button", { name: "Opening Balances" }));
  const { postings } = await run("get_transaction", { id: transactionId });
  const ledger = await run("list_ledger_accounts", {});
  const opening = ledger.find((each: { system: string | null }) => each.system === "opening");
  assert.deepEqual(
    postings.map((each: { accountId: string }) => each.accountId),
    [checking.id, opening!.id],
  );
});

test("a transaction added in the register updates the balance and the category's spending", async ({
  app,
}) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  const month = today().slice(0, 7);

  await page.goto(`${app.url}/accounts/${checking.id}`);
  await expectAccountBalance(page, "Checking", "1,000.00");

  await page.getByRole("button", { name: "Add transaction" }).click();
  await page.getByRole("combobox", { name: "Payee" }).fill("Corner Grocer");
  await page.keyboard.press("Tab");
  await page.getByRole("combobox", { name: "Category" }).fill("Food");
  await page.getByRole("option", { name: "Food" }).click();
  await page.getByRole("textbox", { name: "Payment" }).fill("12.34");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await expectAccountBalance(page, "Checking", "987.66");
  await expectVisible(page.getByRole("button", { name: "Corner Grocer" }));

  await page.getByRole("link", { name: "Budget", exact: true }).click();
  await expectVisible(page.getByLabel(`Food spent in ${month}: -12.34`));
  await expectVisible(page.getByRole("button", { name: "To Budget 1,000.00" }));
});

test("the balances sit right over the rows, and a check narrows the register", async ({ app }) => {
  const { page, run } = app;
  const month = currentMonth();
  const last = addMonths(month, -1);
  const checking = await run("create_account", {
    name: "Checking",
    balance: 100_000,
    date: `${addMonths(month, -3)}-01`,
  });
  const groups = await run("list_categories", {});
  const food = groups.find((group) => !group.isIncome)!.categories[0]!;
  await run("create_transaction", {
    account: checking.id,
    date: `${last}-05`,
    amount: -2_000,
    payee: "Corner Grocer",
    category: food.id,
    cleared: true,
  });
  await run("create_transaction", {
    account: checking.id,
    date: `${last}-06`,
    amount: -700,
    payee: "Mystery Shop",
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${app.url}/accounts/${checking.id}`);
  const rows = page.getByRole("button", { name: "Corner Grocer", exact: true });
  await expectVisible(rows);
  const balances = page.getByLabel("Balances");
  await expectVisible(balances.getByText("973.00", { exact: true }));
  await expectVisible(balances.getByText("Cleared"));
  await expectVisible(balances.getByText("Uncleared"));
  for (const gone of ["Summary", "Balance", "Where the money went", "Coming up"])
    await expectHidden(page.getByRole("region", { name: gone }));

  // No dashboard above the work: the filters and the first rows are in the first screen.
  // No dashboard above the work: the balances line runs straight into the filters, then the rows.
  const box = async (locator: typeof rows) => (await locator.boundingBox())!;
  await expectEventually(async () => {
    const [line, filters, row] = await Promise.all([
      box(balances),
      box(page.getByTestId("register-filters")),
      box(rows),
    ]);
    return Math.abs(line.y + line.height - filters.y) < 2 && row.y < 450;
  }, true);

  // The running balance shows until a filter makes it meaningless.
  const table = page.getByTestId("register-filters");
  await expectVisible(table.getByText("Balance", { exact: true }));

  // A check, as a filter of its own in the address that a reload keeps.
  const check = page.getByRole("button", { name: "1 uncategorized" });
  await check.click();
  await expectVisible(page.getByRole("button", { name: "Mystery Shop", exact: true }));
  await expectHidden(rows);
  await expectHidden(table.getByText("Balance", { exact: true }));
  await page.reload();
  await expectVisible(page.getByRole("button", { name: "Mystery Shop", exact: true }));
  await expectHidden(rows);
  await page.getByRole("button", { name: "1 uncategorized" }).click();
  await expectVisible(rows);
});

test("adding, editing, clearing and bulk actions still work below the balances", async ({
  app,
}) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  const date = today();
  for (const payee of ["First Shop", "Second Shop"])
    await run("create_transaction", { account: checking.id, date, amount: -1_000, payee });

  await page.goto(`${app.url}/accounts/${checking.id}`);
  await expectVisible(page.getByRole("button", { name: "First Shop", exact: true }));

  // The hotkey opens the panel with a new transaction, and Escape closes it.
  const panel = page.getByRole("region", { name: "Panel" });
  await page.keyboard.press("n");
  await expectVisible(panel.getByRole("combobox", { name: "Payee" }));
  await page.keyboard.press("Escape");
  await expectHidden(panel.getByRole("combobox", { name: "Payee" }));

  // A row opens in the panel, to edit there.
  await page.getByRole("button", { name: "First Shop", exact: true }).click();
  await panel.getByRole("textbox", { name: "Notes" }).fill("For the party");
  await panel.getByRole("button", { name: "Save" }).click();
  await expectVisible(page.getByRole("button", { name: "For the party" }));
  await expectHidden(panel.getByRole("textbox", { name: "Notes" }));

  // The cleared mark, on the first row only.
  await expectCount(page.getByRole("button", { name: "Cleared", exact: true }), 1);
  await page.getByRole("button", { name: "Not cleared" }).first().click();
  await expectCount(page.getByRole("button", { name: "Cleared", exact: true }), 2);

  // Selecting swaps the filters for what can be done to the selection; duplicating is not one.
  await page.getByRole("checkbox", { name: "Select all" }).click();
  await expectVisible(page.getByText("3 selected"));
  await expectHidden(page.getByRole("button", { name: "Duplicate" }));
  await page.keyboard.press("Escape");
  await expectHidden(page.getByText("3 selected"));
  await expectHidden(page.getByRole("button", { name: "Show the overview" }));
  await expectHidden(page.getByRole("button", { name: "Hide the overview" }));
});

test("a month's checkbox selects every transaction in it", async ({ app }) => {
  const { page, run } = app;
  const month = currentMonth();
  const last = addMonths(month, -1);
  const checking = await run("create_account", {
    name: "Checking",
    balance: 100_000,
    date: `${addMonths(month, -3)}-01`,
  });
  for (const [date, payee] of [
    [`${month}-01`, "Now Shop"],
    [`${last}-03`, "Then Shop"],
    [`${last}-04`, "Then Cafe"],
  ] as const)
    await run("create_transaction", { account: checking.id, date, amount: -1_000, payee });

  await page.goto(`${app.url}/accounts/${checking.id}`);
  await expectVisible(page.getByRole("button", { name: "Then Shop", exact: true }));
  await page.getByRole("checkbox", { name: `Select ${monthLabelOf(last)}` }).click();
  await expectVisible(page.getByText("2 selected"));
  await page.getByRole("checkbox", { name: `Select ${monthLabelOf(last)}` }).click();
  await expectHidden(page.getByText("2 selected"));
});

test("a missed schedule is a page alert that opens Schedules in the same scope", async ({
  app,
}) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  await run("create_schedule", {
    name: "Rent",
    account: checking.id,
    amount: -50_000,
    amountOp: "is",
    date: addDays(today(), -4),
    dateOp: "is",
    payee: "Landlord",
  });

  await page.goto(`${app.url}/accounts/${checking.id}`);
  await expectVisible(page.getByRole("status").getByText("1 missed schedule"));
  await page.getByRole("link", { name: "Open Schedules" }).click();
  await expectEventually(
    async () => new URL(page.url()).pathname + new URL(page.url()).search,
    `/schedules?account=${checking.id}`,
  );
  await expectVisible(page.getByRole("button", { name: "Rent", exact: true }));
});

test("the uncategorized view works its queue down to nothing", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  const date = today();
  await run("create_transaction", { account: checking.id, date, amount: -1_000, payee: "Shop" });
  await run("create_transaction", { account: checking.id, date, amount: -2_000, payee: "Shop" });

  await page.goto(`${app.url}/accounts/uncategorized`);
  await expectVisible(page.getByRole("button", { name: "Shop", exact: true }).first());
  await expectHidden(page.getByRole("button", { name: "Add transaction" }));
  await expectHidden(page.getByRole("region", { name: "Most waiting" }));

  await page.getByRole("checkbox", { name: "Select all" }).click();
  await page.getByRole("button", { name: "Categorize", exact: true }).first().click();
  const panel = page.getByRole("region", { name: "Panel" });
  await expectVisible(panel.getByRole("heading", { name: "Categorize 2 transactions" }));
  await panel.getByRole("combobox", { name: "Category" }).click();
  await page.getByRole("option", { name: "Food" }).click();
  await panel.getByRole("button", { name: "Save" }).click();
  await expectVisible(page.getByText("Nothing to categorize."));
});

test("a closed account takes no new transactions, and an unknown one says so", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking" });
  const old = await run("create_account", { name: "Old", balance: 1_000 });
  await run("close_account", { id: old.id, transferAccount: checking.id });

  await page.goto(`${app.url}/accounts/${old.id}`);
  await expectVisible(page.getByLabel("Balances").getByText("Closed"));
  await expectVisible(page.getByRole("button", { name: "Account actions" }));
  await expectHidden(page.getByRole("button", { name: "Add transaction" }));
  // The closing transfer is a real row with a running balance.
  await expectVisible(page.getByTestId("register-filters").getByText("Balance", { exact: true }));

  await page.goto(`${app.url}/accounts/nope`);
  await expectVisible(page.getByText("No such account."));
});

test("a phone shows the balances above a list that still adds, with no sideways scroll", async ({
  app,
}) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  await run("create_transaction", {
    account: checking.id,
    date: today(),
    amount: -1_000,
    payee: "Corner Grocer",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${app.url}/accounts/${checking.id}`);
  await expectVisible(page.getByLabel("Balances").getByText("990.00", { exact: true }));
  await expectVisible(page.getByRole("button", { name: /Corner Grocer/ }));
  await expectHidden(page.getByRole("button", { name: "Where the money went" }));
  await expectEventually(
    () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
  await expectEventually(
    () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-slot="scroll-area-viewport"]')].every(
          (each) => each.scrollWidth <= each.clientWidth,
        ),
      ),
    true,
  );
});

test("deleting a reconciled transaction asks first", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking" });
  await run("create_transaction", {
    date: today(),
    account: checking.id,
    amount: -1234,
    payee: "Corner Grocer",
    cleared: true,
  });
  await run("reconcile_account", { id: checking.id, balance: -1234 });

  await page.goto(`${app.url}/accounts/${checking.id}`);
  await expectVisible(page.getByRole("button", { name: "Corner Grocer" }));
  await page.getByRole("checkbox", { name: "Select", exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete a reconciled transaction?" });
  await expectVisible(dialog);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expectHidden(dialog);
  await expectVisible(page.getByRole("button", { name: "Corner Grocer" }));

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete anyway" }).click();
  await expectHidden(page.getByRole("button", { name: "Corner Grocer" }));
});

test("categorizing covers rows a month has hidden and rows of other accounts, in one undo", async ({
  app,
}) => {
  const { page, run } = app;
  const month = currentMonth();
  const last = addMonths(month, -1);
  const one = await run("create_account", { name: "One", balance: 100_000, date: `${last}-01` });
  const two = await run("create_account", { name: "Two", balance: 100_000, date: `${last}-01` });
  const groups = await run("list_categories", {});
  const food = groups.find((group) => !group.isIncome)!.categories[0]!;
  const shop = (account: string, date: string, payee: string) =>
    run("create_transaction", { account, date, amount: -1_000, payee });
  await shop(one.id, `${month}-01`, "Now Shop");
  await shop(one.id, `${last}-05`, "Then Shop");
  await shop(two.id, `${last}-06`, "Other Shop");

  await page.goto(`${app.url}/accounts/uncategorized`);
  await expectVisible(page.getByRole("button", { name: "Now Shop" }));
  const filters = page.getByTestId("register-filters");
  await filters.getByRole("checkbox", { name: "Select all" }).click();
  await expectVisible(page.getByText("3 selected"));

  // The month's heading narrows the table to one row; the three stay selected.
  await page.getByRole("button", { name: monthLabelOf(month), exact: true }).click();
  await expectHidden(page.getByRole("button", { name: "Then Shop" }));
  await expectVisible(page.getByText("3 selected"));
  await filters.getByRole("button", { name: "Categorize", exact: true }).click();
  const panel = page.getByRole("region", { name: "Panel" });
  await panel.getByRole("combobox", { name: "Category" }).click();
  await page.getByRole("option", { name: food.name }).click();
  await panel.getByRole("button", { name: "Save" }).click();

  const waiting = async () => (await run("list_transactions", { uncategorized: true })).total;
  await expectEventually(waiting, 0);
  await run("undo", {});
  await expectEventually(waiting, 3);
});

test("a category set in the pane on a selected row goes on every selected row, in one undo", async ({
  app,
}) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  const payees = ["A Shop", "B Shop", "C Shop"];
  for (const payee of payees)
    await run("create_transaction", { account: checking.id, date: today(), amount: -1_000, payee });
  const categories = async () =>
    (await run("list_transactions", { account: checking.id })).rows
      .filter((row) => payees.includes(row.payee ?? ""))
      .map((row) => (row.counterpart.kind === "category" ? row.counterpart.name : null));

  await page.goto(`${app.url}/accounts/${checking.id}`);
  for (const payee of payees)
    await page
      .getByRole("button", { name: payee, exact: true })
      .locator("..")
      .getByRole("checkbox", { name: "Select" })
      .click();
  await expectVisible(page.getByText("3 selected"));
  await page
    .getByRole("button", { name: "B Shop", exact: true })
    .locator("..")
    .getByRole("button", { name: "Categorize" })
    .click();
  const panel = page.getByRole("region", { name: "Panel" });
  await panel.getByRole("combobox", { name: "Category" }).fill("Food");
  await page.getByRole("option", { name: "Food" }).click();
  await panel.getByRole("button", { name: "Save" }).click();

  await expectHidden(panel);
  await expectCount(page.getByRole("button", { name: "Food", exact: true }), 3);
  assert.deepEqual(await categories(), ["Food", "Food", "Food"]);
  await run("undo", {});
  await expectEventually(categories, [null, null, null]);
});

test("a bulk category the server refuses keeps the pane open and says why", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  const savings = await run("create_account", { name: "Savings", onBudget: false });
  await run("create_transaction", {
    account: savings.id,
    date: today(),
    amount: -1_000,
    payee: "Corner Shop",
  });
  await run("create_transaction", {
    account: savings.id,
    date: today(),
    amount: 2_000,
    transferAccount: checking.id,
  });

  await page.goto(`${app.url}/accounts/${savings.id}`);
  await expectVisible(page.getByRole("button", { name: "Corner Shop", exact: true }));
  const filters = page.getByTestId("register-filters");
  await filters.getByRole("checkbox", { name: "Select all" }).click();
  await filters.getByRole("button", { name: "Categorize", exact: true }).click();
  const panel = page.getByRole("region", { name: "Panel" });
  await panel.getByRole("combobox", { name: "Category" }).fill("Food");
  await page.getByRole("option", { name: "Food" }).click();
  await panel.getByRole("button", { name: "Save" }).click();

  await expectVisible(
    panel.getByRole("alert").getByText("Name the category from the budget account's side"),
  );
  await expectVisible(panel.getByRole("button", { name: "Save" }));
  await expectVisible(filters.getByText("2 selected"));
  const shop = (await run("list_transactions", { account: savings.id })).rows.find(
    (row) => row.payee === "Corner Shop",
  );
  assert.equal(shop?.counterpart.kind, "uncategorized", "the refused write changed nothing");
});

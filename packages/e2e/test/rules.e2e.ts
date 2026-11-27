import { today } from "@reeve/contract/rules";
import {
  expectEventually,
  expectHidden,
  expectText,
  expectValues,
  expectVisible,
  openAccount,
  test,
} from "../src/fixtures.ts";

test("saving a rule's category recategorizes the transactions it matches", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  await run("create_transaction", {
    account: checking.id,
    date: today(),
    amount: -4_520,
    payee: "Corner Grocer",
  });

  await page.goto(`${app.url}/rules`);
  await page.getByRole("button", { name: "New rule" }).click();
  const dialog = page.getByRole("region", { name: "Panel" });
  await expectText(dialog.getByRole("combobox", { name: "Condition field" }), "Payee");
  await dialog.getByRole("combobox", { name: "Value", exact: true }).click();
  await page.getByRole("option", { name: "Corner Grocer" }).click();
  await expectVisible(dialog.getByText("1 existing transaction matches."));
  await expectText(dialog.getByRole("combobox", { name: "Action field" }), "Category");
  await dialog.getByRole("combobox", { name: "New value" }).click();
  await page.getByRole("option", { name: "Food" }).click();
  await expectVisible(dialog.getByText("Saving will set Food on 1 existing transaction."));
  await dialog.getByRole("button", { name: "Save rule" }).click();
  await expectHidden(dialog);
  await expectVisible(page.getByText("Set Food on 1 transaction"));

  await page.getByRole("button", { name: /Corner Grocer/ }).click();
  const editor = page.getByRole("region", { name: "Panel" });
  await expectVisible(editor.getByText("1 existing transaction matches."));
  await editor.getByRole("combobox", { name: "New value" }).fill("Bills");
  await page.getByRole("option", { name: "Bills", exact: true }).click();
  await expectVisible(editor.getByText("Saving will set Bills on 1 existing transaction."));
  await editor.getByRole("button", { name: "Save rule" }).click();
  await expectHidden(editor);
  await expectVisible(page.getByText("Set Bills on 1 transaction"));

  await openAccount(page, "Checking", "954.80");
  await expectVisible(page.getByRole("button", { name: "Corner Grocer" }));
  await expectVisible(page.getByRole("button", { name: "Bills", exact: true }));
});

test("save and apply applies every action of the rule", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  await run("create_transaction", {
    account: checking.id,
    date: today(),
    amount: -4_520,
    payee: "Corner Grocer",
  });

  await page.goto(`${app.url}/rules`);
  await page.getByRole("button", { name: "New rule" }).click();
  const dialog = page.getByRole("region", { name: "Panel" });
  await dialog.getByRole("combobox", { name: "Value", exact: true }).click();
  await page.getByRole("option", { name: "Corner Grocer" }).click();
  await dialog.getByRole("combobox", { name: "Action field" }).click();
  await page.getByRole("option", { name: "Payee name" }).click();
  await dialog.getByRole("textbox", { name: "New value" }).fill("Grocer");
  await expectVisible(dialog.getByText("1 existing transaction matches."));
  await dialog.getByRole("button", { name: "Save and apply" }).click();
  await expectHidden(dialog);
  await expectVisible(page.getByText("Applied the rule to 1 transaction"));

  await openAccount(page, "Checking", "954.80");
  await expectVisible(page.getByRole("button", { name: "Grocer", exact: true }));
});

test("the page says what rules match and what needs attention, and a check filters", async ({
  app,
}) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  const groups = await run("list_categories", {});
  const named = (name: string) =>
    groups.flatMap((group) => group.categories).find((each) => each.name === name)!.id;
  await run("create_transaction", {
    account: checking.id,
    date: today(),
    amount: -4_520,
    payee: "Corner Grocer",
  });
  const payees = await run("list_payees", {});
  const grocer = payees.find((each) => each.name === "Corner Grocer")!.id;
  const setter = (category: string) =>
    run("create_rule", {
      conditions: [{ field: "payee", op: "is", value: grocer }],
      actions: [{ op: "set", field: "category", value: named(category) }],
      recategorize: false,
    });
  await setter("Food");
  await setter("Bills");
  await run("create_rule", {
    conditions: [{ field: "notes", op: "contains", value: "never there" }],
    actions: [{ op: "append-notes", value: "seen" }],
    recategorize: false,
  });

  await page.goto(`${app.url}/rules`);
  for (const gone of ["Summary", "How they run", "Payees worth a rule"])
    await expectHidden(page.getByRole("region", { name: gone }));
  await expectText(page.getByText(/\d+ of 3$/), "3 of 3");

  const attention = page.getByRole("status");
  const conflict = attention.getByRole("button", { name: /conflict/ });
  await expectVisible(attention.getByRole("button", { name: /1 matched nothing in 12 months/ }));
  await conflict.click();
  await expectText(page.getByText(/\d+ of 3$/), "2 of 3");
  await expectHidden(page.getByRole("button", { name: /never there/ }));
  await conflict.click();
  await expectText(page.getByText(/\d+ of 3$/), "3 of 3");

  await page.getByRole("button", { name: /never there/ }).hover();
  await page.getByRole("button", { name: "Rule 1 options" }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  const confirm = page.getByRole("dialog", { name: "Delete this rule?" });
  await expectVisible(confirm.getByText(/stay as they are\. You can undo this\./));
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expectHidden(confirm);
  await expectHidden(page.getByRole("button", { name: /never there/ }));
});

test("a payee worth a rule opens the editor filled in", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  for (const amount of [-1_000, -2_000, -3_000])
    await run("create_transaction", {
      account: checking.id,
      date: today(),
      amount,
      payee: "Amzn Mktp",
    });

  await page.goto(`${app.url}/rules`);
  await page.getByRole("status").getByRole("button", { name: "Review" }).click();
  await page
    .getByRole("dialog", { name: "Payees worth a rule" })
    .getByRole("button", { name: "New rule for Amzn Mktp" })
    .click();
  const dialog = page.getByRole("region", { name: "Panel" });
  await expectValues(dialog.getByRole("combobox", { name: "Value", exact: true }), ["Amzn Mktp"]);
  await expectVisible(dialog.getByText("3 existing transactions match."));
  await dialog.getByRole("combobox", { name: "New value" }).click();
  await page.getByRole("option", { name: "Food" }).click();
  await expectVisible(dialog.getByText("Saving will set Food on 3 existing transactions."));
  await dialog.getByRole("button", { name: "Save rule" }).click();
  await expectHidden(dialog);
  await expectVisible(page.getByText("Set Food on 3 transactions"));
  await expectVisible(page.getByRole("button", { name: /Amzn Mktp/ }));
});

test("a schedule's rule keeps what the schedule owns, and cannot be deleted here", async ({
  app,
}) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  await run("create_schedule", {
    name: "Rent",
    payee: "Landlord",
    account: checking.id,
    amount: -120_000,
    amountOp: "is",
    date: today(),
    frequency: "monthly",
  });

  await page.goto(`${app.url}/rules`);
  await expectVisible(page.getByRole("link", { name: "Belongs to the schedule Rent" }));
  await page.getByRole("button", { name: /Landlord/ }).click();
  const editor = page.getByRole("region", { name: "Panel" });
  await expectVisible(editor.getByText(/belongs to the schedule Rent/));
  await expectVisible(editor.getByText("link it to its schedule"));
  await expectHidden(editor.getByRole("button", { name: "Remove action" }));
  await expectHidden(editor.getByRole("button", { name: "Remove condition" }));
  await editor.getByRole("button", { name: "Add condition" }).click();
  await expectVisible(editor.getByRole("button", { name: "Remove condition" }));
  await editor.getByRole("button", { name: "Cancel" }).click();
  await expectHidden(editor);

  await page.getByRole("button", { name: /Landlord/ }).hover();
  await page.getByRole("button", { name: "Rule 1 options" }).click();
  await expectVisible(page.getByRole("menuitem", { name: "Delete with its schedule" }));
  await page.getByRole("menuitem", { name: "View matching transactions" }).click();
  await expectVisible(page.getByRole("region", { name: "Panel" }));
});

test("a payee's rules link keeps its filter", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  await run("create_transaction", {
    account: checking.id,
    date: today(),
    amount: -500,
    payee: "Cafe",
  });
  await run("create_transaction", {
    account: checking.id,
    date: today(),
    amount: -500,
    payee: "Shop",
  });
  const payees = await run("list_payees", {});
  const id = (name: string) => payees.find((each) => each.name === name)!.id;
  for (const name of ["Cafe", "Shop"])
    await run("create_rule", {
      conditions: [{ field: "payee", op: "is", value: id(name) }],
      actions: [{ op: "append-notes", value: "seen" }],
      recategorize: false,
    });
  await page.goto(`${app.url}/rules?payee=${encodeURIComponent(JSON.stringify([id("Cafe")]))}`);
  await expectVisible(page.getByRole("button", { name: /Cafe/ }));
  await expectHidden(page.getByRole("button", { name: /Shop/ }));
});

test("a rule's names filter as they are typed, one or several", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  for (const payee of ["Corner Grocer", "Corner Cafe"])
    await run("create_transaction", { account: checking.id, date: today(), amount: -500, payee });

  await page.goto(`${app.url}/rules`);
  await page.getByRole("button", { name: "New rule" }).click();
  const panel = page.getByRole("region", { name: "Panel" });
  await panel.getByRole("combobox", { name: "Condition operator" }).click();
  await page.getByRole("option", { name: "is one of" }).click();
  const payees = panel.getByRole("combobox", { name: "Value", exact: true });
  for (const [typed, shown] of [
    ["groc", "Corner Grocer"],
    ["caf", "Corner Cafe"],
  ] as const) {
    await payees.fill(typed);
    await expectEventually(() => page.getByRole("option").allInnerTexts(), [shown]);
    await payees.press("Enter");
  }
  await expectVisible(panel.getByText("2 existing transactions match."));

  const category = panel.getByRole("combobox", { name: "New value" });
  await category.fill("foo");
  await expectEventually(() => page.getByRole("option").allInnerTexts(), ["Food"]);
  await category.press("Enter");
  await expectValues(category, ["Food"]);
});

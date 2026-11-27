import {
  expectEventually,
  expectHidden,
  expectVisible,
  openAccount,
  test,
} from "../src/fixtures.ts";

const PHONE = { width: 390, height: 844 };

test("on a phone, a transaction added from an account's list counts in the budget", async ({
  app,
}) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  await page.setViewportSize(PHONE);

  await page.goto(`${app.url}/budget`);
  const tabs = page.getByRole("navigation", { name: "Pages" });
  await openAccount(page, "Checking", "1,000.00");

  await page.getByRole("button", { name: "Add transaction" }).click();
  const sheet = page.getByRole("region", { name: "Panel" });
  await sheet.getByRole("combobox", { name: "Payee" }).fill("Corner Grocer");
  await page.keyboard.press("Tab");
  await sheet.getByRole("combobox", { name: "Category" }).fill("Food");
  await page.getByRole("option", { name: "Food" }).click();
  await sheet.getByRole("textbox", { name: "Payment" }).fill("12.34");
  await sheet.getByRole("button", { name: "Add", exact: true }).click();

  await expectHidden(sheet);
  await expectVisible(page.getByRole("button", { name: /Corner Grocer/ }));
  await expectVisible(page.getByText("987.66").first());

  await tabs.getByRole("link", { name: "Budget" }).click();
  await expectVisible(
    page.getByRole("button", { name: "Food: budgeted 0.00, spent -12.34, balance -12.34" }),
  );
});

test("on a phone, a category's sheet budgets it and To Budget follows", async ({ app }) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  await page.setViewportSize(PHONE);

  await page.goto(`${app.url}/budget`);
  await expectVisible(page.getByRole("button", { name: "To Budget 1,000.00" }));

  await page.getByRole("button", { name: /^Food: budgeted/ }).click();
  const sheet = page.getByRole("dialog", { name: "Food" });
  await sheet.getByRole("textbox", { name: "Food budgeted" }).fill("250");
  await sheet.getByRole("textbox", { name: "Food budgeted" }).press("Enter");
  await expectVisible(sheet.getByText("250.00").first());
  await page.keyboard.press("Escape");
  await expectHidden(sheet);

  await expectVisible(
    page.getByRole("button", { name: "Food: budgeted 250.00, spent 0.00, balance 250.00" }),
  );
  await expectVisible(page.getByRole("button", { name: "To Budget 750.00" }));
});

test("a phone's tabs stay at the top of the screen while the page scrolls", async ({ app }) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  for (const payee of ["Grocer", "Bakery", "Cinema", "Pharmacy", "Garage", "Florist"])
    await run("create_rule", {
      conditions: [{ field: "payee", op: "contains", value: payee }],
      actions: [{ op: "set", field: "notes", value: payee }],
    });
  await page.setViewportSize({ width: 390, height: 300 });
  await page.goto(`${app.url}/rules`);
  const tabs = page.getByRole("navigation", { name: "Section" });
  await expectVisible(tabs.getByRole("link", { name: "Rules" }));
  const top = (await tabs.boundingBox())?.y;
  await page.evaluate(() =>
    document
      .querySelector('[data-slot="page"]')
      ?.closest('[data-slot="scroll-area-viewport"]')
      ?.scrollTo(0, 150),
  );
  await expectEventually(
    () =>
      page.evaluate(
        () =>
          document
            .querySelector('[data-slot="page"]')
            ?.closest('[data-slot="scroll-area-viewport"]')?.scrollTop,
      ),
    150,
  );
  await expectEventually(async () => (await tabs.boundingBox())?.y, top);
});

import { addDays, today } from "@reeve/contract/rules";
import { expectVisible, test } from "../src/fixtures.ts";

test("an Age of Money widget added to the dashboard shows how old the spent money is", async ({
  app,
}) => {
  const { page, run } = app;
  const account = await run("create_account", {
    name: "Checking",
    balance: 100_000,
    date: addDays(today(), -45),
  });
  await run("create_transaction", {
    account: account.id,
    date: today(),
    amount: -20_000,
    payee: "Grocer",
  });

  await page.goto(`${app.url}/`);
  await page.getByRole("button", { name: "Add widget" }).click();
  await page.getByRole("menuitem", { name: "Age of Money" }).click();

  await expectVisible(page.getByText("Age of Money", { exact: true }));
  await expectVisible(page.getByText("45 days", { exact: true }));
});

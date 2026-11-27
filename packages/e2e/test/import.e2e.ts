import { join } from "node:path";
import {
  expectAccountBalance,
  expectCount,
  expectHidden,
  expectText,
  expectVisible,
  test,
} from "../src/fixtures.ts";

const bankFile = join(import.meta.dirname, "../fixtures/bank.csv");

test("a CSV bank file imports through the import dialog", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 10_000 });

  await page.goto(`${app.url}/accounts/${checking.id}`);
  await expectAccountBalance(page, "Checking", "100.00");

  await page.getByRole("button", { name: "Account actions" }).click();
  await page.getByRole("menuitem", { name: "Import transactions…" }).click();
  const dialog = page.getByRole("dialog", { name: "Import into Checking" });
  await dialog.getByLabel("Choose a bank file…").setInputFiles(bankFile);

  // The dialog guesses the mapping from the header row.
  await expectText(dialog.getByRole("combobox", { name: "Date column" }), "Date");
  await expectText(dialog.getByRole("combobox", { name: "Amount column" }), "Amount");
  await expectCount(dialog.getByRole("checkbox", { name: "Import this row" }), 3);
  await dialog.getByRole("button", { name: "Import 3 transactions" }).click();

  await expectVisible(page.getByText("Imported 3 new, updated 0"));
  await expectHidden(dialog);
  await expectAccountBalance(page, "Checking", "1,474.65");
  for (const payee of ["Corner Grocer", "Acme Payroll", "City Power"])
    await expectVisible(page.getByRole("button", { name: payee, exact: true }));
});

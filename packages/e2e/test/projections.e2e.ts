import { addMonths, currentMonth, firstDay } from "@reeve/contract/rules";
import { expectEventually, expectVisible, test } from "../src/fixtures.ts";

test("the balance forecast projects a schedule to the end of its range", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  await run("create_schedule", {
    name: "Salary",
    account: checking.id,
    amount: 10_000,
    amountOp: "is",
    date: firstDay(addMonths(currentMonth(), 1)),
    dateOp: "is",
    frequency: "monthly",
  });
  const pageId = (await run("list_dashboard_pages", {}))[0]!.id;
  const widget = await run("add_widget", { pageId, type: "balance-forecast-card" });

  await page.goto(`${app.url}/`);
  await expectVisible(page.getByText("Balance Forecast", { exact: true }));
  await page.goto(`${app.url}/reports/balance-forecast?report=${widget.reportId}`);
  await expectVisible(page.getByText(/^Ending balance: /));
  await expectVisible(page.getByRole("definition").filter({ hasText: "2,100.00" }));
  await expectVisible(page.getByText("11 scheduled transactions included in this date range"));
  await expectVisible(page.getByRole("button", { name: "Salary" }));
});

test("the Monte Carlo report simulates a plan and saves it to its report", async ({ app }) => {
  const { page, run } = app;
  const pageId = (await run("list_dashboard_pages", {}))[0]!.id;
  const widget = await run("add_widget", { pageId, type: "monte-carlo-card" });

  await page.goto(`${app.url}/reports/monte-carlo?report=${widget.reportId}`);
  await expectVisible(page.getByText(/simulated scenarios, your pot lasted until age 90\./));
  const target = page.getByRole("textbox", { name: "Pot must last until age" });
  await target.fill("95");
  await target.press("Enter");
  await expectVisible(page.getByText(/simulated scenarios, your pot lasted until age 95\./));
  await page.getByRole("button", { name: "Save report" }).click();
  const confirm = page.getByRole("alertdialog");
  await expectVisible(confirm.getByText(/^Today: /));
  await confirm.getByRole("button", { name: "Save report" }).click();
  await expectEventually(async () => {
    const saved = await run("get_saved_report", { id: widget.reportId! });
    return "definition" in saved && saved.definition.type === "monte-carlo"
      ? saved.definition.settings.targetAge
      : undefined;
  }, 95);
});

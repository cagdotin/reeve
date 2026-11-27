import { addMonths, currentMonth } from "@reeve/contract/rules";
import { monthName } from "@reeve/contract/targets";
import { expectHidden, expectText, expectValues, expectVisible, test } from "../src/fixtures.ts";

const PHONE = { width: 390, height: 844 };

test("a category's target, set in the editor and applied, budgets the month", async ({ app }) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 500_000 });
  const month = currentMonth();
  // Due in the month after next: this month and the two after it save 300 each.
  const due = addMonths(month, 2);

  await page.goto(`${app.url}/budget`);
  const food = page.getByRole("textbox", { name: `Food budgeted in ${month}` });
  await food.hover();
  await page.getByRole("button", { name: "Food options" }).click();
  await page.getByRole("button", { name: "Set a target…" }).click();

  const dialog = page.getByRole("dialog", { name: "Targets for Food" });
  await dialog.getByRole("button", { name: /Save up by a date/ }).click();
  await dialog.getByRole("textbox", { name: "How much" }).fill("900");
  await dialog.getByLabel("Needed by").fill(due);
  await expectVisible(dialog.getByText(`Save 900.00 by ${monthName(due)}`));
  await expectText(dialog.getByText(/this budgets/), `In ${monthName(month)} this budgets 300.00.`);

  await dialog.getByRole("button", { name: "Save" }).click();
  await expectVisible(dialog.getByText("Saved"));
  const groups = await run("list_categories", {});
  const notes = groups.flatMap((group) => group.categories).find((c) => c.name === "Food")?.notes;
  if (notes !== `#template 900 by ${due}`) throw new Error(`Food's note is ${notes}`);

  await dialog.getByRole("button", { name: `Apply to ${monthName(month)} now` }).click();
  await expectHidden(dialog);
  await expectValues(food, ["300.00"]);
  await expectVisible(page.getByRole("button", { name: "Food targets" }));
});

test("the editor shows note templates and sends leftovers to another category", async ({ app }) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  const groups = await run("list_categories", {});
  const food = groups.flatMap((group) => group.categories).find((c) => c.name === "Food")!;
  await run("set_note", { id: food.id, note: "Weekly shop\n#template 50" });

  await page.goto(`${app.url}/budget`);
  await page.getByRole("button", { name: "Food targets" }).click();
  const dialog = page.getByRole("dialog", { name: "Targets for Food" });
  await expectVisible(dialog.getByText("Budget 50.00 each month"));

  await dialog.getByRole("radio", { name: "Moves to another category" }).click();
  await dialog.getByPlaceholder("Choose a category").click();
  await page.getByRole("option", { name: "Savings" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expectVisible(dialog.getByText("At month end, send leftover money to Savings"));

  const after = await run("list_categories", {});
  const note = (name: string) =>
    after.flatMap((group) => group.categories).find((c) => c.name === name)?.notes;
  if (note("Food") !== "Weekly shop\n#template 50\n#cleanup Savings source")
    throw new Error(`Food's note is ${note("Food")}`);
  if (note("Savings") !== "#cleanup Savings sink")
    throw new Error(`Savings' note is ${note("Savings")}`);
});

test("on a phone, a target is set from the category's sheet", async ({ app }) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  await page.setViewportSize(PHONE);
  const month = currentMonth();

  await page.goto(`${app.url}/budget`);
  await page.getByRole("button", { name: /^Food: budgeted/ }).click();
  await page
    .getByRole("dialog", { name: "Food" })
    .getByRole("button", { name: "Set a target" })
    .click();

  const sheet = page.getByRole("dialog", { name: "Targets for Food" });
  await sheet.getByRole("button", { name: /Budget the same amount/ }).click();
  await sheet.getByRole("textbox", { name: "Amount" }).fill("50");
  await sheet.getByRole("button", { name: "Save" }).click();
  await sheet.getByRole("button", { name: `Apply to ${monthName(month)} now` }).click();
  await expectHidden(sheet);
  await expectVisible(
    page.getByRole("button", { name: "Food: budgeted 50.00, spent 0.00, balance 50.00" }),
  );
});

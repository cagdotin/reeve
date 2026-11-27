import { today } from "@reeve/contract/rules";
import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { type App, expectEventually, expectValues, expectVisible, test } from "../src/fixtures.ts";

const panelOf = (page: Page) => page.getByRole("region", { name: "Panel", exact: true });
const learns = async (run: App["run"], name: string) =>
  (await run("list_payees", {})).find((each) => each.name === name)?.learnCategories;

async function seed(run: App["run"]) {
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  await run("create_transaction", {
    account: checking.id,
    date: today(),
    amount: -4_520,
    payee: "Corner Grocer",
  });
  return checking;
}

test("a category picked on a transaction becomes a rule from its panel", async ({ app }) => {
  const { page, run } = app;
  const checking = await seed(run);
  await page.goto(`${app.url}/accounts/${checking.id}`);
  await page.getByRole("button", { name: "Corner Grocer", exact: true }).click();
  const panel = panelOf(page);
  const rules = panel.getByRole("region", { name: "Rules" });
  await expectVisible(rules.getByText("No rule applies to this transaction."));

  await panel.getByRole("combobox", { name: "Category" }).click();
  await page.getByRole("option", { name: "Food", exact: true }).click();
  await rules.getByRole("button", { name: "Add a rule" }).click();
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expectVisible(panel.getByRole("heading", { name: "New rule" }));
  await expectValues(panel.getByRole("combobox", { name: "Value", exact: true }), [
    "Corner Grocer",
  ]);
  await expectValues(panel.getByRole("combobox", { name: "New value" }), ["Food"]);
  await panel.getByRole("button", { name: "Save rule" }).click();

  await expectVisible(panel.getByRole("heading", { name: "Transaction" }));
  await expectVisible(rules.getByText("How it got here"));
  await expectVisible(rules.getByRole("button", { name: /Corner Grocer.*Food/ }));
  await expectVisible(rules.getByText("Category: none → Food"));
  await expectEventually(() => learns(run, "Corner Grocer"), false);
});

test("a payee's panel lists its rules and adds one for it", async ({ app }) => {
  const { page, run } = app;
  await seed(run);
  await page.goto(`${app.url}/payees`);
  await page.getByRole("button", { name: "Corner Grocer", exact: true }).click();
  const panel = panelOf(page);
  const rules = panel.getByRole("region", { name: "Rules" });
  await expectVisible(rules.getByText("No rule names this payee."));
  await expectVisible(rules.getByText(/turns off learning for this payee/));
  const learning = panel.getByRole("switch", { name: "Keep its category rule up to date" });
  assert.equal(await learning.isChecked(), true, "the payee learns before any rule");

  await rules.getByRole("button", { name: "Add a rule" }).click();
  await expectVisible(panel.getByRole("heading", { name: "New rule" }));
  await expectValues(panel.getByRole("combobox", { name: "Value", exact: true }), [
    "Corner Grocer",
  ]);
  const category = panel.getByRole("combobox", { name: "New value" });
  await category.fill("bil");
  await expectEventually(
    () => page.getByRole("option").allInnerTexts(),
    ["Bills", "Bills (Flexible)"],
  );
  await category.press("Enter");
  await panel.getByRole("button", { name: "Save rule" }).click();

  await expectVisible(panel.getByRole("heading", { name: "Edit Corner Grocer" }));
  await expectVisible(rules.getByRole("button", { name: /Corner Grocer.*Bills/ }));
  await expectEventually(() => learning.isChecked(), false);
  assert.equal(await learns(run, "Corner Grocer"), false);

  await rules.getByRole("button", { name: /Corner Grocer.*Bills/ }).click();
  await expectVisible(panel.getByRole("heading", { name: "Edit rule" }));
});

import { today } from "@reeve/contract/rules";
import assert from "node:assert/strict";
import { expectEventually, expectHidden, expectVisible, test } from "../src/fixtures.ts";

test("the register applies category rules to what they match, in one undo step", async ({
  app,
}) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  const food = (await run("list_categories", {}))
    .flatMap((group) => group.categories)
    .find((each) => each.name === "Food")!;
  const spar = await run("create_payee", { name: "Spar" });
  await run("create_rule", {
    conditions: [{ field: "payee", op: "is", value: spar.id }],
    actions: [{ op: "set", field: "category", value: food.id }],
  });
  const added = await Promise.all(
    [-970, -450].map((amount) =>
      run("create_transaction", {
        account: checking.id,
        date: today(),
        amount,
        payee: "Spar Dankt 4802",
      }),
    ),
  );
  await run("update_transactions", { ids: added.map((each) => each.id), payee: "Spar" });

  await page.goto(`${app.url}/accounts/${checking.id}`);
  const alert = page.getByText("2 transactions without a category match a category rule");
  await expectVisible(alert);
  await page.getByRole("button", { name: "Apply rules" }).click();
  await expectHidden(alert);
  const pending = async () =>
    (await run("pending_rule_categories", { account: checking.id })).transactions.length;
  assert.equal(await pending(), 0);

  await run("undo", {});
  await expectEventually(pending, 2);
  await expectVisible(alert);
});

import { today } from "@reeve/contract/rules";
import type { Page } from "playwright-core";
import {
  expectCount,
  expectEventually,
  expectHidden,
  expectVisible,
  test,
} from "../src/fixtures.ts";
import type { App } from "../src/fixtures.ts";

const seed = async (run: App["run"]) => {
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  const savings = await run("create_account", {
    name: "Savings",
    balance: 50_000,
    onBudget: false,
  });
  const date = today();
  const spend = (account: string, payee: string) =>
    run("create_transaction", { account, date, amount: -1_000, payee });
  await spend(checking.id, "Grocer");
  await spend(savings.id, "Grocer");
  await spend(checking.id, "Grocer Inc");
  await spend(savings.id, "Grocer Inc");
  await spend(savings.id, "Broker");
  await run("create_payee", { name: "Nobody Yet" });
  const payees = await run("list_payees", {});
  const payee = (name: string) => payees.find((each) => each.name === name)!.id;

  const schedule = (name: string, account?: string) =>
    run("create_schedule", {
      name,
      ...(account === undefined ? {} : { account }),
      amount: -500,
      amountOp: "is",
      date,
    });
  await schedule("Rent", checking.id);
  await schedule("Fund fee", savings.id);
  await schedule("Someday");

  const rule = (
    notes: string,
    conditionsOp: "and" | "or",
    conditions: ReadonlyArray<{ field: string; op: string; value: string }>,
  ) =>
    run("create_rule", {
      conditionsOp,
      conditions: conditions.map((each) => ({ ...each })) as never,
      actions: [{ op: "set", field: "notes", value: notes }],
      recategorize: false,
    });
  await rule("grocer anywhere", "and", [{ field: "payee", op: "is", value: payee("Grocer") }]);
  await rule("savings or broker", "or", [
    { field: "account", op: "is", value: savings.id },
    { field: "payee", op: "is", value: payee("Broker") },
  ]);
  await rule("broker on savings", "and", [
    { field: "account", op: "is", value: savings.id },
    { field: "payee", op: "is", value: payee("Broker") },
  ]);
  return { checking, savings };
};

const choose = async (page: Page, name: string) => {
  await page.getByRole("button", { name: /^Accounts shown: / }).click();
  await page.getByRole("menuitemradio", { name: new RegExp(`^${name}`) }).click();
};

const note = (page: Page) => page.getByTestId("scope-note");
const panel = (page: Page) => page.getByRole("region", { name: "Panel" });

test("under all accounts the pages add no scope note, and the menu names what it chooses", async ({
  app,
}) => {
  const { page, run } = app;
  await seed(run);
  for (const path of ["/payees", "/rules", "/schedules"]) {
    await page.goto(`${app.url}${path}`);
    await expectVisible(page.getByRole("button", { name: "Accounts shown: All accounts" }));
    await expectCount(note(page), 0);
  }
  await page.getByRole("button", { name: /^Accounts shown: / }).click();
  await expectVisible(page.getByText("Accounts shown", { exact: true }));
});

test("payees under one account say a payee is shared, and editing counts the whole book", async ({
  app,
}) => {
  const { page, run } = app;
  const { checking } = await seed(run);
  await page.goto(`${app.url}/payees?account=${checking.id}`);
  await expectVisible(note(page).getByText(/^Payees with a transaction on Checking\./));
  await expectVisible(note(page).getByText(/changes it everywhere/));
  await expectHidden(page.getByRole("button", { name: "Broker", exact: true }));
  await expectHidden(page.getByRole("button", { name: "Nobody Yet", exact: true }));

  await page.getByRole("button", { name: "Grocer", exact: true }).click();
  await expectVisible(
    panel(page).getByText(
      "A payee is shared by every account: its name and description change on all 2 transactions that name it.",
    ),
  );
  await panel(page).getByRole("textbox", { name: "Name" }).fill("grocer inc");
  await expectVisible(
    panel(page).getByText(/Merging moves Grocer's 2 transactions on every account/),
  );
  await panel(page).getByRole("button", { name: "Cancel" }).click();
  await expectHidden(panel(page));

  await page.getByRole("checkbox", { name: "Select Grocer", exact: true }).click();
  await page.getByRole("checkbox", { name: "Select Grocer Inc", exact: true }).click();
  await page.getByRole("button", { name: "Merge…" }).click();
  const merge = page.getByRole("dialog", { name: "Merge 2 payees" });
  await expectVisible(merge.getByRole("radio", { name: /Grocer Inc\s*2 transactions/ }));
  await merge.getByRole("radio", { name: /Grocer Inc/ }).click();
  await expectVisible(merge.getByText(/^2 transactions on every account, and any rules/));
  await merge.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("checkbox", { name: "Select Grocer", exact: true }).click();
  await page.getByRole("button", { name: "Delete…" }).click();
  const remove = page.getByRole("dialog", { name: "Delete Grocer?" });
  await expectVisible(remove.getByText(/^2 transactions on every account will have no payee\./));
  await remove.getByRole("button", { name: "Cancel" }).click();

  await choose(page, "All accounts");
  await page.getByRole("combobox", { name: "Date range" }).click();
  await page.getByRole("option", { name: "All time" }).click();
  await expectVisible(page.getByRole("button", { name: "Nobody Yet", exact: true }));
  await expectCount(note(page), 0);
});

test("rules under one account mark every-account rules, an or with an account counts as one, and the editor names its reach apart from the matches shown", async ({
  app,
}) => {
  const { page, run } = app;
  const { checking } = await seed(run);
  await page.goto(`${app.url}/rules?account=${checking.id}`);
  await expectVisible(
    note(page).getByText(/^Rules that can act on Checking, by their account conditions\./),
  );
  const row = (notes: string) =>
    page.getByRole("main").locator("[data-quiet]").filter({ hasText: notes });
  await expectVisible(row("grocer anywhere").getByLabel("Applies to every account"));
  await expectVisible(page.getByText("2 rules for every account have matched nothing here."));
  await page.getByRole("button", { name: "Show them" }).click();
  await expectVisible(row("savings or broker").getByLabel("Applies to every account"));
  await expectCount(page.getByRole("main").getByText("broker on savings"), 0);

  await page.getByRole("button", { name: /grocer anywhere/ }).click();
  await expectVisible(panel(page).getByText("Applies to every account.", { exact: true }));
  await expectVisible(panel(page).getByText("2 existing transactions match."));
  await expectVisible(panel(page).getByText("1 of them on Checking."));
  await panel(page).getByRole("button", { name: "Cancel" }).click();
  await expectHidden(panel(page));

  await page.getByRole("button", { name: /savings or broker/ }).click();
  await expectVisible(
    panel(page).getByText(
      "Applies to every account: with Match any, its other conditions can match on any account.",
    ),
  );
  await panel(page).getByRole("button", { name: "Cancel" }).click();

  await choose(page, "All accounts");
  await page.getByRole("button", { name: /broker on savings/ }).click();
  await expectVisible(panel(page).getByText("Applies only where account is Savings."));
  await expectCount(panel(page).getByText(/of them on|All on/), 0);
});

test("schedules under the budget accounts say they are the open ones, and accountless ones stay findable", async ({
  app,
}) => {
  const { page, run } = app;
  await seed(run);
  await page.goto(`${app.url}/schedules?account=budgeted`);
  await expectVisible(note(page).getByText("Schedules that post to open budget accounts."));
  await expectVisible(page.getByRole("main").getByText("Rent").first());
  await expectCount(page.getByRole("main").getByText("Fund fee"), 0);
  await expectVisible(page.getByText("1 schedule has no account, so only All accounts shows it."));
  await page.getByRole("button", { name: "Show all accounts" }).click();
  await expectVisible(page.getByRole("main").getByText("Someday").first());
});

test("changing the accounts shown never rewrites a rule's conditions, and asks first when the editor has changes", async ({
  app,
}) => {
  const { page, run } = app;
  const { checking, savings } = await seed(run);
  await page.goto(`${app.url}/rules?account=${checking.id}`);
  await page.getByRole("button", { name: "New rule" }).click();
  const reach = panel(page).getByText("Applies only where account is Checking.");
  await expectVisible(reach);

  await choose(page, "Savings");
  await expectEventually(async () => new URL(page.url()).searchParams.get("account"), savings.id);
  await expectVisible(reach);

  await panel(page).getByRole("button", { name: "Pre", exact: true }).click();
  await choose(page, "All off-budget accounts");
  const ask = page.getByRole("alertdialog", { name: "Save your changes?" });
  await ask.getByRole("button", { name: "Keep editing" }).click();
  await expectHidden(ask);
  await expectEventually(async () => new URL(page.url()).searchParams.get("account"), savings.id);
  await expectVisible(reach);

  await choose(page, "All off-budget accounts");
  await ask.getByRole("button", { name: "Discard changes" }).click();
  await expectEventually(async () => new URL(page.url()).searchParams.get("account"), "offbudget");
  await expectHidden(panel(page));
  await expectVisible(note(page).getByText(/^Rules that can act on off-budget accounts/));
});

import { FEATURES } from "@reeve/contract/features";
import { currentMonth, today } from "@reeve/contract/rules";
import type { Locator, Page } from "playwright-core";
import {
  expectCount,
  expectEventually,
  expectHidden,
  expectText,
  expectVisible,
  test,
} from "../src/fixtures.ts";

test("the sidebar lists the pages in order, each with the tabs beside it, and Steward does nothing yet", async ({
  app,
}) => {
  const { page } = app;
  await page.goto(`${app.url}/`);
  await expectVisible(page.getByRole("heading", { level: 1, name: "Today" }));

  const rail = page.getByRole("navigation", { name: "Pages" });
  await expectEventually(
    () =>
      rail
        .locator("a[aria-label], button[aria-label]")
        .evaluateAll((items) => items.map((item) => item.getAttribute("aria-label"))),
    ["Home", "Budget", "Accounts", ...(FEATURES.purchases ? ["Purchases"] : []), "Steward"],
  );

  const steward = rail.getByRole("button", { name: "Steward" });
  await expectEventually(() => steward.getAttribute("aria-disabled"), "true");
  await steward.click({ force: true });
  await page.waitForURL(`${app.url}/`);

  const tabs = page.getByRole("navigation", { name: "Section" });
  await rail.getByRole("link", { name: "Budget", exact: true }).click();
  await page.waitForURL(`${app.url}/budget`);
  await expectVisible(page.getByRole("button", { name: "New", exact: true }));
  await expectHidden(tabs.getByRole("link", { name: "Rules" }));

  await rail.getByRole("link", { name: "Accounts", exact: true }).click();
  await page.waitForURL(`${app.url}/accounts/all`);
  await expectVisible(tabs.getByRole("link", { name: "Schedules" }));
  await tabs.getByRole("link", { name: "Rules" }).click();
  await page.waitForURL(`${app.url}/rules`);
  await expectEventually(
    () => rail.getByRole("link", { name: "Accounts", exact: true }).getAttribute("aria-current"),
    "page",
  );

  await page.keyboard.press("p");
  await page.waitForURL(`${app.url}${FEATURES.purchases ? "/receipts" : "/rules"}`);
  await expectCount(tabs.getByRole("link", { name: "Products" }), FEATURES.purchases ? 1 : 0);
});

test("a category's spent figure lists its month in the pane, and hands it to the register, which keeps the filter on reload", async ({
  app,
}) => {
  const { page, run } = app;
  const month = currentMonth();
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  const groups = await run("list_categories", {});
  const [food, other] = groups.find((group) => !group.isIncome)!.categories;
  const date = today();
  await run("create_transaction", {
    account: checking.id,
    date,
    amount: -1_000,
    payee: "Corner Grocer",
    category: food!.id,
  });
  await run("create_transaction", {
    account: checking.id,
    date,
    amount: -2_000,
    payee: "Hardware Barn",
    category: other!.id,
  });

  await page.goto(`${app.url}/budget`);
  await page.getByLabel(`${food!.name} spent in ${month}`).click();
  const records = page.getByRole("list", { name: "Transactions" });
  await expectVisible(records.getByText("Corner Grocer"));
  await expectHidden(records.getByText("Hardware Barn"));
  await page.getByRole("link", { name: "Open in register" }).click();
  await page.waitForURL(/\/accounts\/budgeted\?/);
  await expectVisible(page.getByText("Corner Grocer"));
  await expectHidden(page.getByText("Hardware Barn"));

  await page.reload();
  await expectVisible(page.getByText("Corner Grocer"));
  await expectHidden(page.getByText("Hardware Barn"));

  await page.getByRole("button", { name: /^Clear / }).click();
  await expectVisible(page.getByText("Corner Grocer"));
  await expectEventually(async () => {
    const search = new URL(page.url()).searchParams;
    return [search.has("month"), search.has("categories")];
  }, [false, true]);
});

const row = (page: Page, name: string) =>
  page.getByRole("button", { name: `${name} options`, exact: true });

const drag = async (page: Page, from: Locator, to: Locator, fraction: number) => {
  const handle = await from.boundingBox();
  const target = await to.boundingBox();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 2, target!.y + target!.height * fraction, { steps: 12 });
  await page.mouse.up();
};

test("categories are added, described, hidden and shown in the budget grid", async ({ app }) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  const groups = await run("list_categories", {});
  const group = groups.find((each) => !each.isIncome)!;
  const [first] = group.categories;
  await run("create_rule", {
    stage: "default",
    conditionsOp: "and",
    conditions: [{ field: "notes", op: "is", value: "x" }],
    actions: [{ op: "set", field: "category", value: first!.id }],
  });
  const all = async () => (await run("list_categories", {})).flatMap((each) => each.categories);

  await page.goto(`${app.url}/budget`);
  await page.getByText(first!.name, { exact: true }).first().hover();
  await row(page, first!.name).click();
  const card = page.getByRole("dialog", { name: first!.name });
  await expectVisible(card.getByText("1 rule"));
  await expectVisible(card.getByRole("button", { name: "Set a target…" }));
  await page.keyboard.press("Escape");

  await page.getByText(group.name, { exact: true }).first().hover();
  await row(page, group.name).click();
  await page.getByRole("button", { name: "Edit…" }).click();
  const editGroup = page.getByRole("dialog", { name: `Edit ${group.name}` });
  await editGroup.getByRole("textbox", { name: "Description" }).fill("The monthly basics");
  await editGroup.getByRole("button", { name: "Save" }).click();
  await expectHidden(editGroup);
  await page.getByText(group.name, { exact: true }).first().hover();
  await row(page, group.name).click();
  await expectVisible(page.getByText("The monthly basics"));
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "New category" }).click();
  const dialog = page.getByRole("dialog", { name: "New category" });
  await dialog.getByRole("textbox", { name: "Description" }).fill("Repairs and parts");
  await dialog.getByRole("combobox", { name: "Group" }).click();
  await page.getByRole("option", { name: group.name }).click();
  await dialog.locator("input").first().fill("Bike");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expectHidden(dialog);

  await page.getByText("Bike", { exact: true }).first().hover();
  await row(page, "Bike").click();
  await expectVisible(page.getByText("Repairs and parts"));
  await page.getByRole("button", { name: "Edit…" }).click();
  const edit = page.getByRole("dialog", { name: "Edit Bike" });
  await edit.locator("input").first().fill("Bike repairs");
  await edit.getByRole("button", { name: "Save" }).click();
  await expectHidden(edit);

  await page.getByText("Bike repairs", { exact: true }).first().hover();
  await row(page, "Bike repairs").click();
  await page.getByRole("button", { name: "Hide" }).click();
  await expectHidden(page.getByText("Bike repairs", { exact: true }));
  await expectEventually(
    async () => (await all()).find((each) => each.name === "Bike repairs")?.hidden,
    true,
  );

  await page.getByRole("button", { name: /^Budget view/ }).click();
  await page.getByRole("menuitemcheckbox", { name: "Show hidden categories" }).click();
  await page.keyboard.press("Escape");
  await page.getByText("Bike repairs", { exact: true }).first().hover();
  await row(page, "Bike repairs").click();
  await page.getByRole("button", { name: "Show" }).click();
  await expectEventually(
    async () => (await all()).find((each) => each.name === "Bike repairs")?.hidden,
    false,
  );

  await page.getByText("Bike repairs", { exact: true }).first().hover();
  await row(page, "Bike repairs").click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page
    .getByRole("dialog", { name: "Delete Bike repairs" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expectHidden(page.getByText("Bike repairs", { exact: true }));
});

test("dragging a row moves its figures with it, nests it, and stays in its section", async ({
  app,
}) => {
  const { page, run } = app;
  const month = currentMonth();
  await run("create_account", { name: "Checking", balance: 100_000 });
  const groups = await run("list_categories", {});
  const group = groups.find((each) => !each.isIncome)!;
  const income = groups.find((each) => each.isIncome)!;
  const [first, second] = group.categories;
  await run("set_budget", { month, category: first!.id, amount: 1_234 });
  await run("create_category", { name: "Bonus", groupId: income.id, before: null });
  const all = async () => (await run("list_categories", {})).flatMap((each) => each.categories);
  const name = (category: string) => page.getByText(category, { exact: true }).last();
  const handle = (category: string) =>
    page.getByRole("button", { name: `Move ${category}`, exact: true });
  const budgeted = (category: string) =>
    page.getByRole("textbox", { name: `${category} budgeted in ${month}` });
  const top = async (input: Locator) => (await input.boundingBox())!.y;

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${app.url}/budget`);
  await expectVisible(budgeted(first!.name));
  await expectEventually(
    async () => (await top(budgeted(first!.name))) < (await top(budgeted(second!.name))),
    true,
  );

  await drag(page, handle(first!.name), name(second!.name), 0.9);
  await expectEventually(
    async () => (await top(budgeted(first!.name))) > (await top(budgeted(second!.name))),
    true,
  );
  await expectEventually(() => budgeted(first!.name).inputValue(), "12.34");

  await drag(page, handle(first!.name), name(second!.name), 0.5);
  await expectEventually(
    async () => (await all()).find((each) => each.id === first!.id)?.parentId,
    second!.id,
  );
  await expectVisible(page.getByText("incl. subcategories"));

  const income_ = (await run("list_categories", {})).find((each) => each.isIncome)!;
  const order = income_.categories.map((each) => each.name);
  await drag(page, handle("Bonus"), name(order[0]!), 0);
  await expectEventually(
    async () =>
      (await run("list_categories", {})).find((each) => each.isIncome)!.categories[0]!.name,
    "Bonus",
  );

  await drag(page, handle("Bonus"), name(second!.name), 0.9);
  await expectVisible(page.getByText("Bonus stays where it was."));
  await expectEventually(
    async () =>
      (await run("list_categories", {}))
        .find((each) => each.isIncome)!
        .categories.some((each) => each.name === "Bonus"),
    true,
  );
});

test("a dragged row is its own name cell, see-through under the mouse, over a line across the row", async ({
  app,
}) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  const groups = await run("list_categories", {});
  const [first, second] = groups.find((each) => !each.isIncome)!.categories;

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${app.url}/budget`);
  const handle = await page
    .getByRole("button", { name: `Move ${first!.name}`, exact: true })
    .boundingBox();
  const name = await page.getByText(first!.name, { exact: true }).boundingBox();
  const box = await page.getByText(second!.name, { exact: true }).last().boundingBox();
  const grid = await page.locator("main > * > *").first().boundingBox();
  const x = handle!.x + 8;
  const y = box!.y + box!.height * 0.9;

  await page.mouse.move(x, handle!.y + 10);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
  const label = page.locator('[data-slot="drag-label"]');
  const line = page.locator('[data-slot="drop-line"]');
  await expectVisible(label);
  await expectVisible(line);
  const shown = await label.boundingBox();
  const shownName = await label.getByText(first!.name, { exact: true }).boundingBox();
  const drawn = await line.boundingBox();
  const opacity = await label.evaluate((each) => getComputedStyle(each).opacity);
  const frame = await label.evaluate((each) => {
    const { borderTopWidth, borderBottomWidth, borderTopLeftRadius } = getComputedStyle(
      each,
      "::after",
    );
    return [borderTopWidth, borderBottomWidth, borderTopLeftRadius];
  });
  await page.keyboard.press("Escape");
  await page.mouse.up();

  await expectEventually(
    async () => [
      shown!.x <= x && x <= shown!.x + shown!.width,
      shown!.y <= y && y <= shown!.y + shown!.height,
      shownName!.x === name!.x,
      opacity,
      frame,
      drawn!.x <= grid!.x + 1,
      drawn!.x + drawn!.width >= grid!.x + grid!.width - 1,
    ],
    [true, true, true, "0.85", ["1px", "1px", "0px"], true, true],
  );
  await expectHidden(label);
});

test("a nested drop's line starts where that level's names do", async ({ app }) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  const groups = await run("list_categories", {});
  const [first, second] = groups.find((each) => !each.isIncome)!.categories;
  await run("create_category", { name: "Kid", parent: first!.id, before: null });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${app.url}/budget`);
  const handle = await page
    .getByRole("button", { name: `Move ${second!.name}`, exact: true })
    .boundingBox();
  const kid = await page.getByText("Kid", { exact: true }).boundingBox();

  await page.mouse.move(handle!.x + 8, handle!.y + 10);
  await page.mouse.down();
  await page.mouse.move(handle!.x + 8, kid!.y + kid!.height * 0.9, { steps: 12 });
  const line = page.locator('[data-slot="drop-line"]');
  await expectVisible(line);
  const start = (await line.boundingBox())!.x;
  await page.keyboard.press("Escape");
  await page.mouse.up();

  await expectEventually(async () => Math.abs(start - kid!.x) < 1, true);
});

test("income categories and groups can be edited in the grid, with what income can do", async ({
  app,
}) => {
  const { page, run } = app;
  const groups = await run("list_categories", {});
  const income = groups.find((each) => each.isIncome)!;
  const [salary] = income.categories;

  await page.goto(`${app.url}/budget`);
  await page.getByText(income.name, { exact: true }).nth(1).hover();
  await row(page, income.name).first().click();
  const groupCard = page.getByRole("dialog", { name: income.name });
  await expectVisible(groupCard.getByRole("button", { name: "Add category" }));
  await expectHidden(groupCard.getByRole("button", { name: "Delete" }));
  await expectHidden(groupCard.getByRole("button", { name: "Hide" }));
  await page.keyboard.press("Escape");
  await expectHidden(groupCard);

  await page.getByText(salary!.name, { exact: true }).last().hover();
  await row(page, salary!.name).last().click();
  const card = page.getByRole("dialog", { name: salary!.name });
  await expectVisible(card.getByRole("button", { name: "Edit…" }));
  await expectVisible(card.getByRole("button", { name: "Delete" }));
  await expectHidden(card.getByRole("button", { name: "Set a target…" }));
});

test("collapse all folds the budget and is remembered", async ({ app }) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  const groups = await run("list_categories", {});
  const [first] = groups.find((each) => !each.isIncome)!.categories;
  const shown = page.getByText(first!.name, { exact: true });
  const options = page.getByRole("button", { name: /^Budget view/ });

  await page.goto(`${app.url}/budget`);
  await expectVisible(shown);
  await options.click();
  await page.getByRole("menuitem", { name: "Collapse all" }).click();
  await expectHidden(shown);
  await expectVisible(page.getByRole("menuitem", { name: "Expand all" }));
  await page.keyboard.press("Escape");

  await page.reload();
  await expectHidden(shown);
  await options.click();
  await page.getByRole("menuitem", { name: "Expand all" }).click();
  await expectVisible(shown);
});

test("on a phone the same card edits a category, and rows do not drag", async ({ app }) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  const groups = await run("list_categories", {});
  const group = groups.find((each) => !each.isIncome)!;
  const [first] = group.categories;
  await run("update_category", { id: first!.id, description: "What we eat" });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${app.url}/budget`);
  await row(page, first!.name).click();
  const card = page.getByRole("dialog", { name: first!.name });
  await expectVisible(card.getByText("What we eat"));
  await card.getByRole("button", { name: "Edit…" }).click();
  const edit = page.getByRole("dialog", { name: `Edit ${first!.name}` });
  await edit.locator("input").first().fill("Groceries");
  await edit.getByRole("button", { name: "Save" }).click();
  await expectHidden(edit);
  await expectVisible(row(page, "Groceries"));
  await expectCount(page.getByRole("button", { name: /^Move / }), 0);

  await row(page, group.name).click();
  await expectVisible(
    page.getByRole("dialog", { name: group.name }).getByRole("button", { name: "Add category" }),
  );
  await expectEventually(
    () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
});

test("on a phone, Reports is a tab of Home, and Home stays active on a report", async ({ app }) => {
  const { page } = app;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${app.url}/budget`);
  const bar = page.getByRole("navigation", { name: "Pages" });
  await expectCount(bar.getByRole("link", { name: "Reports" }), 0);
  await bar.getByRole("link", { name: "Home" }).click();
  await page.waitForURL(`${app.url}/`);
  await page
    .getByRole("navigation", { name: "Section" })
    .getByRole("link", { name: "Reports" })
    .click();
  await page.waitForURL(`${app.url}/reports`);
  await page
    .getByRole("main")
    .getByRole("link", { name: /^Cash flow/ })
    .click();
  await page.waitForURL(`${app.url}/reports/cash-flow`);
  await expectEventually(
    () => bar.getByRole("link", { name: "Budget" }).getAttribute("aria-current"),
    null,
  );
  await expectEventually(
    () => bar.getByRole("link", { name: "Home" }).getAttribute("aria-current"),
    "page",
  );
});

test("the account dropdown lists every account, adds one and leads to the banks", async ({
  app,
}) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  await run("create_account", { name: "Pension", balance: 500_000, onBudget: false });
  await page.goto(`${app.url}/payees`);
  await expectVisible(page.getByRole("heading", { name: "Payees" }));
  const scope = page.getByRole("button", { name: /^Accounts shown: / });

  await page.keyboard.press("w");
  await expectCount(page.getByRole("dialog"), 0);

  await scope.click();
  await expectVisible(page.getByRole("menuitemradio", { name: /^All budget accounts/ }));
  await expectVisible(page.getByRole("menuitemradio", { name: /^All off-budget accounts/ }));
  await expectVisible(page.getByRole("menuitemradio", { name: /^Pension/ }));
  await page.getByRole("menuitem", { name: "Add account…" }).click();
  await expectVisible(page.getByRole("dialog", { name: /account/i }).last());
  await page.keyboard.press("Escape");

  await scope.click();
  await page.getByRole("menuitem", { name: "Bank connections" }).click();
  await page.waitForURL(`${app.url}/settings/banks`);
});

test("the book menu is as wide as its button, marks the open book and leads to Settings", async ({
  app,
}) => {
  const { page, run } = app;
  await run("create_book", { name: "First" });
  await run("create_book", { name: "Second" });
  await page.goto(`${app.url}/budget`);
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  const book = sidebar.getByRole("button", { name: /^Book: / });
  const home = sidebar.getByRole("link", { name: "Home", exact: true });
  await expectVisible(book);
  await expectEventually(async () => {
    const bookBox = (await book.boundingBox())!;
    const homeBox = (await home.boundingBox())!;
    return [bookBox.x === homeBox.x, bookBox.width === homeBox.width, bookBox.height];
  }, [true, true, 32]);
  await expectCount(sidebar.getByRole("link", { name: "Settings", exact: true }), 0);

  await book.click();
  const label = await book.getAttribute("aria-label");
  await expectEventually(
    async () => `Book: ${await page.getByRole("menuitemradio", { checked: true }).textContent()}`,
    label,
  );
  await expectCount(page.getByRole("menuitemradio"), 2);
  await expectEventually(async () => {
    const menu = (await page.locator('[data-slot="menu-popup"]').boundingBox())!;
    const button = (await book.boundingBox())!;
    return [menu.x - button.x, menu.width - button.width];
  }, [0, 0]);
  await page.getByRole("menuitem", { name: /^Settings/ }).click();
  await page.waitForURL(`${app.url}/settings/general`);
});

test("the toolbar goes back and forward through the pages shown", async ({ app }) => {
  const { page } = app;
  await page.goto(`${app.url}/budget`);
  const back = page.getByRole("button", { name: "Go back" });
  const forward = page.getByRole("button", { name: "Go forward" });
  await expectVisible(back);
  await expectEventually(() => forward.isDisabled(), true);

  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.waitForURL(`${app.url}/`);
  await back.click();
  await page.waitForURL(`${app.url}/budget`);
  await expectEventually(() => forward.isEnabled(), true);
  await forward.click();
  await page.waitForURL(`${app.url}/`);
  await expectEventually(() => forward.isDisabled(), true);
});

test("settings keeps a book's settings on one page, and the theme on its own", async ({ app }) => {
  const { page } = app;
  await page.goto(`${app.url}/budget`);
  await page.getByRole("button", { name: /^Book: / }).click();
  await page.getByRole("menuitem", { name: /^Settings/ }).click();
  await page.waitForURL(`${app.url}/settings/general`);
  const main = page.getByRole("main");
  await expectVisible(main.getByText("My Budget, envelope budget", { exact: true }));
  for (const label of [
    "Currency",
    "Budget type",
    "Date format",
    ...(FEATURES.purchases ? ["Apply receipts automatically"] : []),
  ]) {
    await expectVisible(page.getByText(label, { exact: true }));
  }

  await expectCount(page.getByRole("banner").getByRole("navigation", { name: "Section" }), 0);
  await expectCount(main.getByRole("navigation", { name: "Section" }), 0);
  await page
    .getByRole("complementary", { name: "Sidebar" })
    .getByRole("navigation", { name: "Section" })
    .getByRole("link", { name: "Appearance" })
    .click();
  await page.waitForURL(`${app.url}/settings/appearance`);
  await page.getByRole("button", { name: "Dark" }).click();
  await expectEventually(
    () => page.evaluate(() => document.documentElement.classList.contains("dark")),
    true,
  );
  await expectHidden(page.getByText("Currency"));

  await page.goto(`${app.url}/settings/nonsense`);
  await page.waitForURL(`${app.url}/settings/general`);
  await page.goto(`${app.url}/settings`);
  await page.waitForURL(`${app.url}/settings/general`);

  await expectVisible(page.getByRole("searchbox", { name: "Filter Settings" }));
  await page.keyboard.press("d");
  await page.waitForURL(`${app.url}/docs`);
  await page.getByRole("button", { name: "Go back" }).click();
  await page.waitForURL(`${app.url}/settings/general`);
});

test("an outline button has an input's corner and border", async ({ app }) => {
  const { page } = app;
  await page.goto(`${app.url}/settings/agents`);
  const look = (element: Element) => {
    const style = getComputedStyle(element);
    return `${style.borderTopLeftRadius} ${style.borderTopColor} ${style.backgroundColor}`;
  };
  const control = page.getByRole("main").locator('[data-slot="input-control"]');
  const button = page.getByRole("button", { name: "Copy MCP URL" });
  await expectVisible(button);
  await expectEventually(
    async () => (await button.evaluate(look)) === (await control.evaluate(look)),
    true,
  );
});

test("a book's buttons in Settings are all the height of an input", async ({ app }) => {
  const { page, run } = app;
  await run("list_books", {});
  await run("create_book", { name: "Another" });
  await run("create_book", { name: "Second" });
  await page.goto(`${app.url}/settings/books`);
  const main = page.getByRole("main");
  const open = main.getByRole("button", { name: "Open" });
  await expectVisible(open);
  for (const name of ["Open", "Make default", "Delete"]) {
    const button = main.getByRole("button", { name }).first();
    await expectEventually(
      async () => `${name} ${(await button.boundingBox())?.height}`,
      `${name} 32`,
    );
  }
});

test("a long file path stays inside a phone's card", async ({ app }) => {
  const { page } = app;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${app.url}/settings/general`);
  const name = page.getByRole("main").getByRole("textbox").first();
  await expectEventually(async () => {
    const box = await name.boundingBox();
    return box !== null && box.x + box.width <= 390;
  }, true);
});

test("the window's header holds a page's tabs and actions", async ({ app }) => {
  const { page } = app;
  await page.goto(`${app.url}/accounts`);
  const header = page.getByRole("banner");
  await expectVisible(header.getByRole("navigation", { name: "Section" }));
  await expectVisible(
    header.getByRole("button", {
      name: "Search and commands",
    }),
  );
  await expectCount(header.getByRole("button", { name: /^Live/ }), 0);
});

test("the header shows only the current page's tabs and actions, however many pages were opened", async ({
  app,
}) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 1_000 });
  await page.goto(`${app.url}/payees`);
  const rail = page.getByRole("navigation", { name: "Pages" });
  const header = page.getByRole("banner");
  for (const name of ["Home", "Accounts"]) {
    await rail.getByRole("link", { name, exact: true }).click();
    await expectCount(page.getByRole("navigation", { name: "Section" }), 1);
    await expectCount(page.getByRole("heading", { level: 1 }), 1);
  }
  await expectVisible(header.getByRole("link", { name: "Schedules" }));
  await expectCount(header.getByRole("link", { name: "Products" }), 0);
  await rail.getByRole("link", { name: "Budget", exact: true }).click();
  await expectCount(header.getByRole("navigation", { name: "Section" }), 0);
  await expectCount(header.getByRole("button", { name: "New", exact: true }), 1);
  await rail.getByRole("link", { name: "Home", exact: true }).click();
  await expectVisible(header.getByRole("link", { name: "Dashboards" }));
  await expectCount(header.getByRole("navigation", { name: "Section" }), 1);
  await expectCount(page.getByRole("button", { name: "New", exact: true }), 0);
  await expectCount(page.locator('[data-slot="bar-actions"]').getByRole("link"), 0);
});

test("search opens from the top bar and the keyboard", async ({ app }) => {
  const { page } = app;
  await page.goto(`${app.url}/budget`);
  const input = page.getByPlaceholder(/Search pages, accounts/);
  await page.getByRole("button", { name: "Search and commands" }).click();
  await expectVisible(input);
  await page.keyboard.press("Escape");
  await expectHidden(input);

  await page.keyboard.press("ControlOrMeta+k");
  await expectVisible(input);
  await input.fill("rules");
  await page.keyboard.press("Enter");
  await page.waitForURL(`${app.url}/rules`);
});

test("the sidebar holds no accounts, folds to a rail of icons and remembers it", async ({
  app,
}) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  await page.goto(`${app.url}/budget`);
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  await expectVisible(sidebar.getByRole("link", { name: "Accounts", exact: true }));
  await expectCount(sidebar.getByText("Checking"), 0);

  const width = async () => (await sidebar.boundingBox())?.width;
  await expectEventually(width, 256);
  const toggle = page.getByRole("button", { name: /(Collapse|Expand) sidebar/ });
  const inset = page.locator('[data-slot="page"]');
  const toggleOpen = await toggle.boundingBox();
  const insetTop = (await inset.boundingBox())?.y;
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expectEventually(width, 56);
  await expectEventually(async () => (await toggle.boundingBox())?.x, toggleOpen?.x);
  await expectEventually(async () => (await toggle.boundingBox())?.y, toggleOpen?.y);
  await expectEventually(async () => (await inset.boundingBox())?.y, insetTop);
  await expectVisible(page.getByRole("contentinfo").getByRole("button", { name: /^Live/ }));
  await page.reload();
  await expectEventually(width, 56);

  await page.keyboard.press("ControlOrMeta+b");
  await expectEventually(width, 256);
});

test("settings lays its list over the sidebar, which filters it, cannot fold and leads back", async ({
  app,
}) => {
  const { page } = app;
  await page.goto(`${app.url}/budget`);
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  const forward = page.getByRole("button", { name: "Go forward" });
  const end = async (locator: typeof sidebar) => {
    const box = (await locator.boundingBox())!;
    return box.x + box.width;
  };
  await expectEventually(async () => (await end(forward)) === (await end(sidebar)) - 8, true);
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expectEventually(async () => (await sidebar.boundingBox())?.width, 56);

  await sidebar.getByRole("button", { name: /^Book: / }).click();
  await page.getByRole("menuitem", { name: /^Settings/ }).click();
  await page.waitForURL(`${app.url}/settings/general`);
  await expectEventually(async () => (await sidebar.boundingBox())?.width, 256);
  await expectCount(page.getByRole("button", { name: /(Collapse|Expand) sidebar/ }), 0);
  await expectEventually(async () => (await end(forward)) === (await end(sidebar)) - 8, true);
  await page.keyboard.press("ControlOrMeta+b");
  await expectEventually(async () => (await sidebar.boundingBox())?.width, 256);

  const list = sidebar.getByRole("navigation", { name: "Section" });
  await expectVisible(list.getByRole("link", { name: "General" }));
  const filter = sidebar.getByRole("searchbox", { name: "Filter Settings" });
  await filter.fill("banks");
  await expectVisible(list.getByRole("link", { name: "Banks" }));
  await expectCount(list.getByRole("link"), 1);
  await filter.fill("no such thing");
  await expectCount(list.getByRole("link"), 0);
  await expectVisible(list.getByText("Nothing matches."));

  await sidebar.getByRole("button", { name: "Back to app" }).click();
  await page.waitForURL(`${app.url}/budget`);
  await expectEventually(async () => (await sidebar.boundingBox())?.width, 56);
});

test("the top bar holds a page's tabs at its left, and the scope and actions on the page's edge", async ({
  app,
}) => {
  const { page } = app;
  await page.goto(`${app.url}/accounts/all`);
  const bar = page.getByRole("banner");
  const tabs = bar.getByRole("navigation", { name: "Section" });
  const actions = bar.locator('[data-slot="bar-actions"]');
  const scope = actions.getByRole("button", { name: /^Accounts shown: / });
  await expectVisible(scope);
  await expectVisible(tabs.getByRole("link", { name: "Rules" }));
  const layout = async () => {
    const forward = (await bar.getByRole("button", { name: "Go forward" }).boundingBox())!;
    const tabsBox = (await tabs.boundingBox())!;
    const actionsBox = (await actions.boundingBox())!;
    const pageBox = (await page.locator('[data-slot="page"]').boundingBox())!;
    const contentEnd = actionsBox.x + actionsBox.width - 8;
    return [
      tabsBox.x - (forward.x + forward.width) < 40,
      actionsBox.x > tabsBox.x + tabsBox.width,
      contentEnd - (pageBox.x + pageBox.width),
    ];
  };
  await expectEventually(layout, [true, true, 1]);

  await page.goto(`${app.url}/`);
  await expectVisible(tabs.getByRole("link", { name: "Dashboards" }));
  await expectVisible(actions.getByRole("button", { name: "Add widget" }));
  await expectEventually(layout, [true, true, 1]);
  const selector = bar.getByRole("button", { name: /^Dashboard: / });
  await expectEventually(async () => {
    const tabsBox = (await tabs.boundingBox())!;
    const selectorBox = (await selector.boundingBox())!;
    return selectorBox.x - (tabsBox.x + tabsBox.width) < 16;
  }, true);
});

test("the tabs' pill slides to the next page's tab instead of jumping", async ({ app }) => {
  const { page } = app;
  await page.goto(`${app.url}/accounts/all`);
  const tabs = page.getByRole("navigation", { name: "Section" });
  await expectVisible(tabs.locator(".bg-primary").last());
  const positions = await page.evaluate(
    () =>
      new Promise<ReadonlyArray<number>>((resolve) => {
        const seen = new Set<number>();
        const started = performance.now();
        const tick = () => {
          const pill = [
            ...document.querySelectorAll('nav[aria-label="Section"] .bg-primary'),
          ].pop();
          if (pill !== undefined)
            seen.add(Math.round(new DOMMatrix(getComputedStyle(pill).transform).m41));
          if (performance.now() - started < 1500) requestAnimationFrame(tick);
          else resolve([...seen]);
        };
        tick();
        const link = [
          ...document.querySelectorAll<HTMLElement>('nav[aria-label="Section"] a'),
        ].pop();
        link?.click();
      }),
  );
  await expectEventually(async () => positions.length > 5, true);
});

test("the pill lands on its tab at once when the page moves to another destination", async ({
  app,
}) => {
  const { page } = app;
  await page.goto(`${app.url}/reports`);
  const tabs = page.getByRole("navigation", { name: "Section" });
  await expectVisible(tabs.locator(".bg-primary").last());
  const positions = await page.evaluate(
    () =>
      new Promise<ReadonlyArray<number>>((resolve) => {
        const seen = new Set<number>();
        const started = performance.now();
        const tick = () => {
          const pill = [
            ...document.querySelectorAll('nav[aria-label="Section"] .bg-primary'),
          ].pop();
          if (pill !== undefined)
            seen.add(Math.round(new DOMMatrix(getComputedStyle(pill).transform).m41));
          if (performance.now() - started < 800) requestAnimationFrame(tick);
          else resolve([...seen]);
        };
        tick();
        document.querySelector<HTMLElement>('a[href="/accounts/all"]')?.click();
      }),
  );
  await expectEventually(async () => positions.length <= 3, true);
  await expectVisible(tabs.getByRole("link", { name: "Schedules" }));
});

test("a report keeps Home's tabs with Reports current, and no arrow back", async ({ app }) => {
  const { page } = app;
  await page.goto(`${app.url}/reports`);
  const tabs = page.getByRole("navigation", { name: "Section" });
  await expectCount(tabs.locator('[aria-current="page"]'), 1);
  await expectText(tabs.locator('[aria-current="page"]'), "Reports");

  await page.goto(`${app.url}/reports/tags`);
  const bar = page.getByRole("banner");
  await expectText(bar.getByRole("heading", { level: 1 }), "Tags");
  await expectText(tabs.locator('[aria-current="page"]'), "Reports");
  await expectCount(bar.getByRole("button", { name: "Back", exact: true }), 0);
  await expectVisible(bar.getByRole("combobox", { name: "Report: Tags" }));
});

test("the window's drag regions stand down while a menu hangs over them", async ({ app }) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  await page.goto(`${app.url}/accounts/all`);
  const region = () =>
    page
      .getByRole("banner")
      .evaluate((header) => getComputedStyle(header).getPropertyValue("-webkit-app-region"));
  const scope = page.getByRole("button", { name: /^Accounts shown: / });
  await expectVisible(scope);
  await expectEventually(region, "drag");

  await scope.click();
  await page.getByRole("menuitemradio", { name: /^All budget accounts/ }).click();
  await page.waitForURL(`${app.url}/accounts/budgeted`);
  await expectEventually(region, "drag");

  await scope.click();
  await expectEventually(region, "no-drag");
  await page.getByRole("menuitemradio", { name: /^All accounts/ }).click();
  await page.waitForURL(`${app.url}/accounts/all`);
  await expectEventually(region, "drag");
});

test("what a person must act on sits at the top of the page, not in the bar", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  await run("create_transaction", {
    account: checking.id,
    date: today(),
    amount: -500,
    payee: "Kiosk",
  });
  await page.goto(`${app.url}/budget`);
  const alert = page.locator('[data-slot="page-alerts"]').getByRole("status");
  await expectVisible(alert.getByText(/1 uncategorized transaction worth/));
  await expectCount(page.getByRole("banner").locator("[data-variant]"), 0);
  await expectEventually(async () => {
    const alertBox = (await alert.boundingBox())!;
    const pageBox = (await page.locator('[data-slot="page"]').boundingBox())!;
    const mainBox = (await page.getByRole("main").boundingBox())!;
    return [
      Math.round(alertBox.y + alertBox.height) === Math.round(pageBox.y),
      alertBox.y + alertBox.height <= mainBox.y,
    ];
  }, [true, true]);
  await alert.getByRole("link", { name: "Categorize" }).click();
  await page.waitForURL(`${app.url}/accounts/uncategorized`);
});

test("the launcher steps into a page, backs out and remembers what ran", async ({ app }) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  await page.goto(`${app.url}/budget`);
  const input = page.getByPlaceholder(/Search pages, accounts/);
  const inAccounts = page.getByPlaceholder("Search accounts…");
  await expectVisible(page.getByRole("button", { name: "Search and commands" }));

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("option", { name: "Accounts" }).click();
  await expectVisible(inAccounts);
  await expectVisible(page.getByRole("option", { name: "Checking" }));
  await page.keyboard.press("Escape");
  await expectVisible(input);
  await page.getByRole("option", { name: "Accounts" }).click();
  await inAccounts.press("Backspace");
  await expectVisible(input);

  await input.fill("check");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/accounts\/.+/);
  await expectHidden(input);

  await page.keyboard.press("ControlOrMeta+k");
  const recent = page.getByRole("group", { name: "Recent" });
  await expectVisible(recent.getByRole("option", { name: "Checking" }));
  await page.keyboard.press("Escape");
  await expectHidden(input);
});

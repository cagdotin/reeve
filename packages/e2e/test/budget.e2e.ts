import { addMonths, currentMonth, today } from "@reeve/contract/rules";
import {
  expectEventually,
  expectText,
  expectValues,
  expectVisible,
  test,
} from "../src/fixtures.ts";

test("budgeting an amount to a category takes it from To Budget", async ({ app }) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  const month = today().slice(0, 7);

  await page.goto(`${app.url}/budget`);
  await expectVisible(page.getByRole("button", { name: "To Budget 1,000.00" }));

  const food = page.getByRole("textbox", { name: `Food budgeted in ${month}` });
  await food.fill("250");
  await food.press("Enter");

  await expectVisible(page.getByRole("button", { name: "To Budget 750.00" }));
  await expectVisible(page.getByRole("button", { name: "Food balance", exact: true }));
  await expectText(page.getByRole("button", { name: "Food balance" }), "250.00");

  await page.reload();
  await expectVisible(page.getByRole("button", { name: "To Budget 750.00" }));
  await expectValues(food, ["250.00"]);
});

test("a category's budget menu changes only that category", async ({ app }) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  const month = today().slice(0, 7);
  const groups = await run("list_categories", {});
  const [first, second] = groups.find((group) => !group.isIncome)!.categories;
  await run("set_budget", { month, category: first!.id, amount: 5_000 });
  await run("set_budget", { month, category: second!.id, amount: 7_000 });

  await page.goto(`${app.url}/budget`);
  const firstCell = page.getByRole("textbox", { name: `${first!.name} budgeted in ${month}` });
  await expectValues(firstCell, ["50.00"]);
  await firstCell.hover();
  await page.getByRole("button", { name: `${first!.name} budget actions for ${month}` }).click();
  await page.getByRole("menuitem", { name: "Set budgets to zero" }).click();

  await expectValues(firstCell, [""]);
  await expectValues(page.getByRole("textbox", { name: `${second!.name} budgeted in ${month}` }), [
    "70.00",
  ]);
});

for (const theme of ["dark", "light"] as const)
  test(`in ${theme}, the budget has no background of its own`, async ({ app }) => {
    const { page, run } = app;
    await run("create_account", { name: "Checking", balance: 100_000 });
    const { id: group } = await run("create_category_group", { name: "Usual" });
    await run("create_category", { name: "Food", groupId: group });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto(`${app.url}/budget`);
    const painted = (name: string) =>
      page
        .getByText(name, { exact: true })
        .first()
        .evaluate((start) => {
          const page = getComputedStyle(document.body);
          const fills: string[] = [];
          for (
            let at: Element | null = start;
            at !== null && at.getAttribute("data-slot") !== "page";
            at = at.parentElement
          ) {
            const fill = getComputedStyle(at).backgroundColor;
            if (fill !== "rgba(0, 0, 0, 0)" && fill !== page.backgroundColor) fills.push(fill);
          }
          return `${page.backgroundImage} ${fills.length}`;
        });
    await expectVisible(page.getByText("Food", { exact: true }).first());
    await expectEventually(() => painted("Food"), "none 0");
    await expectEventually(() => painted("Usual"), "none 0");
  });

test("the budget's months and hidden categories are options in one menu", async ({ app }) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  await page.goto(`${app.url}/budget`);
  const view = page.getByRole("button", { name: /^Budget view/ });
  await view.click();

  const next = addMonths(currentMonth(), 1);
  await page.getByRole("menuitem", { name: /^Next month/ }).click();
  await expectEventually(async () => new URL(page.url()).searchParams.get("month"), next);

  await page.getByRole("menuitemradio", { name: "2 months" }).click();
  await expectVisible(page.getByRole("menuitemradio", { name: "2 months", checked: true }));
  await expectVisible(page.getByRole("button", { name: /^Budget view.*–/ }));

  await page.getByRole("menuitem", { name: /^This month/ }).click();
  await expectEventually(async () => new URL(page.url()).searchParams.get("month"), currentMonth());
  await expectVisible(page.getByRole("menuitemcheckbox", { name: "Show hidden categories" }));
});

for (const theme of ["light", "dark"] as const)
  test(`in ${theme}, scrolling months keeps the page alert and category divider in place`, async ({
    app,
  }) => {
    const { page, run } = app;
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1000, height: 700 });
    const account = await run("create_account", { name: "Checking", balance: 100_000 });
    await run("create_transaction", { account: account.id, date: today(), amount: -100 });
    await page.goto(`${app.url}/budget`);
    await page.getByRole("button", { name: /^Budget view/ }).click();
    await page.getByRole("menuitemradio", { name: "3 months" }).click();
    await page.keyboard.press("Escape");
    const alert = page.getByRole("status").filter({ hasText: "uncategorized" });
    await expectVisible(alert);
    const before = await alert.boundingBox();
    const viewport = page
      .locator('[data-slot="scroll-area-viewport"]')
      .filter({ has: page.getByRole("main") });
    await viewport.evaluate((node) => {
      node.scrollLeft = 150;
    });
    await expectEventually(() => viewport.evaluate((node) => node.scrollLeft), 150);
    await expectEventually(async () => (await alert.boundingBox())?.x, before!.x);
    await expectEventually(async () => (await alert.boundingBox())?.width, before!.width);
    const category = page.getByText("Category", { exact: true });
    await expectEventually(
      () => category.evaluate((node) => getComputedStyle(node).borderRightWidth),
      "1px",
    );
    await expectEventually(
      () => category.evaluate((node) => Math.round(node.getBoundingClientRect().left)),
      Math.round((await viewport.boundingBox())!.x),
    );
    await page.setViewportSize({ width: 1000, height: 400 });
    await viewport.evaluate((node) => {
      node.scrollTop = 100;
    });
    await expectEventually(() => viewport.evaluate((node) => node.scrollTop), 100);
    await expectEventually(async () => (await alert.boundingBox())?.y, before!.y);
  });

test("the budget fills the window beside the rail", async ({ app }) => {
  const { page, run } = app;
  await run("create_account", { name: "Checking", balance: 100_000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${app.url}/budget`);
  await expectVisible(page.getByRole("button", { name: /^To Budget/ }));
  await expectEventually(
    () =>
      page.evaluate(() => {
        const main = document.querySelector("main")!;
        return Math.round(main.parentElement!.clientWidth - main.clientWidth);
      }),
    0,
  );
});

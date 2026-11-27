import { today } from "@reeve/contract/rules";
import {
  expectEventually,
  expectHidden,
  expectText,
  expectVisible,
  test,
} from "../src/fixtures.ts";

const monthsAgo = (months: number) => {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - months);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-15`;
};

test("the payees page starts on recent payees and loads earlier ones a month at a time", async ({
  app,
}) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking" });
  const spend = (payee: string, date: string) =>
    run("create_transaction", { account: checking.id, date, amount: -1_000, payee });
  await spend("Corner Grocer", today());
  await spend("Old Bakery", monthsAgo(5));

  await page.goto(`${app.url}/payees`);
  await expectVisible(page.getByRole("checkbox", { name: "Select Corner Grocer" }));
  await expectHidden(page.getByRole("button", { name: "Old Bakery", exact: true }));
  await expectVisible(page.getByText("1 of 2"));

  const more = page.getByRole("button", { name: "Load one more month" });
  await more.click();
  await expectText(page.getByRole("combobox", { name: "Date range" }), "Last 2 months");
  for (const label of ["Last 3 months", "Last 4 months", "Last 5 months"]) {
    await more.click();
    await expectText(page.getByRole("combobox", { name: "Date range" }), label);
  }
  if (await more.isVisible()) await more.click();
  await expectVisible(page.getByRole("button", { name: "Old Bakery", exact: true }));
  await expectVisible(page.getByText("2 of 2"));
  await expectHidden(more);
});

test("a needs-attention item lists its payees, and a filter narrows them", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  await run("create_transaction", {
    account: checking.id,
    date: today(),
    amount: -1_000,
    payee: "Corner Grocer",
  });
  await run("create_payee", { name: "Never Bought" });

  await page.goto(`${app.url}/payees`);
  await expectHidden(page.getByRole("button", { name: "Never Bought", exact: true }));
  await page.getByRole("button", { name: "1 never used" }).click();
  await expectVisible(page.getByRole("button", { name: "Never Bought", exact: true }));
  await expectHidden(page.getByRole("checkbox", { name: "Select Corner Grocer" }));
  await expectText(page.getByRole("combobox", { name: "Date range" }), "All time");
  await expectVisible(page.getByRole("button", { name: "Remove the Use, all time filter" }));
});

test("a payee gets a description, and renaming it onto another offers a merge", async ({ app }) => {
  const { page, run } = app;
  await run("create_payee", { name: "Billa" });
  await run("create_payee", { name: "Bila" });

  await page.goto(`${app.url}/payees`);
  await page.getByRole("combobox", { name: "Date range" }).click();
  await page.getByRole("option", { name: "All time" }).click();

  await page.getByRole("button", { name: "Bila", exact: true }).click();
  const dialog = page.getByRole("region", { name: "Panel" });
  await dialog.getByRole("textbox", { name: "Description" }).fill("Typo of the supermarket");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expectVisible(page.getByText("Typo of the supermarket"));

  await page.getByRole("button", { name: "Bila", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Name" }).fill("billa");
  await dialog.getByRole("button", { name: "Merge into Billa" }).click();
  await expectHidden(page.getByRole("button", { name: "Bila", exact: true }));
  await expectVisible(page.getByText("Typo of the supermarket"));
});

test("merging selected payees asks which to keep", async ({ app }) => {
  const { page, run } = app;
  await run("create_payee", { name: "Alpha" });
  await run("create_payee", { name: "Beta" });

  await page.goto(`${app.url}/payees`);
  await page.getByRole("combobox", { name: "Date range" }).click();
  await page.getByRole("option", { name: "All time" }).click();
  await page.getByRole("checkbox", { name: "Select Alpha" }).click();
  await page.getByRole("checkbox", { name: "Select Beta" }).click();
  await page.getByRole("button", { name: "Merge…" }).click();
  const dialog = page.getByRole("dialog", { name: "Merge 2 payees" });
  await dialog.getByRole("radio", { name: /Beta/ }).click();
  await dialog.getByRole("button", { name: "Merge" }).click();
  await expectHidden(page.getByRole("button", { name: "Alpha", exact: true }));
  await expectVisible(page.getByRole("button", { name: "Beta", exact: true }));
});

test("deleting a payee says what it does to its rules, and a schedule blocks it", async ({
  app,
}) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking", balance: 100_000 });
  await run("create_schedule", {
    name: "Rent",
    payee: "Landlord",
    account: checking.id,
    amount: -1_000,
    date: today(),
  });
  const lidl = await run("create_payee", { name: "Lidl" });
  await run("create_rule", {
    stage: "default",
    conditionsOp: "and",
    conditions: [{ op: "is", field: "payee", value: lidl.id }],
    actions: [{ op: "set", field: "notes", value: "shop" }],
  });

  await page.goto(`${app.url}/payees`);
  await page.getByRole("combobox", { name: "Date range" }).click();
  await page.getByRole("option", { name: "All time" }).click();

  await page.getByRole("button", { name: "Landlord options" }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  const blocked = page.getByRole("dialog", { name: "Delete Landlord?" });
  await expectVisible(blocked.getByText("used by a schedule"));
  await expectVisible(
    blocked.getByRole("button", { name: "Delete" }).and(page.locator("[disabled]")),
  );
  await blocked.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Lidl options" }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete Lidl?" });
  await expectVisible(dialog.getByText("1 rule naming it"));
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expectHidden(page.getByRole("button", { name: "Lidl", exact: true }));
});

test("the Learn header explains itself, and a payee links to its rules", async ({ app }) => {
  const { page, run } = app;
  const lidl = await run("create_payee", { name: "Lidl" });
  await run("create_payee", { name: "Aldi" });
  await run("create_rule", {
    stage: "default",
    conditionsOp: "and",
    conditions: [{ op: "is", field: "payee", value: lidl.id }],
    actions: [{ op: "set", field: "notes", value: "shop" }],
  });

  await page.goto(`${app.url}/payees`);
  await page.getByRole("combobox", { name: "Date range" }).click();
  await page.getByRole("option", { name: "All time" }).click();

  await page.getByRole("button", { name: "Learn categories: what this does" }).hover();
  await expectVisible(page.getByText("If 3 or more share a category"));
  await page.mouse.move(0, 0);

  await page.getByRole("link", { name: "Lidl rules" }).click();
  await expectVisible(
    page.getByRole("heading", { name: "Rules" }).or(page.getByText("Rules").first()),
  );
  await expectVisible(page.getByRole("button", { name: /payee is Lidl/ }));
});

test("the filters open the page and stick, and a header sorts the table", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking" });
  const names = Array.from({ length: 40 }, (_, i) => `Shop ${String(i).padStart(2, "0")}`);
  for (const [i, payee] of names.entries())
    await run("create_transaction", {
      account: checking.id,
      date: today(),
      amount: -(100 + i),
      payee,
    });

  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto(`${app.url}/payees`);
  const filters = page.getByTestId("payee-filters");
  await expectVisible(filters);
  await expectHidden(page.getByRole("region", { name: "Top payees" }));
  // The filters open the page, with no overview above them.
  const viewport = page.locator('[data-slot="scroll-area-viewport"]:has([data-slot="page"])');
  await viewport.evaluate((element) => {
    element.scrollTop = 500;
  });
  const stuck = async () => {
    const [bar, area] = await Promise.all([filters.boundingBox(), viewport.boundingBox()]);
    return bar!.y === area!.y;
  };
  await expectEventually(stuck, true);
  await expectVisible(page.getByRole("button", { name: "Sort by Spent in the range" }));

  const first = () => page.getByRole("checkbox", { name: /^Select / }).first();
  await page.getByRole("button", { name: "Sort by Payee" }).click();
  await expectEventually(() => first().getAttribute("aria-label"), "Select Shop 00");
  await page.getByRole("button", { name: "Sort by Payee" }).click();
  await expectEventually(() => first().getAttribute("aria-label"), "Select Shop 39");
  await page.getByRole("button", { name: "Sort by Spent in the range" }).click();
  await expectEventually(() => first().getAttribute("aria-label"), "Select Shop 39");
});

test("the table folds to the width it has, with nothing wider than the page", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking" });
  await run("create_transaction", {
    account: checking.id,
    date: today(),
    amount: -100,
    payee: "Corner Grocer",
  });
  await page.goto(`${app.url}/payees`);
  const viewport = page.locator('[data-slot="scroll-area-viewport"]:has([data-slot="page"])');
  const fits = () => viewport.evaluate((element) => element.scrollWidth <= element.clientWidth);

  for (const width of [1440, 1100, 900, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await expectVisible(page.getByRole("button", { name: "Corner Grocer options" }));
    await expectEventually(fits, true);
  }
  await expectVisible(page.getByRole("button", { name: "Sort by Last transaction" }));
  await expectHidden(page.getByRole("button", { name: "Sort by Spent in the range" }));
});

test("the checks are page alerts over the table, with no overview cards", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking" });
  await run("create_transaction", {
    account: checking.id,
    date: today(),
    amount: -2_500,
    payee: "Lidl",
  });
  await page.goto(`${app.url}/payees`);

  await expectVisible(page.getByRole("button", { name: "Lidl options" }));
  await expectHidden(page.locator('[data-slot="page-alerts"] [data-variant]'));
  for (const gone of ["Summary", "Top payees", "Changes"])
    await expectHidden(page.getByRole("region", { name: gone }));

  await run("create_payee", { name: "Unused Shop" });
  const check = page.getByRole("button", { name: "1 never used" });
  await check.click();
  await expectVisible(page.getByRole("button", { name: "Unused Shop options" }));
  await expectHidden(page.getByRole("button", { name: "Lidl options" }));
  await check.click();
  await expectVisible(page.getByRole("button", { name: "Lidl options" }));
});

test("a filter drops hidden payees from the selection", async ({ app }) => {
  const { page, run } = app;
  await run("create_payee", { name: "Alpha" });
  await run("create_payee", { name: "Beta" });

  await page.goto(`${app.url}/payees`);
  await page.getByRole("combobox", { name: "Date range" }).click();
  await page.getByRole("option", { name: "All time" }).click();
  await page.getByRole("checkbox", { name: "Select Alpha" }).click();
  await page.getByRole("checkbox", { name: "Select Beta" }).click();
  await expectVisible(page.getByText("2 selected"));
  await page
    .getByRole("textbox", { name: "Search payees" })
    .or(page.getByRole("searchbox", { name: "Search payees" }))
    .fill("Alpha");
  await expectVisible(page.getByText("1 selected"));
});

test("payees that look like one merge in one click, and later imports follow", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking" });
  const spend = (payee: string) =>
    run("create_transaction", { account: checking.id, date: today(), amount: -1_000, payee });
  await spend("Spar");
  await spend("Spar");
  await spend("Spar Dankt");
  await spend("Trafik");
  await spend("Trafik Otto");

  await page.goto(`${app.url}/payees`);
  await page.getByRole("button", { name: "Review" }).click();
  const spar = page.getByRole("region", { name: "Payees like Spar" });
  await spar.getByRole("button", { name: "Merge into Spar" }).click();
  await expectHidden(spar);
  const trafik = page.getByRole("region", { name: /Payees like Trafik/ });
  await trafik.getByRole("button", { name: "Keep apart" }).click();
  await expectVisible(page.getByText("Nothing left to review."));
  await page.getByRole("button", { name: "Done" }).click();
  await expectHidden(page.getByRole("button", { name: "Review" }));

  await run("import_transactions", {
    account: checking.id,
    rows: [{ date: today(), amount: -500, payee: "Spar Dankt" }],
  });
  const names = async () =>
    (await run("list_payees", {})).map((payee: { name: string }) => payee.name).join(", ");
  await expectEventually(names, "Spar, Trafik, Trafik Otto");
});

test("payees that look like one fit the review dialog, however long their names", async ({
  app,
}) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking" });
  for (const payee of [
    "Interspar",
    "Interspar Dankt",
    "Interspar    2361  K2   01.06. 19:44 Wien Hauptstrasse Filiale Nummer Zwei",
  ])
    await run("create_transaction", { account: checking.id, date: today(), amount: -1_000, payee });

  await page.goto(`${app.url}/payees`);
  await page.getByRole("button", { name: "Review" }).click();
  const dialog = page.getByRole("dialog", { name: "Payees that look like one" });
  await expectVisible(dialog.getByRole("button", { name: "Merge into Interspar" }));
  await expectEventually(
    () =>
      dialog.evaluate((element) =>
        [element, ...element.querySelectorAll("*")].every(
          (each) =>
            !["auto", "scroll"].includes(getComputedStyle(each).overflowX) ||
            each.scrollWidth <= each.clientWidth,
        ),
      ),
    true,
  );
});

test("payees that look like one merge under a new name", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking" });
  for (const payee of ["Mcdonalds194", "Mcdonalds194", "Mcdonalds107", "Mcdonalds 14"])
    await run("create_transaction", { account: checking.id, date: today(), amount: -1_000, payee });

  await page.goto(`${app.url}/payees`);
  await page.getByRole("button", { name: "Review" }).click();
  const group = page.getByRole("region", { name: "Payees like Mcdonalds194" });
  const into = group.getByRole("combobox", { name: "Merge into" });
  await into.fill("McDonald's");
  await into.press("Tab");
  await expectVisible(group.getByText("Mcdonalds194 is renamed McDonald's."));
  await group.getByRole("button", { name: "Merge into McDonald's" }).click();
  await expectVisible(page.getByText("Nothing left to review."));

  await run("import_transactions", {
    account: checking.id,
    rows: [{ date: today(), amount: -500, payee: "Mcdonalds107" }],
  });
  const names = async () =>
    (await run("list_payees", {})).map((payee: { name: string }) => payee.name).join(", ");
  await expectEventually(names, "McDonald's");
});

test("payees that look like one merge into a payee picked from the book", async ({ app }) => {
  const { page, run } = app;
  const checking = await run("create_account", { name: "Checking" });
  for (const payee of ["Trafik Lena", "Trafik Lena", "Trafik Otto", "Trafik", "Tabak Trafik Mila"])
    await run("create_transaction", { account: checking.id, date: today(), amount: -1_000, payee });

  await page.goto(`${app.url}/payees`);
  await page.getByRole("button", { name: "Review" }).click();
  const group = page.getByRole("region", { name: "Payees like Trafik Lena" });
  const into = group.getByRole("combobox", { name: "Merge into" });
  await into.fill("Tabak");
  await page.getByRole("option", { name: "Tabak Trafik Mila" }).click();
  await expectVisible(
    group.getByText("All of them join Tabak Trafik Mila, a payee you already have."),
  );
  await group.getByRole("button", { name: "Merge into Tabak Trafik Mila" }).click();
  await expectHidden(group);

  await run("import_transactions", {
    account: checking.id,
    rows: [{ date: today(), amount: -500, payee: "Trafik Otto" }],
  });
  const payees = async () =>
    (await run("list_payees", {}))
      .map(
        (payee: { name: string; transactionCount: number }) =>
          `${payee.name} ${payee.transactionCount}`,
      )
      .join(", ");
  await expectEventually(payees, "Tabak Trafik Mila 6");
});

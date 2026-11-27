import { addDays, today } from "@reeve/contract/rules";
import {
  type App,
  expectEventually,
  expectHidden,
  expectText,
  expectVisible,
  test,
} from "../src/fixtures.ts";

const monthsAgo = (months: number, day: number) => {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() - months);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const seedAccount = async (run: App["run"]) =>
  (await run("create_account", { name: "Checking", balance: 500_000 })).id;

test("the table lists schedules by urgency, and post and skip move them on", async ({ app }) => {
  const { page, run } = app;
  const account = await seedAccount(run);
  await run("create_schedule", {
    name: "Car tax",
    account,
    amount: -18_500,
    amountOp: "is",
    date: addDays(today(), -4),
  });
  const rent = await run("create_schedule", {
    name: "Rent",
    account,
    amount: -120_000,
    amountOp: "is",
    date: addDays(today(), 3),
    frequency: "monthly",
  });
  const gym = await run("create_schedule", {
    name: "Gym",
    account,
    amount: -3_500,
    amountOp: "isapprox",
    date: addDays(today(), 20),
    frequency: "monthly",
  });

  await page.goto(`${app.url}/schedules`);
  await expectVisible(page.getByText("Missed", { exact: true }).first());
  await expectVisible(page.getByText("~35.00"));
  await expectVisible(page.getByRole("button", { name: "2 of 3" }).or(page.getByText("3 of 3")));

  await page.getByRole("button", { name: "Rent", exact: true }).hover();
  await page.getByRole("button", { name: "Skip Rent" }).click();
  await expectEventually(
    async () => (await run("get_schedule", { id: rent.id })).nextDate !== rent.nextDate,
    true,
  );

  await page.getByRole("button", { name: "Gym", exact: true }).hover();
  await page.getByRole("button", { name: "Post Gym" }).click();
  await expectEventually(
    async () => (await run("get_schedule", { id: gym.id })).nextDate !== gym.nextDate,
    true,
  );
  await expectEventually(
    async () =>
      (await run("list_transactions", { account })).rows.filter(
        (row: { amount: number }) => row.amount === -3_500,
      ).length,
    1,
  );
});

test("a check filters the table, and clicking it again clears", async ({ app }) => {
  const { page, run } = app;
  const account = await seedAccount(run);
  await run("create_schedule", {
    name: "Car tax",
    account,
    amount: -18_500,
    amountOp: "is",
    date: addDays(today(), -4),
  });
  await run("create_schedule", {
    name: "Rent",
    account,
    amount: -120_000,
    amountOp: "is",
    date: addDays(today(), 3),
    frequency: "monthly",
  });

  await page.goto(`${app.url}/schedules`);
  const check = page.getByRole("button", { name: "1 missed", exact: true });
  await check.click();
  await expectHidden(page.getByRole("button", { name: "Rent", exact: true }));
  await expectVisible(page.getByRole("button", { name: "Car tax", exact: true }));
  await check.click();
  await expectVisible(page.getByRole("button", { name: "Rent", exact: true }));
});

test("charges that settled elsewhere show as charged differently", async ({ app }) => {
  const { page, run } = app;
  const account = await seedAccount(run);
  for (const [months, amount] of [
    [3, -1_299],
    [2, -1_599],
    [1, -1_599],
  ] as const)
    await run("create_transaction", {
      account,
      date: monthsAgo(months, 15),
      amount,
      payee: "Netflix",
    });
  await run("create_schedule", {
    name: "Netflix",
    payee: "Netflix",
    account,
    amount: -1_299,
    amountOp: "isapprox",
    date: monthsAgo(4, 15),
    frequency: "monthly",
  });
  await run("create_schedule", {
    name: "Rent",
    account,
    amount: -120_000,
    amountOp: "is",
    date: addDays(today(), 3),
    frequency: "monthly",
  });

  await page.goto(`${app.url}/schedules`);
  await page.getByRole("button", { name: "1 charged differently" }).click();
  await expectVisible(page.getByRole("button", { name: "Netflix", exact: true }));
  await expectHidden(page.getByRole("button", { name: "Rent", exact: true }));
  await expectVisible(page.getByText("15.99"));
});

test("a sortable header replaces the urgency groups, and a third click brings them back", async ({
  app,
}) => {
  const { page, run } = app;
  const account = await seedAccount(run);
  await run("create_schedule", {
    name: "Car tax",
    account,
    amount: -18_500,
    amountOp: "is",
    date: addDays(today(), -4),
  });
  await run("create_schedule", {
    name: "Rent",
    account,
    amount: -120_000,
    amountOp: "is",
    date: addDays(today(), 3),
    frequency: "monthly",
  });

  await page.goto(`${app.url}/schedules`);
  const group = page.getByText("Upcoming", { exact: true });
  await expectVisible(group);
  const header = page.getByRole("button", { name: "Sort by Expected amount" });
  await header.click();
  await expectHidden(group);
  const names = () =>
    page
      .getByRole("button", { name: /^(Car tax|Rent)$/ })
      .evaluateAll((items) => items.map((item) => item.textContent));
  await expectEventually(names, ["Rent", "Car tax"]);
  await header.click();
  await expectEventually(names, ["Car tax", "Rent"]);
  await header.click();
  await expectVisible(group);
});

test("a filter narrows to one payee", async ({ app }) => {
  const { page, run } = app;
  const account = await seedAccount(run);
  for (const [name, payee] of [
    ["Rent", "Landlord"],
    ["Gym", "Gym Club"],
  ] as const)
    await run("create_schedule", {
      name,
      payee,
      account,
      amount: -1_000,
      amountOp: "is",
      date: addDays(today(), 3),
      frequency: "monthly",
    });

  await page.goto(`${app.url}/schedules`);
  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByLabel("Search filters").fill("Gym Club");
  await page.getByRole("checkbox", { name: /Gym Club/ }).click();
  await page.keyboard.press("Escape");
  await expectHidden(page.getByRole("button", { name: "Rent", exact: true }));
  await expectVisible(page.getByRole("button", { name: "Gym", exact: true }));
  await expectVisible(page.getByText("1 of 2"));
});

test("completed schedules wait behind the status filter, and can be restored", async ({ app }) => {
  const { page, run } = app;
  const account = await seedAccount(run);
  const done = await run("create_schedule", {
    name: "Old magazine",
    account,
    amount: -900,
    amountOp: "is",
    date: addDays(today(), 5),
    frequency: "monthly",
  });
  await run("create_schedule", {
    name: "Rent",
    account,
    amount: -120_000,
    amountOp: "is",
    date: addDays(today(), 3),
    frequency: "monthly",
  });
  await run("complete_schedule", { id: done.id });

  await page.goto(`${app.url}/schedules`);
  await expectVisible(page.getByRole("button", { name: "Rent", exact: true }));
  await expectHidden(page.getByRole("button", { name: "Old magazine", exact: true }));
  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByRole("checkbox", { name: /Completed/ }).click();
  await page.keyboard.press("Escape");
  await expectVisible(page.getByRole("button", { name: "Old magazine", exact: true }));
  await page.getByRole("button", { name: "Old magazine options" }).click();
  await page.getByRole("menuitem", { name: "Restore" }).click();
  await expectEventually(async () => (await run("get_schedule", { id: done.id })).completed, false);
});

test("deleting asks first and says what stays", async ({ app }) => {
  const { page, run } = app;
  const account = await seedAccount(run);
  const rent = await run("create_schedule", {
    name: "Rent",
    payee: "Landlord",
    account,
    amount: -120_000,
    amountOp: "is",
    date: monthsAgo(2, 1),
    frequency: "monthly",
  });
  await run("create_transaction", {
    account,
    date: monthsAgo(1, 1),
    amount: -120_000,
    payee: "Landlord",
  });

  await page.goto(`${app.url}/schedules`);
  await page.getByRole("button", { name: "Rent options" }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete Rent?" });
  await expectVisible(dialog.getByText(/1 linked transaction stay/));
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expectVisible(page.getByRole("button", { name: "Rent", exact: true }));
  await expectEventually(
    async () => (await run("list_schedules", {})).some((each) => each.id === rent.id),
    true,
  );

  await page.getByRole("button", { name: "Rent options" }).click();
  await page.getByRole("menuitem", { name: "Delete…" }).click();
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expectEventually(async () => (await run("list_schedules", {})).length, 0);
  await expectHidden(page.getByRole("button", { name: "Rent", exact: true }));
  await expectEventually(
    async () => (await run("list_transactions", { account })).rows.length >= 1,
    true,
  );
});

test("the editor reads as a sentence, previews dates and keeps every field", async ({ app }) => {
  const { page, run } = app;
  const account = await seedAccount(run);
  await page.goto(`${app.url}/schedules`);
  await page.getByRole("button", { name: "New schedule" }).click();
  const dialog = page.getByRole("region", { name: "Panel" });
  await dialog.getByRole("textbox", { name: "Name" }).fill("Power");
  await dialog.getByRole("textbox", { name: "Payee" }).fill("Wien Energie");
  const choose = async (label: string, option: string) => {
    await dialog.getByRole("combobox", { name: label, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  };
  await choose("Amount type", "between");
  await dialog.getByRole("textbox", { name: "Amount", exact: true }).fill("90");
  await dialog.getByRole("textbox", { name: "Amount to" }).fill("120");
  await choose("Account", "Checking");
  await dialog.getByRole("textbox", { name: "Starting" }).fill("2030-01-15");
  await expectVisible(dialog.getByText("Every month on the 15th"));
  await expectVisible(dialog.getByRole("list", { name: "Next dates" }).getByText("Jan 15"));

  await choose("Weekends", "moves to the Friday before");
  await choose("Ends", "after");
  await dialog.getByRole("textbox", { name: "Times" }).fill("6");
  await expectVisible(dialog.getByText(/6 times/));
  await choose("Date match", "on the day");
  await dialog.getByRole("textbox", { name: "Notes" }).fill("Meter 42");
  await dialog.getByRole("checkbox", { name: /automatically/ }).click();
  await dialog.getByRole("button", { name: "Create schedule" }).click();
  await expectHidden(dialog);

  const [made] = await run("list_schedules", {});
  await expectEventually(
    async () => ({
      name: made?.name,
      account: made?.accountId,
      amount: made?.amount,
      posts: made?.postsTransaction,
      dateOp: made?.dateOp,
      notes: made?.notes,
      date: made?.date,
    }),
    {
      name: "Power",
      account,
      amount: { op: "isbetween", value: { num1: -9_000, num2: -12_000 } },
      posts: true,
      dateOp: "is",
      notes: "Meter 42",
      date: {
        start: "2030-01-15",
        frequency: "monthly",
        interval: 1,
        patterns: [],
        skipWeekend: true,
        weekendSolveMode: "before",
        endMode: "after_n_occurrences",
        endOccurrences: 6,
      },
    },
  );

  await page.getByRole("button", { name: "Power", exact: true }).click();
  const edit = page.getByRole("region", { name: "Panel" });
  await expectText(edit.getByRole("combobox", { name: "Amount type" }), "between");
  await edit.getByRole("textbox", { name: "Amount to" }).fill("130");
  await edit.getByRole("button", { name: "On specific days" }).click();
  await edit.getByRole("button", { name: "Save" }).click();
  await expectHidden(edit);
  const after = await run("get_schedule", { id: made!.id });
  await expectEventually(async () => after.amount, {
    op: "isbetween",
    value: { num1: -9_000, num2: -13_000 },
  });
  await expectEventually(
    async () => (typeof after.date === "object" ? after.date.patterns : []),
    [{ type: "day", value: 1 }],
  );
});

test("what repeats in the history becomes a schedule from its alert, or hides", async ({ app }) => {
  const { page, run } = app;
  const account = await seedAccount(run);
  for (const months of [4, 3, 2, 1])
    await run("create_transaction", {
      account,
      date: monthsAgo(months, 10),
      amount: -2_199,
      payee: "Adobe",
    });

  await page.goto(`${app.url}/schedules`);
  const alert = page
    .getByRole("status")
    .filter({ hasText: "1 repeating transaction has no schedule" });
  const found = page.getByRole("dialog", { name: "Found in your history" });

  // Hiding one keeps a way back.
  await alert.getByRole("button", { name: "Review" }).click();
  await found.getByRole("button", { name: "Hide Adobe" }).click();
  await expectHidden(alert);
  await expectVisible(found.getByRole("button", { name: "Show 1 hidden" }));
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Show them" }).click();

  await alert.getByRole("button", { name: "Review" }).click();
  await found.getByRole("button", { name: /Make a schedule for Adobe/ }).click();
  const dialog = page.getByRole("region", { name: "Panel" });
  await expectVisible(dialog.getByText("Every month on the 10th"));
  await dialog.getByRole("button", { name: "Create schedule" }).click();
  await expectHidden(alert);
  await expectEventually(
    async () => {
      const [made] = await run("list_schedules", {});
      return { payee: made?.payee, amount: made?.amount };
    },
    { payee: "Adobe", amount: { op: "is", value: -2_199 } },
  );
});

test("the page fits a phone with no sideways scroll", async ({ app }) => {
  const { page, run } = app;
  const account = await seedAccount(run);
  await run("create_schedule", {
    name: "Rent",
    account,
    amount: -120_000,
    amountOp: "is",
    date: addDays(today(), 3),
    frequency: "monthly",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${app.url}/schedules`);
  await expectVisible(page.getByRole("button", { name: "Rent", exact: true }));
  await expectEventually(
    () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
  );
});

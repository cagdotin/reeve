import { addMonths, currentMonth, today } from "@reeve/contract/rules";
import { createOperations, type Operations } from "@reeve/contract/operations";

type Run = Operations["run"];

/** Six months of an ordinary household, so every screen has something true to show. */
export async function seed(run: Run) {
  const checking = await run("create_account", { name: "Everyday Checking", balance: 412_300 });
  const savings = await run("create_account", { name: "Rainy Day Savings", balance: 1_250_000 });
  const card = await run("create_account", { name: "Travel Card", balance: -84_210 });
  const brokerage = await run("create_account", {
    name: "Index Fund",
    balance: 3_180_000,
    onBudget: false,
  });

  // An account's starting balance is dated today; six months back gives the charts a history.
  const start = `${addMonths(currentMonth(), -6)}-01`;
  const { rows } = await run("list_transactions", { limit: 10 });
  for (const row of rows) await run("update_transaction", { id: row.transactionId, date: start });

  const groups = await run("list_categories", {});
  const usual = groups.find((group) => group.name === "Usual Expenses")!;
  const named = (name: string) =>
    groups.flatMap((group) => group.categories).find((category) => category.name === name)!.id;
  const food = named("Food");
  const general = named("General");
  const bills = named("Bills");
  const income = named("Income");
  const dining = await run("create_category", { name: "Dining out", groupId: usual.id });
  const transport = await run("create_category", { name: "Transport", groupId: usual.id });
  const fun = await run("create_category", { name: "Fun", groupId: usual.id });

  const budgets: ReadonlyArray<readonly [string, number]> = [
    [food, 45_000],
    [dining.id, 18_000],
    [transport.id, 12_000],
    [bills, 145_000],
    [general, 20_000],
    [fun.id, 15_000],
  ];

  const now = today();
  const dayOfMonth = Number(now.slice(8));
  const purchases: ReadonlyArray<
    readonly [day: number, payee: string, category: string, cents: number, account: string]
  > = [
    [2, "Corner Grocer", food, 6_420, checking.id],
    [3, "City Transit", transport.id, 4_900, checking.id],
    [5, "Noodle House", dining.id, 3_250, card.id],
    [8, "Corner Grocer", food, 8_915, checking.id],
    [11, "Hardware Barn", general, 2_740, card.id],
    [12, "Cinema Paradiso", fun.id, 2_400, card.id],
    [15, "Corner Grocer", food, 7_130, checking.id],
    [18, "Noodle House", dining.id, 4_180, card.id],
    [22, "Fresh Market", food, 5_260, checking.id],
    [25, "Record Store", fun.id, 3_600, card.id],
    [27, "City Transit", transport.id, 2_100, checking.id],
  ];

  for (let back = 5; back >= 0; back--) {
    const month = addMonths(currentMonth(), -back);
    const on = (day: number) => `${month}-${String(day).padStart(2, "0")}`;
    const happened = (day: number) => back > 0 || day <= dayOfMonth;
    if (happened(1))
      await run("create_transaction", {
        account: checking.id,
        date: on(1),
        amount: 345_000,
        payee: "Acme Payroll",
        category: income,
      });
    if (happened(1))
      await run("create_transaction", {
        account: checking.id,
        date: on(1),
        amount: -120_000,
        payee: "Landlord",
        category: bills,
      });
    if (happened(9))
      await run("create_transaction", {
        account: checking.id,
        date: on(9),
        amount: -6_500,
        payee: "Power & Light",
        category: bills,
      });
    if (happened(4))
      await run("create_transaction", {
        account: checking.id,
        date: on(4),
        amount: -30_000,
        transferAccount: savings.id,
      });
    for (const [day, payee, category, cents, account] of purchases)
      if (happened(day))
        await run("create_transaction", {
          account,
          date: on(day),
          amount: -Math.round(cents * (1 + ((back * 7) % 5) / 12)),
          payee,
          category,
          cleared: back > 0,
        });
    for (const [category, amount] of budgets) await run("set_budget", { month, category, amount });
  }

  await run("create_transaction", {
    account: checking.id,
    date: now,
    amount: -1_899,
    payee: "Unknown Merchant",
  });
  await run("create_transaction", {
    account: card.id,
    date: now,
    amount: -4_250,
    payee: "Bookshop",
    notes: "#gift for a friend",
  });

  await run("create_schedule", {
    name: "Rent",
    account: checking.id,
    amount: -120_000,
    amountOp: "is",
    date: `${addMonths(currentMonth(), 1)}-01`,
    frequency: "monthly",
  });
  await run("create_schedule", {
    name: "Gym",
    account: card.id,
    amount: -3_500,
    amountOp: "isapprox",
    date: `${addMonths(currentMonth(), 1)}-06`,
    frequency: "monthly",
  });
  await run("create_schedule", {
    name: "Payroll",
    account: checking.id,
    amount: 345_000,
    amountOp: "is",
    date: `${addMonths(currentMonth(), 1)}-01`,
    frequency: "monthly",
  });

  await run("create_rule", {
    conditions: [{ field: "payee", op: "contains", value: "Grocer" }],
    actions: [{ op: "set", field: "category", value: food }],
    recategorize: false,
  });
  await run("create_rule", {
    conditions: [{ field: "payee", op: "contains", value: "Noodle" }],
    actions: [{ op: "set", field: "category", value: dining.id }],
    recategorize: false,
  });

  return { checking, savings, card, brokerage, food };
}

if (import.meta.main) {
  const url = process.argv[2];
  if (url === undefined) throw new Error("Usage: node seed.ts <server url>");
  await seed(createOperations(url).run);
  console.log("seeded");
}

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
beforeEach(() => {
  s = scratch();
});
afterEach(() => s.dispose());

/**
 * A book with a checking account (1,000.00 on 2026-01-01), a credit card, an off-budget brokerage
 * account and a few months of spending, income and transfers.
 */
const setup = async () => {
  const book = (await s.call("create_book", { name: "Reports" })).id as string;
  const groups = await s.call("list_categories", { book });
  const usual = groups[0];
  const category = (name: string) =>
    groups.flatMap((g: any) => g.categories).find((c: any) => c.name === name);
  const food = category("Food");
  const bills = category("Bills");
  const income = category("Income");
  const savings = category("Savings");
  const checking = await s.call("create_account", {
    book,
    name: "Checking",
    balance: 100000,
    date: "2026-01-01",
  });
  const card = await s.call("create_account", { book, name: "Visa", type: "liability" });
  const brokerage = await s.call("create_account", {
    book,
    name: "Brokerage",
    onBudget: false,
    balance: 500000,
    date: "2026-01-01",
  });
  const tx = (input: Record<string, unknown>) =>
    s.call("create_transaction", { book, account: checking.id, ...input });
  return { book, usual, food, bills, income, savings, checking, card, brokerage, tx };
};

describe("net worth", () => {
  it("sums each account's balance per month, splitting assets and debt", async () => {
    const { book, food, checking, card, brokerage, tx } = await setup();
    await tx({ date: "2026-02-10", amount: -20000, payee: "Grocer", category: food.id });
    await tx({ date: "2026-03-05", amount: -30000, account: card.id, category: food.id });
    // A transfer between two accounts in the report changes nothing.
    await tx({ date: "2026-03-20", amount: -10000, transferAccount: card.id });

    const report = await s.call("net_worth_report", { book, start: "2026-01", end: "2026-03" });
    expect(report.start).toBe("2026-01-01");
    expect(report.points.map((p: any) => p.date)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(report.points.map((p: any) => p.netWorth)).toEqual([600000, 580000, 550000]);
    expect(report.points[2]).toMatchObject({
      assets: 570000,
      debt: 20000,
      change: -30000,
      balances: { [checking.id]: 70000, [card.id]: -20000, [brokerage.id]: 500000 },
    });
    expect(report.points[0].change).toBe(600000);
    expect(report.totalChange).toBe(-50000);
    expect(report).toMatchObject({ netWorth: 550000, lowest: 550000, highest: 600000 });
    expect(report.accounts.map((a: any) => a.name)).toEqual(["Checking", "Visa", "Brokerage"]);
  });

  it("starts one interval before the range when older transactions exist", async () => {
    const { book, food, tx } = await setup();
    await tx({ date: "2026-03-10", amount: -5000, category: food.id });
    const report = await s.call("net_worth_report", { book, start: "2026-03", end: "2026-04" });
    expect(report.start).toBe("2026-02-01");
    expect(report.points.map((p: any) => [p.date, p.netWorth, p.change])).toEqual([
      ["2026-02", 600000, 0],
      ["2026-03", 595000, -5000],
      ["2026-04", 595000, 0],
    ]);
  });

  it("filters accounts and transactions, and counts a transfer out of the set as a loss", async () => {
    const { book, checking, brokerage, tx } = await setup();
    await tx({ date: "2026-02-01", amount: -10000, transferAccount: brokerage.id });
    const report = await s.call("net_worth_report", {
      book,
      start: "2026-01",
      end: "2026-02",
      accounts: [checking.id],
    });
    expect(report.points.map((p: any) => p.netWorth)).toEqual([100000, 90000]);
    const filtered = await s.call("net_worth_report", {
      book,
      start: "2026-01",
      end: "2026-02",
      conditions: [{ field: "account", op: "offBudget" }],
    });
    expect(filtered.points.map((p: any) => p.netWorth)).toEqual([500000, 510000]);
  });

  it("reports by day, week and year", async () => {
    const { book, food, tx } = await setup();
    await tx({ date: "2026-01-03", amount: -1000, category: food.id });
    const daily = await s.call("net_worth_report", {
      book,
      start: "2026-01",
      end: "2026-01",
      interval: "Daily",
    });
    expect(daily.points).toHaveLength(31);
    expect(daily.points.slice(0, 3).map((p: any) => p.netWorth)).toEqual([600000, 600000, 599000]);
    const weekly = await s.call("net_worth_report", {
      book,
      start: "2026-01",
      end: "2026-01",
      interval: "Weekly",
    });
    // 2025-12-28 is the Sunday the week of 2026-01-01 starts on.
    expect(weekly.points[0].date).toBe("2025-12-28");
    expect(weekly.points.map((p: any) => p.netWorth)).toEqual([
      599000, 599000, 599000, 599000, 599000,
    ]);
    const yearly = await s.call("net_worth_report", {
      book,
      start: "2026-01",
      end: "2026-06",
      interval: "Yearly",
    });
    expect(yearly.points.map((p: any) => [p.date, p.netWorth])).toEqual([["2026", 599000]]);
  });
});

describe("cash flow", () => {
  it("splits budget money into income, expenses and transfers", async () => {
    const { book, food, income, card, brokerage, tx } = await setup();
    await tx({ date: "2026-02-01", amount: 250000, payee: "Employer", category: income.id });
    await tx({ date: "2026-02-03", amount: -12000, category: food.id });
    await tx({ date: "2026-02-04", amount: -5000, transferAccount: card.id });
    await tx({ date: "2026-02-05", amount: -40000, transferAccount: brokerage.id });
    await tx({ date: "2026-02-06", amount: -3000, account: brokerage.id, category: null });

    const report = await s.call("cash_flow_report", { book, start: "2026-02", end: "2026-02" });
    expect(report.interval).toBe("Daily");
    expect(report.startingBalance).toBe(100000);
    expect(report).toMatchObject({
      totalIncome: 250000,
      totalExpenses: -12000,
      // Between budget accounts a transfer nets out; to the brokerage it leaves the budget.
      totalTransfers: -40000,
      balance: 298000,
    });
    expect(report.points).toHaveLength(28);
    expect(report.points[0]).toMatchObject({ date: "2026-02-01", income: 250000, balance: 350000 });
    expect(report.totalChange).toBe(298000 - 350000);

    const monthly = await s.call("cash_flow_report", {
      book,
      start: "2026-01",
      end: "2026-06",
    });
    expect(monthly.interval).toBe("Monthly");
    expect(monthly.startingBalance).toBe(0);
    expect(monthly.points.map((p: any) => [p.date, p.income, p.expenses])).toEqual([
      ["2026-01", 100000, 0],
      ["2026-02", 250000, -12000],
      ["2026-03", 0, 0],
      ["2026-04", 0, 0],
      ["2026-05", 0, 0],
      ["2026-06", 0, 0],
    ]);
    const withoutTransfers = await s.call("cash_flow_report", {
      book,
      start: "2026-02",
      end: "2026-02",
      conditions: [{ field: "transfer", op: "is", value: false }],
    });
    expect(withoutTransfers.totalTransfers).toBe(0);
  });
});

describe("spending", () => {
  it("compares cumulative spending per day with last month, the average and the budget", async () => {
    const { book, food, bills, income, tx } = await setup();
    await tx({ date: "2026-03-02", amount: -9000, category: food.id });
    await tx({ date: "2026-04-05", amount: -6000, category: food.id });
    await tx({ date: "2026-05-01", amount: -3000, category: bills.id });
    await tx({ date: "2026-05-02", amount: 50000, category: income.id });
    await tx({ date: "2026-06-02", amount: -1000, category: food.id });
    await tx({ date: "2026-06-30", amount: -2000, category: food.id });
    await s.call("set_budget", { book, month: "2026-06", category: food.id, amount: 30000 });

    const report = await s.call("spending_report", {
      book,
      compare: "2026-06",
      compareTo: "2026-05",
    });
    expect(report.averageRange).toEqual({
      startMonth: "2026-03",
      endMonth: "2026-05",
      months: ["2026-03", "2026-04", "2026-05"],
    });
    const day = (d: string) => report.days.find((each: any) => each.day === d);
    expect(day("01")).toMatchObject({ compare: 0, compareTo: -3000, average: -1000 });
    expect(day("02")).toMatchObject({ compare: -1000, compareTo: -3000, average: -4000 });
    expect(day("05")).toMatchObject({ average: -6000 });
    // Day 28 takes the rest of the month.
    expect(day("28")).toMatchObject({ compare: -3000, compareTo: -3000, budget: -30000 });
    expect(day("28").months["2026-06"].daily).toBe(-2000);
    expect(day("01").budget).toBe(-1000);
    expect(report.totalTotals).toBe(-21000);
    const foodRow = report.categories.find((c: any) => c.id === food.id);
    expect(foodRow).toMatchObject({
      compare: -3000,
      compareTo: 0,
      average: -5000,
      budgeted: 30000,
    });
  });

  it("lists the transactions behind a category's figure, counting a split by its lines", async () => {
    const { book, food, bills, card, brokerage, tx } = await setup();
    const groceries = await tx({
      date: "2026-06-03",
      amount: -4200,
      payee: "Grocer",
      category: food.id,
    });
    const split = await tx({
      date: "2026-06-04",
      amount: -10000,
      payee: "Market",
      splits: [
        { amount: -3000, category: food.id },
        { amount: -2500, category: food.id },
        { amount: -4500, category: bills.id },
      ],
    });
    const onCard = await s.call("create_transaction", {
      book,
      account: card.id,
      date: "2026-06-10",
      amount: -1800,
      payee: "Grocer",
      category: food.id,
    });
    const refund = await tx({
      date: "2026-06-12",
      amount: 700,
      payee: "Grocer",
      category: food.id,
    });
    const toBrokerage = await tx({
      date: "2026-06-15",
      amount: -20000,
      transferAccount: brokerage.id,
      category: food.id,
    });
    await s.call("create_transaction", {
      book,
      account: brokerage.id,
      date: "2026-06-16",
      amount: -900,
      category: food.id,
    });
    await s.call("create_account", { book, name: "Cash", balance: 5000, date: "2026-06-01" });
    await tx({ date: "2026-05-30", amount: -600, category: food.id });

    const report = await s.call("spending_report", { book, compare: "2026-06" });
    const figure = report.categories.find((c: any) => c.id === food.id).compare;
    const records = await s.call("spending_transactions", {
      book,
      category: food.id,
      month: "2026-06",
    });
    expect(figure, "grocer, the split's food lines, the card, the refund, the transfer").toBe(
      -4200 - 5500 - 1800 + 700 - 20000,
    );
    expect(records.total, "the rows sum to the report's figure").toBe(figure);
    const counted = new Map(records.rows.map((r: any) => [r.row.transactionId, r.counted]));
    expect(counted.get(groceries.id)).toBe(-4200);
    expect(counted.get(split.id), "a split counts only its food lines").toBe(-5500);
    expect(counted.get(onCard.id), "a second budget account counts").toBe(-1800);
    expect(counted.get(refund.id), "a refund lowers the figure").toBe(700);
    expect(
      counted.get(toBrokerage.id),
      "a transfer off the budget counts against its category",
    ).toBe(-20000);
    expect(records.rows, "nothing else: not May, not the opening balance").toHaveLength(5);
    expect(
      records.rows.find((r: any) => r.row.transactionId === split.id).row.amount,
      "the row keeps the whole split's amount",
    ).toBe(-10000);
    expect(
      records.rows.every((r: any) => r.row.accountId !== brokerage.id),
      "off-budget activity is not spending",
    ).toBe(true);

    const filtered = await s.call("spending_transactions", {
      book,
      category: food.id,
      month: "2026-06",
      conditions: [{ field: "account", op: "is", value: card.id }],
    });
    const filteredReport = await s.call("spending_report", {
      book,
      compare: "2026-06",
      conditions: [{ field: "account", op: "is", value: card.id }],
    });
    expect(filtered.total).toBe(
      filteredReport.categories.find((c: any) => c.id === food.id).compare,
    );
    expect(filtered.rows.map((r: any) => r.row.transactionId)).toEqual([onCard.id]);
  });

  it("budgets only the categories the filters name (Actual's getSpendingBudgetFilters)", async () => {
    const { book, food, bills, income, usual } = await setup();
    await s.call("update_book", { book, budgetType: "tracking" });
    await s.call("set_budget", { book, month: "2026-06", category: food.id, amount: 30000 });
    await s.call("set_budget", { book, month: "2026-06", category: bills.id, amount: 60000 });
    await s.call("set_budget", { book, month: "2026-06", category: income.id, amount: 90000 });
    const budget = async (conditions: Array<unknown>) =>
      (await s.call("spending_report", { book, compare: "2026-06", conditions })).days.at(-1)
        .budget;
    expect(await budget([])).toBe(-90000);
    expect(await budget([{ field: "account", op: "is", value: "x" }])).toBe(-90000);
    expect(await budget([{ field: "category", op: "oneOf", value: [food.id, income.id] }])).toBe(
      -30000,
    );
    expect(await budget([{ field: "category_group", op: "is", value: usual.id }])).toBe(-90000);
    expect(await budget([{ field: "category", op: "contains", value: "bil" }])).toBe(-60000);
  });

  it("leaves out opening balances, as Actual books them to an income category", async () => {
    const { book, food, tx } = await setup();
    await s.call("create_account", {
      book,
      name: "Savings account",
      balance: 250000,
      date: "2026-06-15",
    });
    await s.call("create_account", {
      book,
      name: "Store card",
      type: "liability",
      balance: -45000,
      date: "2026-06-15",
    });
    await tx({ date: "2026-06-20", amount: -2000, category: food.id });
    const report = await s.call("spending_report", { book, compare: "2026-06" });
    expect(report.days.at(-1).compare).toBe(-2000);
  });
});

describe("summary", () => {
  it("sums and averages the matching transactions", async () => {
    const { book, food, bills, tx } = await setup();
    await tx({ date: "2026-02-10", amount: -6000, category: food.id });
    await tx({ date: "2026-03-10", amount: -3000, category: food.id });
    await tx({ date: "2026-03-11", amount: -3000, category: bills.id });
    const base = {
      book,
      start: "2026-02",
      end: "2026-03",
      conditions: [{ field: "amount", op: "lt", value: 0 }],
    };
    expect(await s.call("summary_report", base)).toMatchObject({
      start: "2026-02-01",
      end: "2026-03-31",
      total: -12000,
      dividend: -12000,
      divisor: 0,
    });
    expect(await s.call("summary_report", { ...base, content: "avgPerTransact" })).toMatchObject({
      total: -4000,
      divisor: 3,
    });
    expect(await s.call("summary_report", { ...base, content: "avgPerMonth" })).toMatchObject({
      total: -6000,
      divisor: 2,
    });
    const yearly = await s.call("summary_report", { ...base, content: "avgPerYear" });
    expect(yearly.divisor).toBeCloseTo(59 / 365.25);
    const share = await s.call("summary_report", {
      ...base,
      content: "percentage",
      conditions: [{ field: "category", op: "is", value: food.id }],
      divisorConditions: [{ field: "amount", op: "lt", value: 0 }],
    });
    expect(share).toMatchObject({ total: 75, dividend: -9000, divisor: -12000 });
  });

  it("counts both sides of a transfer, as Actual's summary does", async () => {
    const { book, card, tx } = await setup();
    await tx({ date: "2026-02-10", amount: -6000, transferAccount: card.id });
    const report = await s.call("summary_report", {
      book,
      start: "2026-02",
      end: "2026-02",
      content: "avgPerTransact",
    });
    expect(report).toMatchObject({ total: 0, dividend: 0, divisor: 2 });
  });
});

describe("calendar", () => {
  it("gives each day's income and expenses in whole weeks", async () => {
    const { book, food, income, tx } = await setup();
    await tx({ date: "2026-02-02", amount: -3000, category: food.id });
    await tx({ date: "2026-02-02", amount: -1000, category: food.id });
    await tx({ date: "2026-02-20", amount: 8000, category: income.id });
    const report = await s.call("calendar_report", { book, start: "2026-02", end: "2026-02" });
    const [month] = report.months;
    expect(month).toMatchObject({ month: "2026-02", totalIncome: 8000, totalExpense: 4000 });
    // February 2026 starts on a Sunday and fills four weeks exactly.
    expect(month.days).toHaveLength(28);
    expect(month.days[1]).toMatchObject({
      date: "2026-02-02",
      inMonth: true,
      expense: 4000,
      expenseSize: 100,
    });
    expect(month.days[19]).toMatchObject({ income: 8000, incomeSize: 100 });
    const march = (await s.call("calendar_report", { book, start: "2026-03", end: "2026-03" }))
      .months[0];
    expect(march.days).toHaveLength(35);
  });
});

describe("custom reports", () => {
  const custom = (book: string, input: Record<string, unknown>) =>
    s.call("run_custom_report", {
      book,
      isDateStatic: true,
      startDate: "2026-02-01",
      endDate: "2026-03-31",
      ...input,
    });

  it("groups payments by category with the buckets of uncategorized money", async () => {
    const { book, food, bills, card, brokerage, tx } = await setup();
    await tx({ date: "2026-02-03", amount: -12000, category: food.id });
    await tx({ date: "2026-03-03", amount: -8000, category: food.id });
    await tx({ date: "2026-03-04", amount: -3000, category: bills.id });
    await tx({ date: "2026-03-05", amount: -2000 });
    await tx({ date: "2026-03-06", amount: -1000, transferAccount: card.id });
    await tx({ date: "2026-03-07", amount: -500, account: brokerage.id });

    const report = await custom(book, {});
    expect(report.groups.map((g: any) => [g.name, g.totalDebts])).toEqual([
      ["Food", -20000],
      ["Bills", -3000],
      ["Uncategorized", -2000],
      ["Transfers", -1000],
    ]);
    expect(report.groups[0].intervals.map((i: any) => [i.date, i.totalDebts])).toEqual([
      ["2026-02", -12000],
      ["2026-03", -8000],
    ]);
    expect(report.intervals.map((i: any) => i.totalDebts)).toEqual([-12000, -14000]);
    expect(report.intervals[1].stacked[food.id]).toBe(8000);
    expect(report.totalDebts).toBe(-26000);

    const withOffBudget = await custom(book, { showOffBudget: true });
    expect(
      withOffBudget.groups.find((g: any) => g.uncategorizedId === "off_budget").totalDebts,
    ).toBe(-500);
    const withoutUncategorized = await custom(book, { showUncategorized: false });
    expect(withoutUncategorized.groups.map((g: any) => g.name)).toEqual(["Food", "Bills"]);

    const grouped = await custom(book, { groupBy: "Group" });
    expect(grouped.groups.map((g: any) => [g.name, g.totalDebts])).toEqual([
      ["Usual Expenses", -23000],
      ["Uncategorized & Off budget", -3000],
    ]);
    expect(grouped.groupedData[0].categories.map((c: any) => c.name)).toEqual(["Food", "Bills"]);
  });

  it("offers each balance type, sorting and empty rows", async () => {
    const { book, food, bills, income, tx } = await setup();
    await tx({ date: "2026-02-03", amount: -12000, category: food.id });
    await tx({ date: "2026-02-04", amount: 2000, category: food.id });
    await tx({ date: "2026-02-05", amount: 5000, category: bills.id });
    await tx({ date: "2026-02-06", amount: 90000, category: income.id });
    const totals = async (balanceType: string, sortBy = "desc") =>
      (await custom(book, { balanceType, sortBy })).groups.map((g: any) => [g.name, g.totalTotals]);
    expect(await totals("Payment")).toEqual([["Food", -10000]]);
    expect(await totals("Deposit")).toEqual([
      ["Income", 90000],
      ["Bills", 5000],
      ["Food", -10000],
    ]);
    expect(await totals("Net", "asc")).toEqual([
      ["Food", -10000],
      ["Bills", 5000],
      ["Income", 90000],
    ]);
    expect(await totals("Net Payment")).toEqual([["Food", -10000]]);
    expect(await totals("Net Deposit", "name")).toEqual([
      ["Bills", 5000],
      ["Income", 90000],
    ]);
    const all = await custom(book, { showEmpty: true });
    expect(all.groups.length).toBeGreaterThan(5);
  });

  it("hides hidden categories unless asked", async () => {
    const { book, food, bills, tx } = await setup();
    await s.call("update_category", { book, id: bills.id, hidden: true });
    await tx({ date: "2026-02-03", amount: -100, category: food.id });
    await tx({ date: "2026-02-03", amount: -200, category: bills.id });
    const names = async (showHiddenCategories: boolean) =>
      (await custom(book, { showHiddenCategories })).groups.map((g: any) => g.name);
    expect(await names(true)).toEqual(["Bills", "Food"]);
    expect(await names(false)).toEqual(["Food"]);
  });

  it("groups by payee, with a transfer's account as its payee, and by account", async () => {
    const { book, food, card, checking, tx } = await setup();
    await tx({ date: "2026-02-03", amount: -100, payee: "Grocer", category: food.id });
    await tx({ date: "2026-02-04", amount: -300, payee: "Grocer", category: food.id });
    await tx({ date: "2026-02-05", amount: -200, transferAccount: card.id });
    const payees = await custom(book, { groupBy: "Payee", balanceType: "Net" });
    expect(payees.groups.map((g: any) => [g.name, g.totalTotals])).toEqual([
      ["Checking", 200],
      ["Visa", -200],
      ["Grocer", -400],
    ]);
    const accounts = await custom(book, { groupBy: "Account", balanceType: "Net" });
    expect(accounts.groups.map((g: any) => [g.id, g.totalTotals])).toEqual([
      [card.id, 200],
      [checking.id, -600],
    ]);
  });

  it("rolls up weeks, quarters and years and trims empty intervals", async () => {
    const { book, food, tx } = await setup();
    await tx({ date: "2026-01-15", amount: -50, category: food.id });
    await tx({ date: "2026-03-01", amount: -25, category: food.id });
    await tx({ date: "2026-04-10", amount: -10, category: food.id });
    await tx({ date: "2026-09-30", amount: -5, category: food.id });
    // Actual's custom-spreadsheet test: monthly rows roll up into calendar quarters.
    const quarterly = await custom(book, {
      startDate: "2026-01-01",
      endDate: "2026-09-30",
      interval: "Quarterly",
    });
    expect(quarterly.intervals.map((i: any) => [i.date, i.totalDebts, i.intervalEndDate])).toEqual([
      ["2026-01", -75, "2026-03-31"],
      ["2026-04", -10, "2026-06-30"],
      ["2026-07", -5, "2026-09-30"],
    ]);
    expect(quarterly.totalDebts).toBe(-90);
    const weekly = await custom(book, {
      startDate: "2026-02-22",
      endDate: "2026-03-14",
      interval: "Weekly",
    });
    expect(weekly.intervals.map((i: any) => [i.date, i.totalDebts])).toEqual([
      ["2026-02-22", 0],
      ["2026-03-01", -25],
      ["2026-03-08", 0],
    ]);
    const trimmed = await custom(book, {
      startDate: "2025-11-01",
      endDate: "2026-12-31",
      interval: "Monthly",
      trimIntervals: true,
    });
    expect(trimmed.intervals.map((i: any) => i.date)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
    const yearly = await custom(book, {
      startDate: "2025-01-01",
      endDate: "2026-12-31",
      interval: "Yearly",
    });
    expect(yearly.intervals.map((i: any) => [i.date, i.totalDebts])).toEqual([
      ["2025", 0],
      ["2026", -90],
    ]);
  });

  it("buckets by the scope's tags (Actual's tag group tests)", async () => {
    const { book, food, tx } = await setup();
    const red = await s.call("create_tag", { book, tag: "red" });
    await s.call("create_tag", { book, tag: "circle" });
    await tx({ date: "2026-02-01", amount: -100, notes: "#red #circle", category: food.id });
    await tx({ date: "2026-02-02", amount: -50, notes: "#red", category: food.id });
    await tx({ date: "2026-03-02", amount: -25, notes: "#red", category: food.id });
    await tx({ date: "2026-03-03", amount: -10, notes: "lunch", category: food.id });
    const report = await custom(book, { groupBy: "Tag", showEmpty: true });
    expect(Object.fromEntries(report.groups.map((g: any) => [g.name, g.totalDebts]))).toEqual({
      "#circle": 0,
      "#circle + #red": -100,
      "#red": -75,
      Untagged: -10,
    });
    const selected = await custom(book, {
      groupBy: "Tag",
      tagScope: { mode: "selected", tagIds: [red.id] },
    });
    expect(Object.fromEntries(selected.groups.map((g: any) => [g.name, g.totalDebts]))).toEqual({
      "#red": -175,
      Untagged: -10,
    });
    const error = await s.fails("run_custom_report", {
      book,
      groupBy: "Tag",
      balanceType: "Budgeted",
    });
    expect(error.message).toBe("Budgeted reports cannot be split by tags.");
  });

  it("reports what is budgeted", async () => {
    const { book, food, bills } = await setup();
    await s.call("set_budget", { book, month: "2026-02", category: food.id, amount: 40000 });
    await s.call("set_budget", { book, month: "2026-03", category: food.id, amount: 30000 });
    await s.call("set_budget", { book, month: "2026-03", category: bills.id, amount: 10000 });
    const report = await custom(book, { balanceType: "Budgeted" });
    expect(report.groups.map((g: any) => [g.name, g.totalTotals])).toEqual([
      ["Food", 70000],
      ["Bills", 10000],
    ]);
    expect(report.intervals.map((i: any) => i.totalTotals)).toEqual([40000, 40000]);
  });

  it("filters with rule conditions", async () => {
    const { book, food, bills, tx } = await setup();
    await tx({
      date: "2026-02-03",
      amount: -1200,
      payee: "Grocer",
      category: food.id,
      notes: "#weekly shop",
    });
    await tx({ date: "2026-02-04", amount: -3000, payee: "Power Co", category: bills.id });
    await tx({ date: "2026-03-04", amount: -1000, payee: "Grocer", category: food.id });
    const total = async (conditions: Array<unknown>, conditionsOp = "and") =>
      (await custom(book, { conditions, conditionsOp })).totalDebts;
    expect(await total([{ field: "payee", op: "contains", value: "groc" }])).toBe(-2200);
    expect(await total([{ field: "notes", op: "hasTags", value: "#weekly" }])).toBe(-1200);
    expect(await total([{ field: "notes", op: "contains", value: "SHOP" }])).toBe(-1200);
    expect(await total([{ field: "date", op: "is", value: "2026-03" }])).toBe(-1000);
    expect(await total([{ field: "date", op: "gte", value: "2026-02-04" }])).toBe(-4000);
    expect(await total([{ field: "amount", op: "isapprox", value: -1150 }])).toBe(-1200);
    expect(await total([{ field: "amount_outflow", op: "gt", value: 1500 }])).toBe(-3000);
    expect(
      await total([{ field: "amount", op: "isbetween", value: { num1: -1100, num2: -900 } }]),
    ).toBe(-1000);
    expect(await total([{ field: "category", op: "notOneOf", value: [food.id] }])).toBe(-3000);
    expect(await total([{ field: "payee", op: "matches", value: "^Power" }])).toBe(-3000);
    expect(
      await total(
        [
          { field: "category", op: "is", value: bills.id },
          { field: "date", op: "is", value: "2026-03-04" },
        ],
        "or",
      ),
    ).toBe(-4000);
    expect(await total([{ field: "category", op: "oneOf", value: [] }])).toBe(0);
  });

  it("saves, runs, renames and deletes report definitions", async () => {
    const { book, food, tx } = await setup();
    await tx({ date: "2026-02-03", amount: -1200, category: food.id });
    const saved = await s.call("create_custom_report", {
      book,
      name: "Food",
      isDateStatic: true,
      startDate: "2026-02-01",
      endDate: "2026-02-28",
      groupBy: "Payee",
    });
    expect(saved).toMatchObject({ name: "Food", groupBy: "Payee", balanceType: "Payment" });
    expect((await s.fails("create_custom_report", { book, name: "Food" })).message).toBe(
      "There is already a report named Food",
    );
    expect(
      (
        await s.fails("create_custom_report", {
          book,
          name: "X",
          groupBy: "Tag",
          balanceType: "Budgeted",
        })
      ).message,
    ).toBe("Budgeted reports cannot be split by tags.");
    const run = await s.call("run_custom_report", { book, id: saved.id, groupBy: "Category" });
    expect(run.groups.map((g: any) => g.name)).toEqual(["Food"]);
    await s.call("create_custom_report", { book, name: "another" });
    const renamed = await s.call("update_custom_report", { book, id: saved.id, name: "Groceries" });
    expect(renamed).toMatchObject({ name: "Groceries", groupBy: "Payee" });
    expect((await s.call("list_custom_reports", { book })).map((r: any) => r.name)).toEqual([
      "another",
      "Groceries",
    ]);
    const [page] = await s.call("list_dashboard_pages", { book });
    const widget = await s.call("add_widget", {
      book,
      pageId: page.id,
      type: "custom-report",
      reportId: saved.id,
    });
    await s.call("delete_custom_report", { book, id: saved.id, expectedPlacementIds: [widget.id] });
    expect((await s.call("list_custom_reports", { book })).map((r: any) => r.name)).toEqual([
      "another",
    ]);
    expect((await s.fails("remove_widget", { book, id: widget.id }))._tag).toBe("NotFound");
  });
});

describe("crossover", () => {
  it("projects the balance until its withdrawals cover the expenses", async () => {
    const { book, food, brokerage, tx } = await setup();
    for (const month of ["01", "02", "03"])
      await tx({ date: `2026-${month}-10`, amount: -10000, category: food.id });
    const report = await s.call("crossover_report", {
      book,
      start: "2026-01",
      end: "2026-03",
      accounts: [brokerage.id],
      expenseCategories: [food.id],
      safeWithdrawalRate: 0.12,
      expectedContribution: 100000,
      estimatedReturn: 0,
    });
    expect(report.points.slice(0, 3).map((p: any) => [p.month, p.expenses, p.nestEgg])).toEqual([
      ["2026-01", 10000, 500000],
      ["2026-02", 10000, 500000],
      ["2026-03", 10000, 500000],
    ]);
    expect(report.lastKnownMonthlyIncome).toBe(5000);
    // 1% a month of 500,000 + 100,000 a month reaches 10,000 a month at 1,000,000.
    expect(report.crossoverMonth).toBe("2026-08");
    expect(report).toMatchObject({
      targetMonthlyIncome: 10000,
      targetNestEgg: 1000000,
      historicalReturn: 0,
    });
  });
});

describe("formula", () => {
  it("evaluates queries, balances and budget values", async () => {
    const { book, food, tx } = await setup();
    await tx({ date: "2026-02-03", amount: -1250, category: food.id });
    await tx({ date: "2026-02-04", amount: -750, category: food.id });
    await s.call("set_budget", { book, month: "2026-02", category: food.id, amount: 5000 });
    const queries = {
      food: {
        conditions: [{ field: "category", op: "is", value: food.id }],
        timeFrame: { start: "2026-02", end: "2026-02", mode: "static" },
      },
    };
    const run = (formula: string) => s.call("evaluate_formula", { book, formula, queries });
    expect(await run('=QUERY("food")')).toEqual({ result: -20, error: null });
    expect((await run('=QUERY_COUNT("food")')).result).toBe(2);
    expect((await run('=BALANCE_OF("Checking")')).result).toBe(980);
    expect((await run('=ROUND(QUERY("food") / 2, 0)')).result).toBe(-10);
    expect(
      (await run(`=BUDGET_QUERY("budgeted", "${food.id}", "2026-02", "2026-02")`)).result,
    ).toBe(50);
    expect(
      (await run(`=BUDGET_QUERY("balance_end", "${food.id}", "2026-02", "2026-02")`)).result,
    ).toBe(30);
    expect((await run('=QUERY_EXTRACT_TIMEFRAME_START("food")')).result).toBe("2026-02");
    expect((await run("=INTEGER_TO_AMOUNT(12345)")).result).toBe(123.45);
    expect((await run("=FORMATNUMBER(1234.5)")).result).toBe("1,234.50");
    expect(await run("1+1")).toEqual({ result: null, error: "Formula must start with =" });
    expect((await run("=1/0")).error).toBe("Formula error: DIV_BY_ZERO");
  });
});

describe("dashboard", () => {
  it("starts with Today and places new widgets after the last one", async () => {
    const { book } = await setup();
    const pages = await s.call("list_dashboard_pages", { book });
    expect(pages.map((p: any) => p.name)).toEqual(["Today"]);
    expect(pages[0].widgets).toHaveLength(6);
    expect(pages[0].widgets[0]).toMatchObject({ type: "home-insight", x: 0, y: 0, width: 6 });
    expect((await s.call("list_dashboard_pages", { book })).length).toBe(1);

    const second = await s.call("create_dashboard_page", { book, name: "Trends" });
    const first = await s.call("add_widget", { book, pageId: second.id, type: "net-worth-card" });
    expect(first).toMatchObject({ x: 0, y: 0, width: 4, height: 2, availability: "available" });
    const next = await s.call("add_widget", {
      book,
      pageId: second.id,
      type: "cash-flow-card",
      width: 6,
    });
    expect(next).toMatchObject({ x: 4, y: 0 });
    const wrapped = await s.call("add_widget", { book, pageId: second.id, type: "spending-card" });
    expect(wrapped).toMatchObject({ x: 0, y: 2 });
    const tall = await s.call("create_dashboard_page", { book, name: "Tall" });
    await s.call("add_widget", {
      book,
      pageId: tall.id,
      type: "net-worth-card",
      width: 6,
      height: 3,
    });
    await s.call("add_widget", { book, pageId: tall.id, type: "summary-card" });
    expect(
      await s.call("add_widget", { book, pageId: tall.id, type: "cash-flow-card" }),
      "a wrapped widget starts below the tallest widget, not the last",
    ).toMatchObject({ x: 0, y: 3 });
    await s.call("delete_dashboard_page", { book, id: tall.id });

    const moved = await s.call("update_widget", {
      book,
      id: wrapped.id,
      x: 8,
      config: { ...wrapped.config, title: "Spent" },
    });
    expect(moved).toMatchObject({ x: 8, y: 2, config: { title: "Spent" } });
    await s.call("update_widgets", {
      book,
      widgets: [
        { id: first.id, y: 4 },
        { id: next.id, height: 3 },
      ],
    });
    const copied = await s.call("copy_widget", { book, id: moved.id, pageId: pages[0].id });
    expect(copied).toMatchObject({
      pageId: pages[0].id,
      type: "spending-card",
      reportId: moved.reportId,
      config: moved.config,
    });

    await s.call("rename_dashboard_page", { book, id: second.id, name: "Later" });
    const reset = await s.call("reset_dashboard_page", { book, id: second.id });
    expect(reset).toMatchObject({ name: "Later" });
    expect(reset.widgets).toHaveLength(6);
    await s.call("delete_dashboard_page", { book, id: second.id });
    const error = await s.fails("delete_dashboard_page", { book, id: pages[0].id });
    expect(error.message).toBe("Cannot delete the last dashboard page");
  });
});

describe("tags", () => {
  it("renames a tag and rewrites it in notes (Actual's tags-rename tests)", async () => {
    const { book, tx } = await setup();
    const tag = await s.call("create_tag", { book, tag: "Reimbursable" });
    const matching = await tx({ date: "2026-01-01", amount: -1000, notes: "Lunch #Reimbursable" });
    const partial = await tx({
      date: "2026-01-01",
      amount: -1000,
      notes: "Dinner #ReimbursableLater",
    });
    const odd = await tx({
      date: "2026-01-01",
      amount: -1000,
      notes: "##Reimbursable #reimbursable #Reimbursable#Work",
    });
    expect((await s.call("list_tags", { book }))[0].count).toBe(2);
    await s.call("update_tag", { book, id: tag.id, tag: "  ToBeReimbursed  " });
    expect((await s.call("list_tags", { book })).map((t: any) => t.tag)).toEqual([
      "ToBeReimbursed",
    ]);
    const notes = async (id: string) => (await s.call("get_transaction", { book, id })).notes;
    expect(await notes(matching.id)).toBe("Lunch #ToBeReimbursed");
    expect(await notes(partial.id)).toBe("Dinner #ReimbursableLater");
    expect(await notes(odd.id)).toBe("##Reimbursable #reimbursable #ToBeReimbursed#Work");
    expect(await s.call("undo", { book })).toEqual({ done: true });
    expect(await notes(matching.id)).toBe("Lunch #Reimbursable");
  });

  it("rejects invalid, taken and unknown names", async () => {
    const { book } = await setup();
    const food = await s.call("create_tag", { book, tag: "Food" });
    await s.call("create_tag", { book, tag: "Groceries" });
    expect((await s.fails("update_tag", { book, id: food.id, tag: "two words" })).message).toBe(
      "Invalid tag name",
    );
    expect((await s.fails("update_tag", { book, id: food.id, tag: "Groceries" })).message).toBe(
      "A tag with that name already exists",
    );
    expect((await s.fails("update_tag", { book, id: "missing", tag: "Food" }))._tag).toBe(
      "NotFound",
    );
    const recolored = await s.call("create_tag", { book, tag: "Food", color: "#ff0000" });
    expect(recolored).toMatchObject({ id: food.id, color: "#ff0000" });
    await s.call("delete_tags", { book, ids: [food.id] });
    expect((await s.call("list_tags", { book })).map((t: any) => t.tag)).toEqual(["Groceries"]);
  });

  it("discovers unique tags using exact hashtag boundaries", async () => {
    const { book, tx } = await setup();
    const red = await s.call("create_tag", { book, tag: "red" });
    await tx({ date: "2026-01-01", amount: -100, notes: "#red#circle #red ##ignored" });
    await tx({ date: "2026-01-01", amount: -100, notes: "#circle #Red #$splurge" });
    const tags = await s.call("discover_tags", { book });
    expect(tags.map((t: any) => t.tag).sort()).toEqual(["$splurge", "Red", "circle", "red"]);
    expect(tags.find((t: any) => t.tag === "red")).toMatchObject({ id: red.id, count: 1 });
    expect(tags.find((t: any) => t.tag === "circle").count).toBe(2);
  });
});

/** Actual's `server/forecast/app.test.ts`, through `forecast_balances`, on 2024-03-10. */
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
let book: string;
let checking: string;

const link = (schedule: string, transaction: string) => {
  const db = new DatabaseSync(join(s.home, "books", `${book}.sqlite`));
  try {
    db.prepare("UPDATE transactions SET schedule_id = ? WHERE id = ?").run(schedule, transaction);
  } finally {
    db.close();
  }
};

const add = (date: string, amount: number, account = checking) =>
  s.call("create_transaction", { book, date, account, amount });

const schedule = (input: Record<string, unknown>) =>
  s.call("create_schedule", { book, account: checking, amountOp: "is", dateOp: "is", ...input });

const forecast = (input: Record<string, unknown>) =>
  s.call("forecast_balances", { book, ...input });

const byDate = (result: any, account = checking) =>
  Object.fromEntries(
    result.dataPoints
      .filter((point: any) => point.accountId === account)
      .map((point: any) => [point.date, point]),
  );

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2024, 2, 10, 12));
  s = scratch();
  book = (await s.call("create_book", { name: "Test" })).id;
  checking = (await s.call("create_account", { book, name: "Checking" })).id;
});

afterEach(async () => {
  await s.dispose();
  vi.useRealTimers();
});

describe("balance forecast", () => {
  it("reconciles projected and recorded occurrences without double counting", async () => {
    const salary = await schedule({ amount: 500_000, date: "2024-03-10", frequency: "monthly" });
    await add("2024-02-01", 100_000);
    link(salary.id, (await add("2024-03-10", 500_000)).id);
    const result = await forecast({ accounts: [checking], from: "2024-03-01", to: "2024-04-30" });
    const points = byDate(result);
    expect(points["2024-03-09"].balance).toBe(100_000);
    expect(points["2024-03-10"]).toMatchObject({
      balance: 600_000,
      recordedAmount: 500_000,
      transactions: [],
    });
    expect(points["2024-04-10"]).toMatchObject({
      balance: 1_100_000,
      transactions: [{ amount: 500_000, scheduleId: salary.id, isTransfer: false }],
    });
    expect(points["2024-04-30"].balance).toBe(1_100_000);
  });

  it("shows the real running balance for historical months", async () => {
    await add("2024-01-05", 1000);
    await add("2024-03-20", -200);
    const result = await forecast({ accounts: [checking], from: "2024-01-01", to: "2024-04-30" });
    const points = byDate(result);
    expect(points["2024-01-01"].balance).toBe(0);
    expect(points["2024-01-05"].balance).toBe(1000);
    expect(points["2024-03-19"].balance).toBe(1000);
    expect(points["2024-03-20"].balance).toBe(800);
    expect(points["2024-04-30"].balance).toBe(800);
    expect(result.dataPoints).toHaveLength(121);
    expect(result.lowestBalance).toEqual({
      date: "2024-01-01",
      balance: 0,
      accountId: "",
      accountName: "",
    });
  });

  it("treats an explicit empty account selection as no accounts", async () => {
    await add("2024-01-05", 1000);
    const result = await forecast({ accounts: [], from: "2024-01-01", to: "2024-01-31" });
    expect(result.dataPoints).toEqual([]);
    expect(result.lowestBalance).toEqual({
      date: "2024-01-01",
      balance: 0,
      accountId: "",
      accountName: "",
    });
  });

  it("uses the requested range for empty-account results", async () => {
    expect(
      await forecast({ accounts: ["missing-account"], from: "2024-03-01", to: "2024-03-31" }),
    ).toEqual({
      dataPoints: [],
      lowestBalance: { date: "2024-03-01", balance: 0, accountId: "", accountName: "" },
      forecastStartDate: "2024-03-01",
      forecastEndDate: "2024-03-31",
    });
  });

  it("generates tracking budget forecasts only for tracking budget files", async () => {
    const error = await s.fails("forecast_balances", {
      book,
      source: "tracking-budget",
      from: "2024-03-01",
      to: "2024-03-31",
    });
    expect(error.message).toBe("Tracking budget forecasts require a Tracking Budget file.");
    await s.call("update_book", { book, budgetType: "tracking" });
    await add("2024-01-05", 1000);
    const result = await forecast({
      source: "tracking-budget",
      from: "2024-03-01",
      to: "2024-03-31",
    });
    expect(result.dataPoints).toEqual([
      {
        date: "2024-03-31",
        balance: 1000,
        accountId: "tracking-budget",
        accountName: "Tracking Budget",
        transactions: [],
      },
    ]);
  });

  it("adds a tracking budget's budgeted income and takes its budgeted expenses", async () => {
    await s.call("update_book", { book, budgetType: "tracking" });
    await add("2024-01-05", 1000);
    const groups = await s.call("list_categories", { book });
    const food = groups[0].categories[0].id;
    const income = groups.find((group: any) => group.isIncome).categories[0].id;
    await s.call("set_budget", { book, month: "2024-04", category: income, amount: 500 });
    await s.call("set_budget", { book, month: "2024-04", category: food, amount: 200 });
    const result = await forecast({
      source: "tracking-budget",
      from: "2024-03-01",
      to: "2024-05-31",
    });
    expect(result.dataPoints.map((point: any) => [point.date, point.balance])).toEqual([
      ["2024-03-31", 1000],
      ["2024-04-30", 1300],
      ["2024-05-31", 1300],
    ]);
  });

  it("ignores reconstructed schedule occurrences before today", async () => {
    await schedule({ amount: -100, date: "2024-01-15", frequency: "monthly" });
    const points = byDate(
      await forecast({ accounts: [checking], from: "2024-01-01", to: "2024-04-30" }),
    );
    expect(points["2024-03-14"]).toMatchObject({ balance: 0, transactions: [] });
    expect(points["2024-03-15"]).toMatchObject({ balance: -100, transactions: [{ amount: -100 }] });
    expect(points["2024-04-14"]).toMatchObject({ balance: -100, transactions: [] });
    expect(points["2024-04-15"]).toMatchObject({ balance: -200, transactions: [{ amount: -100 }] });
  });

  it("does not double-count daily occurrences with op is posted on the due date", async () => {
    const daily = await schedule({ amount: -5_000, date: "2024-03-10", frequency: "daily" });
    link(daily.id, (await add("2024-03-10", -5_000)).id);
    const points = byDate(
      await forecast({ accounts: [checking], from: "2024-03-10", to: "2024-03-12" }),
    );
    expect(points["2024-03-10"]).toMatchObject({ balance: -5_000, transactions: [] });
    expect(points["2024-03-11"]).toMatchObject({
      balance: -10_000,
      transactions: [{ amount: -5_000 }],
    });
    expect(points["2024-03-12"]).toMatchObject({
      balance: -15_000,
      transactions: [{ amount: -5_000 }],
    });
  });

  it("runs the rules on projected transactions, as a rule that moves them to another account", async () => {
    const savings = (await s.call("create_account", { book, name: "Savings" })).id;
    const moved = await schedule({ amount: -250, date: "2024-03-20", frequency: "monthly" });
    const db = new DatabaseSync(join(s.home, "books", `${book}.sqlite`));
    db.prepare(
      `INSERT INTO rules (id, stage, conditions_op, conditions, actions, created_at)
       VALUES ('to-savings', 'post', 'and', ?, ?, 0)`,
    ).run(
      JSON.stringify([{ field: "amount", op: "is", value: -250 }]),
      JSON.stringify([{ op: "set", field: "account", value: savings }]),
    );
    db.close();
    const result = await forecast({
      accounts: [checking, savings],
      from: "2024-03-01",
      to: "2024-04-30",
    });
    expect(byDate(result)["2024-03-20"]).toMatchObject({ balance: 0, transactions: [] });
    expect(byDate(result, savings)["2024-03-20"]).toMatchObject({
      balance: -250,
      transactions: [{ amount: -250, scheduleId: moved.id }],
    });
  });

  it("includes account-less schedules only when asked", async () => {
    await s.call("create_schedule", {
      book,
      amount: -75,
      amountOp: "is",
      date: "2024-03-15",
      frequency: "monthly",
    });
    const combined = (result: any, date: string) =>
      result.dataPoints
        .filter((point: any) => point.date === date)
        .reduce((sum: number, point: any) => sum + point.balance, 0);
    const included = await forecast({
      accounts: [checking],
      from: "2024-03-01",
      to: "2024-03-31",
      includeAccountless: true,
    });
    expect(combined(included, "2024-03-15")).toBe(-75);
    expect(included.lowestBalance).toMatchObject({ date: "2024-03-15", balance: -75 });
    expect(
      included.dataPoints.some((point: any) => point.accountId === "__unassigned_schedule__"),
    ).toBe(true);
    const excluded = await forecast({
      accounts: [checking],
      from: "2024-03-01",
      to: "2024-03-31",
      includeAccountless: false,
    });
    expect(combined(excluded, "2024-03-15")).toBe(0);
    expect(
      excluded.dataPoints.every((point: any) => point.accountId !== "__unassigned_schedule__"),
    ).toBe(true);
  });

  it("does not project a recorded occurrence that report filters exclude", async () => {
    const bill = await schedule({ amount: -10_000, date: "2024-03-10", frequency: "monthly" });
    const recorded = await s.call("create_transaction", {
      book,
      date: "2024-03-10",
      account: checking,
      amount: -10_000,
      cleared: true,
    });
    link(bill.id, recorded.id);
    const result = await forecast({
      accounts: [checking],
      from: "2024-03-01",
      to: "2024-04-30",
      conditions: [{ field: "cleared", op: "is", value: false }],
    });
    const points = byDate(result);
    expect(points["2024-03-10"]).toMatchObject({ balance: 0, recordedAmount: 0, transactions: [] });
    expect(points["2024-04-10"]).toMatchObject({
      balance: -10_000,
      transactions: [{ amount: -10_000, scheduleId: bill.id }],
    });
  });

  it("applies standard historical report filters to posted transactions", async () => {
    await s.call("create_transaction", {
      book,
      date: "2024-03-10",
      account: checking,
      amount: -25,
      payee: "Grocery Store",
    });
    await s.call("create_transaction", {
      book,
      date: "2024-03-11",
      account: checking,
      amount: -100,
      payee: "Landlord",
    });
    const payees = await s.call("list_payees", { book });
    const grocery = payees.find((payee: any) => payee.name === "Grocery Store").id;
    const result = await forecast({
      from: "2024-03-01",
      to: "2024-03-31",
      conditions: [{ field: "payee", op: "is", value: grocery }],
    });
    const points = byDate(result);
    expect(points["2024-03-09"].balance).toBe(0);
    expect(points["2024-03-10"].balance).toBe(-25);
    expect(points["2024-03-11"].balance).toBe(-25);
    expect(points["2024-03-31"].balance).toBe(-25);
  });

  it("filters future schedule occurrences on the category the schedule sets", async () => {
    const groups = await s.call("list_categories", { book });
    const food = groups[0].categories[0].id;
    const other = groups[0].categories[1].id;
    const bill = await schedule({
      amount: -75,
      date: "2024-03-15",
      frequency: "monthly",
      category: food,
    });
    await schedule({ amount: -40, date: "2024-03-16", frequency: "monthly", category: other });
    const points = byDate(
      await forecast({
        from: "2024-03-01",
        to: "2024-04-30",
        conditions: [{ field: "category", op: "is", value: food }],
      }),
    );
    expect(points["2024-03-15"]).toMatchObject({
      balance: -75,
      transactions: [{ amount: -75, scheduleId: bill.id }],
    });
    expect(points["2024-03-16"]).toMatchObject({ balance: -75, transactions: [] });
    expect(points["2024-04-15"]).toMatchObject({ balance: -150 });
  });

  it("restricts accounts by account conditions, but not for mixed or conditions", async () => {
    const savings = (await s.call("create_account", { book, name: "Savings" })).id;
    await s.call("create_transaction", {
      book,
      date: "2024-03-10",
      account: checking,
      amount: -30,
      payee: "Grocery Store",
    });
    await add("2024-03-11", 200, savings);
    const payees = await s.call("list_payees", { book });
    const grocery = payees.find((payee: any) => payee.name === "Grocery Store").id;
    const mixed = await forecast({
      from: "2024-03-01",
      to: "2024-03-31",
      conditionsOp: "or",
      conditions: [
        { field: "account", op: "is", value: savings },
        { field: "payee", op: "is", value: grocery },
      ],
    });
    expect(byDate(mixed)["2024-03-10"].balance).toBe(-30);
    expect(byDate(mixed, savings)["2024-03-11"].balance).toBe(200);
    const only = await forecast({
      from: "2024-03-01",
      to: "2024-03-31",
      conditions: [{ field: "account", op: "is", value: savings }],
    });
    expect(new Set(only.dataPoints.map((point: any) => point.accountId))).toEqual(
      new Set([savings]),
    );
  });
});

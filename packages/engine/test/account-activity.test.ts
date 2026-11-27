import { addDays, addMonths, currentMonth, today } from "@reeve/contract/rules";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scratch } from "./helpers.ts";

let env: ReturnType<typeof scratch>;
let call: ReturnType<typeof scratch>["call"];

beforeEach(() => {
  env = scratch();
  call = env.call;
});
afterEach(() => env.dispose());

const month = currentMonth();
const day = (monthsAgo: number, dayOfMonth = 10) =>
  `${addMonths(month, -monthsAgo)}-${String(dayOfMonth).padStart(2, "0")}`;

/** A category of the seeded budget, an expense one unless asked for income. */
const category = async (index = 0, income = false): Promise<string> => {
  const groups: Array<any> = await call("list_categories", {});
  return groups.filter((group) => group.isIncome === income).flatMap((g) => g.categories)[index].id;
};

const changeOf = (row: { in: number; out: number; transfers: number; opening: number }) =>
  row.in - row.out + row.transfers + row.opening;

describe("account_activity", () => {
  it("counts money in and out from category lines, so transfers are not spending", async () => {
    const checking = await call("create_account", { name: "Checking", balance: 100_000 });
    const savings = await call("create_account", { name: "Savings" });
    const food = await category();
    const salary = await category(0, true);
    const date = day(0, 1);
    await call("create_transaction", {
      account: checking.id,
      date,
      amount: -2_000,
      category: food,
    });
    await call("create_transaction", {
      account: checking.id,
      date,
      amount: 5_000,
      category: salary,
    });
    await call("create_transaction", {
      account: checking.id,
      date,
      amount: -30_000,
      transferAccount: savings.id,
    });

    const activity = await call("account_activity", { account: checking.id });
    expect(activity.period).toMatchObject({ in: 5_000, out: 2_000, transfers: -30_000 });
    expect(activity.period.opening).toBe(100_000);
    expect(activity.categories.map((each: any) => each.id)).toEqual([food]);

    const receiving = await call("account_activity", { account: savings.id });
    expect(receiving.period).toMatchObject({ in: 0, out: 0, transfers: 30_000 });
  });

  it("a transfer inside the scope nets to nothing, and the months add up to the balance", async () => {
    const checking = await call("create_account", {
      name: "Checking",
      balance: 100_000,
      date: day(2),
    });
    const savings = await call("create_account", { name: "Savings", balance: 20_000 });
    await call("create_transaction", {
      account: checking.id,
      date: day(1),
      amount: -30_000,
      transferAccount: savings.id,
    });
    await call("create_transaction", {
      account: savings.id,
      date: day(0, 1),
      amount: -1_000,
      category: await category(),
    });

    const all = await call("account_activity", {});
    expect(all.period.transfers).toBe(0);
    expect(all.months.at(-1).balance).toBe(119_000);
    for (const row of all.months) expect(row.transfers).toBe(0);
    const accounts: Array<any> = await call("list_accounts", {});
    expect(all.months.at(-1).balance).toBe(accounts.reduce((sum, each) => sum + each.balance, 0));

    const one = await call("account_activity", { account: checking.id });
    expect(one.months.at(-2).balance).toBe(70_000);
    let running = 0;
    for (const row of one.months) {
      running += changeOf(row);
      expect(row.balance).toBe(running);
    }
  });

  it("keeps a liability's sign: owing is negative, a purchase is out, a payment is a transfer", async () => {
    const checking = await call("create_account", { name: "Checking", balance: 100_000 });
    const card = await call("create_account", { name: "Visa", type: "liability" });
    const food = await category();
    const date = day(0, 1);
    await call("create_transaction", { account: card.id, date, amount: -6_000, category: food });
    await call("create_transaction", { account: card.id, date, amount: 1_000, category: food });
    await call("create_transaction", {
      account: checking.id,
      date,
      amount: -2_000,
      transferAccount: card.id,
    });

    const activity = await call("account_activity", { account: card.id });
    expect(activity.months.at(-1).balance).toBe(-3_000);
    expect(activity.period).toMatchObject({ in: 1_000, out: 6_000, transfers: 2_000 });
    expect(activity.categories[0].amount).toBe(5_000);
  });

  it("gives a split's category lines to the account paying, not to one receiving a transfer", async () => {
    const checking = await call("create_account", { name: "Checking", balance: 100_000 });
    const savings = await call("create_account", { name: "Savings" });
    await call("create_transaction", {
      account: checking.id,
      date: day(0, 1),
      amount: -10_000,
      splits: [
        { category: await category(), amount: -6_000 },
        { transferAccount: savings.id, amount: -4_000 },
      ],
    });
    const paying = await call("account_activity", { account: checking.id });
    expect(paying.period).toMatchObject({ out: 6_000, transfers: -4_000 });
    const receiving = await call("account_activity", { account: savings.id });
    expect(receiving.period).toMatchObject({ in: 0, out: 0, transfers: 4_000 });
    expect(receiving.categories).toEqual([]);
  });

  it("counts both directions of a split: a paycheck's tax is out, and no transfer appears", async () => {
    const checking = await call("create_account", { name: "Checking" });
    const salary = await category(0, true);
    const tax = await category(0);
    await call("create_transaction", {
      account: checking.id,
      date: day(0, 1),
      amount: 80_000,
      splits: [
        { category: salary, amount: 100_000 },
        { category: tax, amount: -20_000 },
      ],
    });
    const activity = await call("account_activity", { account: checking.id });
    expect(activity.period).toMatchObject({ in: 100_000, out: 20_000, transfers: 0 });
    expect(activity.categories.map((row: any) => [row.id, row.amount])).toEqual([[tax, 20_000]]);
  });

  it("counts both directions of a receipt, and nets a refund out of the ranking", async () => {
    const checking = await call("create_account", { name: "Checking" });
    const food = await category(0);
    const general = await category(1);
    await call("create_transaction", {
      account: checking.id,
      date: day(0, 1),
      amount: -8_000,
      splits: [
        { category: food, amount: -10_000 },
        { category: general, amount: 2_000 },
      ],
    });
    await call("create_transaction", {
      account: checking.id,
      date: day(0, 2),
      amount: -3_000,
      splits: [
        { category: food, amount: -4_000 },
        { category: food, amount: 1_000 },
      ],
    });
    const activity = await call("account_activity", { account: checking.id });
    expect(activity.period).toMatchObject({ in: 3_000, out: 14_000, transfers: 0 });
    expect(activity.categories.map((row: any) => [row.id, row.amount])).toEqual([[food, 13_000]]);
  });

  it("keeps a two-way split with a transfer on the account paying", async () => {
    const checking = await call("create_account", { name: "Checking" });
    const savings = await call("create_account", { name: "Savings" });
    await call("create_transaction", {
      account: checking.id,
      date: day(0, 1),
      amount: -10_000,
      splits: [
        { category: await category(0), amount: -8_000 },
        { category: await category(1), amount: 2_000 },
        { transferAccount: savings.id, amount: -4_000 },
      ],
    });
    const paying = await call("account_activity", { account: checking.id });
    expect(paying.period).toMatchObject({ in: 2_000, out: 8_000, transfers: -4_000 });
    const receiving = await call("account_activity", { account: savings.id });
    expect(receiving.period).toMatchObject({ in: 0, out: 0, transfers: 4_000 });
  });

  it("ranks a period against the one before, and narrows to a month", async () => {
    const checking = await call("create_account", { name: "Checking", balance: 100_000 });
    const food = await category(0);
    const fun = await category(1);
    const spend = (date: string, amount: number, id: string, payee: string) =>
      call("create_transaction", { account: checking.id, date, amount, category: id, payee });
    await spend(day(3), -1_000, food, "Grocer");
    await spend(day(1), -4_000, food, "Grocer");
    await spend(day(0, 1), -3_000, fun, "Cinema");

    const range = await call("account_activity", { account: checking.id, months: 2 });
    expect(range.months.map((row: any) => row.month)).toEqual([addMonths(month, -1), month]);
    expect(range.period).toMatchObject({ from: addMonths(month, -1), to: month, out: 7_000 });
    expect(range.period.previous.out).toBe(1_000);
    expect(range.categories.map((row: any) => [row.id, row.amount, row.previous])).toEqual([
      [food, 4_000, 1_000],
      [fun, 3_000, 0],
    ]);
    expect(range.payees.map((row: any) => row.name)).toEqual(["Grocer", "Cinema"]);

    const focus = await call("account_activity", {
      account: checking.id,
      months: 2,
      month: addMonths(month, -1),
    });
    expect(focus.months).toHaveLength(2);
    expect(focus.period).toMatchObject({ out: 4_000, from: addMonths(month, -1) });
    expect(focus.period.previous.out).toBe(0);

    const allTime = await call("account_activity", { account: checking.id });
    expect(allTime.period.previous).toBeNull();
  });

  it("has no previous period when the account is younger than it", async () => {
    const checking = await call("create_account", { name: "Checking", date: day(1) });
    await call("create_transaction", {
      account: checking.id,
      date: day(0, 1),
      amount: -500,
      category: await category(),
    });
    const activity = await call("account_activity", { account: checking.id, months: 12 });
    expect(activity.period.previous).toBeNull();
    expect(activity.months[0].month).toBe(month);
  });

  it("counts what needs tidying as the register would filter it", async () => {
    const checking = await call("create_account", {
      name: "Checking",
      balance: 100_000,
      date: day(3),
    });
    const brokerage = await call("create_account", { name: "Brokerage", onBudget: false });
    const old = addDays(today(), -40);
    const recent = addDays(today(), -30);
    await call("create_transaction", { account: checking.id, date: old, amount: -100 });
    await call("create_transaction", { account: checking.id, date: recent, amount: -200 });
    await call("create_transaction", { account: brokerage.id, date: old, amount: -300 });

    const activity = await call("account_activity", { account: checking.id });
    const uncategorized = await call("list_transactions", {
      account: checking.id,
      uncategorized: true,
    });
    expect(activity.attention.uncategorized).toBe(uncategorized.total);
    expect(activity.attention.uncategorized).toBe(2);
    const stale = await call("list_transactions", {
      account: checking.id,
      status: ["uncleared"],
      to: addDays(today(), -31),
    });
    expect(activity.attention.oldUncleared).toBe(stale.total);
    expect(activity.attention.lastReconciled).toBeNull();

    const offBudget = await call("account_activity", { account: brokerage.id });
    expect(offBudget.attention.uncategorized).toBe(0);

    await call("update_transactions", {
      ids: stale.rows.map((row: any) => row.transactionId),
      account: checking.id,
      cleared: true,
    });
    const balance = (await call("list_accounts", {})).find((a: any) => a.id === checking.id);
    await call("reconcile_account", { id: checking.id, balance: balance.cleared, date: today() });
    const after = await call("account_activity", { account: checking.id });
    expect(after.attention.oldUncleared).toBe(0);
    expect(after.attention.lastReconciled).toBe(old);
    expect(after.attention.toReconcile).toBe(0);
  });

  it("is the uncategorized queue when asked: its rows and nothing else, on budget accounts", async () => {
    const checking = await call("create_account", { name: "Checking", balance: 100_000 });
    const brokerage = await call("create_account", { name: "Brokerage", onBudget: false });
    const date = day(0, 1);
    await call("create_transaction", { account: checking.id, date, amount: -700, payee: "Shop" });
    await call("create_transaction", { account: checking.id, date, amount: 300, payee: "Shop" });
    await call("create_transaction", { account: brokerage.id, date, amount: -900 });
    await call("create_transaction", {
      account: checking.id,
      date,
      amount: -5_000,
      category: await category(),
    });

    const queue = await call("account_activity", { uncategorized: true });
    const rows = await call("list_transactions", { uncategorized: true });
    expect(queue.months.at(-1).balance).toBeNull();
    expect(queue.period).toMatchObject({ in: 300, out: 700, count: rows.total, transfers: 0 });
    expect(queue.payees.map((row: any) => [row.name, row.count])).toEqual([["Shop", 2]]);
    expect(queue.accounts.map((row: any) => [row.name, row.count])).toEqual([["Checking", 2]]);
  });

  it("projects from schedules without counting missed ones, and cancels transfers in scope", async () => {
    const checking = await call("create_account", { name: "Checking", balance: 100_000 });
    const savings = await call("create_account", { name: "Savings" });
    const next = addMonths(month, 1);
    await call("create_schedule", {
      name: "Rent",
      account: checking.id,
      amount: -50_000,
      amountOp: "is",
      date: `${next}-05`,
      dateOp: "is",
    });
    await call("create_schedule", {
      name: "Old bill",
      account: checking.id,
      amount: -9_900,
      amountOp: "is",
      date: addDays(today(), -5),
      dateOp: "is",
    });

    const activity = await call("account_activity", { account: checking.id });
    expect(activity.attention.missedSchedules).toBe(1);
    expect(activity.projection.map((row: any) => [row.month, row.balance])).toEqual([
      [month, 100_000],
      [next, 50_000],
      [addMonths(month, 2), 50_000],
    ]);
    expect(activity.projection[1].scheduled).toBe(-50_000);

    const none = await call("account_activity", { account: savings.id });
    expect(none.projection).toEqual([]);
    expect(none.attention.missedSchedules).toBe(0);
  });

  it("leaves a closed account's schedules out, except on that account's own page", async () => {
    const checking = await call("create_account", { name: "Checking", balance: 100_000 });
    const old = await call("create_account", { name: "Old", balance: 1_000 });
    await call("create_schedule", {
      name: "Old salary",
      account: old.id,
      amount: 7_000,
      amountOp: "is",
      date: `${addMonths(month, 1)}-05`,
      dateOp: "is",
    });
    await call("create_schedule", {
      name: "Old missed",
      account: old.id,
      amount: -500,
      amountOp: "is",
      date: addDays(today(), -5),
      dateOp: "is",
    });
    await call("close_account", { id: old.id, transferAccount: checking.id });

    const all = await call("account_activity", {});
    expect(all.projection).toEqual([]);
    expect(all.attention.missedSchedules).toBe(0);
    const own = await call("account_activity", { account: old.id });
    expect(own.projection[1].scheduled).toBe(7_000);
    expect(own.attention.missedSchedules).toBe(1);
  });

  it("the queue's money covers every row it counts, future-dated ones too", async () => {
    const checking = await call("create_account", { name: "Checking", balance: 100_000 });
    const date = day(0, 1);
    await call("create_transaction", { account: checking.id, date, amount: -1_000, payee: "Now" });
    await call("create_transaction", {
      account: checking.id,
      date: `${addMonths(month, 1)}-01`,
      amount: -2_000,
      payee: "Next",
    });
    const queue = await call("account_activity", { uncategorized: true });
    expect(queue.months.reduce((sum: number, row: any) => sum + row.count, 0)).toBe(2);
    expect(queue.period).toMatchObject({ out: 3_000, count: 2 });
    expect(queue.payees.map((row: any) => row.name).toSorted()).toEqual(["Next", "Now"]);
    expect(queue.accounts[0].count).toBe(2);
  });

  it("charts an account whose only row is far in the future", async () => {
    const checking = await call("create_account", { name: "Checking" });
    const far = addMonths(month, 30);
    await call("create_transaction", {
      account: checking.id,
      date: `${far}-05`,
      amount: -2_500,
      category: await category(),
    });
    const activity = await call("account_activity", { account: checking.id, months: 12 });
    expect(activity.months.length).toBeGreaterThan(0);
    expect(activity.months.at(-1)).toMatchObject({ month: far, balance: -2_500 });

    const queue = await call("create_transaction", {
      account: checking.id,
      date: `${addMonths(month, 40)}-05`,
      amount: -100,
    });
    expect(queue.id).toBeTruthy();
    const waiting = await call("account_activity", { uncategorized: true });
    expect(waiting.months.reduce((sum: number, row: any) => sum + row.count, 0)).toBe(1);
    expect(waiting.period).toMatchObject({ out: 100, count: 1 });
  });

  it("answers for an empty scope, and refuses an unknown account", async () => {
    const empty = await call("account_activity", {});
    expect(empty.months).toEqual([]);
    expect(empty.earliest).toBeNull();
    expect(empty.period).toMatchObject({ from: null, to: null, in: 0 });
    const error = await env.fails("account_activity", { account: "nope" });
    expect(String(error._tag ?? error)).toMatch(/NotFound/);
  });
});

describe("update_transactions", () => {
  it("categorizes rows of several accounts in one undo step", async () => {
    const one = await call("create_account", { name: "One" });
    const two = await call("create_account", { name: "Two" });
    const date = day(0, 1);
    const first = await call("create_transaction", { account: one.id, date, amount: -100 });
    const second = await call("create_transaction", { account: two.id, date, amount: -200 });
    const third = await call("create_transaction", { account: two.id, date, amount: -300 });
    const food = await category();
    await call("update_transactions", {
      ids: [first.id, second.id, third.id],
      category: food,
      accountOf: [
        { id: first.id, account: one.id },
        { id: second.id, account: two.id },
        { id: third.id, account: two.id },
      ],
    });
    const waiting = () => call("list_transactions", { uncategorized: true });
    expect((await waiting()).total).toBe(0);
    await call("undo", {});
    expect((await waiting()).total).toBe(3);
  });
});

import { currentMonth, firstDay, prevMonth } from "@reeve/contract/rules";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
beforeEach(() => {
  s = scratch();
});
afterEach(() => s.dispose());

const month = currentMonth();
const day = firstDay(month);

const setup = async () => {
  const book = await s.call("create_book", { name: "Test" });
  const groups = await s.call("list_categories", { book: book.id });
  const food = groups[0].categories.find((c: any) => c.name === "Food");
  const bills = groups[0].categories.find((c: any) => c.name === "Bills");
  const income = groups.find((g: any) => g.isIncome).categories[0];
  const checking = await s.call("create_account", {
    book: book.id,
    name: "Checking",
    balance: 100000,
    date: day,
  });
  return { book: book.id, food, bills, income, checking };
};

describe("ledger", () => {
  it("creates a book with Actual's default categories", async () => {
    const book = await s.call("create_book", { name: "Household" });
    expect(book.id).toBe("household");
    const groups = await s.call("list_categories", { book: "household" });
    expect(groups.map((g: any) => g.name)).toEqual([
      "Usual Expenses",
      "Investments and Savings",
      "Income",
    ]);
    expect((await s.call("list_books")).map((b: any) => b.id)).toEqual(["household"]);
  });

  it("writes balanced postings and keeps balances", async () => {
    const { book, food, checking } = await setup();
    const tx = await s.call("create_transaction", {
      book,
      date: day,
      account: checking.id,
      amount: -4250,
      payee: "Grocer",
      category: food.id,
    });
    expect(tx.postings.map((p: any) => p.amount)).toEqual([-4250, 4250]);
    const [account] = await s.call("list_accounts", { book });
    expect(account.balance).toBe(100000 - 4250);
    const page = await s.call("list_transactions", { book, account: checking.id });
    expect(page.rows[0].counterpart).toEqual({ kind: "category", id: food.id, name: "Food" });
    expect(page.rows[0].balance).toBe(95750);
    expect(page.rows[1].balance).toBe(100000);
  });

  it("refuses postings that do not balance", async () => {
    const { book, food, checking } = await setup();
    const error = await s.fails("create_journal_entry", {
      book,
      date: day,
      postings: [
        { account: checking.id, amount: -1 },
        { account: food.id, amount: 2 },
      ],
    });
    expect(error._tag).toBe("InvalidRequest");
  });

  it("splits and transfers", async () => {
    const { book, food, bills, checking } = await setup();
    const savings = await s.call("create_account", { book, name: "Savings" });
    const split = await s.call("create_transaction", {
      book,
      date: day,
      account: checking.id,
      amount: -12000,
      splits: [
        { category: food.id, amount: -8000 },
        { transferAccount: savings.id, amount: -4000 },
      ],
    });
    expect(split.postings).toHaveLength(3);
    const rows = (await s.call("list_transactions", { book, account: savings.id })).rows;
    expect(rows[0].amount).toBe(4000);
    expect(rows[0].counterpart.kind).toBe("split");
    const edited = await s.call("update_transaction", {
      book,
      id: split.id,
      account: checking.id,
      category: bills.id,
    });
    expect(edited.postings.map((p: any) => p.amount)).toEqual([-12000, 12000]);
  });

  it("undoes and redoes", async () => {
    const { book, food, checking } = await setup();
    await s.call("create_transaction", {
      book,
      date: day,
      account: checking.id,
      amount: -500,
      category: food.id,
    });
    expect((await s.call("list_accounts", { book }))[0].balance).toBe(99500);
    expect((await s.call("undo", { book })).done).toBe(true);
    expect((await s.call("list_accounts", { book }))[0].balance).toBe(100000);
    expect((await s.call("redo", { book })).done).toBe(true);
    expect((await s.call("list_accounts", { book }))[0].balance).toBe(99500);
  });
});

describe("envelope budget", () => {
  it("puts opening balances in To Budget and subtracts what is assigned", async () => {
    const { book, food } = await setup();
    await s.call("set_budget", { book, month, category: food.id, amount: 30000 });
    const view = await s.call("get_budget", { book, month });
    const summary = view.months[0].summary;
    expect(summary.income).toBe(100000);
    expect(summary.totalBudgeted).toBe(-30000);
    expect(summary.toBudget).toBe(70000);
  });

  it("takes overspending out of next month's To Budget unless it rolls over", async () => {
    const { book, food, checking } = await setup();
    const last = prevMonth(month);
    await s.call("create_transaction", {
      book,
      date: firstDay(last),
      account: checking.id,
      amount: -100000,
      payee: "x",
      category: food.id,
    });
    // The opening balance and the spending both fall in the months they are dated.
    let view = await s.call("get_budget", { book, month: last, count: 2 });
    const [before, after] = view.months;
    expect(before.categories.find((c: any) => c.id === food.id).balance).toBe(-100000);
    expect(after.summary.lastMonthOverspent).toBe(-100000);
    expect(after.categories.find((c: any) => c.id === food.id).balance).toBe(0);
    await s.call("set_carryover", { book, month: last, category: food.id, carryover: true });
    view = await s.call("get_budget", { book, month, count: 1 });
    expect(view.months[0].summary.lastMonthOverspent).toBe(0);
    expect(view.months[0].categories.find((c: any) => c.id === food.id).balance).toBe(-100000);
  });

  it("holds for next month and moves money", async () => {
    const { book, food, bills } = await setup();
    await s.call("hold_for_next_month", { book, month, amount: 999999 });
    let summary = (await s.call("get_budget", { book, month })).months[0].summary;
    expect(summary.hold).toBe(100000);
    expect(summary.toBudget).toBe(0);
    await s.call("reset_hold", { book, month });
    await s.call("set_budget", { book, month, category: food.id, amount: 5000 });
    await s.call("move_budget", { book, month, from: food.id, to: bills.id, amount: 2000 });
    const view = await s.call("get_budget", { book, month });
    expect(view.months[0].categories.find((c: any) => c.id === bills.id).budgeted).toBe(2000);
    expect(view.months[0].note).toContain("Reassigned 20.00 from Food → Bills");
  });

  it("counts a categorized transfer to an off-budget account against the category", async () => {
    const { book, food, checking } = await setup();
    const invest = await s.call("create_account", { book, name: "Brokerage", onBudget: false });
    await s.call("create_transaction", {
      book,
      date: day,
      account: checking.id,
      amount: -10000,
      transferAccount: invest.id,
      category: food.id,
    });
    const view = await s.call("get_budget", { book, month });
    expect(view.months[0].categories.find((c: any) => c.id === food.id).spent).toBe(-10000);
    expect(view.months[0].summary.income).toBe(100000);
  });
});

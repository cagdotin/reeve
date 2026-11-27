import { currentMonth, firstDay } from "@reeve/contract/rules";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
beforeEach(() => {
  s = scratch();
});
afterEach(() => s.dispose());

const day = firstDay(currentMonth());

const setup = async () => {
  const book = (await s.call("create_book", { name: "Test" })).id;
  const groups = await s.call("list_categories", { book });
  const food = groups[0].categories.find((c: any) => c.name === "Food").id;
  const bills = groups[0].categories.find((c: any) => c.name === "Bills").id;
  const checking = (await s.call("create_account", { book, name: "Checking" })).id;
  const card = (await s.call("create_account", { book, name: "Card", type: "liability" })).id;
  const add = (account: string, payee: string, category: string, cleared = false) =>
    s.call("create_transaction", {
      book,
      account,
      date: day,
      amount: -100,
      payee,
      category,
      cleared,
    });
  await add(checking, "Grocer", food, true);
  await add(checking, "Power Co", bills);
  await add(card, "Bakery", food);
  const payees = new Map(
    (await s.call("list_payees", { book })).map((p: any) => [p.name, p.id] as const),
  );
  const payeesOf = async (input: object) =>
    (await s.call("list_transactions", { book, ...input })).rows.map((r: any) => r.payee).sort();
  return { book, food, bills, checking, card, payees, payeesOf };
};

describe("register filters", () => {
  it("matches any of the given accounts, categories and payees, and all filters together", async () => {
    const { food, bills, checking, card, payees, payeesOf } = await setup();
    expect(await payeesOf({ accounts: [checking, card] })).toEqual([
      "Bakery",
      "Grocer",
      "Power Co",
    ]);
    expect(await payeesOf({ categories: [food] })).toEqual(["Bakery", "Grocer"]);
    expect(await payeesOf({ categories: [food, bills] })).toEqual(["Bakery", "Grocer", "Power Co"]);
    expect(await payeesOf({ payees: [payees.get("Grocer"), payees.get("Power Co")] })).toEqual([
      "Grocer",
      "Power Co",
    ]);
    expect(await payeesOf({ categories: [food], accounts: [card] })).toEqual(["Bakery"]);
    expect(await payeesOf({ categories: [] })).toEqual([]);
  });

  it("filters by status", async () => {
    const { book, checking, payeesOf } = await setup();
    expect(await payeesOf({ status: ["cleared"] })).toEqual(["Grocer"]);
    expect(await payeesOf({ status: ["uncleared"] })).toEqual(["Bakery", "Power Co"]);
    await s.call("reconcile_account", { book, id: checking, balance: -100 });
    expect(await payeesOf({ status: ["reconciled"] })).toEqual(["Grocer"]);
    expect(await payeesOf({ status: ["cleared"] })).toEqual([]);
    expect(await payeesOf({ status: ["cleared", "reconciled"] })).toEqual(["Grocer"]);
  });
});

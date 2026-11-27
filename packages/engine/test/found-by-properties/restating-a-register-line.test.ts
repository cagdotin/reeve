import { today } from "@reeve/contract/rules";
import { afterEach, beforeEach, expect, it } from "vitest";
import { scratch } from "../helpers.ts";

let s: ReturnType<typeof scratch>;
let checking: string;
let savings: string;
let brokerage: string;
let food: string;
let bills: string;

const date = today();

beforeEach(async () => {
  s = scratch();
  checking = (await s.call("create_account", { name: "Checking" })).id;
  savings = (await s.call("create_account", { name: "Savings", onBudget: false })).id;
  brokerage = (await s.call("create_account", { name: "Brokerage", onBudget: false })).id;
  const categories = (await s.call<Array<any>>("list_categories")).flatMap(
    (group) => group.categories,
  );
  food = categories.find((each: any) => each.name === "Food").id;
  bills = categories.find((each: any) => each.name === "Bills").id;
});

afterEach(() => s.dispose());

const split = () =>
  s.call("create_transaction", {
    date,
    account: checking,
    amount: -300,
    splits: [
      { amount: -100, category: food },
      { amount: -200, category: bills },
    ],
  });

it("takes a split's own amount back without its lines", async () => {
  const { id } = await split();
  const before = await s.call("get_transaction", { id });
  await s.call("update_transaction", { id, account: checking, amount: -300 });
  expect(await s.call("get_transaction", { id })).toEqual(before);
});

it("still asks for the lines when a split's amount changes", async () => {
  const { id } = await split();
  const error = await s.fails("update_transaction", { id, account: checking, amount: -400 });
  expect(error._tag).toBe("InvalidRequest");
});

it("keeps a posting's memo when the amount changes", async () => {
  const { id } = await s.call("create_journal_entry", {
    date,
    postings: [
      { account: checking, amount: -100, memo: "from the card" },
      { account: food, amount: 100, memo: "the groceries" },
    ],
  });
  await s.call("update_transaction", { id, account: checking, amount: -150 });
  const { postings } = await s.call("get_transaction", { id });
  expect(postings.map((each: any) => [each.amount, each.memo])).toEqual([
    [-150, "from the card"],
    [150, "the groceries"],
  ]);
});

it("drops a memo a write names as empty", async () => {
  const { id } = await s.call("create_journal_entry", {
    date,
    postings: [
      { account: checking, amount: -100 },
      { account: food, amount: 100, memo: "the groceries" },
    ],
  });
  await s.call("update_transaction", {
    id,
    postings: [
      { account: checking, amount: -100 },
      { account: food, amount: 100, memo: null },
    ],
  });
  const { postings } = await s.call("get_transaction", { id });
  expect(postings[1].memo).toBeNull();
});

it("keeps the postings in order when a transfer is edited from its far side", async () => {
  const { id } = await s.call("create_transaction", {
    date,
    account: checking,
    amount: -100,
    transferAccount: savings,
  });
  await s.call("update_transaction", { id, account: savings, amount: 150 });
  const { postings } = await s.call("get_transaction", { id });
  expect(postings.map((each: any) => each.accountId)).toEqual([checking, savings]);
});

it("keeps a transfer line's category when its other side restates the amount", async () => {
  const { id } = await s.call("create_transaction", {
    date,
    account: checking,
    amount: -300,
    splits: [
      { amount: -100, transferAccount: savings, category: food },
      { amount: -200, transferAccount: brokerage, category: bills },
    ],
  });
  const before = await s.call("get_transaction", { id });
  await s.call("update_transaction", { id, account: savings, amount: 100 });
  expect(await s.call("get_transaction", { id })).toEqual(before);
});

it("drops a transfer's category once an edit from its far side leaves the budget", async () => {
  const { id } = await s.call("create_transaction", {
    date,
    account: checking,
    amount: -300,
    splits: [
      { amount: -100, transferAccount: savings, category: food },
      { amount: -200, transferAccount: brokerage },
    ],
  });
  await s.call("update_transaction", {
    id,
    account: savings,
    amount: 100,
    splits: [
      { amount: 60, transferAccount: brokerage },
      { amount: 40, transferAccount: brokerage },
    ],
  });
  const { postings } = await s.call("get_transaction", { id });
  const own = postings.find((each: any) => each.accountId === savings);
  expect(own.categoryId).toBeNull();
});

it("refuses a category on a transfer that never touches the budget", async () => {
  const error = await s.fails("create_journal_entry", {
    date,
    postings: [
      { account: savings, amount: -100, category: food },
      { account: brokerage, amount: 100 },
    ],
  });
  expect(error._tag).toBe("InvalidRequest");
});

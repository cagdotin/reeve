import { today } from "@reeve/contract/rules";
import { afterEach, beforeEach, expect, it } from "vitest";
import { scratch } from "../helpers.ts";

let s: ReturnType<typeof scratch>;
let checking: string;
let savings: string;
let food: string;
let general: string;

beforeEach(async () => {
  s = scratch();
  checking = (await s.call("create_account", { name: "Checking" })).id;
  savings = (await s.call("create_account", { name: "Savings", onBudget: false })).id;
  const categories = (await s.call<Array<any>>("list_categories")).flatMap(
    (group) => group.categories,
  );
  const named = (name: string) => categories.find((each: any) => each.name === name).id;
  [food, general] = [named("Food"), named("General")];
});

afterEach(() => s.dispose());

const ruleForEveryone = (action: Record<string, unknown>) =>
  s.call("create_rule", {
    conditions: [{ op: "contains", field: "notes", value: "x" }],
    actions: [{ op: "set", ...action }],
    recategorize: false,
  });

it("keeps the amount of a split when a rule sets another", async () => {
  await ruleForEveryone({ field: "amount", value: -999 });
  const made = await s.call("create_transaction", {
    date: today(),
    account: checking,
    amount: -300,
    notes: "x",
    splits: [
      { amount: -100, category: food },
      { amount: -200, category: general },
    ],
  });
  expect(made.postings.map((each: any) => each.amount)).toEqual([-300, 100, 200]);
});

it("still sets the amount of an entry with no splits", async () => {
  await ruleForEveryone({ field: "amount", value: -999 });
  const made = await s.call("create_transaction", {
    date: today(),
    account: checking,
    amount: -300,
    notes: "x",
  });
  expect(made.postings[0].amount).toBe(-999);
});

it("keeps the account of a transfer when a rule moves it onto the other side", async () => {
  await ruleForEveryone({ field: "account", value: savings });
  const made = await s.call("create_transaction", {
    date: today(),
    account: checking,
    amount: -300,
    notes: "x",
    transferAccount: savings,
  });
  expect(made.postings.map((each: any) => each.accountId)).toEqual([checking, savings]);
});

it("keeps the account of a split when a rule moves it onto one of its transfers", async () => {
  await ruleForEveryone({ field: "account", value: savings });
  const made = await s.call("create_transaction", {
    date: today(),
    account: checking,
    amount: -300,
    notes: "x",
    splits: [
      { amount: -100, transferAccount: savings },
      { amount: -200, category: food },
    ],
  });
  expect(made.postings[0].accountId).toBe(checking);
});

it("imports a row when one rule splits it and another changes its amount", async () => {
  const conditions = [{ op: "contains", field: "imported_payee", value: "Shop" }];
  await s.call("create_rule", {
    conditions,
    actions: [
      { op: "set-split-amount", splitIndex: 1, method: "remainder" },
      { op: "set", field: "category", splitIndex: 1, value: food },
    ],
    recategorize: false,
  });
  await s.call("create_rule", {
    conditions,
    actions: [{ op: "set", field: "amount", value: -999 }],
    recategorize: false,
  });
  await s.call("import_transactions", {
    account: checking,
    rows: [{ date: today(), amount: -300, payee: "Shop" }],
  });
  const { rows } = await s.call("list_transactions", { account: checking });
  expect(rows).toHaveLength(1);
});

it("keeps the rest of what the rule did", async () => {
  await s.call("create_rule", {
    conditions: [{ op: "contains", field: "notes", value: "x" }],
    actions: [
      { op: "set", field: "amount", value: -999 },
      { op: "set", field: "payee", value: (await s.call("create_payee", { name: "Shop" })).id },
    ],
    recategorize: false,
  });
  const made = await s.call("create_transaction", {
    date: today(),
    account: checking,
    amount: -300,
    notes: "x",
    splits: [
      { amount: -100, category: food },
      { amount: -200, category: general },
    ],
  });
  expect(made.payee).toBe("Shop");
  expect(made.postings[0].amount).toBe(-300);
});

import { today } from "@reeve/contract/rules";
import { afterEach, beforeEach, expect, it } from "vitest";
import { scratch } from "../helpers.ts";

let s: ReturnType<typeof scratch>;
let checking: string;
let card: string;
let savings: string;
let food: string;
let bills: string;
const date = today();
const everything = [{ op: "is", field: "date", value: date }];

beforeEach(async () => {
  s = scratch();
  checking = (await s.call("create_account", { name: "Checking" })).id;
  card = (await s.call("create_account", { name: "Card" })).id;
  savings = (await s.call("create_account", { name: "Savings", onBudget: false })).id;
  const categories = (await s.call<Array<any>>("list_categories")).flatMap(
    (group) => group.categories,
  );
  food = categories.find((each: any) => each.name === "Food").id;
  bills = categories.find((each: any) => each.name === "Bills").id;
});

afterEach(() => s.dispose());

const rule = (actions: ReadonlyArray<unknown>) =>
  s.call("create_rule", { conditions: everything, actions, recategorize: false });

it("reports no change for a category a transfer within the budget cannot carry", async () => {
  await rule([{ op: "set", field: "category", value: food }]);
  const { id } = await s.call("create_transaction", {
    date,
    account: checking,
    amount: -100,
    transferAccount: card,
  });
  const { updated } = await s.call("apply_rules", { ids: [id] });
  expect(updated).toEqual([]);
});

it("takes no undo step for a category a transfer within the budget cannot carry", async () => {
  const { id } = await s.call("create_transaction", {
    date,
    account: checking,
    amount: -100,
    transferAccount: card,
  });
  const made = await rule([{ op: "set", field: "category", value: food }]);
  await s.call("apply_rules", { ids: [id] });
  await s.call("undo");
  const rules = await s.call<Array<any>>("list_rules");
  expect(rules.map((each) => each.id)).not.toContain(made.id);
});

it("reports no change when the two sides of a transfer come out as they were", async () => {
  const [rewe, aldi] = [
    (await s.call("create_payee", { name: "Rewe" })).id,
    (await s.call("create_payee", { name: "Aldi" })).id,
  ];
  await s.call("create_rule", {
    stage: "pre",
    conditions: everything,
    actions: [{ op: "set", field: "payee", value: rewe }],
    recategorize: false,
  });
  await s.call("create_rule", {
    conditions: [{ op: "gt", field: "amount", value: 0 }],
    actions: [{ op: "set", field: "payee", value: aldi }],
    recategorize: false,
  });
  const { id } = await s.call("create_transaction", {
    date,
    account: checking,
    amount: -100,
    transferAccount: savings,
  });
  await s.call("apply_rules", { ids: [id] });
  const again = await s.call("apply_rules", { ids: [id] });
  expect(again.updated).toEqual([]);
});

it("leaves a transfer's account when a rule moves it onto the other side", async () => {
  await rule([{ op: "set", field: "account", value: checking }]);
  const { id } = await s.call("create_transaction", {
    date,
    account: checking,
    amount: -100,
    transferAccount: card,
  });
  await s.call("apply_rules", { ids: [id] });
  const { postings } = await s.call("get_transaction", { id });
  expect(postings.map((each: any) => each.accountId)).toEqual([checking, card]);
});

it("leaves a split's amount when a rule's does not fit its lines, and does the rest", async () => {
  await rule([
    { op: "set", field: "amount", value: -999 },
    { op: "set", field: "notes", value: "seen" },
  ]);
  const { id } = await s.call("create_transaction", {
    date,
    account: checking,
    amount: -300,
    splits: [
      { amount: -100, category: food },
      { amount: -200, category: bills },
    ],
  });
  await s.call("apply_rules", { ids: [id] });
  const { notes, postings } = await s.call("get_transaction", { id });
  expect(notes).toBe("seen");
  expect(postings[0].amount).toBe(-300);
});

it("leaves a reconciled amount when a rule changes it", async () => {
  const { id } = await s.call("create_transaction", {
    date,
    account: checking,
    amount: -300,
    cleared: true,
  });
  await s.call("reconcile_account", { id: checking, balance: -300 });
  await rule([{ op: "set", field: "amount", value: -999 }]);
  await s.call("apply_rules", { ids: [id] });
  expect((await s.call("get_transaction", { id })).postings[0].amount).toBe(-300);
});

const splitInTwo = [
  { op: "set-split-amount", splitIndex: 1, method: "fixed-percent", value: 50 },
  { op: "set-split-amount", splitIndex: 2, method: "remainder" },
];

it("runs on the side left when rules on the other side moved a transfer off it", async () => {
  const { id } = await s.call("create_transaction", {
    date,
    account: checking,
    amount: -100,
    transferAccount: card,
  });
  await rule(splitInTwo);
  await s.call("apply_rules", { ids: [id] });
  const { postings } = await s.call("get_transaction", { id });
  expect(postings).toHaveLength(3);
});

it("keeps a split's lines when a rule that splits meets it", async () => {
  const { id } = await s.call("create_transaction", {
    date,
    account: checking,
    amount: -300,
    payee: "Rewe",
    splits: [
      { amount: -100, category: food },
      { amount: -200, category: bills },
    ],
  });
  await rule(splitInTwo);
  const before = await s.call("get_transaction", { id });
  const { updated } = await s.call("apply_rules", { ids: [id] });
  expect(updated).toEqual([]);
  expect(await s.call("get_transaction", { id })).toEqual(before);
});

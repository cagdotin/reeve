import { today } from "@reeve/contract/rules";
import { afterEach, beforeEach, expect, it } from "vitest";
import { scratch } from "../helpers.ts";

let s: ReturnType<typeof scratch>;
let checking: string;
let opening: string;
let food: string;
let start: string;

beforeEach(async () => {
  s = scratch();
  checking = (await s.call("create_account", { name: "Checking", balance: 10_000 })).id;
  const ledger = await s.call<Array<any>>("list_ledger_accounts");
  opening = ledger.find((each) => each.system === "opening").id;
  const categories = (await s.call<Array<any>>("list_categories")).flatMap(
    (group) => group.categories,
  );
  food = categories.find((each: any) => each.name === "Food").id;
  start = (await s.call("list_transactions", { account: checking })).rows[0].transactionId;
});

afterEach(() => s.dispose());

const sides = async (id: string) =>
  (await s.call("get_transaction", { id })).postings.map((each: any) => [
    each.accountId,
    each.amount,
  ]);

it("takes a new amount and stays on Opening Balances", async () => {
  await s.call("update_transaction", { id: start, account: checking, amount: 12_500 });
  expect(await sides(start)).toEqual([
    [checking, 12_500],
    [opening, -12_500],
  ]);
});

it("takes the category it already has", async () => {
  await s.call("update_transaction", {
    id: start,
    account: checking,
    amount: 12_500,
    category: opening,
  });
  expect(await sides(start)).toEqual([
    [checking, 12_500],
    [opening, -12_500],
  ]);
});

it("can still move to a category a person names", async () => {
  await s.call("update_transaction", { id: start, account: checking, category: food });
  expect(await sides(start)).toEqual([
    [checking, 10_000],
    [food, -10_000],
  ]);
});

it("lets apply_rules change what a rule says about it", async () => {
  const rule = await s.call("create_rule", {
    conditions: [{ op: "gt", field: "amount", value: 0 }],
    actions: [
      { op: "set", field: "cleared", value: false },
      { op: "set", field: "notes", value: "seen" },
    ],
  });
  const { updated } = await s.call("apply_rules", { rule: rule.id, ids: [start] });
  expect(updated.map((each: any) => each.id)).toEqual([start]);
  const { notes, postings } = await s.call("get_transaction", { id: start });
  expect(notes).toBe("seen");
  expect(postings.map((each: any) => each.accountId)).toEqual([checking, opening]);
});

it("lets a rule move it to another account", async () => {
  const other = (await s.call("create_account", { name: "Other" })).id;
  const rule = await s.call("create_rule", {
    conditions: [{ op: "gt", field: "amount", value: 0 }],
    actions: [{ op: "set", field: "account", value: other }],
  });
  await s.call("apply_rules", { rule: rule.id, ids: [start] });
  expect(await sides(start)).toEqual([
    [other, 10_000],
    [opening, -10_000],
  ]);
});

it("keeps Opening Balances out of everyone else's reach", async () => {
  const entered = await s.fails("create_transaction", {
    date: today(),
    account: checking,
    amount: -100,
    category: opening,
  });
  expect(entered._tag).toBe("InvalidRequest");
  const { id } = await s.call("create_transaction", {
    date: today(),
    account: checking,
    amount: -100,
    category: food,
  });
  const changed = await s.fails("update_transaction", { id, account: checking, category: opening });
  expect(changed._tag).toBe("InvalidRequest");
});

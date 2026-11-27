import { today } from "@reeve/contract/rules";
import { afterEach, beforeEach, expect, it } from "vitest";
import { scratch } from "../helpers.ts";

let s: ReturnType<typeof scratch>;
let checking: string;
let savings: string;
let food: string;

beforeEach(async () => {
  s = scratch();
  checking = (await s.call("create_account", { name: "Checking" })).id;
  savings = (await s.call("create_account", { name: "Savings", onBudget: false })).id;
  const categories = (await s.call<Array<any>>("list_categories")).flatMap(
    (group) => group.categories,
  );
  food = categories.find((each: any) => each.name === "Food").id;
});

afterEach(() => s.dispose());

const transferCategory = async (id: string) =>
  (await s.call("get_transaction", { id })).postings.find((p: any) => p.accountId === savings)
    .categoryId;

it("keeps the category when the budget side names the transfer it already is", async () => {
  const { id } = await s.call("create_transaction", {
    date: today(),
    account: checking,
    amount: -1000,
    transferAccount: savings,
    category: food,
  });
  await s.call("update_transaction", { id, account: checking, transferAccount: savings });
  expect(await transferCategory(id)).toBe(food);
});

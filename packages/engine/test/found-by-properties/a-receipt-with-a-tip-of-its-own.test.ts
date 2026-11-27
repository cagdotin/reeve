import { today } from "@reeve/contract/rules";
import { vi, afterEach, beforeEach, expect, it } from "vitest";

// Frozen behavior stays covered without enabling purchases in the product.
vi.mock("@reeve/contract/features", () => ({ FEATURES: { purchases: true } }));
import { scratch } from "../helpers.ts";

let s: ReturnType<typeof scratch>;
let checking: string;
let food: string;
let bills: string;

beforeEach(async () => {
  s = scratch();
  checking = (await s.call("create_account", { name: "Checking" })).id;
  const categories = (await s.call<Array<any>>("list_categories")).flatMap(
    (group) => group.categories,
  );
  food = categories.find((each: any) => each.name === "Food").id;
  bills = categories.find((each: any) => each.name === "Bills").id;
});

afterEach(() => s.dispose());

it("reads as applied when its tip went to a category a person named", async () => {
  const { receipt } = await s.call("create_receipt", {
    date: today(),
    total: 1000,
    lines: [{ text: "Dinner", lineTotal: 1000, budgetCategoryId: food }],
  });
  const { id } = await s.call("create_transaction", {
    date: today(),
    account: checking,
    amount: -1200,
  });
  await s.call("link_receipt_payment", { receipt: receipt.id, transaction: id, amount: 1000 });
  const applied = await s.call("apply_receipt_to_transaction", {
    id: receipt.id,
    remainderCategory: bills,
  });
  expect(applied.receipt.status.applied).toBe(true);
  const after = await s.call("get_receipt", { id: receipt.id });
  expect(after.status.applied).toBe(true);
});

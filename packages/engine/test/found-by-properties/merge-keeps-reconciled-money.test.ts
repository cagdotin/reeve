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

const entry = (amount: number, extra: Record<string, unknown> = {}) =>
  s.call("create_transaction", { date: today(), account: checking, amount, ...extra });
const reconcile = async (account: string) => {
  const { cleared } = (await s.call("list_accounts")).find((each: any) => each.id === account);
  await s.call("reconcile_account", { id: account, balance: cleared });
};
const reconciledTotal = async (account: string) => {
  const { rows } = await s.call("list_transactions", { account, status: ["reconciled"] });
  return rows.reduce((sum: number, row: any) => sum + row.amount, 0);
};

it("refuses when both copies are reconciled, since one would leave the agreed balance", async () => {
  const [a, b] = [await entry(-100, { cleared: true }), await entry(-100, { cleared: true })];
  await reconcile(checking);
  const failure = await s.fails("merge_transactions", { keep: a.id, drop: b.id });
  expect(failure.message).toContain("reconciled");
  expect(await reconciledTotal(checking)).toBe(-200);
  await s.call("delete_transactions", { ids: [b.id], confirmReconciled: true });
  expect(await reconciledTotal(checking)).toBe(-100);
});

it("refuses when the dropped copy's other side is reconciled and the kept one has its own category", async () => {
  const a = await entry(-100, { category: food });
  const b = await entry(-100, { transferAccount: savings });
  await s.call("update_transaction", { id: b.id, account: savings, cleared: true });
  await reconcile(savings);
  await s.fails("merge_transactions", { keep: a.id, drop: b.id });
  expect(await reconciledTotal(savings)).toBe(100);
});

it("carries the other side over when the kept copy is uncategorized", async () => {
  const a = await entry(-100);
  const b = await entry(-100, { transferAccount: savings });
  await s.call("update_transaction", { id: b.id, account: savings, cleared: true });
  await reconcile(savings);
  await s.call("merge_transactions", { keep: a.id, drop: b.id });
  expect(await reconciledTotal(savings)).toBe(100);
});

it("marks only the posting of the shared amount, in a kept copy with two on the account", async () => {
  const keep = await s.call("create_journal_entry", {
    date: today(),
    postings: [
      { account: checking, amount: -40 },
      { account: checking, amount: -100 },
      { account: food, amount: 140 },
    ],
  });
  const drop = await entry(-100, { category: food, cleared: true });
  await reconcile(checking);
  const merged = await s.call("merge_transactions", { keep: keep.id, drop: drop.id });
  const marks = merged.postings
    .filter((posting: any) => posting.accountId === checking)
    .map((posting: any) => [posting.amount, posting.reconciled]);
  expect(marks).toEqual([
    [-40, false],
    [-100, true],
  ]);
});

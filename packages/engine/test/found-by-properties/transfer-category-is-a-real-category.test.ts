import { currentMonth, today } from "@reeve/contract/rules";
import { afterEach, beforeEach, expect, it } from "vitest";
import { scratch } from "../helpers.ts";

let s: ReturnType<typeof scratch>;
let checking: string;
let savings: string;
let uncategorized: string;

beforeEach(async () => {
  s = scratch();
  checking = (await s.call("create_account", { name: "Checking", balance: 100_000 })).id;
  savings = (await s.call("create_account", { name: "Savings", onBudget: false })).id;
  await s.call("create_transaction", { date: today(), account: checking, amount: -100 });
  const ledger = await s.call<Array<any>>("list_ledger_accounts");
  uncategorized = ledger.find((each) => each.system === "uncategorized").id;
});

afterEach(() => s.dispose());

const toBudget = async () =>
  (await s.call("get_budget", { month: currentMonth() })).months[0].summary.toBudget;

it("refuses a transfer that counts against Uncategorized, whose money no envelope holds", async () => {
  const before = await toBudget();
  const failure = await s.fails("create_transaction", {
    date: today(),
    account: checking,
    amount: -1000,
    transferAccount: savings,
    category: uncategorized,
  });
  expect(failure.message).toContain("not a category");
  expect(await toBudget()).toBe(before);
});

it("refuses the same in a journal entry and in rewritten postings", async () => {
  const postings = [
    { account: checking, amount: -1000 },
    { account: savings, amount: 1000, category: uncategorized },
  ];
  const journal = await s.fails("create_journal_entry", { date: today(), postings });
  expect(journal.message).toContain("not a category");
  const { id } = await s.call("create_transaction", {
    date: today(),
    account: checking,
    amount: -1000,
    transferAccount: savings,
  });
  const rewrite = await s.fails("update_transaction", { id, postings });
  expect(rewrite.message).toContain("not a category");
});

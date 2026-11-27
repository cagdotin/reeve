import { today } from "@reeve/contract/rules";
import { afterEach, beforeEach, expect, it } from "vitest";
import { scratch } from "../helpers.ts";

let s: ReturnType<typeof scratch>;

beforeEach(() => {
  s = scratch();
});

afterEach(() => s.dispose());

it("keeps the cleared mark on the line a merge replaces", async () => {
  const { id: checking } = await s.call("create_account", { name: "Checking" });
  const { postings } = await s.call("create_transaction", {
    date: today(),
    account: checking,
    amount: -500,
  });
  const uncategorized = postings.find((each: any) => each.accountId !== checking).accountId;
  const { id: keep } = await s.call("create_journal_entry", {
    date: today(),
    postings: [
      { account: checking, amount: -1000 },
      { account: uncategorized, amount: 1000, cleared: true },
    ],
  });
  const [{ id: drop }] = await s.call<Array<any>>("duplicate_transactions", { ids: [keep] });
  const merged = await s.call("merge_transactions", { keep, drop });
  const line = merged.postings.find((each: any) => each.accountId === uncategorized);
  expect(line.cleared).toBe(true);
});

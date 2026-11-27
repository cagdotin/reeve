import { afterEach, beforeEach, expect, it } from "vitest";
import { scratch } from "../helpers.ts";

let s: ReturnType<typeof scratch>;
let account: string;

beforeEach(async () => {
  s = scratch();
  account = (await s.call("create_account", { name: "Checking" })).id;
});

afterEach(() => s.dispose());

const csv = (...days: ReadonlyArray<string>) =>
  ["Date,Payee,Notes,Amount", ...days.map((day) => `${day},Aldi,,25.00`)].join("\n");

it("adds nothing the second time when a row's nearest match is another row's own", async () => {
  await s.call("create_transaction", { date: "2026-06-09", account, amount: 2500, payee: "Rewe" });
  const input = { account, fileName: "bank.csv", content: csv("2026-06-01", "2026-06-02") };
  const first = await s.call("import_transactions", input);
  expect(first.added).toHaveLength(1);
  expect(first.updated).toHaveLength(1);
  const second = await s.call("import_transactions", input);
  expect(second.added).toEqual([]);
  const { rows } = await s.call("list_transactions", { account });
  expect(rows).toHaveLength(2);
});

it("keeps two rows alike but for their notes on their own transactions", async () => {
  await s.call("create_transaction", { date: "2026-06-06", account, amount: 2500 });
  const input = {
    account,
    fileName: "bank.csv",
    content: [
      "Date,Payee,Notes,Amount",
      "2026-06-09,Aldi,card 12,25.00",
      "2026-06-02,Aldi,,25.00",
      "2026-06-09,Aldi,,25.00",
    ].join("\n"),
  };
  await s.call("import_transactions", input);
  const second = await s.call("import_transactions", input);
  expect(second.added).toEqual([]);
  expect(second.updated).toEqual([]);
});

it("still takes a transaction of the same payee a few days off", async () => {
  await s.call("create_transaction", { date: "2026-06-05", account, amount: 2500, payee: "Aldi" });
  const { added, updated } = await s.call("import_transactions", {
    account,
    fileName: "bank.csv",
    content: csv("2026-06-02"),
  });
  expect(added).toEqual([]);
  expect(updated).toHaveLength(1);
});

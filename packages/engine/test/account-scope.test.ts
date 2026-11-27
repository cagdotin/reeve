import { addDays, today } from "@reeve/contract/rules";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
let book: string;
let checking: string;
let card: string;
let savings: string;
let old: string;
let food: string;
let bills: string;
const yesterday = addDays(today(), -1);
const soon = addDays(today(), 3);

beforeEach(async () => {
  s = scratch();
  book = (await s.call("create_book", { name: "Test" })).id;
  const account = async (name: string, more: Record<string, unknown> = {}) =>
    (await s.call("create_account", { book, name, ...more })).id as string;
  checking = await account("Checking");
  card = await account("Card");
  savings = await account("Savings", { onBudget: false });
  old = await account("Old");
  const groups = await s.call("list_categories", { book });
  const named = (name: string) => groups[0].categories.find((c: any) => c.name === name).id;
  food = named("Food");
  bills = named("Bills");
});
afterEach(() => s.dispose());

const call = (name: string, input: Record<string, unknown> = {}) =>
  s.call(name, { book, ...input });

const spend = (account: string, payee: string, amount: number, category = food) =>
  call("create_transaction", { account, date: yesterday, amount, payee, category });

const names = (rows: ReadonlyArray<{ readonly name: string | null }>) =>
  rows.map((row) => row.name ?? "").toSorted((a, b) => a.localeCompare(b));

describe("every overview takes a scope", () => {
  it("rejects an account that does not exist, and leaves a call without a scope as it was", async () => {
    await spend(checking, "Shop", -1000);
    for (const name of ["schedule_activity", "payee_activity", "rule_activity"]) {
      await expect(s.fails(name, { book, account: "nope" })).resolves.toMatchObject({
        _tag: "NotFound",
      });
    }
    const whole = await call("payee_activity");
    expect(whole.summary.transactions).toBe(1);
    await expect(call("payee_activity", { account: card })).resolves.toMatchObject({
      total: 0,
      payees: [],
      earliest: null,
    });
  });
});

describe("payee_activity", () => {
  beforeEach(async () => {
    await spend(checking, "Shop", -1000);
    await spend(checking, "Shop", -2500, bills);
    await spend(card, "Shop", -400);
    await spend(card, "Cafe", -700);
    await spend(savings, "Broker", -900);
    await call("create_payee", { name: "Unused" });
  });

  it("counts only the scope's transactions, as its postings add up", async () => {
    const overview = await call("payee_activity", { account: checking });
    expect(names(overview.payees)).toEqual(["Shop"]);
    const [shop] = overview.payees;
    expect(overview.total).toBe(1);
    expect(shop.transactionCount).toBe(2);
    expect(shop.rangeTransactions).toBe(2);
    expect(shop.rangeSpent, "the 4.00 on Card is another account's").toBe(1000 + 2500);
    expect(shop.categories.map((each: { id: string }) => each.id).toSorted()).toEqual(
      [food, bills].toSorted(),
    );
    expect(overview.summary).toMatchObject({ payees: 1, transactions: 2, spent: 3500 });

    const postings = await call("list_transactions", { account: checking, payees: [shop.id] });
    const fromRegister = postings.rows.reduce(
      (sum: number, row: { amount: number }) => sum - row.amount,
      0,
    );
    expect(shop.rangeSpent, "the tile is what the register shows for that payee").toBe(
      fromRegister,
    );
  });

  it("groups by budget and off budget, and only the whole book holds unused payees", async () => {
    const budget = await call("payee_activity", { onBudget: true });
    expect(names(budget.payees)).toEqual(["Cafe", "Shop"]);
    expect(budget.summary.spent).toBe(1000 + 2500 + 400 + 700);
    expect(budget.attention.unused).toBe(0);

    const off = await call("payee_activity", { onBudget: false });
    expect(names(off.payees)).toEqual(["Broker"]);

    const whole = await call("payee_activity");
    expect(names(whole.payees)).toEqual(["Broker", "Cafe", "Shop", "Unused"]);
    expect(whole.attention.unused).toBe(1);
    expect(whole.payees.find((each: any) => each.name === "Shop").transactionCount).toBe(3);
  });

  it("keeps a closed account's past under its group, as the register does", async () => {
    await spend(old, "Gone", -300);
    await call("close_account", { id: old, transferAccount: card });
    const budget = await call("payee_activity", { onBudget: true });
    expect(names(budget.payees)).toContain("Gone");
  });
});

describe("schedule_activity", () => {
  const schedule = (name: string, account: string | undefined, amount = -1000) =>
    call("create_schedule", {
      name,
      amountOp: "is",
      amount,
      date: soon,
      ...(account === undefined ? {} : { account }),
    });

  beforeEach(async () => {
    await schedule("Rent", checking, -50_000);
    await schedule("Fee", card, -500);
    await schedule("Interest", savings, 700);
    await schedule("Floating", undefined);
  });

  it("lists what posts to the scope, and says how many have no account", async () => {
    const overview = await call("schedule_activity", { account: checking });
    expect(names(overview.schedules)).toEqual(["Rent"]);
    expect(overview.noAccount).toBe(1);
    const month = overview.months.find(
      (each: { month: string }) => each.month === soon.slice(0, 7),
    );
    expect(month.out, "only Rent counts toward what the month holds").toBe(50_000);
    expect(month.in).toBe(0);

    expect(names((await call("schedule_activity", { onBudget: true })).schedules)).toEqual([
      "Fee",
      "Rent",
    ]);
    expect(names((await call("schedule_activity", { onBudget: false })).schedules)).toEqual([
      "Interest",
    ]);
    expect(names((await call("schedule_activity")).schedules)).toEqual([
      "Fee",
      "Floating",
      "Interest",
      "Rent",
    ]);
  });

  it("shows a closed account's schedule on that account alone", async () => {
    await schedule("Stopped", old);
    await spend(old, "Gone", -300);
    await call("close_account", { id: old, transferAccount: card });
    expect(names((await call("schedule_activity", { onBudget: true })).schedules)).toEqual([
      "Fee",
      "Rent",
    ]);
    expect(names((await call("schedule_activity", { account: old })).schedules)).toEqual([
      "Stopped",
    ]);
  });

  it("finds new schedules only on the scope's accounts", async () => {
    for (const months of [1, 2, 3, 4]) {
      const date = addDays(today(), -30 * months);
      await call("create_transaction", { account: card, date, amount: -999, payee: "Gym" });
    }
    const found = await call("find_schedules");
    expect(found.some((each: any) => each.accountId === card)).toBe(true);
    await expect(call("find_schedules", { account: checking })).resolves.toEqual([]);
    expect(
      (await call("find_schedules", { account: card })).map((each: any) => each.accountId),
    ).toEqual(found.map(() => card));
  });
});

describe("rule_activity", () => {
  const rule = async (conditions: ReadonlyArray<unknown>, conditionsOp: "and" | "or" = "and") =>
    (
      await call("create_rule", {
        conditions,
        conditionsOp,
        actions: [{ op: "set", field: "notes", value: "seen" }],
        recategorize: false,
      })
    ).id as string;
  const account = (op: string, value: unknown) => ({ field: "account", op, value });
  const textOf = (value: string) => ({ field: "imported_payee", op: "is", value });

  it("keeps rules that can act on the scope, and counts matches there alone", async () => {
    const shop = (await call("create_payee", { name: "Shop" })).id;
    const named = await rule([account("is", checking)]);
    const elsewhere = await rule([account("is", card)]);
    const not = await rule([account("isNot", checking)]);
    const everywhere = await rule([{ field: "payee", op: "is", value: shop }]);
    const either = await rule([account("is", card), textOf("x")], "or");
    const budget = await rule([account("onBudget", null)]);
    await spend(checking, "Shop", -1000);
    await spend(card, "Shop", -400);
    await spend(card, "Shop", -300);

    const overview = await call("rule_activity", { account: checking });
    const byId = new Map(overview.rules.map((each: any) => [each.id, each]));
    expect(byId.has(named)).toBe(true);
    expect(byId.has(elsewhere), "a rule on Card alone cannot act on Checking").toBe(false);
    expect(byId.has(not), "a rule excluding Checking cannot act on it").toBe(false);
    expect(byId.has(budget), "Checking is on budget").toBe(true);
    expect(byId.get(named)).toMatchObject({ everyAccount: false, matches: 1, totalMatches: 1 });
    expect(byId.get(everywhere), "1 of Shop's 3 is on Checking").toMatchObject({
      everyAccount: true,
      matches: 1,
      totalMatches: 1,
    });
    expect(byId.get(either), "with or, another condition can still match").toMatchObject({
      everyAccount: true,
    });
    expect(overview.summary).toMatchObject({ transactions: 1, covered: 1 });

    const whole = await call("rule_activity");
    expect(whole.rules.find((each: any) => each.id === everywhere).totalMatches).toBe(3);
    expect(whole.summary.transactions).toBe(3);
    expect(
      (await call("rule_activity", { onBudget: false })).rules.map((each: any) => each.id),
    ).toEqual(expect.not.arrayContaining([budget, named]));
  });

  it("does not call a rule quiet for matching only on other accounts", async () => {
    const shop = (await call("create_payee", { name: "Shop" })).id;
    const id = await rule([{ field: "payee", op: "is", value: shop }]);
    await spend(card, "Shop", -400);
    const here = (await call("rule_activity", { account: checking })).rules.find(
      (each: any) => each.id === id,
    );
    expect(here).toMatchObject({ totalMatches: 0, everyAccount: true });
    expect(here.problems.quiet).toBe(false);
  });

  it("names only the scope's payees as worth a rule", async () => {
    for (const amount of [-100, -200])
      await call("create_transaction", { account: card, date: yesterday, amount, payee: "Often" });
    expect((await call("rule_activity", { account: checking })).suggestionCount).toBe(0);
    expect((await call("rule_activity", { account: card })).suggestionCount).toBe(1);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addDays, today } from "@reeve/contract/rules";
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
let book: string;
let checking: string;
let food: string;
let bills: string;
beforeEach(async () => {
  s = scratch();
  book = (await s.call("create_book", { name: "Test" })).id;
  checking = (await s.call("create_account", { book, name: "Checking" })).id;
  const groups = await s.call("list_categories", { book });
  const named = (name: string) => groups[0].categories.find((c: any) => c.name === name).id;
  food = named("Food");
  bills = named("Bills");
});
afterEach(() => s.dispose());

const call = (name: string, input: Record<string, unknown> = {}) =>
  s.call(name, { book, ...input });

const payee = async (name: string) => (await call("create_payee", { name })).id as string;

const spend = (name: string | null, date: string, amount = -1000, category = food) =>
  call("create_transaction", {
    account: checking,
    date,
    amount,
    payee: name,
    category,
  });

const setter = (id: string, category = food) =>
  call("create_rule", {
    stage: "default",
    conditionsOp: "and",
    conditions: [{ op: "is", field: "payee", value: id }],
    actions: [{ op: "set", field: "category", value: category }],
  });

const activity = (since?: string) =>
  call("payee_activity", since === undefined ? {} : { since }) as Promise<any>;

const row = async (name: string, since?: string) =>
  (await activity(since)).payees.find((each: any) => each.name === name);

describe("payee descriptions", () => {
  it("are kept, cleaned and cleared", async () => {
    const id = await payee("GOTAX");
    const set = await call("update_payee", { id, description: "  Taxi app  " });
    expect(set.description).toBe("Taxi app");
    expect((await call("update_payee", { id, description: "  " })).description).toBeNull();
    expect((await call("create_payee", { name: "gotax", description: "Cab" })).description).toBe(
      "Cab",
    );
  });

  it("carry over a merge when the target has none", async () => {
    const target = await payee("A");
    const other = (await call("create_payee", { name: "B", description: "From B" })).id;
    const merged = await call("merge_payees", { target, merge: [other] });
    expect(merged.description).toBe("From B");
  });
});

describe("renaming a payee", () => {
  it("refuses a name another payee has, in any case", async () => {
    await payee("Billa");
    const id = await payee("Bila");
    await expect(call("update_payee", { id, name: "BILLA" })).rejects.toThrow(/already a payee/);
    expect((await call("list_payees")).map((each: any) => each.name)).toEqual(["Bila", "Billa"]);
  });

  it("changes the case of its own name", async () => {
    const id = await payee("billa");
    expect((await call("update_payee", { id, name: "BILLA" })).name).toBe("BILLA");
  });
});

describe("deleting a payee", () => {
  it("leaves no rule that matches transactions without a payee", async () => {
    const id = await payee("Lidl");
    await setter(id);
    await call("delete_payees", { ids: [id] });
    expect(await call("list_rules")).toEqual([]);
    const created = await call("create_transaction", {
      account: checking,
      date: "2026-10-10",
      amount: -1000,
    });
    const { rows } = await call("list_transactions", { account: checking });
    expect(rows.find((each: any) => each.transactionId === created.id).counterpart.name).not.toBe(
      "Food",
    );
  });

  it("only takes it out of a list of payees", async () => {
    const one = await payee("One");
    const two = await payee("Two");
    await call("create_rule", {
      stage: "default",
      conditionsOp: "and",
      conditions: [{ op: "oneOf", field: "payee", value: [one, two] }],
      actions: [{ op: "set", field: "category", value: food }],
    });
    await call("delete_payees", { ids: [one] });
    const [rule] = await call("list_rules");
    expect(rule.conditions[0].value).toEqual([two]);
    await call("delete_payees", { ids: [two] });
    expect(await call("list_rules")).toEqual([]);
  });

  it("drops a rule's action that sets it, keeping the rule's others", async () => {
    const id = await payee("Renamed");
    await call("create_rule", {
      stage: "default",
      conditionsOp: "and",
      conditions: [{ op: "contains", field: "notes", value: "x" }],
      actions: [
        { op: "set", field: "payee", value: id },
        { op: "set", field: "category", value: food },
      ],
    });
    await call("delete_payees", { ids: [id] });
    const [rule] = await call("list_rules");
    expect(rule.actions.map((each: any) => each.field)).toEqual(["category"]);
  });

  it("is refused while a schedule names it, changing nothing", async () => {
    const id = await payee("Rent");
    await call("create_schedule", {
      name: "Rent",
      payee: "Rent",
      account: checking,
      amount: -1000,
      date: "2026-10-10",
    });
    await spend("Rent", "2026-10-01");
    await expect(call("delete_payees", { ids: [id] })).rejects.toThrow(/schedule Rent/);
    expect((await row("Rent")).transactionCount).toBe(1);
  });

  it("comes back with its rule on undo", async () => {
    const id = await payee("Lidl");
    await setter(id);
    await call("delete_payees", { ids: [id] });
    await call("undo");
    expect(await call("list_rules")).toHaveLength(1);
  });
});

describe("payee_activity", () => {
  it("counts the range apart from all time, and lists only payees in range", async () => {
    await spend("Old", "2026-01-05");
    await spend("Both", "2026-01-05");
    await spend("Both", "2026-09-05", -2500);
    await spend("Both", "2026-09-06", -500);
    const overview = await activity("2026-09-01");
    expect(overview.payees.map((each: any) => each.name)).toEqual(["Both"]);
    expect(overview.total).toBe(2);
    expect(overview.earliest).toBe("2026-01-05");
    expect(overview.payees[0]).toMatchObject({
      transactionCount: 3,
      rangeTransactions: 2,
      rangeSpent: 3000,
      lastTransaction: "2026-09-06",
    });
  });

  it("lists unused payees only for all time", async () => {
    await payee("Unused");
    expect((await activity("2026-01-01")).payees).toEqual([]);
    expect((await row("Unused")).lastTransaction).toBeNull();
  });

  it("orders a payee's categories by use", async () => {
    await spend("Mixed", "2026-09-01", -100, bills);
    await spend("Mixed", "2026-09-02", -100, food);
    await spend("Mixed", "2026-09-03", -100, food);
    expect((await row("Mixed")).categories).toMatchObject([
      { name: "Food", transactions: 2 },
      { name: "Bills", transactions: 1 },
    ]);
  });

  it("counts rules, and finds setters that repeat one category", async () => {
    const id = await payee("Twice");
    const other = await payee("Different");
    await setter(id);
    await setter(id);
    await setter(other, food);
    await setter(other, bills);
    expect(await row("Twice")).toMatchObject({ ruleCount: 2, duplicateRules: true });
    expect(await row("Different")).toMatchObject({ ruleCount: 2, duplicateRules: false });
  });

  it("counts what needs attention over the whole book, whatever the range", async () => {
    await payee("Unused");
    const dup = await payee("Dup");
    await setter(dup);
    await setter(dup);
    for (const day of ["01", "02", "03"]) await spend("Friend", `2026-01-${day}`);
    await call("update_payee", {
      id: (await call("list_payees")).find((each: any) => each.name === "Friend").id,
      learnCategories: false,
    });
    const friend = await row("Friend");
    for (const rule of await call("list_rules"))
      if (rule.conditions[0].value === friend.id) await call("delete_rules", { ids: [rule.id] });
    expect((await activity("2026-10-01")).attention).toEqual({
      unused: 2,
      repeatWithoutRule: 1,
      duplicateRules: 1,
      ruleDisagrees: 0,
    });
  });
});

describe("payee_activity's patterns", () => {
  it("counts as many days before the range as the range has, both ends included", async () => {
    const daysAgo = (days: number) => addDays(today(), -days);
    await spend("First day before", daysAgo(11), -1000);
    await spend("Last day before", daysAgo(21), -1000);
    await spend("Too early", daysAgo(22), -1000);
    const overview = await activity(daysAgo(10));
    expect(overview.summary.previous.transactions).toBe(2);
  });

  it("compares the range with as many days before it", async () => {
    const daysAgo = (days: number) => addDays(today(), -days);
    await spend("Steady", daysAgo(50), -1000);
    await spend("Steady", daysAgo(5), -3000);
    await spend("Fresh", today(), -500);
    const overview = await activity(daysAgo(30));
    expect(overview.summary).toEqual({
      payees: 2,
      newPayees: 1,
      transactions: 2,
      spent: 3500,
      previous: { payees: 1, newPayees: 1, transactions: 1, spent: 1000 },
    });
    expect(overview.movers.map((each: any) => [each.name, each.spent, each.previousSpent])).toEqual(
      [
        ["Steady", 3000, 1000],
        ["Fresh", 500, 0],
      ],
    );
    expect(overview.payees.find((each: any) => each.name === "Fresh").newInRange).toBe(true);
    expect(overview.payees.find((each: any) => each.name === "Steady").newInRange).toBe(false);
  });

  it("has no comparison over all time, and always twelve months", async () => {
    await spend("A", "2026-01-05");
    const overview = await activity();
    expect(overview.summary.previous).toBeNull();
    expect(overview.movers).toEqual([]);
    expect(overview.months).toHaveLength(12);
  });

  it("lists a settled price, not a one-off or a different purchase", async () => {
    for (const [i, amount] of [-1599, -1599, -1799, -1799].entries())
      await spend("Plan", `2026-0${i + 1}-06`, amount);
    for (const [i, amount] of [-340, -3300, -3300].entries())
      await spend("Tickets", `2026-0${i + 1}-07`, amount);
    for (const [i, amount] of [-7000, -7000, -13000, -7000, -7000].entries())
      await spend("Phone", `2026-0${i + 1}-08`, amount);
    expect((await activity()).priceChanges).toMatchObject([
      { name: "Plan", from: 1599, to: 1799, date: "2026-03-06" },
    ]);
  });

  it("finds a regular payee gone quiet, not one used on a trip", async () => {
    for (const month of ["01", "02", "03", "04", "05", "06"])
      await spend("Regular", `2025-${month}-10`);
    for (const day of ["01", "02", "03", "04"]) await spend("Trip", `2025-06-${day}`);
    const [quiet, ...others] = (await activity()).quiet;
    expect(others).toEqual([]);
    expect(quiet).toMatchObject({ name: "Regular", lastTransaction: "2025-06-10" });
    expect(quiet.usualGap).toBeGreaterThan(27);
  });

  it("flags a rule that recent transactions ignore", async () => {
    const id = await payee("Drugstore");
    await setter(id, bills);
    await call("update_payee", { id, learnCategories: false });
    for (const day of ["01", "02", "03"]) {
      const created = await spend("Drugstore", `2026-09-${day}`);
      await call("update_transaction", { id: created.id, account: checking, category: food });
    }
    expect((await row("Drugstore")).ruleDisagrees).toBe(true);
    expect((await activity()).attention.ruleDisagrees).toBe(1);
    const other = await payee("Agrees");
    await setter(other, food);
    for (const day of ["01", "02", "03"]) await spend("Agrees", `2026-09-${day}`);
    expect((await row("Agrees")).ruleDisagrees).toBe(false);
  });
});

describe("payees that look like one", () => {
  const names = async (scope: Record<string, unknown> = {}) =>
    ((await call("suggest_payee_merges", scope)).groups as Array<Array<any>>).map((group) =>
      group.map((each) => each.name),
    );

  it("groups payees whose words begin with another's, the most used first", async () => {
    for (const name of ["Spar", "Spar Dankt", "Spar 4824", "Interspar", "Billa", "SP Northwind"])
      await payee(name);
    await spend("Spar Dankt", today());
    await spend("Spar Dankt", today());
    expect(await names()).toEqual([["Spar Dankt", "Spar", "Spar 4824"]]);
  });

  it("lets a short word lead no group", async () => {
    await payee("BH");
    await payee("SP Northwind");
    expect(await names()).toEqual([]);
  });

  it("never suggests payees kept apart, and undo brings them back", async () => {
    const trafik = await payee("Trafik");
    const adam = await payee("Trafik Otto");
    await payee("Trafik 3213");
    expect(await call("keep_payees_apart", { payees: [trafik, adam] })).toEqual({ pairs: 1 });
    expect(await names()).toEqual([["Trafik", "Trafik 3213"]]);
    await call("undo");
    expect(await names()).toEqual([["Trafik", "Trafik 3213", "Trafik Otto"]]);
  });

  it("forgets what was kept apart when a payee goes", async () => {
    const [a, b] = [await payee("Hofer"), await payee("Hofer Wien")];
    await call("keep_payees_apart", { payees: [a, b] });
    await call("merge_payees", { target: a, merge: [b] });
    expect(await names()).toEqual([]);
    expect((await call("list_payees")).map((each: any) => each.name)).toEqual(["Hofer"]);
  });

  it("scoped to an account, keeps the groups with a payee on it, whole", async () => {
    const savings = (await call("create_account", { name: "Savings" })).id;
    for (const name of ["Billa", "Hofer", "Hofer Wien"]) await payee(name);
    await spend("Billa 1234", today());
    await call("create_transaction", {
      account: savings,
      date: today(),
      amount: -500,
      payee: "Hofer 77",
      category: food,
    });
    expect(await names({ account: checking })).toEqual([["Billa 1234", "Billa"]]);
    expect(await names({ account: savings })).toEqual([["Hofer 77", "Hofer", "Hofer Wien"]]);
    expect(await names({ onBudget: true })).toHaveLength(2);
    await expect(names({ account: "nope" })).rejects.toThrow(/not found|nope/i);
  });

  it("refuses to keep fewer than two payees apart", async () => {
    const only = await payee("Solo");
    await expect(call("keep_payees_apart", { payees: [only, only] })).rejects.toThrow(
      /two or more/,
    );
  });
});

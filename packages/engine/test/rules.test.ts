// Actual's transaction-rules.test.ts and formula-action-integration.test.ts, adapted to reeve's
// operations: rules run on register entries (create_transaction, run_rules, apply_rules).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
beforeEach(() => {
  s = scratch();
});
afterEach(() => s.dispose());

const setup = async () => {
  const book = (await s.call("create_book", { name: "Test" })).id as string;
  const groups = await s.call("list_categories", { book });
  const usual = groups[0];
  const food = usual.categories.find((c: any) => c.name === "Food").id as string;
  const bills = usual.categories.find((c: any) => c.name === "Bills").id as string;
  const checking = (await s.call("create_account", { book, name: "Checking" })).id as string;
  const call = (name: string, input: Record<string, unknown> = {}) =>
    s.call(name, { book, ...input });
  const fails = (name: string, input: Record<string, unknown> = {}) =>
    s.fails(name, { book, ...input });
  const payee = async (name: string) => (await call("create_payee", { name })).id as string;
  const rule = (input: Record<string, unknown>) => call("create_rule", input);
  const add = (input: Record<string, unknown>) =>
    call("create_transaction", { account: checking, date: "2020-08-11", amount: -50, ...input });
  const run = (input: Record<string, unknown>) =>
    call("run_rules", { account: checking, date: "2020-08-11", amount: 50, ...input });
  const categoryOf = (tx: any) =>
    tx.postings.length === 2 ? (tx.postings[1].accountId as string) : undefined;
  return {
    book,
    food,
    bills,
    groupId: usual.id as string,
    checking,
    call,
    fails,
    payee,
    rule,
    add,
    run,
    categoryOf,
  };
};

describe("rule operations", () => {
  it("validates rules", async () => {
    const { rule, food } = await setup();
    const bad = [
      { conditions: [{ op: "noop", field: "date", value: "2019-05" }], actions: [] },
      { conditions: [{ op: "gt", field: "date", value: "2019-05" }], actions: [] },
      { conditions: [{ op: "is", field: "amount", value: "hello" }], actions: [] },
      { conditions: [{ op: "isbetween", field: "amount", value: 3 }], actions: [] },
      { conditions: [{ op: "oneOf", field: "notes", value: ["a"] }], actions: [] },
      { conditions: [{ op: "is", field: "cleared", value: "true" }], actions: [] },
      {
        conditions: [],
        actions: [{ op: "set", field: "notes", value: "", template: "{{#if}}" }],
      },
      { conditions: [], actions: [{ op: "set", field: "account", value: "" }] },
    ];
    for (const input of bad)
      expect((await s.fails("create_rule", input))._tag).toBe("InvalidRequest");
    const ok = await rule({
      conditions: [{ op: "is", field: "date", value: "2019-05" }],
      actions: [
        { op: "set", field: "notes", value: "Sarah" },
        { op: "set", field: "category", value: food },
      ],
    });
    expect(ok.stage).toBe("default");
    expect(ok.conditionsOp).toBe("and");
  });

  it("inserts a rule that runs on new transactions", async () => {
    const { rule, add, call, food, categoryOf } = await setup();
    const {
      recategorized,
      categorized: _,
      ...created
    } = await rule({
      stage: "pre",
      conditions: [{ op: "is", field: "date", value: "2019-05" }],
      actions: [
        { op: "set", field: "notes", value: "Sarah" },
        { op: "set", field: "category", value: food },
      ],
    });
    expect(recategorized).toEqual([]);
    expect(await call("list_rules")).toEqual([created]);
    expect(await call("get_rule", { id: created.id })).toEqual(created);
    const tx = await add({ date: "2019-05-10", notes: "" });
    expect(tx.date).toBe("2019-05-10");
    expect(tx.notes).toBe("Sarah");
    expect(categoryOf(tx)).toBe(food);
    const other = await add({ date: "2019-06-10" });
    expect(other.notes).toBe(null);
  });

  it("updates a rule", async () => {
    const { rule, run, call, food, bills } = await setup();
    const { id } = await rule({
      stage: "pre",
      conditions: [{ op: "is", field: "imported_payee", value: "kroger" }],
      actions: [
        { op: "set", field: "notes", value: "Sarah" },
        { op: "set", field: "category", value: food },
      ],
    });
    let entry = await run({ importedPayee: "Kroger", notes: "" });
    expect(entry.importedPayee).toBe("Kroger");
    expect(entry.notes).toBe("Sarah");
    expect(entry.category).toBe(food);

    await call("update_rule", { id, actions: [{ op: "set", field: "category", value: bills }] });
    entry = await run({ importedPayee: "Kroger", notes: "" });
    expect(entry.notes).toBe("");
    expect(entry.category).toBe(bills);

    await call("update_rule", {
      id,
      conditions: [{ op: "is", field: "imported_payee", value: "ABC" }],
    });
    entry = await run({ importedPayee: "ABC", notes: "" });
    expect(entry.category).toBe(bills);
    expect((await run({ importedPayee: "Kroger" })).category).toBe(null);
    expect(await call("list_rules")).toHaveLength(1);
    expect((await s.fails("update_rule", { id: "nope" }))._tag).toBe("NotFound");
  });

  it("deletes rules", async () => {
    const { rule, run, call, payee, food } = await setup();
    const kroger = await payee("Kroger");
    const { id } = await rule({
      conditions: [{ op: "is", field: "payee", value: kroger }],
      actions: [{ op: "set", field: "category", value: food }],
    });
    expect((await run({ payee: "Kroger" })).category).toBe(food);
    expect(await call("delete_rules", { ids: [id] })).toEqual({ deleted: [id], kept: [] });
    expect(await call("list_rules")).toEqual([]);
    expect((await run({ payee: "Kroger" })).category).toBe(null);
  });

  it("matches payee rules after a pre rule's formula sets the payee name", async () => {
    const { rule, run, payee, food } = await setup();
    const amazon = await payee("Amazon");
    await rule({
      stage: "pre",
      conditions: [{ op: "is", field: "imported_payee", value: "AMZN MKTP" }],
      actions: [{ op: "set", field: "payee_name", value: null, formula: '="Amazon"' }],
    });
    await rule({
      conditions: [{ op: "is", field: "payee", value: amazon }],
      actions: [{ op: "set", field: "category", value: food }],
    });
    const entry = await run({ importedPayee: "AMZN MKTP" });
    expect(entry.payee).toBe("Amazon");
    expect(entry.category).toBe(food);
  });

  it("creates the payee a rule names when the transaction is written", async () => {
    const { rule, add, call } = await setup();
    await rule({
      conditions: [{ op: "contains", field: "payee_name", value: "lowes" }],
      actions: [{ op: "set", field: "payee_name", value: "Lowe's" }],
    });
    const tx = await add({ payee: "LOWES #123" });
    expect(tx.payee).toBe("Lowe's");
    expect((await call("list_payees")).map((p: any) => p.name)).toContain("Lowe's");
  });

  it("runs every rule in each stage, pre then default then post", async () => {
    const { rule, run, payee } = await setup();
    const ids = await Promise.all(
      ["kroger", "kroger1", "kroger2", "kroger3", "kroger4"].map(payee),
    );
    await rule({
      stage: "post",
      conditions: [{ op: "oneOf", field: "payee", value: ids }],
      actions: [{ op: "set", field: "notes", value: "got it2" }],
    });
    await rule({
      stage: "pre",
      conditions: [{ op: "is", field: "imported_payee", value: "123 kroger" }],
      actions: [{ op: "set", field: "payee", value: ids[3] }],
    });
    await rule({
      conditions: [{ op: "contains", field: "imported_payee", value: "kroger" }],
      actions: [{ op: "set", field: "payee", value: ids[4] }],
    });
    await rule({
      conditions: [{ op: "is", field: "payee", value: ids[4] }],
      actions: [{ op: "set", field: "notes", value: "got it" }],
    });
    expect(
      await run({ importedPayee: "123 kroger", date: "2020-08-11", amount: 50 }),
    ).toMatchObject({
      date: "2020-08-11",
      importedPayee: "123 kroger",
      payee: "kroger4",
      amount: 50,
      notes: "got it2",
    });
  });

  it("matches 'payee is nothing' and 'category is nothing'", async () => {
    const { rule, run } = await setup();
    await rule({
      conditions: [{ op: "is", field: "payee", value: null }],
      actions: [{ op: "set", field: "notes", value: "no payee" }],
    });
    expect((await run({ importedPayee: "kroger" })).notes).toBe("no payee");
    expect((await run({ payee: "Someone" })).notes).toBe(null);
    await rule({
      conditions: [{ op: "is", field: "category", value: null }],
      actions: [{ op: "append-notes", value: "; no category" }],
    });
    expect((await run({})).notes).toBe("no payee; no category");
  });

  it("matches the category group, also of a category set earlier in the chain", async () => {
    const { rule, run, payee, food, bills, groupId, call } = await setup();
    const other = await call("create_category_group", { name: "Fun" });
    const movies = (await call("create_category", { name: "Movies", groupId: other.id })).id;
    await rule({
      stage: "post",
      conditions: [{ op: "is", field: "category_group", value: groupId }],
      actions: [{ op: "set", field: "notes", value: "bills-matched" }],
    });
    expect((await run({ category: bills, notes: "" })).notes).toBe("bills-matched");
    expect((await run({ category: movies, notes: "" })).notes).toBe("");
    const power = await payee("Power Co");
    await rule({
      stage: "pre",
      conditions: [{ op: "is", field: "payee", value: power }],
      actions: [{ op: "set", field: "category", value: food }],
    });
    const entry = await run({ payee: "Power Co", notes: "" });
    expect(entry.category).toBe(food);
    expect(entry.notes).toBe("bills-matched");
  });

  it("orders rules by stage and specificity, and lists a payee's rules", async () => {
    const { rule, call, payee, food } = await setup();
    const kroger = await payee("kroger");
    const contains = await rule({
      conditions: [{ op: "contains", field: "notes", value: "sar" }],
      actions: [],
    });
    const exact = await rule({
      conditions: [{ op: "is", field: "payee", value: kroger }],
      actions: [{ op: "set", field: "category", value: food }],
    });
    const mixed = await rule({
      conditions: [
        { op: "is", field: "notes", value: "James" },
        { op: "gt", field: "amount", value: 5 },
      ],
      actions: [],
    });
    const post = await rule({ stage: "post", conditions: [], actions: [] });
    const pre = await rule({
      stage: "pre",
      conditions: [{ op: "is", field: "notes", value: "x" }],
      actions: [{ op: "set", field: "payee", value: kroger }],
    });
    expect((await call("list_rules")).map((r: any) => r.id)).toEqual([
      pre.id,
      contains.id,
      mixed.id,
      exact.id,
      post.id,
    ]);
    expect((await call("list_rules", { payee: kroger })).map((r: any) => r.id)).toEqual([
      pre.id,
      exact.id,
    ]);
  });
});

describe("conditions", () => {
  it("matches amounts, inflow and outflow, budget and recurring dates", async () => {
    const { rule, run, call } = await setup();
    const savings = (await call("create_account", { name: "Brokerage", onBudget: false })).id;
    await rule({
      conditions: [{ op: "gt", field: "amount_outflow", value: 1000 }],
      actions: [{ op: "append-notes", value: "big-out" }],
    });
    await rule({
      conditions: [{ op: "isbetween", field: "amount_inflow", value: { num1: 100, num2: 200 } }],
      actions: [{ op: "append-notes", value: "small-in" }],
    });
    await rule({
      conditions: [{ op: "isapprox", field: "amount", value: -2000 }],
      actions: [{ op: "append-notes", value: "~20" }],
    });
    await rule({
      conditions: [{ op: "offBudget", field: "account", value: null }],
      actions: [{ op: "append-notes", value: "off" }],
    });
    await rule({
      conditions: [
        {
          op: "is",
          field: "date",
          value: { start: "2020-01-15", frequency: "monthly", interval: 1 },
        },
      ],
      actions: [{ op: "append-notes", value: "monthly" }],
    });
    expect((await run({ amount: -2100 })).notes).toBe("big-out~20");
    expect((await run({ amount: 2100 })).notes).toBe(null);
    expect((await run({ amount: 150 })).notes).toBe("small-in");
    expect((await run({ amount: 150, account: savings })).notes).toBe("offsmall-in");
    expect((await run({ amount: 1, date: "2020-03-15" })).notes).toBe("monthly");
  });

  it("matches text: matches, oneOf, hasTags", async () => {
    const { rule, run } = await setup();
    await rule({
      conditions: [{ op: "matches", field: "imported_payee", value: "^amzn\\s+\\d+$" }],
      actions: [{ op: "set", field: "payee_name", value: "Amazon" }],
    });
    await rule({
      conditions: [{ op: "hasTags", field: "notes", value: "#trip" }],
      actions: [{ op: "prepend-notes", value: "[travel] " }],
    });
    await rule({
      conditions: [{ op: "oneOf", field: "payee_name", value: ["Amazon", "Ebay"] }],
      actions: [{ op: "set", field: "cleared", value: true }],
    });
    const entry = await run({ importedPayee: "AMZN 123", notes: "souvenir #trip" });
    expect(entry).toMatchObject({
      payee: "Amazon",
      notes: "[travel] souvenir #trip",
      cleared: true,
    });
    expect((await run({ notes: "#tripping" })).notes).toBe("#tripping");
  });
});

describe("actions", () => {
  it("splits with fixed amounts, percents and the remainder", async () => {
    const { rule, add, food, bills } = await setup();
    await rule({
      conditions: [{ op: "is", field: "notes", value: "split me" }],
      actions: [
        { op: "set-split-amount", splitIndex: 1, method: "fixed-amount", value: -1000 },
        { op: "set", field: "category", value: food, splitIndex: 1 },
        { op: "set-split-amount", splitIndex: 2, method: "fixed-percent", value: 50 },
        { op: "set", field: "category", value: bills, splitIndex: 2 },
        { op: "set", field: "notes", value: "rest", splitIndex: 3 },
        { op: "set-split-amount", splitIndex: 3, method: "remainder" },
      ],
    });
    const tx = await add({ amount: -5000, notes: "split me" });
    expect(tx.postings.map((p: any) => p.amount)).toEqual([-5000, 1000, 2000, 2000]);
    expect(tx.postings[1].accountId).toBe(food);
    expect(tx.postings[2].accountId).toBe(bills);
    expect(tx.postings[3].memo).toBe("rest");
  });

  it("keeps a split that does not add up balanced with an uncategorized line", async () => {
    const { rule, run, food } = await setup();
    await rule({
      conditions: [{ op: "is", field: "notes", value: "split me" }],
      actions: [
        { op: "set-split-amount", splitIndex: 1, method: "fixed-amount", value: -1000 },
        { op: "set", field: "category", value: food, splitIndex: 1 },
      ],
    });
    const entry = await run({ amount: -3000, notes: "split me" });
    expect(entry.splits).toEqual([
      { category: food, amount: -1000, memo: null },
      { category: null, amount: -2000 },
    ]);
  });

  it("links schedules, deletes transactions, and templates", async () => {
    const { rule, run, fails, checking } = await setup();
    await rule({
      conditions: [{ op: "is", field: "imported_payee", value: "gym" }],
      actions: [{ op: "link-schedule", value: "schedule-1" }],
    });
    await rule({
      conditionsOp: "or",
      conditions: [
        { op: "is", field: "imported_payee", value: "spam" },
        { op: "is", field: "notes", value: "spam" },
      ],
      actions: [{ op: "delete-transaction" }],
    });
    await rule({
      conditions: [{ op: "contains", field: "imported_payee", value: "#" }],
      actions: [
        {
          op: "set",
          field: "notes",
          value: "",
          template: '{{regex imported_payee "/#(\\d+)/" "no. $1"}} on {{format date \'MMM d\'}}',
        },
        { op: "set", field: "date", value: "", template: "{{addDays date 3}}" },
      ],
    });
    expect((await run({ importedPayee: "gym" })).scheduleId).toBe("schedule-1");
    expect(await run({ importedPayee: "spam" })).toBe(null);
    const refused = await fails("create_transaction", {
      account: checking,
      date: "2020-01-01",
      amount: 1,
      notes: "spam",
    });
    expect(refused._tag).toBe("InvalidRequest");
    const templated = await run({ importedPayee: "shop #42", date: "2020-02-27" });
    expect(templated.notes).toBe("shop no. 42 on Feb 27");
    expect(templated.date).toBe("2020-03-01");
  });

  it("sees the running balance in templates and formulas", async () => {
    const { rule, run, call, checking } = await setup();
    await call("create_transaction", { account: checking, date: "2020-01-01", amount: 1000 });
    await call("create_transaction", { account: checking, date: "2020-01-02", amount: 2500 });
    await call("create_transaction", { account: checking, date: "2020-01-05", amount: 9999 });
    await rule({
      conditions: [{ op: "contains", field: "imported_payee", value: "kroger" }],
      actions: [{ op: "set", field: "notes", value: "", template: "Balance: {{balance}}" }],
    });
    await rule({
      conditions: [{ op: "contains", field: "imported_payee", value: "aldi" }],
      actions: [
        {
          op: "set",
          field: "notes",
          value: null,
          formula: '=FORMATCURRENCY(BALANCE_OF("Checking"))',
        },
      ],
    });
    expect((await run({ importedPayee: "kroger", date: "2020-01-03" })).notes).toBe(
      "Balance: 3500",
    );
    expect((await run({ importedPayee: "aldi", date: "2020-01-03" })).notes).toBe("$35.00");
  });
});

describe("formulas", () => {
  const cases: Array<[string, string, Record<string, unknown>, string]> = [
    [
      '=CONCATENATE("Interest: ", FORMATCURRENCY(amount * 0.05))',
      "notes",
      { amount: 100000 },
      "Interest: $50.00",
    ],
    [
      '=IF(amount > 0, "Income", IF(ABS(amount) > 100, "Large Expense", IF(ABS(amount) > 50, "Medium Expense", "Small Expense")))',
      "notes",
      { amount: -5000 },
      "Small Expense",
    ],
    ["=RIGHT(imported_payee, 4)", "notes", { importedPayee: "Card ending 1234" }, "1234"],
    [
      "=PROPER(TRIM(imported_payee))",
      "notes",
      { importedPayee: "  joe's   diner " },
      "Joe'S Diner",
    ],
    ["=ROUND(amount * 0.333, 2)", "amount", { amount: -10000 }, "-3330"],
    ["=CEILING(ABS(amount), 5)", "notes", { amount: -1234 }, "15"],
    [
      '=YEAR(date) & "-" & MONTH(date) & "-" & DAY(date)',
      "notes",
      { date: "2024-03-15" },
      "2024-3-15",
    ],
    ['=TEXT(EOMONTH(date, 0), "YYYY-MM-DD")', "date", { date: "2024-02-10" }, "2024-02-29"],
    [
      '=SWITCH(imported_payee, "A", "one", "B", "two", "other")',
      "notes",
      { importedPayee: "B" },
      "two",
    ],
    ['=IFERROR(1/0, "safe")', "notes", {}, "safe"],
    ['=CHOOSE(2, "a", "b", "c")', "notes", {}, "b"],
    ["=FORMATNUMBER(1234567.891, 1)", "notes", {}, "1,234,567.9"],
  ];
  it.each(cases)("%s", async (formula, field, entry, expected) => {
    const { rule, run } = await setup();
    await rule({
      conditions: [{ op: "gte", field: "date", value: "2000-01-01" }],
      actions: [{ op: "set", field, value: null, formula }],
    });
    const result = await run({ date: "2024-01-01", ...entry });
    expect(String(result[field])).toBe(expected);
  });
});

describe("existing transactions", () => {
  const seed = async () => {
    const env = await setup();
    const { call, checking, food, payee } = env;
    const kroger = await payee("kroger");
    const lowes = await payee("lowes");
    const make = (input: Record<string, unknown>) =>
      call("create_transaction", { account: checking, ...input });
    const t1 = await make({
      date: "2020-10-01",
      payee: "kroger",
      category: food,
      notes: "barr",
      amount: 353,
    });
    const t2 = await make({ date: "2020-10-15", payee: "kroger", notes: "fooo", amount: 453 });
    const t3 = await make({ date: "2020-10-15", payee: "lowes", notes: "FooO #tag", amount: -322 });
    const t4 = await make({ date: "2020-10-16", payee: "lowes", amount: 101 });
    const t5 = await make({
      date: "2020-10-16",
      payee: "lowes",
      category: food,
      notes: "",
      amount: 124,
    });
    const ids = { "1": t1.id, "2": t2.id, "3": t3.id, "4": t4.id, "5": t5.id };
    const names = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
    const matching = async (conditions: Array<unknown>) => {
      const page = await call("preview_rule", { conditions });
      return page.rows
        .map((row: any) => names[row.transactionId] as string)
        .sort((a: string, b: string) => a.localeCompare(b));
    };
    return { ...env, ids, kroger, lowes, matching };
  };

  it("previews what conditions match", async () => {
    const { matching, lowes, food } = await seed();
    expect(await matching([{ field: "date", op: "is", value: "2020-10-15" }])).toEqual(["2", "3"]);
    expect(await matching([{ field: "payee", op: "is", value: lowes }])).toEqual(["3", "4", "5"]);
    expect(await matching([{ field: "amount", op: "is", value: 353 }])).toEqual(["1"]);
    expect(await matching([{ field: "notes", op: "is", value: "FooO" }])).toEqual(["2"]);
    expect(await matching([{ field: "notes", op: "contains", value: "oo" }])).toEqual(["2", "3"]);
    expect(await matching([{ field: "notes", op: "is", value: "" }])).toEqual(["4", "5"]);
    expect(await matching([{ field: "amount", op: "gt", value: 300 }])).toEqual(["1", "2"]);
    expect(
      await matching([
        { field: "amount", op: "gt", value: 400 },
        { field: "amount", op: "lt", value: 500 },
      ]),
    ).toEqual(["2"]);
    expect(
      await matching([
        { field: "amount_inflow", op: "gt", value: 300 },
        { field: "amount_inflow", op: "lt", value: 400 },
      ]),
    ).toEqual(["1"]);
    expect(await matching([{ field: "amount_inflow", op: "gt", value: -1000 }])).toEqual([
      "1",
      "2",
      "4",
      "5",
    ]);
    expect(await matching([{ field: "amount_outflow", op: "gt", value: 300 }])).toEqual(["3"]);
    expect(await matching([{ field: "date", op: "gt", value: "2020-10-10" }])).toEqual([
      "2",
      "3",
      "4",
      "5",
    ]);
    expect(await matching([{ field: "category", op: "is", value: null }])).toEqual(["2", "3", "4"]);
    expect(await matching([{ field: "category", op: "isNot", value: null }])).toEqual(["1", "5"]);
    expect(await matching([{ field: "category", op: "is", value: food }])).toEqual(["1", "5"]);
    expect(await matching([{ field: "payee", op: "contains", value: "LOW" }])).toEqual([
      "3",
      "4",
      "5",
    ]);
    expect(await matching([{ field: "notes", op: "hasTags", value: "#tag" }])).toEqual(["3"]);
    expect(await matching([{ field: "payee", op: "oneOf", value: [] }])).toEqual([]);
  });

  it("previews a rule's matches by its id, with the register rows", async () => {
    const { rule, call, kroger } = await seed();
    const { id } = await rule({
      conditions: [{ field: "payee", op: "is", value: kroger }],
      actions: [{ op: "set", field: "notes", value: "K" }],
    });
    const page = await call("preview_rule", { rule: id, limit: 1 });
    expect(page.total).toBe(2);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].payee).toBe("kroger");
  });

  it("applies a rule's actions to what it matches, or to transactions by id", async () => {
    const { rule, call, kroger, ids, bills, categoryOf } = await seed();
    const { id } = await rule({
      conditions: [{ field: "payee", op: "is", value: kroger }],
      actions: [
        { op: "set", field: "notes", value: "K" },
        { op: "set", field: "category", value: bills },
      ],
    });
    const result = await call("apply_rules", { rule: id });
    const byId = (a: string, b: string) => a.localeCompare(b);
    expect(result.updated.map((tx: any) => tx.id).sort(byId)).toEqual(
      [ids["1"], ids["2"]].sort(byId),
    );
    for (const tx of result.updated) {
      expect(tx.notes).toBe("K");
      expect(categoryOf(tx)).toBe(bills);
    }
    const byIds = await call("apply_rules", { rule: id, ids: [ids["4"]] });
    expect(byIds.updated[0].notes).toBe("K");
    const adHoc = await call("apply_rules", {
      ids: [ids["5"]],
      actions: [{ op: "delete-transaction" }],
    });
    expect(adHoc).toEqual({ updated: [], deleted: [ids["5"]] });
  });

  it("runs every rule on existing transactions, by ids or conditions", async () => {
    const { rule, call, lowes, ids } = await seed();
    await rule({
      conditions: [{ field: "payee", op: "is", value: lowes }],
      actions: [{ op: "append-notes", value: "!" }],
    });
    const result = await call("apply_rules", { ids: [ids["1"], ids["3"]] });
    expect(result.updated.map((tx: any) => [tx.id, tx.notes])).toEqual([[ids["3"], "FooO #tag!"]]);
    const filtered = await call("apply_rules", {
      conditions: [{ field: "amount", op: "gt", value: 100 }],
    });
    expect(filtered.updated.map((tx: any) => tx.notes)).toEqual(["!", "!"]);
    expect((await s.fails("apply_rules", {}))._tag).toBe("InvalidRequest");
  });

  it("undoes applying rules in one step", async () => {
    const { rule, call, lowes, ids } = await seed();
    await rule({
      conditions: [{ field: "payee", op: "is", value: lowes }],
      actions: [{ op: "set", field: "notes", value: "changed" }],
    });
    await call("apply_rules", { conditions: [{ field: "payee", op: "is", value: lowes }] });
    await call("undo");
    expect((await call("get_transaction", { id: ids["3"] })).notes).toBe("FooO #tag");
  });
});

describe("payee renaming", () => {
  it("adds imported names to the pre rule that renames to the payee", async () => {
    const { call, payee, run } = await setup();
    const amazon = await payee("Amazon");
    const first = await call("create_payee_rename_rule", { fromNames: ["AMZN 1"], to: amazon });
    expect(first.stage).toBe("pre");
    const second = await call("create_payee_rename_rule", {
      fromNames: ["AMZN 2", "", "AMZN 1"],
      to: amazon,
    });
    expect(second.id).toBe(first.id);
    expect(second.conditions[0].value).toEqual(["amzn 1", "amzn 2"].map((n) => n.toUpperCase()));
    expect((await run({ importedPayee: "amzn 2" })).payee).toBe("Amazon");
  });
});

describe("learning categories", () => {
  const learn = async () => {
    const env = await setup();
    const { call, checking, food, bills } = env;
    const groups = await call("list_categories");
    const beer = groups[0].categories.find((c: any) => c.id !== food && c.id !== bills).id;
    const enter = async (payee: string | null, category: string, date = "2016-12-01") => {
      const tx = await call("create_transaction", { account: checking, date, amount: -100, payee });
      return call("update_transaction", { id: tx.id, account: checking, category });
    };
    const categoryRules = async () =>
      (await call("list_rules")).filter((r: any) => r.actions[0]?.field === "category");
    // A rule written by hand turns learning off for its payee (docs/rules/rules-and-payees.md); switching it back on
    // hands the rule to the learner, which these tests are about.
    const relearn = (...ids: ReadonlyArray<string>) =>
      Promise.all(ids.map((id) => call("update_payee", { id, learnCategories: true })));
    return { ...env, beer, enter, categoryRules, relearn };
  };

  const expectCategoryRule = (rule: any, category: string, payee: string) => {
    expect(rule.conditions).toEqual([{ op: "is", field: "payee", value: payee }]);
    expect(rule.actions).toEqual([{ op: "set", field: "category", value: category }]);
  };

  it("creates a rule once a payee gets the same category three times", async () => {
    const { enter, categoryRules, food, call } = await learn();
    await enter("foo", food);
    await enter("foo", food);
    expect(await categoryRules()).toEqual([]);
    const tx = await enter("foo", food);
    const [rule] = await categoryRules();
    expectCategoryRule(rule, food, tx.payeeId);
    // A new transaction for the payee now gets the category by itself.
    const next = await call("create_transaction", {
      account: (await call("list_accounts"))[0].id,
      date: "2016-12-02",
      amount: -1,
      payee: "foo",
    });
    expect(next.postings[1].accountId).toBe(food);
  });

  it("leaves an existing rule alone when the category is ambiguous", async () => {
    const { enter, categoryRules, food, beer, bills, rule, payee } = await learn();
    const foo = await payee("foo");
    await enter("foo", food);
    await enter("foo", beer);
    await enter("foo", beer);
    expect(await categoryRules()).toEqual([]);
    await rule({
      conditions: [{ op: "is", field: "payee", value: foo }],
      actions: [{ op: "set", field: "category", value: bills }],
    });
    await enter("foo", food);
    const rules = await categoryRules();
    expect(rules).toHaveLength(1);
    expectCategoryRule(rules[0], bills, foo);
  });

  it("updates an existing rule", async () => {
    const { enter, categoryRules, food, beer, rule, payee, relearn } = await learn();
    const foo = await payee("foo");
    await rule({
      conditions: [{ op: "is", field: "payee", value: foo }],
      actions: [{ op: "set", field: "category", value: beer }],
    });
    await relearn(foo);
    await enter("foo", food);
    await enter("foo", food);
    expectCategoryRule((await categoryRules())[0], beer, foo);
    await enter("foo", food);
    const rules = await categoryRules();
    expect(rules).toHaveLength(1);
    expectCategoryRule(rules[0], food, foo);
  });

  it("works with multiple payees", async () => {
    const { enter, categoryRules, food, bills, rule, payee } = await learn();
    const foo = await payee("foo");
    const bar = await payee("bar");
    await rule({
      conditions: [{ op: "is", field: "payee", value: foo }],
      actions: [{ op: "set", field: "category", value: food }],
    });
    for (let i = 0; i < 3; i++) await enter("bar", bills, "2016-12-03");
    const rules = await categoryRules();
    expect(rules).toHaveLength(2);
    expectCategoryRule(
      rules.find((r: any) => r.conditions[0].value === foo),
      food,
      foo,
    );
    expectCategoryRule(
      rules.find((r: any) => r.conditions[0].value === bar),
      bills,
      bar,
    );
  });

  it("does not create a rule when a 'one of' rule already sets the category", async () => {
    const { enter, categoryRules, food, rule, payee } = await learn();
    const foo = await payee("foo");
    const bar = await payee("bar");
    await rule({
      conditions: [{ op: "oneOf", field: "payee", value: [foo, bar] }],
      actions: [{ op: "set", field: "category", value: food }],
    });
    for (let i = 0; i < 3; i++) await enter("foo", food);
    const rules = await categoryRules();
    expect(rules).toHaveLength(1);
    expect(rules[0].conditions[0].op).toBe("oneOf");
  });

  it("creates a rule when a 'one of' rule sets another category", async () => {
    const { enter, categoryRules, food, beer, rule, payee, relearn } = await learn();
    const foo = await payee("foo");
    const bar = await payee("bar");
    await rule({
      conditions: [{ op: "oneOf", field: "payee", value: [foo, bar] }],
      actions: [{ op: "set", field: "category", value: beer }],
    });
    await relearn(foo, bar);
    for (let i = 0; i < 3; i++) await enter("foo", food);
    const rules = await categoryRules();
    expect(rules).toHaveLength(2);
    expectCategoryRule(
      rules.find((r: any) => r.conditions[0].op === "is"),
      food,
      foo,
    );
  });

  it("updates every rule that sets the payee's category", async () => {
    const { enter, categoryRules, food, beer, bills, rule, payee, relearn } = await learn();
    const foo = await payee("foo");
    await rule({
      conditions: [{ op: "is", field: "payee", value: foo }],
      actions: [{ op: "set", field: "category", value: bills }],
    });
    await rule({
      conditions: [{ op: "is", field: "payee", value: foo }],
      actions: [{ op: "set", field: "category", value: food }],
    });
    await rule({
      conditions: [{ op: "is", field: "payee", value: null }],
      actions: [{ op: "set", field: "category", value: beer }],
    });
    await relearn(foo);
    for (let i = 0; i < 3; i++) await enter("foo", beer, "2016-12-02");
    const values = (await categoryRules()).map((r: any) => [
      r.conditions[0].value,
      r.actions[0].value,
    ]);
    expect(values).toHaveLength(3);
    expect(values).toEqual(
      expect.arrayContaining([
        [foo, beer],
        [null, beer],
      ]),
    );
    expect(values.filter(([payee]: [string | null]) => payee === foo)).toHaveLength(2);
  });

  it("never learns for no payee, or a payee that does not learn", async () => {
    const { enter, categoryRules, food, call, payee } = await learn();
    for (let i = 0; i < 3; i++) await enter(null, food);
    expect(await categoryRules()).toEqual([]);
    const market = await payee("supermarket");
    await call("update_payee", { id: market, learnCategories: false });
    for (let i = 0; i < 3; i++) await enter("supermarket", food);
    expect(await categoryRules()).toEqual([]);
  });

  it("adding transactions without a payee never changes rules", async () => {
    const { enter, categoryRules, food, beer, rule, payee } = await learn();
    const foo = await payee("foo");
    const bar = await payee("bar");
    await rule({
      conditions: [{ op: "is", field: "payee", value: foo }],
      actions: [{ op: "set", field: "category", value: beer }],
    });
    await rule({
      conditions: [{ op: "oneOf", field: "payee", value: [foo, bar] }],
      actions: [{ op: "set", field: "category", value: beer }],
    });
    for (let i = 0; i < 3; i++) await enter(null, food);
    const rules = await categoryRules();
    expect(rules.map((r: any) => r.actions[0].value)).toEqual([beer, beer]);
  });
});

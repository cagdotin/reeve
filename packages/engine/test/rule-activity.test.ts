import { addMonths, monthOf, today } from "@reeve/contract/rules";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scratch, writeOlderRule } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
let book: string;
let checking: string;
let savings: string;
let food: string;
let bills: string;
beforeEach(async () => {
  s = scratch();
  book = (await s.call("create_book", { name: "Test" })).id;
  checking = (await s.call("create_account", { book, name: "Checking" })).id;
  savings = (await s.call("create_account", { book, name: "Savings" })).id;
  const groups = await s.call("list_categories", { book });
  const named = (name: string) => groups[0].categories.find((c: any) => c.name === name).id;
  food = named("Food");
  bills = named("Bills");
});
afterEach(() => s.dispose());

const call = (name: string, input: Record<string, unknown> = {}) =>
  s.call(name, { book, ...input });

const payee = async (name: string) => (await call("create_payee", { name })).id as string;

const spend = (name: string | null, date: string, category: string | null = food, amount = -1000) =>
  call("create_transaction", {
    account: checking,
    date,
    amount,
    payee: name,
    ...(category === null ? {} : { category }),
  });

const rule = (
  conditions: ReadonlyArray<Record<string, unknown>>,
  actions: ReadonlyArray<Record<string, unknown>> = [{ op: "set", field: "notes", value: "seen" }],
  more: Record<string, unknown> = {},
) => call("create_rule", { conditions, actions, recategorize: false, ...more });

const setter = (id: string, category = food, more: Record<string, unknown> = {}) =>
  rule(
    [{ field: "payee", op: "is", value: id }],
    [{ op: "set", field: "category", value: category }],
    more,
  );

const activity = (since?: string) =>
  call("rule_activity", since === undefined ? {} : { since }) as Promise<any>;

const row = async (id: string, since?: string) =>
  (await activity(since)).rules.find((each: any) => each.id === id);

const thisMonth = monthOf(today());
const dayIn = (monthsAgo: number, date = "15") => `${addMonths(thisMonth, -monthsAgo)}-${date}`;

describe("rule_activity matches", () => {
  it("counts what conditions match in the range, by month, with the last match", async () => {
    const id = await payee("Grocer");
    const { id: ruleId } = await setter(id);
    await spend("Grocer", dayIn(1));
    await spend("Grocer", dayIn(1, "16"));
    await spend("Grocer", dayIn(5));
    await spend("Other", dayIn(1));

    const all = await row(ruleId);
    expect(all.matches).toBe(3);
    expect(all.totalMatches).toBe(3);
    expect(all.lastMatch).toBe(dayIn(1, "16"));
    expect(all.months).toHaveLength(12);
    expect(all.months[10]).toBe(2);
    expect(all.months[6]).toBe(1);

    const recent = await row(ruleId, dayIn(2));
    expect(recent.matches).toBe(2);
    expect(recent.totalMatches).toBe(3);
  });

  it("previews every row it counts, even when a transfer has another side", async () => {
    const { id } = await rule([{ field: "account", op: "is", value: savings }]);
    await call("create_transaction", {
      account: checking,
      date: dayIn(1),
      amount: -500,
      transferAccount: savings,
    });
    const preview: any = await call("preview_rule", { rule: id, limit: 1 });
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0].accountId).toBe(savings);
  });

  it("counts a transfer once when a rule matches both of its sides", async () => {
    const { id } = await rule([{ field: "transfer", op: "is", value: true }]);
    await call("create_transaction", {
      account: checking,
      date: dayIn(1),
      amount: -500,
      transferAccount: savings,
    });
    expect((await row(id)).totalMatches).toBe(1);
  });

  it("counts a split once, and matches conditions together on one line", async () => {
    const both = await rule(
      [
        { field: "category", op: "is", value: food },
        { field: "amount", op: "is", value: -300 },
      ],
      undefined,
    );
    const never = await rule([
      { field: "category", op: "is", value: bills },
      { field: "amount", op: "is", value: -300 },
    ]);
    await call("create_transaction", {
      account: checking,
      date: dayIn(1),
      amount: -1000,
      payee: "Shop",
      splits: [
        { category: food, amount: -300 },
        { category: bills, amount: -700 },
      ],
    });
    expect((await row(both.id)).totalMatches).toBe(1);
    expect((await row(never.id)).totalMatches).toBe(0);
  });

  // The index is only an optimization: every kind of condition must count what preview_rule does.
  it("agrees with preview_rule for every kind of condition", async () => {
    const grocer = await payee("Grocer");
    const landlord = await payee("Landlord");
    await spend("Grocer", dayIn(1));
    await spend("GROCER two", dayIn(2));
    await spend("Landlord", dayIn(3), bills, -90_000);
    await spend(null, dayIn(4), null);
    await call("create_transaction", {
      account: savings,
      date: dayIn(1),
      amount: 2000,
      payee: "Landlord",
      notes: "refund #tax",
      category: bills,
    });
    await call("create_transaction", {
      account: checking,
      date: dayIn(1),
      amount: -500,
      transferAccount: savings,
    });
    const shapes: ReadonlyArray<{ conditions: Array<any>; conditionsOp?: string }> = [
      { conditions: [{ field: "payee", op: "is", value: grocer }] },
      { conditions: [{ field: "payee", op: "is", value: null }] },
      { conditions: [{ field: "payee", op: "isNot", value: grocer }] },
      { conditions: [{ field: "payee", op: "oneOf", value: [grocer, landlord] }] },
      { conditions: [{ field: "payee", op: "notOneOf", value: [grocer] }] },
      { conditions: [{ field: "payee", op: "contains", value: "grocer" }] },
      { conditions: [{ field: "payee", op: "matches", value: "^land" }] },
      { conditions: [{ field: "account", op: "is", value: savings }] },
      { conditions: [{ field: "account", op: "offBudget", value: null }] },
      { conditions: [{ field: "category", op: "is", value: food }] },
      { conditions: [{ field: "category", op: "is", value: null }] },
      { conditions: [{ field: "category", op: "isNot", value: null }] },
      { conditions: [{ field: "amount", op: "lt", value: -5000 }] },
      { conditions: [{ field: "amount_inflow", op: "gt", value: 1000 }] },
      { conditions: [{ field: "notes", op: "hasTags", value: "#tax" }] },
      { conditions: [{ field: "date", op: "is", value: addMonths(thisMonth, -1) }] },
      {
        conditions: [
          { field: "payee", op: "is", value: landlord },
          { field: "account", op: "is", value: savings },
        ],
      },
      {
        conditionsOp: "or",
        conditions: [
          { field: "payee", op: "is", value: grocer },
          { field: "payee", op: "is", value: landlord },
        ],
      },
      {
        conditionsOp: "or",
        conditions: [
          { field: "payee", op: "is", value: grocer },
          { field: "amount", op: "gt", value: 0 },
        ],
      },
      { conditions: [] },
    ];
    for (const shape of shapes) {
      const { id } = await rule(shape.conditions, undefined, {
        conditionsOp: shape.conditionsOp ?? "and",
      });
      const preview: any = await call("preview_rule", { rule: id });
      const expected = new Set(preview.rows.map((each: any) => each.transactionId));
      expect({ shape, count: (await row(id)).totalMatches }).toEqual({
        shape,
        count: expected.size,
      });
    }
  });
});

describe("rule_activity totals", () => {
  it("covers transactions that can carry a category, and counts as the register does", async () => {
    const id = await payee("Grocer");
    await setter(id);
    await spend("Grocer", dayIn(1));
    await spend("Other", dayIn(1));
    await spend("Unknown", dayIn(1), null);
    await call("create_transaction", {
      account: checking,
      date: dayIn(1),
      amount: -500,
      transferAccount: savings,
    });
    const { summary } = await activity();
    expect(summary.transactions).toBe(3);
    expect(summary.covered).toBe(1);
    expect(summary.uncategorized).toBe(1);
    expect(summary.active).toBe(1);
    expect(summary.previous).toBeNull();
    const register: any = await call("list_transactions", { uncategorized: true });
    expect(register.total).toBe(1);
  });

  it("counts as many days before the range as the range has, both ends included", async () => {
    const id = await payee("Grocer");
    await setter(id);
    const daysAgo = (days: number) =>
      new Date(Date.parse(today()) - days * 86_400_000).toISOString().slice(0, 10);
    await spend("Grocer", daysAgo(11));
    await spend("Grocer", daysAgo(21));
    await spend("Grocer", daysAgo(22));
    const { summary } = await activity(daysAgo(10));
    expect(summary.previous.transactions).toBe(2);
  });

  it("compares a range with as many days before it", async () => {
    const id = await payee("Grocer");
    await setter(id);
    await spend("Grocer", dayIn(0, "01"));
    await spend("Grocer", dayIn(3));
    const days = 60;
    const since = new Date(Date.parse(today()) - days * 86_400_000).toISOString().slice(0, 10);
    const { summary } = await activity(since);
    expect(summary.previous.transactions + summary.transactions).toBeGreaterThan(0);
    expect(summary.previous.active + summary.active).toBeGreaterThan(0);
  });
});

describe("rule_activity problems", () => {
  it("finds rules with the same conditions that set different categories", async () => {
    const id = await payee("Noodle");
    const one = await setter(id, food);
    const two = await setter(id, bills);
    const other = await setter(await payee("Else"), bills);
    expect((await row(one.id)).problems.conflict).toBe(true);
    expect((await row(two.id)).problems.conflict).toBe(true);
    expect((await row(other.id)).problems.conflict).toBe(false);
  });

  it("calls rules duplicates when stage, conditions and actions all agree", async () => {
    const id = await payee("Netflix");
    const one = await setter(id);
    const two = await setter(id);
    const later = await setter(id, food, { stage: "post" });
    expect((await row(one.id)).problems.duplicate).toBe(true);
    expect((await row(two.id)).problems.duplicate).toBe(true);
    expect((await row(later.id)).problems.duplicate).toBe(false);
    expect((await row(one.id)).problems.conflict).toBe(false);
  });

  it("sees duplicates whatever the order and case of their conditions", async () => {
    const a = await rule([
      { field: "imported_payee", op: "contains", value: "SHOP" },
      { field: "amount", op: "lt", value: 0 },
    ]);
    const b = await rule([
      { field: "amount", op: "lt", value: 0 },
      { field: "imported_payee", op: "contains", value: "shop" },
    ]);
    expect((await row(a.id)).problems.duplicate).toBe(true);
    expect((await row(b.id)).problems.duplicate).toBe(true);
  });

  it("calls a learned rule and the same rule by hand duplicates", async () => {
    const id = await payee("Cafe");
    for (const date of ["10", "11", "12"]) await spend("Cafe", dayIn(1, date));
    const byHand = await rule(
      [{ value: id, field: "payee", op: "is" }],
      [{ value: food, field: "category", op: "set" }],
    );
    expect((await row(byHand.id)).problems.duplicate).toBe(true);
    const { rules } = await activity();
    expect(rules.filter((each: any) => each.problems.duplicate)).toHaveLength(2);
  });

  it("does not call a plain rule and a schedule's rule for one payee duplicates", async () => {
    const id = await payee("Landlord");
    const plain = await setter(id);
    await call("create_schedule", {
      payee: "Landlord",
      account: checking,
      amount: -90_000,
      amountOp: "is",
      date: dayIn(-1),
      category: food,
    });
    expect((await row(plain.id)).problems.duplicate).toBe(false);
  });

  it("calls a rule quiet after twelve months without a match", async () => {
    await spend("Other", dayIn(1));
    const id = await payee("Old");
    const stale = await setter(id);
    await spend("Old", dayIn(14));
    const current = await setter(await payee("New"));
    await spend("New", dayIn(1));
    expect((await row(stale.id)).problems.quiet).toBe(true);
    expect((await row(current.id)).problems.quiet).toBe(false);
  });

  it("does not call a rule quiet when it clears away what it matched", async () => {
    await spend("Other", dayIn(1));
    const renames = await rule(
      [{ field: "payee", op: "is", value: await payee("Old name") }],
      [{ op: "set", field: "payee", value: await payee("New name") }],
    );
    const fills = await rule(
      [{ field: "category", op: "is", value: null }],
      [{ op: "set", field: "category", value: food }],
    );
    const deletes = await rule(
      [{ field: "payee", op: "is", value: await payee("Spam") }],
      [{ op: "delete-transaction" }],
    );
    for (const { id } of [renames, fills, deletes])
      expect((await row(id)).problems.quiet).toBe(false);
  });

  it("calls nothing quiet in a book with no transactions", async () => {
    const { id } = await setter(await payee("Grocer"));
    expect((await row(id)).problems.quiet).toBe(false);
  });

  it("does not call a schedule's rule quiet, and says which schedule owns it", async () => {
    await spend("Other", dayIn(1));
    const schedule: any = await call("create_schedule", {
      name: "Rent",
      payee: "Landlord",
      account: checking,
      amount: -90_000,
      amountOp: "is",
      date: dayIn(-1),
    });
    const { rules } = await activity();
    const owned = rules.find((each: any) => each.schedule?.id === schedule.id);
    expect(owned.schedule.name).toBe("Rent");
    expect(owned.schedule.completed).toBe(false);
    expect(owned.problems.quiet).toBe(false);
  });

  it("names hidden categories, hidden groups, closed accounts and what is gone", async () => {
    const groups: any = await call("list_categories", {});
    const hidden = await call("create_category", { name: "Hidden", groupId: groups[0].id });
    await call("update_category", { id: hidden.id, hidden: true });
    const closed = (await call("create_account", { name: "Old" })).id;
    await call("create_transaction", { account: closed, date: dayIn(9), amount: -100 });
    await call("create_transaction", { account: closed, date: dayIn(9), amount: 100 });
    await call("close_account", { id: closed });
    const sets = await rule(
      [{ field: "payee", op: "is", value: await payee("A") }],
      [{ op: "set", field: "category", value: hidden.id }],
    );
    const reads = await rule([{ field: "account", op: "oneOf", value: [closed, checking] }]);
    const gone = await rule([{ field: "payee", op: "is", value: await payee("B") }]);
    writeOlderRule((await s.call("get_book", { book })).file, gone.id, [
      { op: "set", field: "category", value: "no-such-category" },
    ]);
    const fine = await setter(await payee("C"));
    expect((await row(sets.id)).problems.stale).toEqual([
      { state: "hidden", field: "category", name: "Hidden" },
    ]);
    expect((await row(reads.id)).problems.stale).toEqual([
      { state: "closed", field: "account", name: "Old" },
    ]);
    expect((await row(gone.id)).problems.stale).toEqual([
      { state: "deleted", field: "category", name: null },
    ]);
    expect((await row(fine.id)).problems.stale).toEqual([]);
  });

  it("does not read a text condition on an id field as an id", async () => {
    const { id } = await rule([{ field: "payee", op: "contains", value: "shop" }]);
    expect((await row(id)).problems.stale).toEqual([]);
  });

  it("sees when most of a rule's latest matches carry another category", async () => {
    const id = await payee("Cafe");
    await call("update_payee", { id, learnCategories: false });
    for (const date of ["10", "11", "12", "13", "14"]) await spend("Cafe", dayIn(1, date), food);
    const wrong = await setter(id, bills);
    const seen = await row(wrong.id);
    expect(seen.problems.disagrees).toBe(true);
    expect(seen.categorized).toBe(5);
    expect(seen.carryingCategory).toBe(0);
  });
});

describe("rule_activity suggestions", () => {
  it("lists payees with repeat transactions that no category rule matches", async () => {
    const covered = await payee("Grocer");
    await call("update_payee", { id: await payee("Cafe"), learnCategories: false });
    for (const date of ["10", "11", "12"]) await spend("Cafe", dayIn(1, date), food);
    for (const date of ["10", "11", "12"]) await spend("Grocer", dayIn(1, date), food);
    await setter(covered);
    const { suggestions, suggestionCount } = await activity();
    expect(suggestions.map((each: any) => each.name)).toEqual(["Cafe"]);
    expect(suggestionCount).toBe(1);
    expect(suggestions[0]).toMatchObject({
      unmatched: 3,
      uncategorized: 0,
      category: food,
      categoryName: "Food",
    });
  });

  it("still suggests a payee whose only rule sets something else", async () => {
    const id = await payee("Cafe");
    await rule([{ field: "payee", op: "is", value: id }]);
    for (const date of ["10", "11", "12"]) await spend("Cafe", dayIn(1, date), null);
    const { suggestions } = await activity();
    expect(suggestions.map((each: any) => each.name)).toEqual(["Cafe"]);
  });

  it("puts uncategorized payees first, and offers no category without a majority", async () => {
    await spend("Shop", dayIn(1), null);
    await spend("Shop", dayIn(1, "16"), null);
    await spend("Mixed", dayIn(1, "10"), food);
    await spend("Mixed", dayIn(1, "11"), bills);
    await spend("Mixed", dayIn(1, "12"), null);
    await spend("Mixed", dayIn(1, "13"), null);
    const { suggestions, uncategorizedPayees } = await activity();
    expect(suggestions.map((each: any) => each.name)).toEqual(["Mixed", "Shop"]);
    expect(suggestions[0].category).toBeNull();
    expect(uncategorizedPayees).toBe(2);
  });

  it("leaves out payees not used in twelve months", async () => {
    for (const date of ["10", "11", "12"]) await spend("Gone", dayIn(14, date), null);
    expect((await activity()).suggestions).toEqual([]);
  });
});

describe("a preview's count of transactions", () => {
  it("is what apply_rules deletes, and what rule_activity counts", async () => {
    await spend("Plain", dayIn(1));
    await call("create_transaction", {
      account: checking,
      date: dayIn(1),
      amount: -500,
      transferAccount: savings,
    });
    const { id } = await rule(
      [{ field: "account", op: "oneOf", value: [checking, savings] }],
      [{ op: "delete-transaction" }],
    );
    const preview: any = await call("preview_rule", { rule: id });
    expect(preview.total).toBe(3);
    expect(preview.transactions).toBe(2);
    expect((await row(id)).totalMatches).toBe(2);
    expect((await call("apply_rules", { rule: id })).deleted).toHaveLength(2);
  });
});

describe("duplicates compare actions exactly", () => {
  const conditions = [{ field: "imported_payee", op: "contains", value: "acme" }];

  it("does not call values that differ in case duplicates", async () => {
    const upper = await rule(conditions, [{ op: "set", field: "payee_name", value: "ACME Corp" }]);
    const lower = await rule(conditions, [{ op: "set", field: "payee_name", value: "acme corp" }]);
    expect((await row(upper.id)).problems.duplicate).toBe(false);
    expect((await row(lower.id)).problems.duplicate).toBe(false);
  });

  it("does not call the same actions in another order duplicates", async () => {
    const first = { op: "set", field: "notes", value: "first" };
    const second = { op: "set", field: "notes", value: "second" };
    const one = await rule(conditions, [first, second]);
    const two = await rule(conditions, [second, first]);
    expect((await row(one.id)).problems.duplicate).toBe(false);
    expect((await row(two.id)).problems.duplicate).toBe(false);
  });
});

describe("update_rule on a schedule's rule", () => {
  const schedule = async () => {
    const made: any = await call("create_schedule", {
      name: "Rent",
      payee: "Landlord",
      account: checking,
      amount: -90_000,
      amountOp: "is",
      date: dayIn(-1),
      frequency: "monthly",
    });
    return { made, own: await call("get_rule", { id: made.ruleId }) };
  };

  it.each(["payee", "account", "amount", "date"])("refuses to drop its %s", async (field) => {
    const { own } = await schedule();
    const failure = await s.fails("update_rule", {
      book,
      id: own.id,
      conditions: own.conditions.filter((each: any) => each.field !== field),
    });
    expect(failure._tag).toBe("InvalidRequest");
    expect(failure.message).toContain('schedule "Rent"');
    expect(await call("get_rule", { id: own.id })).toEqual(own);
  });

  it("refuses to change its date, or a stated condition's operator", async () => {
    const { own } = await schedule();
    const moved = own.conditions.map((each: any) =>
      each.field === "date" ? { ...each, op: "is", value: dayIn(-5) } : each,
    );
    const failure = await s.fails("update_rule", { book, id: own.id, conditions: moved });
    expect(failure._tag).toBe("InvalidRequest");
  });

  it("refuses to drop its link or to match on any condition", async () => {
    const { own } = await schedule();
    const unlinked = await s.fails("update_rule", {
      book,
      id: own.id,
      actions: own.actions.filter((each: any) => each.op !== "link-schedule"),
    });
    expect(unlinked._tag).toBe("InvalidRequest");
    const either = await s.fails("update_rule", { book, id: own.id, conditionsOp: "or" });
    expect(either._tag).toBe("InvalidRequest");
  });

  it("lets its other conditions, actions and stage change", async () => {
    const { own } = await schedule();
    const updated: any = await call("update_rule", {
      id: own.id,
      stage: "post",
      conditions: [...own.conditions, { field: "notes", op: "contains", value: "rent" }],
      actions: [...own.actions, { op: "append-notes", value: "paid" }],
    });
    expect(updated.stage).toBe("post");
    expect(updated.conditions).toHaveLength(own.conditions.length + 1);
  });

  it("leaves the schedule's own updates and other rules free", async () => {
    const { made } = await schedule();
    const moved: any = await call("update_schedule", {
      id: made.id,
      payee: "New landlord",
      amount: -80_000,
      amountOp: "is",
    });
    expect(moved.payee).toBe("New landlord");
    const plain = await rule([{ field: "notes", op: "contains", value: "x" }]);
    const changed: any = await call("update_rule", { id: plain.id, conditions: [] });
    expect(changed.conditions).toEqual([]);
  });
});

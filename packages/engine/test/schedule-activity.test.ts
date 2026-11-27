/** `schedule_activity` on 2024-06-10: what is coming, what it costs, and what charges show. */
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
let book: string;
let checking: string;

const schedule = (input: Record<string, unknown>) =>
  s.call("create_schedule", { book, account: checking, amountOp: "is", ...input });

const spend = (date: string, amount: number, payee = "Landlord", account = checking) =>
  s.call("create_transaction", { book, account, date, amount, payee });

const activity = async (input: Record<string, unknown> = {}) =>
  s.call("schedule_activity", { book, ...input });

const row = async (id: string) =>
  (await activity()).schedules.find((each: { id: string }) => each.id === id);

const link = (id: string, transaction: string) => {
  const db = new DatabaseSync(join(s.home, "books", `${book}.sqlite`));
  try {
    db.prepare("UPDATE transactions SET schedule_id = ? WHERE id = ?").run(id, transaction);
  } finally {
    db.close();
  }
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2024, 5, 10, 12));
  s = scratch();
  book = (await s.call("create_book", { name: "Test" })).id;
  checking = (await s.call("create_account", { book, name: "Checking" })).id;
});

afterEach(async () => {
  await s.dispose();
  vi.useRealTimers();
});

describe("what it costs a month", () => {
  it("normalizes each frequency, a yearly bill being one twelfth", async () => {
    const cost = async (input: Record<string, unknown>) =>
      (await row((await schedule({ date: "2024-06-20", ...input })).id)).monthly;
    expect(await cost({ name: "m", amount: -1000, frequency: "monthly" })).toBe(-1000);
    expect(await cost({ name: "y", amount: -12000, frequency: "yearly" })).toBe(-1000);
    expect(await cost({ name: "q", amount: -3000, frequency: "monthly", interval: 3 })).toBe(-1000);
    expect(await cost({ name: "w", amount: -1200, frequency: "weekly", interval: 2 })).toBe(-2600);
    expect(
      await cost({
        name: "t",
        amount: -500,
        frequency: "monthly",
        patterns: [
          { type: "day", value: 1 },
          { type: "day", value: 15 },
        ],
      }),
    ).toBe(-1000);
    expect(await cost({ name: "pay", amount: 5000, frequency: "monthly" })).toBe(5000);
  });

  it("counts the middle of a range, and nothing for a one-off or a completed schedule", async () => {
    const range = await schedule({
      amount: -1000,
      amountOp: "isbetween",
      amountTo: -2000,
      date: "2024-06-20",
      frequency: "monthly",
    });
    expect(await row(range.id)).toMatchObject({ expected: -1500, monthly: -1500 });
    const once = await schedule({ name: "once", amount: -900, date: "2024-06-20" });
    expect((await row(once.id)).monthly).toBe(0);
    const done = await schedule({
      name: "done",
      amount: -900,
      date: "2024-06-20",
      frequency: "monthly",
    });
    await s.call("complete_schedule", { book, id: done.id });
    expect(await row(done.id)).toMatchObject({ monthly: 0, occurrences: [] });
  });

  it("is nothing once a recurrence has run out", async () => {
    const ended = await schedule({
      amount: -900,
      date: "2024-01-05",
      frequency: "monthly",
      endMode: "on_date",
      endDate: "2024-03-05",
    });
    expect(await row(ended.id)).toMatchObject({ monthly: 0, endsOn: "2024-03-05" });
  });
});

describe("what it costs a month, honestly", () => {
  const cost = async (input: Record<string, unknown>) =>
    (await row((await schedule(input)).id)).monthly;

  it("still counts a bill whose next date is past the twelve months ahead", async () => {
    expect(
      await cost({ name: "paid", amount: -1200, date: "2025-07-01", frequency: "yearly" }),
    ).toBe(-100);
    expect(
      await cost({
        name: "fourteen",
        amount: -1400,
        date: "2025-09-01",
        frequency: "monthly",
        interval: 14,
      }),
    ).toBe(-100);
    expect(
      await cost({
        name: "biennial",
        amount: -2400,
        date: "2026-01-01",
        frequency: "yearly",
        interval: 2,
      }),
    ).toBe(-100);
  });

  it("counts a yearly bill just paid, whose next date moved a year on", async () => {
    const yearly = await schedule({
      name: "insurance",
      amount: -1200,
      date: "2024-06-10",
      frequency: "yearly",
    });
    await s.call("post_schedule_transaction", { book, id: yearly.id });
    expect((await row(yearly.id)).nextDate).toBe("2025-06-10");
    vi.setSystemTime(new Date(2024, 5, 11, 12));
    expect((await row(yearly.id)).monthly).toBe(-100);
  });

  it("is nothing when the last date is paid", async () => {
    const last = await schedule({
      name: "last",
      amount: -1000,
      date: "2024-06-10",
      frequency: "monthly",
      endMode: "on_date",
      endDate: "2024-06-10",
    });
    const paid = await spend("2024-06-10", -1000);
    link(last.id, paid.id);
    expect(await row(last.id)).toMatchObject({ status: "paid", monthly: 0 });
  });

  it("counts only the dates that happen: the 31st skips five months", async () => {
    expect(
      await cost({ name: "end", amount: -1200, date: "2024-07-31", frequency: "monthly" }),
    ).toBe(-700);
    expect(
      await cost({
        name: "pattern",
        amount: -1200,
        date: "2024-07-01",
        frequency: "monthly",
        patterns: [{ type: "day", value: 31 }],
      }),
    ).toBe(-700);
  });

  it("counts a fifth Friday as the few months that have one", async () => {
    const monthly = await cost({
      name: "fifth",
      amount: -1200,
      date: "2024-07-01",
      frequency: "monthly",
      patterns: [{ type: "FR", value: 5 }],
    });
    expect(monthly).toBeGreaterThan(-500);
    expect(monthly).toBeLessThan(-400);
  });

  it("counts a leap day once every four years", async () => {
    expect(
      await cost({ name: "leap", amount: -1200, date: "2028-02-29", frequency: "yearly" }),
    ).toBe(-25);
  });

  it("counts two patterns that land on the same day once", async () => {
    expect(
      await cost({
        name: "same",
        amount: -500,
        date: "2024-07-01",
        frequency: "monthly",
        patterns: [
          { type: "day", value: 1 },
          { type: "day", value: 1 },
        ],
      }),
    ).toBe(-500);
  });

  it("keeps a closed account's schedule out of the totals", async () => {
    const savings = (await s.call("create_account", { book, name: "Old" })).id;
    const before = await activity();
    const closed = await schedule({
      name: "gone",
      account: savings,
      amount: -1000,
      date: "2024-06-20",
      frequency: "monthly",
    });
    await spend("2024-06-01", -500, "Old shop", savings);
    await s.call("close_account", { book, id: savings, transferAccount: checking });
    const after = await activity();
    expect(after.months).toEqual(before.months);
    expect(after.schedules.find((each: { id: string }) => each.id === closed.id)).toMatchObject({
      monthly: 0,
      occurrences: [],
    });
  });
});

describe("saving from the editor", () => {
  const SAVE = { patterns: [], endMode: "never", skipWeekend: false, interval: 1 };

  it("keeps a missed date when the recurrence only gains its defaults", async () => {
    const bill = await schedule({
      name: "Rent",
      amount: -1000,
      date: "2024-06-20",
      frequency: "monthly",
      postsTransaction: false,
    });
    vi.setSystemTime(new Date(2024, 5, 28, 12));
    expect(await row(bill.id)).toMatchObject({ nextDate: "2024-06-20", status: "missed" });
    await s.call("update_schedule", {
      book,
      id: bill.id,
      name: "Renamed",
      date: "2024-06-20",
      frequency: "monthly",
      ...SAVE,
    });
    expect(await row(bill.id)).toMatchObject({ nextDate: "2024-06-20", status: "missed" });
  });

  it("moves the next date for a real change of recurrence", async () => {
    const bill = await schedule({
      name: "Rent",
      amount: -1000,
      date: "2024-06-20",
      frequency: "monthly",
    });
    vi.setSystemTime(new Date(2024, 5, 28, 12));
    await s.call("update_schedule", {
      book,
      id: bill.id,
      date: "2024-06-20",
      frequency: "monthly",
      ...SAVE,
      interval: 2,
    });
    expect((await row(bill.id)).nextDate).toBe("2024-08-20");
  });

  it("keeps actions the rules page added", async () => {
    const food = (await s.call("create_category_group", { book, name: "Living" })).id;
    const first = (await s.call("create_category", { book, name: "Food", groupId: food })).id;
    const second = (await s.call("create_category", { book, name: "Fun", groupId: food })).id;
    const bill = await schedule({ name: "Shop", amount: -1000, date: "2024-06-20" });
    const rule = (await s.call("get_rule", { book, id: bill.ruleId })) as {
      actions: Array<Record<string, unknown>>;
    };
    const added = [
      { op: "set", field: "notes", value: "", template: "{{payee}}" },
      { op: "set-split-amount", splitIndex: 1, method: "fixed-percent", value: 50 },
      { op: "set", field: "category", value: first, splitIndex: 1 },
      { op: "set-split-amount", splitIndex: 2, method: "remainder" },
      { op: "set", field: "category", value: second, splitIndex: 2 },
    ];
    await s.call("update_rule", { book, id: bill.ruleId, actions: [...rule.actions, ...added] });

    await s.call("update_schedule", {
      book,
      id: bill.id,
      name: "Food",
      category: null,
      notes: null,
    });

    const saved = (await s.call("get_rule", { book, id: bill.ruleId })) as {
      actions: Array<Record<string, unknown>>;
    };
    expect(saved.actions.filter((action) => action["op"] !== "link-schedule")).toEqual(added);
    expect(await row(bill.id)).toMatchObject({ categoryId: null, notes: null });
  });

  it("sets its own category beside a split's", async () => {
    const group = (await s.call("create_category_group", { book, name: "Living" })).id;
    const first = (await s.call("create_category", { book, name: "Food", groupId: group })).id;
    const second = (await s.call("create_category", { book, name: "Fun", groupId: group })).id;
    const bill = await schedule({ name: "Shop", amount: -1000, date: "2024-06-20" });
    const rule = (await s.call("get_rule", { book, id: bill.ruleId })) as {
      actions: Array<Record<string, unknown>>;
    };
    const split = { op: "set", field: "category", value: first, splitIndex: 1 };
    await s.call("update_rule", { book, id: bill.ruleId, actions: [...rule.actions, split] });

    await s.call("update_schedule", { book, id: bill.id, category: second });

    const saved = (await s.call("get_rule", { book, id: bill.ruleId })) as {
      actions: Array<Record<string, unknown>>;
    };
    expect(saved.actions).toContainEqual(split);
    expect(saved.actions).toContainEqual({ op: "set", field: "category", value: second });
    expect((await row(bill.id)).categoryId).toBe(second);
  });
});

describe("what is coming", () => {
  it("lists occurrences through the window, with a missed date first", async () => {
    const monthly = await schedule({ amount: -100, date: "2024-06-20", frequency: "monthly" });
    expect((await row(monthly.id)).occurrences).toEqual(["2024-06-20", "2024-07-20", "2024-08-20"]);
    const missed = await schedule({ name: "late", amount: -100, date: "2024-06-01" });
    expect(await row(missed.id)).toMatchObject({ status: "missed", occurrences: ["2024-06-01"] });
    const short = await s.call("schedule_activity", { book, days: 15 });
    expect(short.until).toBe("2024-06-25");
    expect(
      short.schedules.find((each: { id: string }) => each.id === monthly.id).occurrences,
    ).toEqual(["2024-06-20"]);
  });

  it("drops a next date already paid", async () => {
    const paid = await schedule({ amount: -100, date: "2024-06-12", frequency: "monthly" });
    await spend("2024-06-11", -100, "Other");
    link(paid.id, (await spend("2024-06-11", -100, "Other")).id);
    const found = await row(paid.id);
    expect(found.status).toBe("paid");
    expect(found.occurrences[0]).toBe("2024-07-12");
  });

  it("totals the next twelve months from today, a yearly bill in its month", async () => {
    await schedule({ name: "a", amount: -100, date: "2024-06-05", frequency: "monthly" });
    await schedule({ name: "b", amount: 700, date: "2024-06-20", frequency: "monthly" });
    await schedule({ name: "c", amount: -1200, date: "2024-09-01", frequency: "yearly" });
    const { months } = await activity();
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ month: "2024-06", out: 0, in: 700 });
    expect(months[1]).toEqual({ month: "2024-07", out: 100, in: 700 });
    expect(months[3]).toEqual({ month: "2024-09", out: 1300, in: 700 });
  });
});

describe("recent charges", () => {
  it("counts linked transactions, and matches unlinked ones by payee, account and day", async () => {
    await spend("2024-04-02", -1000);
    await spend("2024-05-15", -1000);
    await spend("2024-06-01", -1000);
    const rent = await schedule({
      payee: "Landlord",
      amount: -1000,
      date: "2024-03-01",
      frequency: "monthly",
    });
    link(rent.id, (await spend("2024-02-28", -1000, "Other")).id);
    const found = await row(rent.id);
    expect(
      found.charges.map((each: { date: string; linked: boolean }) => [each.date, each.linked]),
    ).toEqual([
      ["2024-02-28", true],
      ["2024-04-02", false],
      ["2024-06-01", false],
    ]);
    expect(found.linkedTransactions).toBe(1);
  });

  it("links a transaction the schedule's rule matches when it is entered", async () => {
    const rent = await schedule({
      payee: "Landlord",
      amount: -1000,
      date: "2024-03-01",
      frequency: "monthly",
    });
    await spend("2024-04-02", -1000);
    const found = await row(rent.id);
    expect(found.charges).toMatchObject([{ date: "2024-04-02", linked: true }]);
    expect(found.linkedTransactions).toBe(1);
  });

  it("reads charges from before the schedule began", async () => {
    const rent = await schedule({
      payee: "Landlord",
      amount: -1000,
      date: "2024-06-01",
      frequency: "monthly",
    });
    await spend("2024-01-01", -1000);
    await spend("2024-02-01", -1000);
    expect((await row(rent.id)).charges).toHaveLength(2);
  });

  it("leaves out other accounts, money the other way and a very different amount", async () => {
    const savings = (await s.call("create_account", { book, name: "Savings" })).id;
    const rent = await schedule({
      payee: "Landlord",
      amount: -1000,
      date: "2024-03-01",
      frequency: "monthly",
    });
    await spend("2024-03-01", -1000, "Landlord", savings);
    await spend("2024-04-01", 1000);
    await spend("2024-05-01", -9000);
    expect((await row(rent.id)).charges).toEqual([]);
  });
});

describe("charged differently", () => {
  const netflix = (amountOp: string, amount: number, extra: Record<string, unknown> = {}) =>
    schedule({
      payee: "Netflix",
      amount,
      amountOp,
      date: "2024-01-15",
      frequency: "monthly",
      ...extra,
    });
  const charge = (date: string, amount: number) => spend(date, amount, "Netflix");

  it("flags charges that settled away from an exact amount", async () => {
    const id = (await netflix("is", -1000)).id;
    await charge("2024-03-15", -1000);
    await charge("2024-04-15", -1200);
    expect((await row(id)).drift).toBe(null);
    await charge("2024-05-15", -1200);
    expect((await row(id)).drift).toEqual({ actual: -1200, since: "2024-04-15" });
  });

  it("leaves a one-off difference alone", async () => {
    const id = (await netflix("is", -1000)).id;
    await charge("2024-03-15", -1000);
    await charge("2024-04-15", -1200);
    await charge("2024-05-15", -1000);
    expect((await row(id)).drift).toBe(null);
  });

  it("allows an about amount its 7.5% either side", async () => {
    const id = (await netflix("isapprox", -1000)).id;
    await charge("2024-04-15", -1050);
    await charge("2024-05-15", -1050);
    expect((await row(id)).drift).toBe(null);
    await charge("2024-02-15", -1300);
    await charge("2024-03-15", -1300);
    const other = (await netflix("isapprox", -1000, { name: "other", payee: "Disney" })).id;
    await spend("2024-04-15", -1300, "Disney");
    await spend("2024-05-15", -1300, "Disney");
    expect((await row(other)).drift).toMatchObject({ actual: -1300 });
  });

  it("flags a varying amount only after three charges on one side of its range", async () => {
    const id = (await netflix("isbetween", -1000, { amountTo: -1200, payee: "Energy" })).id;
    await spend("2024-03-15", -1400, "Energy");
    await spend("2024-04-15", -1450, "Energy");
    expect((await row(id)).drift).toBe(null);
    await spend("2024-05-15", -1500, "Energy");
    expect((await row(id)).drift).toEqual({ actual: -1450, since: "2024-03-15" });
  });
});

describe("gone quiet", () => {
  it("counts dates since the last charge, once two have passed", async () => {
    const gym = await schedule({
      payee: "Gym",
      amount: -500,
      date: "2024-01-05",
      frequency: "monthly",
    });
    await spend("2024-03-05", -500, "Gym");
    expect((await row(gym.id)).quiet).toEqual({ dates: 3, lastCharge: "2024-03-05" });
    await spend("2024-05-05", -500, "Gym");
    expect((await row(gym.id)).quiet).toBe(null);
  });

  it("only counts dates from when it began, and never a one-off", async () => {
    const fresh = await schedule({
      payee: "Gym",
      amount: -500,
      date: "2024-06-05",
      frequency: "monthly",
    });
    expect((await row(fresh.id)).quiet).toBe(null);
    const once = await schedule({ name: "once", amount: -500, date: "2024-01-05" });
    expect((await row(once.id)).quiet).toBe(null);
  });
});

describe("how it ends", () => {
  it("gives the last day of a recurrence with an end", async () => {
    const times = await schedule({
      amount: -500,
      date: "2024-06-05",
      frequency: "monthly",
      endMode: "after_n_occurrences",
      endOccurrences: 3,
    });
    expect((await row(times.id)).endsOn).toBe("2024-08-05");
    const open = await schedule({
      name: "open",
      amount: -500,
      date: "2024-06-05",
      frequency: "monthly",
    });
    expect((await row(open.id)).endsOn).toBe(null);
  });
});

describe("deleting", () => {
  it("removes the schedule and its rule and keeps linked transactions", async () => {
    const rent = await schedule({ amount: -1000, date: "2024-06-20", frequency: "monthly" });
    const tx = await spend("2024-06-01", -1000, "Other");
    link(rent.id, tx.id);
    await s.call("delete_schedule", { book, id: rent.id });
    expect((await activity()).schedules).toEqual([]);
    expect((await s.call("list_rules", { book })).map((each: any) => each.id)).not.toContain(
      rent.ruleId,
    );
    expect((await s.call("get_transaction", { book, id: tx.id })).id).toBe(tx.id);
  });

  it("comes back with undo, rule and all", async () => {
    const rent = await schedule({ amount: -1000, date: "2024-06-20", frequency: "monthly" });
    await s.call("delete_schedule", { book, id: rent.id });
    await s.call("undo", { book });
    expect((await row(rent.id)).ruleId).toBe(rent.ruleId);
    expect((await s.call("list_rules", { book })).map((each: any) => each.id)).toContain(
      rent.ruleId,
    );
  });
});

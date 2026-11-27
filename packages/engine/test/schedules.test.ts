/**
 * Actual's `server/schedules/app.test.ts`, through the schedule operations. Actual's tests run on
 * 2017-01-01; the clock is set to that day unless a test moves it.
 */
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scratch } from "./helpers.ts";
import {
  areConditionValuesEqual,
  updateConditions,
  type Condition,
} from "../src/schedules/status.ts";

let s: ReturnType<typeof scratch>;
let book: string;
let checking: string;

/** Sets the clock to noon of a day. */
const at = (day: string) =>
  vi.setSystemTime(
    new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), 12),
  );

/** Writes to the book's file directly, as Actual's tests write to its database. */
const sql = (statement: string, ...params: Array<string | number | null>) => {
  const db = new DatabaseSync(join(s.home, "books", `${book}.sqlite`));
  try {
    db.prepare(statement).run(...params);
  } finally {
    db.close();
  }
};

const setNextDate = (id: string, day: string) =>
  sql("UPDATE schedules SET next_date = ? WHERE id = ?", Number(day.replaceAll("-", "")), id);

/** A transaction linked to a schedule, as Actual's tests insert one. */
const linkedTransaction = async (schedule: string, date: string, amount: number) => {
  const tx = await s.call("create_transaction", { book, date, account: checking, amount });
  sql("UPDATE transactions SET schedule_id = ? WHERE id = ?", schedule, tx.id);
  return tx;
};

const scheduleTransactions = async (schedule: string) =>
  (await s.call("list_transactions", { book, account: checking })).rows
    .filter((row: any) => row.scheduleId === schedule)
    .map((row: any) => ({ date: row.date, amount: row.amount }))
    .toSorted((a: any, b: any) => a.date.localeCompare(b.date));

const twiceAMonth = {
  date: "2020-12-20",
  frequency: "monthly",
  patterns: [
    { type: "day", value: 15 },
    { type: "day", value: 30 },
  ],
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  at("2017-01-01");
  s = scratch();
  book = (await s.call("create_book", { name: "Test" })).id;
  checking = (await s.call("create_account", { book, name: "Checking" })).id;
});

afterEach(async () => {
  await s.dispose();
  vi.useRealTimers();
});

describe("schedule conditions", () => {
  it("updates conditions when they exist", () => {
    const updated = updateConditions(
      [
        { op: "is", field: "payee", value: "FOO" },
        { op: "is", field: "date", value: "2020-01-01" },
      ],
      [{ op: "is", field: "payee", value: "bar" }],
    );
    expect(updated).toHaveLength(2);
    expect(updated[0]!.value).toBe("bar");
  });

  it("adds conditions that don't exist", () => {
    const conds: Array<Condition> = [
      { op: "contains", field: "payee", value: "FOO" },
      { op: "contains", field: "notes", value: "dflksjdflskdjf" },
    ];
    expect(updateConditions(conds, [{ op: "is", field: "payee", value: "bar" }])).toHaveLength(3);
  });

  it("compares condition values deeply regardless of key order", () => {
    expect(
      areConditionValuesEqual(
        {
          value: {
            start: "2020-12-20",
            frequency: "monthly",
            patterns: [{ type: "day", value: 15 }],
          },
          field: "date",
        },
        {
          field: "date",
          value: {
            patterns: [{ value: 15, type: "day" }],
            frequency: "monthly",
            start: "2020-12-20",
          },
        },
      ),
    ).toBe(true);
    expect(
      areConditionValuesEqual(
        [{ field: "date" }, { field: "account" }],
        [{ field: "account" }, { field: "date" }],
      ),
    ).toBe(false);
    expect(areConditionValuesEqual(null, undefined)).toBe(false);
    expect(areConditionValuesEqual(undefined, undefined)).toBe(true);
  });
});

describe("schedules", () => {
  it("creates a schedule stored as a rule that links its transactions", async () => {
    const schedule = await s.call("create_schedule", {
      book,
      name: "Paycheck",
      payee: "Employer",
      account: checking,
      amount: 250000,
      ...twiceAMonth,
    });
    expect(schedule.nextDate).toBe("2020-12-30");
    expect(schedule.ruleId).toBeTruthy();
    expect(schedule.payee).toBe("Employer");
    expect(schedule.amount).toEqual({ op: "isapprox", value: 250000 });
    expect(schedule.description).toBe("Every month on the 15th and 30th");
    expect(schedule.status).toBe("scheduled");
    const rules = await s.call("list_rules", { book });
    const rule = rules.find((each: any) => each.id === schedule.ruleId);
    expect(rule.actions).toEqual([{ op: "link-schedule", value: schedule.id }]);
    expect(rule.conditions.map((cond: any) => [cond.field, cond.op])).toEqual([
      ["payee", "is"],
      ["account", "is"],
      ["amount", "isapprox"],
      ["date", "isapprox"],
    ]);
    expect((await s.fails("create_schedule", { book, amount: 1 }))._tag).toBeDefined();
  });

  it("trims schedule names when creating and updating schedules", async () => {
    const created = await s.call("create_schedule", {
      book,
      name: "  Rent  ",
      amount: -1,
      date: "2020-12-20",
    });
    expect(created.name).toBe("Rent");
    const updated = await s.call("update_schedule", { book, id: created.id, name: "  Mortgage  " });
    expect(updated.name).toBe("Mortgage");
  });

  it("treats names as duplicates after trimming whitespace", async () => {
    await s.call("create_schedule", { book, name: "Rent", amount: -1, date: "2020-12-20" });
    const error = await s.fails("create_schedule", {
      book,
      name: "  Rent  ",
      amount: -1,
      date: "2020-12-20",
    });
    expect(error.message).toMatch(/same name/);
  });

  it("updates a schedule, and its next date when the date changes", async () => {
    const created = await s.call("create_schedule", {
      book,
      payee: "foo",
      amount: -1,
      ...twiceAMonth,
    });
    expect(created.nextDate).toBe("2020-12-30");
    expect(created.postsTransaction).toBe(false);
    at("2021-05-17");
    const updated = await s.call("update_schedule", {
      book,
      id: created.id,
      postsTransaction: true,
      patterns: [
        { type: "day", value: 18 },
        { type: "day", value: 29 },
      ],
    });
    expect(updated.nextDate).toBe("2021-05-18");
    expect(updated.postsTransaction).toBe(true);
  });

  it("does not update the next date when unrelated conditions change", async () => {
    const created = await s.call("create_schedule", {
      book,
      payee: "foo",
      amount: -1,
      ...twiceAMonth,
    });
    at("2021-05-17");
    const updated = await s.call("update_schedule", { book, id: created.id, payee: "bar" });
    expect(updated.nextDate).toBe("2020-12-30");
    expect(updated.payee).toBe("bar");
  });

  it("does not update the next date when the date is given unchanged", async () => {
    const created = await s.call("create_schedule", { book, amount: -1, ...twiceAMonth });
    at("2021-05-17");
    const updated = await s.call("update_schedule", { book, id: created.id, ...twiceAMonth });
    expect(updated.nextDate).toBe("2020-12-30");
  });

  it("preserves skipped dates on rename but resets them when the account changes", async () => {
    at("2021-05-17");
    const savings = (await s.call("create_account", { book, name: "Savings" })).id;
    const created = await s.call("create_schedule", {
      book,
      account: checking,
      amount: -1,
      date: "2021-05-17",
      frequency: "monthly",
      patterns: [{ type: "day", value: 17 }],
    });
    await s.call("skip_schedule_date", { book, id: created.id });
    const renamed = await s.call("update_schedule", {
      book,
      id: created.id,
      name: "Broadband",
      account: checking,
    });
    expect(renamed.nextDate).toBe("2021-06-17");
    const moved = await s.call("update_schedule", { book, id: created.id, account: savings });
    expect(moved.nextDate).toBe("2021-05-17");
  });

  it("deletes a schedule and its rule", async () => {
    const created = await s.call("create_schedule", { book, amount: -1, ...twiceAMonth });
    expect(await s.call("list_schedules", { book })).toHaveLength(1);
    await s.call("delete_schedule", { book, id: created.id });
    expect(await s.call("list_schedules", { book })).toHaveLength(0);
    const rules = await s.call("list_rules", { book });
    expect(rules.some((rule: any) => rule.id === created.ruleId)).toBe(false);
  });

  it("computes the next date again from today when asked", async () => {
    const created = await s.call("create_schedule", { book, amount: -1, ...twiceAMonth });
    at("2021-05-17");
    const reset = await s.call("update_schedule", { book, id: created.id, resetNextDate: true });
    expect(reset.nextDate).toBe("2021-05-30");
  });

  // December 2020: Saturdays are the 5th, 12th, 19th and 26th.
  it.each([
    [{}, "2020-12-05", "2020-12-12"],
    [{ skipWeekend: true, weekendSolveMode: "after" }, "2020-12-07", "2020-12-14"],
    [{ skipWeekend: true, weekendSolveMode: "before" }, "2020-12-04", "2020-12-11"],
  ])("skips the next date (%o)", async (weekend, first, skipped) => {
    const created = await s.call("create_schedule", {
      book,
      amount: -1,
      date: "2020-12-05",
      frequency: "weekly",
      ...weekend,
    });
    expect(created.nextDate).toBe(first);
    expect((await s.call("skip_schedule_date", { book, id: created.id })).nextDate).toBe(skipped);
  });

  it("skips to the Monday after a `before` weekend adjustment", async () => {
    const created = await s.call("create_schedule", {
      book,
      amount: -1,
      date: "2020-12-04",
      frequency: "daily",
      skipWeekend: true,
      weekendSolveMode: "before",
    });
    expect(created.nextDate).toBe("2020-12-04");
    expect((await s.call("skip_schedule_date", { book, id: created.id })).nextDate).toBe(
      "2020-12-07",
    );
  });

  it("keeps an occurrence moved `after` the weekend onto a later day when created", async () => {
    // Saturday 31 December moves to Monday 2 January, still ahead of Sunday 1 January.
    for (const frequency of ["weekly", "monthly"]) {
      const created = await s.call("create_schedule", {
        book,
        name: frequency,
        amount: -1,
        date: "2016-12-31",
        frequency,
        skipWeekend: true,
        weekendSolveMode: "after",
      });
      expect(created.nextDate).toBe("2017-01-02");
    }
  });

  it("keeps an occurrence moved `after` the weekend onto a later day when updated", async () => {
    const created = await s.call("create_schedule", { book, amount: -1, date: "2020-12-20" });
    // Sunday 23 May: Saturday 22 May moves to Monday 24 May.
    at("2021-05-23");
    const updated = await s.call("update_schedule", {
      book,
      id: created.id,
      date: "2021-05-22",
      frequency: "weekly",
      skipWeekend: true,
      weekendSolveMode: "after",
    });
    expect(updated.nextDate).toBe("2021-05-24");
  });

  it("keeps the last date of a schedule that has ended", async () => {
    const created = await s.call("create_schedule", {
      book,
      amount: -1,
      date: "2016-11-07",
      frequency: "weekly",
      endMode: "after_n_occurrences",
      endOccurrences: 2,
    });
    expect(created.nextDate).toBe("2016-11-14");
  });

  it("completes and restores a schedule", async () => {
    const created = await s.call("create_schedule", {
      book,
      amount: -1,
      date: "2016-12-05",
      frequency: "weekly",
    });
    expect(created.nextDate).toBe("2017-01-02");
    const completed = await s.call("complete_schedule", { book, id: created.id });
    expect(completed.status).toBe("completed");
    at("2017-02-01");
    const restored = await s.call("restore_schedule", { book, id: created.id });
    expect(restored.completed).toBe(false);
    expect(restored.nextDate).toBe("2017-02-06");
    expect(await s.call("list_schedules", { book, completed: true })).toHaveLength(0);
  });

  it("makes a schedule one-off with frequency null and keeps category and notes as actions", async () => {
    const groups = await s.call("list_categories", { book });
    const food = groups[0].categories[0].id;
    const created = await s.call("create_schedule", {
      book,
      amount: -1,
      date: "2017-02-01",
      frequency: "monthly",
      category: food,
      notes: "groceries",
    });
    expect(created.categoryId).toBe(food);
    expect(created.notes).toBe("groceries");
    const updated = await s.call("update_schedule", {
      book,
      id: created.id,
      frequency: null,
      notes: null,
    });
    expect(updated.date).toBe("2017-02-01");
    expect(updated.notes).toBeNull();
    expect(updated.categoryId).toBe(food);
  });
});

describe("statuses and matching", () => {
  it("counts a transaction linked to the schedule as paid for its next date", async () => {
    const created = await s.call("create_schedule", {
      book,
      account: checking,
      amount: -1000,
      date: "2017-01-03",
    });
    expect(created.status).toBe("upcoming");
    await linkedTransaction(created.id, "2017-01-03", -1000);
    expect((await s.call("get_schedule", { book, id: created.id })).status).toBe("paid");
  });

  it("counts an early payment within two days for an approximate recurring date", async () => {
    const created = await s.call("create_schedule", {
      book,
      account: checking,
      amount: -1000,
      date: "2017-01-03",
      frequency: "monthly",
    });
    await linkedTransaction(created.id, "2017-01-01", -1000);
    expect((await s.call("get_schedule", { book, id: created.id })).status).toBe("paid");
  });

  it("gives due, missed, upcoming and scheduled as of today", async () => {
    const status = async (date: string) =>
      (await s.call("create_schedule", { book, amount: -1, date })).id;
    const due = await status("2017-01-01");
    const missed = await status("2016-12-20");
    const upcoming = await status("2017-01-05");
    const later = await status("2017-02-05");
    const byId = new Map(
      (await s.call("list_schedules", { book })).map((each: any) => [each.id, each.status]),
    );
    expect([byId.get(due), byId.get(missed), byId.get(upcoming), byId.get(later)]).toEqual([
      "due",
      "missed",
      "upcoming",
      "scheduled",
    ]);
    const month = new Map(
      (await s.call("list_schedules", { book, upcomingLength: "5-week" })).map((each: any) => [
        each.id,
        each.status,
      ]),
    );
    expect(month.get(later)).toBe("upcoming");
  });

  it("links a matching transaction through the schedule's rule", async () => {
    const created = await s.call("create_schedule", {
      book,
      payee: "Landlord",
      account: checking,
      amount: -120000,
      amountOp: "is",
      date: "2017-01-03",
      frequency: "monthly",
    });
    const tx = await s.call("create_transaction", {
      book,
      date: "2017-01-02",
      account: checking,
      amount: -120000,
      payee: "Landlord",
    });
    expect(tx.scheduleId).toBe(created.id);
    expect((await s.call("get_schedule", { book, id: created.id })).status).toBe("paid");
  });
});

describe("posting", () => {
  it("posts a schedule's transaction on its next date and moves a recurring one on", async () => {
    const groups = await s.call("list_categories", { book });
    const food = groups[0].categories[0].id;
    const created = await s.call("create_schedule", {
      book,
      payee: "Grocer",
      account: checking,
      amount: -5000,
      amountOp: "isbetween",
      amountTo: -7000,
      date: "2017-01-03",
      frequency: "weekly",
      category: food,
      notes: "weekly shop",
    });
    const tx = await s.call("post_schedule_transaction", { book, id: created.id });
    expect(tx.scheduleId).toBe(created.id);
    expect(tx.date).toBe("2017-01-03");
    expect(tx.payee).toBe("Grocer");
    expect(tx.notes).toBe("weekly shop");
    expect(tx.postings.map((p: any) => [p.accountId, p.amount])).toEqual([
      [checking, -6000],
      [food, 6000],
    ]);
    expect((await s.call("get_schedule", { book, id: created.id })).nextDate).toBe("2017-01-10");
  });

  it("posts today when asked", async () => {
    const created = await s.call("create_schedule", {
      book,
      account: checking,
      amount: -100,
      date: "2016-12-20",
    });
    const tx = await s.call("post_schedule_transaction", { book, id: created.id, today: true });
    expect(tx.date).toBe("2017-01-01");
    expect((await s.call("get_schedule", { book, id: created.id })).status).toBe("paid");
  });

  it("refuses to post a schedule without an account", async () => {
    const created = await s.call("create_schedule", { book, amount: -100, date: "2017-01-01" });
    const error = await s.fails("post_schedule_transaction", { book, id: created.id });
    expect(error._tag).toBe("InvalidRequest");
  });
});

describe("the schedule service", () => {
  const autoPost = (date: unknown) =>
    s.call("create_schedule", {
      book,
      postsTransaction: true,
      account: checking,
      amount: -10000,
      amountOp: "is",
      dateOp: "is",
      ...(date as object),
    });

  it("auto-posts every missed recurring occurrence while catching up", async () => {
    const created = await autoPost({ date: "2016-12-05", frequency: "weekly", interval: 2 });
    setNextDate(created.id, "2016-12-05");
    const result = await s.call("run_schedules", { book });
    expect(result.posted).toHaveLength(2);
    expect(await scheduleTransactions(created.id)).toEqual([
      { date: "2016-12-05", amount: -10000 },
      { date: "2016-12-19", amount: -10000 },
    ]);
    expect((await s.call("get_schedule", { book, id: created.id })).nextDate).toBe("2017-01-02");
  });

  it("continues auto-post catch-up after an already paid occurrence", async () => {
    const created = await autoPost({ date: "2016-12-05", frequency: "weekly", interval: 2 });
    setNextDate(created.id, "2016-12-05");
    await linkedTransaction(created.id, "2016-12-05", -10000);
    await s.call("run_schedules", { book });
    expect(await scheduleTransactions(created.id)).toEqual([
      { date: "2016-12-05", amount: -10000 },
      { date: "2016-12-19", amount: -10000 },
    ]);
    expect((await s.call("get_schedule", { book, id: created.id })).nextDate).toBe("2017-01-02");
  });

  it("catches up an auto-post schedule moved `before` a weekend occurrence", async () => {
    const created = await autoPost({
      date: "2016-12-24",
      frequency: "weekly",
      skipWeekend: true,
      weekendSolveMode: "before",
    });
    setNextDate(created.id, "2016-12-23");
    await linkedTransaction(created.id, "2016-12-23", -10000);
    await s.call("run_schedules", { book });
    expect(await scheduleTransactions(created.id)).toEqual([
      { date: "2016-12-23", amount: -10000 },
      { date: "2016-12-30", amount: -10000 },
    ]);
    expect((await s.call("get_schedule", { book, id: created.id })).nextDate).toBe("2017-01-06");
  });

  it("completes one-time auto-post schedules that are already paid", async () => {
    const created = await autoPost({ date: "2016-12-05" });
    await linkedTransaction(created.id, "2016-12-05", -10000);
    const result = await s.call("run_schedules", { book });
    expect(result.completed).toEqual([created.id]);
    expect((await s.call("get_schedule", { book, id: created.id })).completed).toBe(true);
    expect(await scheduleTransactions(created.id)).toHaveLength(1);
  });

  it("auto-posts one-time schedules that are due", async () => {
    const created = await autoPost({ date: "2016-12-31" });
    await s.call("run_schedules", { book });
    expect(await scheduleTransactions(created.id)).toEqual([
      { date: "2016-12-31", amount: -10000 },
    ]);
  });

  it("keeps a schedule posted today paid for the rest of the day", async () => {
    const created = await autoPost({ date: "2016-12-18", frequency: "weekly" });
    setNextDate(created.id, "2017-01-01");
    await s.call("run_schedules", { book });
    expect(await scheduleTransactions(created.id)).toEqual([
      { date: "2017-01-01", amount: -10000 },
    ]);
    expect((await s.call("get_schedule", { book, id: created.id })).nextDate).toBe("2017-01-01");
    await s.call("run_schedules", { book });
    expect(await scheduleTransactions(created.id)).toHaveLength(1);
    const after = await s.call("get_schedule", { book, id: created.id });
    expect([after.nextDate, after.status]).toEqual(["2017-01-01", "paid"]);
  });

  it("keeps a `set amount` action in sync when the amount is edited", async () => {
    const created = await autoPost({ date: "2016-12-31", amount: -6000 });
    const rule = (await s.call("list_rules", { book })).find(
      (each: any) => each.id === created.ruleId,
    );
    sql(
      "UPDATE rules SET actions = ? WHERE id = ?",
      JSON.stringify([{ op: "set", field: "amount", value: -6000 }, ...rule.actions]),
      created.ruleId,
    );
    await s.call("update_schedule", { book, id: created.id, amount: -8000 });
    await s.call("run_schedules", { book });
    expect((await scheduleTransactions(created.id)).map((tx: any) => tx.amount)).toEqual([-8000]);
  });

  it("moves a paid recurring schedule that does not post to its next date", async () => {
    const created = await s.call("create_schedule", {
      book,
      account: checking,
      amount: -100,
      date: "2016-12-20",
      frequency: "weekly",
    });
    setNextDate(created.id, "2016-12-27");
    await linkedTransaction(created.id, "2016-12-27", -100);
    const result = await s.call("run_schedules", { book });
    expect(result.advanced).toEqual([created.id]);
    expect((await s.call("get_schedule", { book, id: created.id })).nextDate).toBe("2017-01-03");
  });

  it("leaves schedules on closed accounts alone", async () => {
    await s.call("create_transaction", { book, date: "2016-12-01", account: checking, amount: 0 });
    await autoPost({ date: "2016-12-31" });
    await s.call("close_account", { book, id: checking });
    expect((await s.call("run_schedules", { book })).posted).toEqual([]);
  });
});

describe("dates and previews", () => {
  it("lists the coming days of a schedule", async () => {
    const created = await s.call("create_schedule", {
      book,
      amount: -1,
      date: "2017-01-15",
      frequency: "monthly",
    });
    expect(await s.call("list_schedule_dates", { book, id: created.id, count: 3 })).toEqual([
      "2017-01-15",
      "2017-02-15",
      "2017-03-15",
    ]);
    expect(
      await s.call("list_schedule_dates", {
        book,
        id: created.id,
        from: "2017-03-01",
        to: "2017-04-30",
      }),
    ).toEqual(["2017-03-15", "2017-04-15"]);
  });

  it("previews a recurrence as the editor does, skipping months without the day as Actual", async () => {
    expect(
      await s.call("preview_recurrence", {
        book,
        start: "2016-12-31",
        frequency: "monthly",
        interval: 1,
        skipWeekend: true,
        weekendSolveMode: "after",
        count: 3,
      }),
    ).toEqual({
      description: "Every month on the 31st (after weekend)",
      dates: ["2017-01-31", "2017-03-31", "2017-05-31"],
    });
  });

  it("previews the schedules' coming transactions for a register", async () => {
    const savings = (await s.call("create_account", { book, name: "Savings" })).id;
    const weekly = await s.call("create_schedule", {
      book,
      payee: "Cafe",
      account: checking,
      amount: -500,
      date: "2016-12-26",
      frequency: "weekly",
    });
    await s.call("create_schedule", { book, account: savings, amount: 100, date: "2017-01-02" });
    await s.call("create_schedule", { book, account: checking, amount: -1, date: "2017-03-01" });
    const rows = await s.call("list_scheduled_transactions", {
      book,
      account: checking,
      upcomingLength: "14",
    });
    expect(rows.map((row: any) => [row.date, row.forceUpcoming])).toEqual([
      ["2017-01-09", true],
      ["2017-01-02", false],
    ]);
    expect(rows[0]).toMatchObject({
      id: `preview/${weekly.id}/2017-01-09`,
      scheduleId: weekly.id,
      payee: "Cafe",
      amount: -500,
      status: "upcoming",
    });
    expect(
      (await s.call("list_scheduled_transactions", { book })).map((row: any) => row.date),
    ).toEqual(["2017-01-02", "2017-01-02"]);
  });
});

describe("finding schedules", () => {
  it("finds a monthly payment and a weekly one in the history", async () => {
    at("2017-06-20");
    const add = (date: string, amount: number, payee: string) =>
      s.call("create_transaction", { book, date, account: checking, amount, payee });
    for (const date of [
      "2017-01-05",
      "2017-02-06",
      "2017-03-05",
      "2017-04-05",
      "2017-05-04",
      "2017-06-05",
    ])
      await add(date, -89900, "Gym");
    for (const date of [
      "2017-05-02",
      "2017-05-09",
      "2017-05-16",
      "2017-05-23",
      "2017-05-30",
      "2017-06-06",
    ])
      await add(date, date === "2017-05-16" ? -1250 : -1200, "Bakery");
    await add("2017-06-01", -5000, "One-off");
    const found = await s.call("find_schedules", { book });
    const byPayee = new Map(found.map((each: any) => [each.payee, each]));
    expect([...byPayee.keys()].toSorted((a: any, b: any) => a.localeCompare(b))).toEqual([
      "Bakery",
      "Gym",
    ]);
    expect(byPayee.get("Gym")).toMatchObject({
      accountId: checking,
      amount: -89900,
      amountOp: "is",
      dateOp: "isapprox",
      date: { frequency: "monthly", start: "2017-01-05", interval: 1 },
    });
    expect(byPayee.get("Bakery")).toMatchObject({
      amountOp: "isapprox",
      dateOp: "is",
      date: { frequency: "weekly", start: "2017-05-02" },
      description: "Every week on Tuesday",
    });
  });
});

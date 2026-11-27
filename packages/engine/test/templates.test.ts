// Templates through the operations, on real books: ported from Actual's goal-template.test.ts,
// cleanup-template.test.ts and schedule-template.db.test.ts.
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dayToInt } from "@reeve/contract/rules";
import type { Book } from "../src/book.ts";
import type { TemplateCategory } from "../src/templates/context.ts";
import { bookSchedules } from "../src/templates/env.ts";
import { parse, months } from "../src/templates/months.ts";
import { getNextDate, type DateCondition } from "../src/templates/recur.ts";
import { runScheduleForecast } from "../src/templates/schedule.ts";
import type { ScheduleTemplate } from "../src/templates/types.ts";
import { scratch } from "./helpers.ts";

let s: ReturnType<typeof scratch>;
beforeEach(() => {
  s = scratch();
});
afterEach(async () => {
  vi.useRealTimers();
  await s.dispose();
});

const setup = async (opening = 100000, month = "2024-01") => {
  const book: string = (await s.call("create_book", { name: "Templates" })).id;
  const groups = await s.call("list_categories", { book });
  const all = groups.flatMap((group: any) => group.categories);
  const cat = (name: string) => all.find((category: any) => category.name === name);
  const checking = await s.call("create_account", {
    book,
    name: "Checking",
    balance: opening,
    date: `${month}-01`,
  });
  const note = (category: string, text: string | null) =>
    s.call("set_note", { book, id: cat(category).id, note: text });
  const row = async (category: string, at = month) => {
    const view = await s.call("get_budget", { book, month: at });
    return view.months[0].categories.find((c: any) => c.id === cat(category).id);
  };
  const usual = groups.find((group: any) => group.name === "Usual Expenses");
  return { book, cat, checking, note, row, usual, groups };
};

const monthly = (amount: number, priority = 1) =>
  `#template-${priority} ${amount} repeat every 1 months starting 2024-01-01`;

/** Opens the book's file beside the engine, to add schedules as the schedules domain stores them. */
const fileOf = (book: string) => new DatabaseSync(join(s.home, "books", `${book}.sqlite`));

const insertSchedule = (
  db: DatabaseSync,
  input: {
    id: string;
    name: string;
    account: string;
    amount: number;
    date: DateCondition["value"];
    today: string;
  },
) => {
  const conditions = [
    { op: "is", field: "account", value: input.account },
    { op: "is", field: "amount", value: input.amount },
    { op: "is", field: "date", value: input.date },
  ];
  const next = getNextDate({ op: "is", value: input.date }, parse(input.today));
  db.prepare(
    "INSERT INTO rules (id, stage, conditions_op, conditions, actions, created_at) VALUES (?, 'pre', 'and', ?, ?, 0)",
  ).run(
    `rule-${input.id}`,
    JSON.stringify(conditions),
    JSON.stringify([{ op: "link-schedule", value: input.id }]),
  );
  db.prepare(
    "INSERT INTO schedules (id, name, rule_id, next_date, completed, posts_transaction, created_at) VALUES (?, ?, ?, ?, 0, 0, 0)",
  ).run(input.id, input.name, `rule-${input.id}`, next === null ? null : dayToInt(next));
};

const recurrence = (start: string, frequency: "monthly" | "yearly" = "monthly") => ({
  start,
  frequency,
  interval: 1,
  patterns: [],
  skipWeekend: false,
  weekendSolveMode: "after" as const,
  endMode: "never" as const,
});

describe("apply templates to a group (applyMultipleCategoryTemplates)", () => {
  it("writes per-category budgets and returns a success notification", async () => {
    const { book, note, row, usual } = await setup(100000);
    await note("Food", monthly(100));
    await note("Bills", monthly(200));
    const result = await s.call("apply_group_templates", {
      book,
      month: "2024-01",
      group: usual.id,
    });
    expect(result).toEqual({
      month: "2024-01",
      message: "templates-applied",
      applied: 2,
      errors: [],
    });
    expect((await row("Food")).budgeted).toBe(10000);
    expect((await row("Bills")).budgeted).toBe(20000);
  });

  it("clamps lower-priority categories when funds run out", async () => {
    // Only $150 available; Food (p1) wants $100, Bills (p2) wants $100.
    const { book, note, row, usual } = await setup(15000);
    await note("Food", monthly(100, 1));
    await note("Bills", monthly(100, 2));
    await s.call("apply_group_templates", { book, month: "2024-01", group: usual.id });
    expect((await row("Food")).budgeted).toBe(10000);
    expect((await row("Bills")).budgeted).toBe(5000);
  });

  it("returns an error notification when a template fails validation", async () => {
    const { book, note, row, usual } = await setup(100000);
    await note("Food", "#template-1 1200 by 2023-12");
    const result = await s.call("apply_group_templates", {
      book,
      month: "2024-06",
      group: usual.id,
    });
    expect(result.message).toBe("template-errors");
    expect(result.errors).toEqual([
      "Food: Target month has passed, remove or update the target month",
    ]);
    expect((await row("Food", "2024-06")).budgeted).toBe(0);
  });

  it("resets the goal of categories whose templates were removed", async () => {
    const { book, note, row, usual } = await setup(100000);
    await note("Food", "#template 123.45");
    await s.call("apply_group_templates", { book, month: "2024-01", group: usual.id });
    expect((await row("Food")).goal).toBe(12345);
    await note("Food", null);
    const result = await s.call("apply_group_templates", {
      book,
      month: "2024-01",
      group: usual.id,
    });
    expect(result.message).toBe("templates-up-to-date");
    expect((await row("Food")).goal).toBe(null);
    expect((await row("Food")).budgeted).toBe(12345);
  });

  it("distributes remainder funds across categories by weight", async () => {
    const { book, note, row, usual } = await setup(20000);
    await note("Food", "#template remainder 3");
    await note("Bills", "#template remainder");
    await s.call("apply_group_templates", { book, month: "2024-01", group: usual.id });
    expect((await row("Food")).budgeted).toBe(15000);
    expect((await row("Bills")).budgeted).toBe(5000);
  });
});

describe("tracking budget priority handling (issue #8422)", () => {
  const tracking = async (budgetedIncome: number) => {
    // An opening balance makes January part of the book's months.
    const context = await setup(100);
    await s.call("update_book", { book: context.book, budgetType: "tracking" });
    await s.call("set_budget", {
      book: context.book,
      month: "2024-01",
      category: context.cat("Income").id,
      amount: budgetedIncome,
    });
    return context;
  };

  it("funds a priority>0 template from the budgeted savings", async () => {
    const { book, note, row, usual } = await tracking(100000);
    await note("Food", monthly(100));
    const result = await s.call("apply_group_templates", {
      book,
      month: "2024-01",
      group: usual.id,
    });
    expect(result.message).toBe("templates-applied");
    expect((await row("Food")).budgeted).toBe(10000);
  });

  it("clamps lower-priority categories once the budgeted savings run out", async () => {
    const { book, note, row, usual } = await tracking(15000);
    await note("Food", monthly(100, 1));
    await note("Bills", monthly(100, 2));
    await s.call("apply_group_templates", { book, month: "2024-01", group: usual.id });
    expect((await row("Food")).budgeted).toBe(10000);
    expect((await row("Bills")).budgeted).toBe(5000);
  });
});

describe("apply templates to a month", () => {
  it("skips categories that already have a non-zero budget", async () => {
    const { book, cat, note, row } = await setup(100000);
    await s.call("set_budget", { book, month: "2024-01", category: cat("Bills").id, amount: 5000 });
    await note("Food", monthly(100));
    await note("Bills", monthly(200));
    const result = await s.call("apply_templates", { book, month: "2024-01" });
    expect(result.applied).toBe(1);
    expect((await row("Food")).budgeted).toBe(10000);
    expect((await row("Bills")).budgeted).toBe(5000);
  });

  it("overwrites what is budgeted when asked", async () => {
    const { book, cat, note, row } = await setup(100000);
    await s.call("set_budget", { book, month: "2024-01", category: cat("Bills").id, amount: 5000 });
    await note("Food", monthly(100));
    await note("Bills", monthly(200));
    const result = await s.call("overwrite_templates", { book, month: "2024-01" });
    expect(result.applied).toBe(2);
    expect((await row("Bills")).budgeted).toBe(20000);
  });

  it("does not count what was budgeted by hand as the templates' to spend", async () => {
    // $300 in To Budget plus Bills' $50 budgeted by hand: the p1 templates get $350 to share.
    const { book, cat, note, row } = await setup(35000);
    await s.call("set_budget", { book, month: "2024-01", category: cat("Bills").id, amount: 5000 });
    await note("Food", monthly(300));
    await note("Bills", monthly(100));
    await s.call("overwrite_templates", { book, month: "2024-01" });
    expect((await row("Food")).budgeted).toBe(30000);
    expect((await row("Bills")).budgeted).toBe(5000);
  });

  it("applies one category's templates", async () => {
    const { book, cat, note, row } = await setup(100000);
    await note("Food", monthly(100));
    await note("Bills", monthly(200));
    await s.call("apply_category_templates", {
      book,
      month: "2024-01",
      category: cat("Food").id,
    });
    expect((await row("Food")).budgeted).toBe(10000);
    expect((await row("Bills")).budgeted).toBe(0);
  });

  it("leaves hidden categories and income categories out of a whole month", async () => {
    const { book, cat, note, row } = await setup(100000);
    await s.call("update_category", { book, id: cat("General").id, hidden: true });
    await note("General", monthly(100));
    await note("Income", monthly(100));
    const result = await s.call("apply_templates", { book, month: "2024-01" });
    expect(result.message).toBe("templates-up-to-date");
    expect((await row("General")).budgeted).toBe(0);
    expect((await row("Income")).budgeted).toBe(0);
  });

  it("stores a #goal as the long goal without budgeting", async () => {
    const { book, cat, note, row } = await setup(100000);
    await s.call("set_budget", {
      book,
      month: "2024-01",
      category: cat("Savings").id,
      amount: 2500,
    });
    await note("Savings", "Rainy day fund\n#goal 1000");
    await s.call("overwrite_templates", { book, month: "2024-01" });
    const savings = await row("Savings");
    expect(savings).toMatchObject({ budgeted: 2500, goal: 100000, longGoal: 1 });
  });

  it("budgets a percentage of an income category", async () => {
    const { book, cat, checking, note, row } = await setup(0);
    await s.call("create_transaction", {
      book,
      date: "2024-01-05",
      account: checking.id,
      amount: 200000,
      category: cat("Income").id,
    });
    await note("Food", "#template 10% of Income");
    await s.call("apply_templates", { book, month: "2024-01" });
    expect((await row("Food")).budgeted).toBe(20000);
  });

  it("copies an earlier month's budget", async () => {
    const { book, cat, note, row } = await setup(100000, "2023-12");
    await s.call("set_budget", { book, month: "2023-12", category: cat("Food").id, amount: 4200 });
    await note("Food", "#template copy from 1 months ago");
    await s.call("apply_templates", { book, month: "2024-01" });
    expect((await row("Food")).budgeted).toBe(4200);
  });

  it("averages the spending of the months before", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2024, 4, 15, 12));
    const { book, cat, checking, note, row } = await setup(100000);
    for (const [day, amount] of [
      ["2024-02-10", -2000],
      ["2024-03-10", -3000],
      ["2024-04-10", -4000],
    ] as const)
      await s.call("create_transaction", {
        book,
        date: day,
        account: checking.id,
        amount,
        category: cat("Food").id,
      });
    await note("Food", "#template average 3 months [increase 10%]");
    await s.call("apply_templates", { book, month: "2024-05" });
    expect((await row("Food", "2024-05")).budgeted).toBe(3300);
  });

  it("is one undo step", async () => {
    const { book, note, row } = await setup(100000);
    await note("Food", monthly(100));
    await note("Bills", monthly(200));
    await s.call("apply_templates", { book, month: "2024-01" });
    await s.call("undo", { book });
    expect((await row("Food")).budgeted).toBe(0);
    expect((await row("Bills")).budgeted).toBe(0);
  });

  it("budgets a schedule template from the book's schedules", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2024, 0, 2, 12));
    const { book, checking, note, row } = await setup(100000);
    const db = fileOf(book);
    insertSchedule(db, {
      id: "rent",
      name: "Rent",
      account: checking.id,
      amount: -120000,
      date: recurrence("2024-01-25"),
      today: "2024-01-02",
    });
    db.close();
    await note("Bills", "#template schedule Rent");
    const result = await s.call("apply_templates", { book, month: "2024-01" });
    // Schedule templates run at priority 0, which To Budget does not clamp.
    expect(result.message).toBe("templates-applied");
    expect(await row("Bills")).toMatchObject({ budgeted: 120000, goal: 120000 });
  });
});

describe("check templates", () => {
  it("reports lines that do not parse and schedules that do not exist", async () => {
    const { book, cat, checking, note } = await setup(0);
    await note("Food", "#template 10\n#template broken template");
    await note("Bills", "#template schedule Rent\n#template schedule Phone");
    const db = fileOf(book);
    insertSchedule(db, {
      id: "rent",
      name: "Rent",
      account: checking.id,
      amount: -1000,
      date: "2024-01-25",
      today: "2024-01-01",
    });
    db.close();
    expect(await s.call("check_templates", { book })).toEqual({
      ok: false,
      problems: [
        {
          category: cat("Food").id,
          name: "Food",
          message: "Food: #template broken template",
        },
        {
          category: cat("Bills").id,
          name: "Bills",
          message: 'Bills: Schedule "Phone" does not exist',
        },
      ],
    });
  });

  it("passes when every template is fine", async () => {
    const { book, note } = await setup(0);
    await note("Food", "#template 10\nnot a template");
    expect(await s.call("check_templates", { book })).toEqual({ ok: true, problems: [] });
  });
});

describe("cleanup templates", () => {
  // Food and Bills share a pool: Food is a sink, Bills a source. $110 is budgeted in full.
  const pool = async (billsSpent: number) => {
    const context = await setup(11000);
    const { book, cat, checking, note } = context;
    await s.call("set_budget", { book, month: "2024-01", category: cat("Food").id, amount: 6000 });
    await s.call("set_budget", { book, month: "2024-01", category: cat("Bills").id, amount: 5000 });
    const spend = (category: string, amount: number) =>
      s.call("create_transaction", {
        book,
        date: "2024-01-10",
        account: checking.id,
        amount: -amount,
        category: cat(category).id,
      });
    await spend("Food", 7500);
    await spend("Bills", billsSpent);
    await note("Food", "#cleanup Something sink");
    await note("Bills", "#cleanup something source");
    return context;
  };

  it("does not drain a source whose balance is negative", async () => {
    const { book, row } = await pool(6000);
    await s.call("cleanup_templates", { book, month: "2024-01" });
    expect((await row("Bills")).budgeted).not.toBe(6000);
    expect((await row("Bills")).budgeted).toBe(5000);
  });

  it("warns that the overspent source has no available funds", async () => {
    const { book } = await pool(6000);
    const result = await s.call("cleanup_templates", { book, month: "2024-01" });
    expect(result.message).toBe("cleanup-no-funds");
    expect(result.warnings).toContain("Bills does not have available funds.");
  });

  it("still drains a source that has positive leftover funds", async () => {
    const { book, row } = await pool(4000);
    const result = await s.call("cleanup_templates", { book, month: "2024-01" });
    // The source gives up its leftover (5000 - 1000), which the pool's sink takes.
    expect((await row("Bills")).budgeted).toBe(4000);
    expect((await row("Food")).budgeted).toBe(7000);
    expect(result.warnings).not.toContain("Bills does not have available funds.");
  });

  it("returns global sources to To Budget, covers overspending, then fills sinks by weight", async () => {
    const { book, cat, checking, note, row } = await setup(20000);
    const budget = (category: string, amount: number) =>
      s.call("set_budget", { book, month: "2024-01", category: cat(category).id, amount });
    await budget("Food", 5000);
    await budget("General", 5000);
    await budget("Bills", 5000);
    for (const [category, amount] of [
      ["Food", 2000],
      ["General", 7000],
    ] as const)
      await s.call("create_transaction", {
        book,
        date: "2024-01-10",
        account: checking.id,
        amount: -amount,
        category: cat(category).id,
      });
    await note("Food", "#cleanup source");
    await note("Bills", "#cleanup sink 3");
    await note("Savings", "#cleanup sink");
    const result = await s.call("cleanup_templates", { book, month: "2024-01" });
    // Food gives back $30, General's $20 overspending is covered, and the $60 left in To
    // Budget goes 3:1 to Bills and Savings.
    expect(result).toMatchObject({ message: "cleanup-applied", sources: 1, sinks: 2 });
    expect(await row("Food")).toMatchObject({ budgeted: 2000, goal: 2000, longGoal: 0 });
    expect((await row("General")).budgeted).toBe(7000);
    expect((await row("Bills")).budgeted).toBe(9500);
    expect((await row("Savings")).budgeted).toBe(1500);
  });

  it("warns about a group without sinks", async () => {
    const { book, note } = await setup(0);
    await note("Food", "#cleanup Trips source");
    const result = await s.call("cleanup_templates", { book, month: "2024-01" });
    expect(result.warnings).toContain('Cleanup group "Trips" has no matching sink categories.');
  });

  it("is for envelope budgets", async () => {
    const { book } = await setup(0);
    await s.call("update_book", { book, budgetType: "tracking" });
    expect((await s.fails("cleanup_templates", { book, month: "2024-01" }))._tag).toBe(
      "InvalidRequest",
    );
  });
});

describe("schedule forecast against a real book", () => {
  // Ported from schedule-template.db.test.ts: the forecast's transaction queries run on SQLite.
  const forecast = (
    book: string,
    templates: ReadonlyArray<ScheduleTemplate>,
    month: string,
    balance: number,
    category: TemplateCategory,
    today: string,
  ) => {
    const client = fileOf(book);
    try {
      return runScheduleForecast(templates, month, balance, 0, category, {
        isTracking: false,
        hideFraction: false,
        today,
        value: () => 0,
        carryover: () => false,
        categories: () => [],
        categoryAverage: () => 0,
        schedules: bookSchedules({ client } as unknown as Book),
      });
    } finally {
      client.close();
    }
  };

  const base = async () => {
    const book: string = (await s.call("create_book", { name: "Forecast" })).id;
    const groups = await s.call("list_categories", { book });
    const account = await s.call("create_account", { book, name: "Checking" });
    const create = async (name: string): Promise<TemplateCategory> => {
      const created = await s.call("create_category", { book, name, groupId: groups[0].id });
      return { id: created.id, name, isIncome: false };
    };
    const pay = async (schedule: string, date: string, amount: number, category: string | null) => {
      const tx = await s.call("create_transaction", {
        book,
        date,
        account: account.id,
        amount,
        ...(category === null ? {} : { category }),
      });
      const db = fileOf(book);
      db.prepare("UPDATE transactions SET schedule_id = ? WHERE id = ?").run(schedule, tx.id);
      db.close();
    };
    const complete = (schedule: string) => {
      const db = fileOf(book);
      db.prepare("UPDATE schedules SET completed = 1 WHERE id = ?").run(schedule);
      db.close();
    };
    return { book, account, create, pay, complete };
  };

  const setUpRent = async (today: string, start = "2024-01-25") => {
    const context = await base();
    const category = await context.create("Rent");
    const date = recurrence(start);
    const db = fileOf(context.book);
    insertSchedule(db, {
      id: "rent",
      name: "Rent",
      account: context.account.id,
      amount: -10000,
      date,
      today,
    });
    db.close();
    const payRent = (day: string, fromCategory: string | null = category.id) =>
      context.pay("rent", day, -10000, fromCategory);
    const template: ScheduleTemplate = {
      type: "schedule",
      name: "Rent",
      scheduleId: "rent",
      priority: 0,
      directive: "template",
    };
    /** Actual's `setNextDate({ advance: true })`. */
    const advance = () => {
      const file = fileOf(context.book);
      const row = file.prepare("SELECT next_date FROM schedules WHERE id = 'rent'").get() as {
        next_date: number;
      };
      const current = String(row.next_date).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
      const next = getNextDate({ op: "is", value: date }, parse(months.addDays(current, 1)));
      file.prepare("UPDATE schedules SET next_date = ? WHERE id = 'rent'").run(dayToInt(next!));
      file.close();
    };
    return { ...context, category, payRent, template, advance };
  };

  const setUpOneTimeBills = async (today: string) => {
    const context = await base();
    const category = await context.create("Annual bills");
    const db = fileOf(context.book);
    const bills = [
      { name: "Bill A", id: "bill-a", date: "2026-10-01", amount: -10000 },
      { name: "Bill B", id: "bill-b", date: "2026-11-01", amount: -9000 },
    ];
    for (const bill of bills)
      insertSchedule(db, {
        id: bill.id,
        name: bill.name,
        account: context.account.id,
        amount: bill.amount,
        date: bill.date,
        today,
      });
    db.close();
    const templates: Array<ScheduleTemplate> = bills.map((bill) => ({
      type: "schedule",
      name: bill.name,
      scheduleId: bill.id,
      priority: 0,
      directive: "template",
    }));
    const other = await context.create("Other bills");
    const payBill = (
      id: string,
      day: string,
      amount: number,
      fromCategory: string | null = category.id,
    ) => context.pay(id, day, amount, fromCategory);
    return { ...context, category, otherCategoryId: other.id, templates, payBill };
  };

  it("ignores payments dated after today when re-running a past month", async () => {
    const today = "2024-09-15";
    const { book, category, payRent, template } = await setUpRent(today);
    await payRent("2024-06-25");
    await payRent("2024-09-25");
    await payRent("2024-10-25");
    expect(forecast(book, [template], "2024-06", 0, category, today).toBudget).toBe(10000);
  });

  it("ignores future-dated payments when budgeting the current month", async () => {
    const today = "2024-09-15";
    const { book, category, payRent, template } = await setUpRent(today);
    await payRent("2024-09-25");
    await payRent("2024-10-25");
    expect(forecast(book, [template], "2024-09", 0, category, today).toBudget).toBe(10000);
  });

  it("does not charge a bill paid early in the previous month when budgeting ahead", async () => {
    const today = "2024-10-26";
    const { book, category, payRent, template } = await setUpRent(today, "2024-01-01");
    await payRent("2024-10-01");
    await payRent("2024-10-25");
    expect(forecast(book, [template], "2024-11", 0, category, today).toBudget).toBe(5000);
  });

  it("does not charge a bill paid early in the previous month when budgeting the current month", async () => {
    const today = "2024-10-15";
    const { book, category, payRent, template } = await setUpRent(today, "2024-01-01");
    await payRent("2024-09-29");
    expect(forecast(book, [template], "2024-10", 0, category, today).toBudget).toBe(5000);
  });

  it("reserves an unposted one-time bill from an earlier month when budgeting ahead", async () => {
    const today = "2026-09-22";
    const { book, category, templates } = await setUpOneTimeBills(today);
    const result = forecast(book, templates, "2026-11", 15334, category, today);
    expect(result.toBudget).toBe(3666);
    expect([...result.perScheduleMonthly.values()].every(Number.isFinite)).toBe(true);
  });

  it("does not reserve a one-time bill from an earlier month once it has posted", async () => {
    const today = "2026-09-22";
    const { book, category, payBill, templates } = await setUpOneTimeBills(today);
    await payBill("bill-a", "2026-10-01", -10000);
    expect(forecast(book, templates, "2026-11", 5334, category, today).toBudget).toBe(3666);
  });

  it("still reserves a one-time bill when its only payment sits in another category", async () => {
    const today = "2026-09-22";
    const { book, category, otherCategoryId, payBill, templates } = await setUpOneTimeBills(today);
    await payBill("bill-a", "2026-10-01", -10000, otherCategoryId);
    expect(forecast(book, templates, "2026-11", 15334, category, today).toBudget).toBe(3666);
  });

  it("covers a one-time bill that posted and completed this month", async () => {
    const today = "2026-10-03";
    const { book, category, payBill, templates, complete } = await setUpOneTimeBills(today);
    await payBill("bill-a", "2026-10-01", -10000);
    complete("bill-a");
    expect(forecast(book, [templates[0]!], "2026-10", 7500, category, today).toBudget).toBe(2500);
  });

  it("covers a completed full-flag bill that posted this month", async () => {
    const today = "2026-10-03";
    const { book, category, payBill, templates, complete } = await setUpOneTimeBills(today);
    await payBill("bill-a", "2026-10-01", -10000);
    complete("bill-a");
    expect(
      forecast(book, [{ ...templates[0]!, full: true }], "2026-10", 7500, category, today).toBudget,
    ).toBe(2500);
  });

  it("asks a past month for the same amount before and after a schedule completes", async () => {
    const today = "2026-10-03";
    const { book, category, payBill, templates, complete } = await setUpOneTimeBills(today);
    await payBill("bill-a", "2026-10-01", -10000);
    complete("bill-a");
    expect(forecast(book, templates, "2026-08", 0, category, today).toBudget).toBe(4750);
  });

  it("counts a completed schedule payment dated later this month", async () => {
    const today = "2026-10-03";
    const { book, category, payBill, templates, complete } = await setUpOneTimeBills(today);
    await payBill("bill-a", "2026-10-20", -10000);
    complete("bill-a");
    expect(forecast(book, [templates[0]!], "2026-10", 7500, category, today).toBudget).toBe(2500);
  });

  it("reserves a completed bill whose payment is not in this category when budgeting ahead", async () => {
    const today = "2026-10-07";
    const { book, category, payBill, templates, complete } = await setUpOneTimeBills(today);
    await payBill("bill-a", "2026-10-01", -10000, null);
    complete("bill-a");
    expect(forecast(book, templates, "2026-11", 15334, category, today).toBudget).toBe(3666);
  });

  it("counts a completed bill whose payment is dated after today", async () => {
    const today = "2026-10-07";
    const { book, category, payBill, templates, complete } = await setUpOneTimeBills(today);
    await payBill("bill-b", "2026-11-01", -9000);
    complete("bill-b");
    expect(forecast(book, [templates[1]!], "2026-11", 5334, category, today).toBudget).toBe(3666);
  });

  it("ignores a schedule completed long ago whose template line was never removed", async () => {
    const { book, category, template, complete } = await setUpRent("2024-06-01");
    complete("rent");
    expect(forecast(book, [template], "2026-10", 0, category, "2026-10-27").toBudget).toBe(0);
  });

  it("does not count a posted full-flag payment as this month's spending", async () => {
    const today = "2026-10-10";
    const { book, category, payBill, templates } = await setUpOneTimeBills(today);
    await payBill("bill-a", "2026-10-01", -10000);
    expect(
      forecast(
        book,
        [{ ...templates[0]!, full: true }, templates[1]!],
        "2026-10",
        0,
        category,
        today,
      ).toBudget,
    ).toBe(10000 + 4500);
  });

  it("counts a completed schedule up to a payment entered after its next date", async () => {
    const { book, category, payRent, template, complete } = await setUpRent("2024-06-01");
    for (const day of ["2024-04-25", "2024-05-25", "2024-07-25", "2024-08-25"]) await payRent(day);
    complete("rent");
    expect(forecast(book, [template], "2024-08", 0, category, "2024-08-01").toBudget).toBe(10000);
  });

  it("reserves nothing for a completed schedule when budgeting ahead", async () => {
    const today = "2026-10-03";
    const { book, category, payBill, templates, complete } = await setUpOneTimeBills(today);
    await payBill("bill-a", "2026-10-01", -10000);
    complete("bill-a");
    expect(forecast(book, templates, "2026-11", 5334, category, today).toBudget).toBe(3666);
  });

  it("splits among past one-time bills when no other schedule is left", async () => {
    const today = "2026-09-22";
    const { book, category, templates } = await setUpOneTimeBills(today);
    const result = forecast(book, [templates[0]!], "2026-11", 5000, category, today);
    expect(result.toBudget).toBe(5000);
    expect(result.perScheduleMonthly.get(templates[0]!)).toBe(5000);
  });

  it("reserves a bill whose linked payment is not categorized yet when budgeting ahead", async () => {
    const today = "2026-10-26";
    const { book, category, payRent, template, advance } = await setUpRent(today, "2026-10-22");
    await payRent("2026-10-22", null);
    advance();
    expect(forecast(book, [template], "2026-11", 10000, category, today).toBudget).toBe(10000);
  });

  it("does not reserve a skipped occurrence when budgeting ahead", async () => {
    const today = "2026-10-26";
    const { book, category, template, advance } = await setUpRent(today, "2026-10-22");
    advance();
    expect(forecast(book, [template], "2026-11", 10000, category, today).toBudget).toBe(0);
  });

  it("reserves a bill that has not posted yet this month when budgeting ahead", async () => {
    const today = "2026-10-20";
    const { book, category, template } = await setUpRent(today, "2026-10-22");
    expect(forecast(book, [template], "2026-11", 10000, category, today).toBudget).toBe(10000);
  });

  describe("with an unpaid full-flag bill when budgeting ahead", () => {
    // Rent ($100 on the 25th) is budgeted in full; Insurance ($1,200 a year from Oct 2027) is
    // smoothed and has nothing saved yet, so it needs $100 a month.
    const today = "2026-10-20";
    const setUp = async () => {
      const context = await setUpRent(today, "2026-01-25");
      const db = fileOf(context.book);
      insertSchedule(db, {
        id: "insurance",
        name: "Insurance",
        account: context.account.id,
        amount: -120000,
        date: recurrence("2027-10-01", "yearly"),
        today,
      });
      db.close();
      const templates: Array<ScheduleTemplate> = [
        { ...context.template, full: true },
        {
          type: "schedule",
          name: "Insurance",
          scheduleId: "insurance",
          priority: 0,
          directive: "template",
        },
      ];
      return { ...context, templates };
    };

    it("does not treat the full-flag bill's funding as surplus", async () => {
      const { book, category, templates } = await setUp();
      expect(forecast(book, templates, "2026-11", 10000, category, today).toBudget).toBe(20000);
    });

    it("asks the same once the full-flag bill has posted", async () => {
      const { book, category, payRent, templates } = await setUp();
      await payRent("2026-10-20");
      expect(forecast(book, templates, "2026-11", 0, category, today).toBudget).toBe(20000);
    });
  });
});

import type { Row } from "./schedules";
import { describe, expect, it } from "vitest";
import {
  amountIsOutflow,
  amountLabel,
  attentionItems,
  DEFAULT_SORT,
  DESCENDING_FIRST,
  groupByUrgency,
  matchesSearch,
  newCandidates,
  passesFilters,
  relativeDay,
  scheduleFilterGroups,
  sortSchedules,
  timesPerYear,
  type ScheduleSort,
  type ScheduleSortKey,
} from "./schedules";
import { nextSort } from "./insights";

const TODAY = "2026-11-02";

const row = (fields: Partial<Row> = {}): Row => ({
  id: fields.name ?? "s",
  name: "Rent",
  ruleId: "r",
  nextDate: "2026-11-10",
  completed: false,
  postsTransaction: false,
  payeeId: "p",
  payee: "Landlord",
  accountId: "a",
  account: "Checking",
  amount: { op: "is", value: -1000 },
  date: "2026-11-10",
  dateOp: "isapprox",
  categoryId: "c",
  notes: null,
  description: "",
  status: "scheduled",
  expected: -1000,
  monthly: -1000,
  categoryName: "Bills",
  occurrences: ["2026-11-10"],
  charges: [],
  linkedTransactions: 0,
  drift: null,
  quiet: null,
  endsOn: null,
  ...fields,
});

describe("reading a row", () => {
  const format = (value: number) => (value / 100).toFixed(2);
  it("writes each amount op so it can be told apart", () => {
    expect(amountLabel({ op: "is", value: -1299 }, format)).toBe("12.99");
    expect(amountLabel({ op: "isapprox", value: -1299 }, format)).toBe("~12.99");
    expect(amountLabel({ op: "isapprox", value: 1299 }, format)).toBe("~+12.99");
    expect(amountLabel({ op: "isbetween", value: { num1: -9000, num2: -12000 } }, format)).toBe(
      "90.00–120.00",
    );
    expect(amountLabel({ op: "isbetween", value: { num1: 100, num2: 200 } }, format)).toBe(
      "+1.00–2.00",
    );
    expect(amountLabel(null, format)).toBe("");
  });

  it("says how far off a day is", () => {
    expect(relativeDay(TODAY, TODAY)).toBe("today");
    expect(relativeDay("2026-11-03", TODAY)).toBe("tomorrow");
    expect(relativeDay("2026-11-01", TODAY)).toBe("yesterday");
    expect(relativeDay("2026-11-12", TODAY)).toBe("in 10 days");
    expect(relativeDay("2026-10-28", TODAY)).toBe("5 days ago");
  });

  it("counts a recurrence's times a year", () => {
    const day = (value: number) => ({ type: "day", value }) as const;
    const on = { start: "2026-01-15" };
    expect(timesPerYear({ ...on, frequency: "yearly", interval: 1 })).toBe(1);
    expect(timesPerYear({ ...on, frequency: "monthly", interval: 3 })).toBe(4);
    expect(
      timesPerYear({ ...on, frequency: "monthly", interval: 1, patterns: [day(1), day(2)] }),
    ).toBe(24);
    expect(timesPerYear({ ...on, frequency: "weekly", interval: 2 })).toBe(26);
  });

  it("counts only the dates that happen", () => {
    const monthly = { frequency: "monthly", interval: 1 } as const;
    expect(timesPerYear({ ...monthly, start: "2026-01-31" })).toBe(7);
    expect(
      timesPerYear({
        ...monthly,
        start: "2026-01-01",
        patterns: [{ type: "day", value: 31 }],
      }),
    ).toBe(7);
    expect(
      timesPerYear({
        ...monthly,
        start: "2026-01-01",
        patterns: [{ type: "day", value: -1 }],
      }),
    ).toBe(12);
    const fifth = timesPerYear({
      ...monthly,
      start: "2026-01-01",
      patterns: [{ type: "FR", value: 5 }],
    });
    expect(fifth).toBeGreaterThan(4);
    expect(fifth).toBeLessThan(5);
    expect(timesPerYear({ frequency: "yearly", interval: 1, start: "2028-02-29" })).toBe(0.25);
  });

  it("reads a range's direction from the amounts, not its first end", () => {
    const between = (num1: number, num2: number) => ({
      op: "isbetween" as const,
      value: { num1, num2 },
    });
    expect(amountIsOutflow(between(0, 100))).toBe(false);
    expect(amountIsOutflow(between(100, 0))).toBe(false);
    expect(amountIsOutflow(between(0, -100))).toBe(true);
    expect(amountIsOutflow(between(-100, 0))).toBe(true);
    expect(amountIsOutflow({ op: "is", value: 500 })).toBe(false);
    expect(amountIsOutflow({ op: "is", value: -500 })).toBe(true);
    expect(amountIsOutflow({ op: "is", value: 0 })).toBe(true);
    expect(amountIsOutflow(null)).toBe(true);
  });
});

describe("the table's order", () => {
  it("groups by urgency, leaving out empty groups", () => {
    const groups = groupByUrgency([
      row({ name: "a", status: "paid" }),
      row({ name: "b", status: "missed" }),
      row({ name: "c", status: "due" }),
    ]);
    expect(groups.map((group) => group.label)).toEqual(["Missed", "Due today", "Paid"]);
  });

  it("sorts on a header, with nothing to show last in either direction", () => {
    const rows = [
      row({ name: "a", monthly: 0 }),
      row({ name: "b", monthly: -500 }),
      row({ name: "c", monthly: -900 }),
    ];
    const names = (descending: boolean) =>
      sortSchedules(rows, { key: "monthly", descending }).map((each) => each.name);
    expect(names(true)).toEqual(["c", "b", "a"]);
    expect(names(false)).toEqual(["b", "c", "a"]);
  });

  it("a third click on a header goes back to urgency", () => {
    const next = (sort: ScheduleSort, key: ScheduleSortKey) =>
      nextSort(sort, key, DESCENDING_FIRST, DEFAULT_SORT);
    const first = next(DEFAULT_SORT, "amount");
    expect(first).toEqual({ key: "amount", descending: true });
    const second = next(first, "amount");
    expect(second).toEqual({ key: "amount", descending: false });
    expect(next(second, "amount")).toEqual(DEFAULT_SORT);
    expect(next(DEFAULT_SORT, "name")).toEqual({ key: "name", descending: false });
  });
});

describe("filters", () => {
  it("hides completed schedules until the status filter asks for them", () => {
    const done = row({ completed: true, status: "completed" });
    expect(passesFilters(done, {}, TODAY)).toBe(false);
    expect(passesFilters(done, { status: ["completed"] }, TODAY)).toBe(true);
    expect(passesFilters(row(), { status: ["completed"] }, TODAY)).toBe(false);
  });

  it("is any within a group and all across groups", () => {
    const rent = row({ accountId: "a", payeeId: "p" });
    expect(passesFilters(rent, { account: ["a", "b"] }, TODAY)).toBe(true);
    expect(passesFilters(rent, { account: ["a"], payee: ["other"] }, TODAY)).toBe(false);
    expect(passesFilters(rent, { direction: ["in"] }, TODAY)).toBe(false);
    expect(passesFilters(row({ accountId: null }), { account: ["a"] }, TODAY)).toBe(false);
  });

  it("offers only options that would keep a row", () => {
    const groups = scheduleFilterGroups([row({ categoryId: null, categoryName: null })], TODAY);
    expect(groups.map((group) => group.id)).toEqual([
      "status",
      "direction",
      "check",
      "account",
      "payee",
    ]);
    expect(groups[2]!.options).toEqual([
      { value: "uncategorized", label: "No category", count: 1 },
    ]);
  });

  it("searches names, payees, accounts, categories and notes", () => {
    expect(matchesSearch(row({ notes: "Flat 3" }), "flat")).toBe(true);
    expect(matchesSearch(row(), "bills")).toBe(true);
    expect(matchesSearch(row(), "nope")).toBe(false);
  });

  it("each check filters to the schedules it counts", () => {
    const rows = [
      row({ name: "missed", status: "missed" }),
      row({ name: "drift", drift: { actual: -1200, since: "2026-09-01" } }),
      row({ name: "quiet", quiet: { dates: 3, lastCharge: null } }),
      row({ name: "none", categoryId: null }),
      row({ name: "ending", endsOn: "2026-12-01" }),
      row({ name: "later", endsOn: "2027-06-01" }),
      row({ name: "ended", endsOn: "2026-10-01" }),
      row({ name: "loose", accountId: null }),
      row({ name: "done", completed: true, status: "completed", categoryId: null }),
    ];
    const items = attentionItems(rows, TODAY);
    expect(Object.fromEntries(items.map((item) => [item.id, item.count]))).toEqual({
      missed: 1,
      drift: 1,
      quiet: 1,
      uncategorized: 1,
      ending: 1,
      accountless: 1,
    });
    for (const item of items) {
      const kept = rows.filter((each) => passesFilters(each, item.filters, TODAY));
      expect(kept.length).toBe(1);
    }
  });
});

describe("found in the history", () => {
  const found = (payeeId: string | null, amount = -500, accountId = "a") =>
    ({ payeeId, accountId, amount }) as Parameters<typeof newCandidates>[0][number];

  it("leaves out what a schedule already covers and what was dismissed", () => {
    const rows = [row({ payeeId: "p", accountId: "a" })];
    expect(newCandidates([found("p")], rows, new Set())).toEqual([]);
    expect(newCandidates([found("p", -500, "other")], rows, new Set())).toHaveLength(1);
    expect(newCandidates([found("q")], rows, new Set(["a:q"]))).toEqual([]);
    expect(newCandidates([found(null)], rows, new Set())).toHaveLength(1);
  });

  it("finds it again once its schedule is completed, largest first", () => {
    const rows = [row({ payeeId: "p", completed: true, status: "completed" })];
    const result = newCandidates([found("q", -100), found("p", -900)], rows, new Set());
    expect(result.map((each) => each.payeeId)).toEqual(["p", "q"]);
  });
});

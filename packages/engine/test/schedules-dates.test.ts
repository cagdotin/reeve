/**
 * Actual's `shared/schedules.test.ts`, `server/schedules/occurrences.test.ts` and
 * `desktop-client/src/util/schedule.test.ts`, on the engine's schedule date functions. Actual's
 * tests run on 2017-01-01; here that day is passed as `today`.
 */
import { describe, expect, it } from "vitest";
import {
  getNextDate,
  getNextDateAfter,
  getOccurrencesBetween,
  getRecurringDescription,
  getScheduleDates,
  type RecurConfig,
} from "../src/schedules/recurrence.ts";
import {
  computeSchedulePreviewTransactions,
  getScheduleOccurrenceMatchStartDate,
  getStatus,
  getUpcomingDays,
  indexPostedScheduleTransactions,
  isCustomUpcomingLength,
  isScheduleOccurrencePosted,
  UPCOMING_LENGTH_PRESET_LABELS,
  UPCOMING_LENGTH_PRESET_VALUES,
  type PreviewSchedule,
} from "../src/schedules/status.ts";
import type { ScheduleStatus } from "../src/schedules/types.ts";
import { addDays } from "@reeve/contract/rules";

const today = "2017-01-01";

describe("getStatus", () => {
  it("returns completed if completed", () => {
    expect(getStatus(today, true, false, "7", today)).toBe("completed");
  });

  it("returns paid if has transactions", () => {
    expect(getStatus(today, false, true, "7", today)).toBe("paid");
  });

  it("returns due if today", () => {
    expect(getStatus(today, false, false, "7", today)).toBe("due");
  });

  it.each([1, 7, 14, 30])("returns upcoming if within upcoming range %i", (length) => {
    expect(getStatus(addDays(today, 1), false, false, String(length), today)).toBe("upcoming");
    expect(getStatus(addDays(today, length), false, false, String(length), today)).toBe("upcoming");
    expect(getStatus(addDays(today, length + 1), false, false, String(length), today)).toBe(
      "scheduled",
    );
  });

  it("returns missed if past", () => {
    expect(getStatus(addDays(today, -1), false, false, "7", today)).toBe("missed");
  });

  it("returns scheduled if not due, upcoming, or missed", () => {
    expect(getStatus(addDays(today, 8), false, false, "7", today)).toBe("scheduled");
  });
});

describe("getUpcomingDays", () => {
  it.each([
    ["1", 1, "2017-01-01"],
    ["7", 7, "2017-01-01"],
    ["14", 14, "2017-01-01"],
    ["oneMonth", 31, "2017-01-01"],
    ["oneMonth", 30, "2017-04-01"],
    ["oneMonth", 30, "2017-04-15"],
    ["oneMonth", 28, "2017-02-01"],
    ["oneMonth", 29, "2020-02-01"],
    ["currentMonth", 30, "2017-01-01"],
    ["currentMonth", 27, "2017-02-01"],
    ["currentMonth", 20, "2017-02-08"],
    ["currentMonth", 28, "2020-02-01"],
    ["2-day", 2, "2017-01-01"],
    ["5-week", 35, "2017-01-01"],
    ["3-month", 91, "2017-01-01"],
    ["4-year", 1462, "2017-01-01"],
    ["1-year", 366, "2017-06-15"],
    ["1-year", 367, "2019-06-15"],
    ["2-year", 731, "2017-06-15"],
  ] as const)("value of %s returns %i days on %s", (value, expected, date) => {
    expect(getUpcomingDays(value, date)).toBe(expected);
  });
});

describe("computeSchedulePreviewTransactions", () => {
  const makeSchedule = (
    overrides: Partial<PreviewSchedule> & Pick<PreviewSchedule, "id" | "nextDate" | "conditions">,
  ): PreviewSchedule => ({ completed: false, amount: -10000, ...overrides });
  const weekly = [
    { field: "date", op: "isapprox", value: { start: "2016-12-01", frequency: "weekly" } },
  ];
  const statuses = (status: ScheduleStatus) => new Map([["sched-1", status]]);

  it("sets forceUpcoming=false for past dates of a missed recurring schedule", () => {
    const result = computeSchedulePreviewTransactions(
      [makeSchedule({ id: "sched-1", nextDate: "2016-12-19", conditions: weekly })],
      statuses("missed"),
      "7",
      today,
    );
    const past = result.filter((r) => r.date < today);
    expect(past.length).toBeGreaterThan(0);
    expect(past.every((r) => !r.forceUpcoming)).toBe(true);
  });

  it("sets forceUpcoming=true for future dates that differ from next_date", () => {
    const result = computeSchedulePreviewTransactions(
      [makeSchedule({ id: "sched-1", nextDate: "2016-12-19", conditions: weekly })],
      statuses("missed"),
      "7",
      today,
    );
    const future = result.filter((r) => r.date > today);
    expect(future.length).toBeGreaterThan(0);
    expect(future.every((r) => r.forceUpcoming)).toBe(true);
  });

  it("sets forceUpcoming=false for next_date when not paid", () => {
    const result = computeSchedulePreviewTransactions(
      [
        makeSchedule({
          id: "sched-1",
          nextDate: "2017-01-03",
          conditions: [{ field: "date", op: "is", value: "2017-01-03" }],
        }),
      ],
      statuses("upcoming"),
      "7",
      today,
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.forceUpcoming).toBe(false);
  });

  it("shifts next_date and forces upcoming for paid schedules", () => {
    const result = computeSchedulePreviewTransactions(
      [makeSchedule({ id: "sched-1", nextDate: "2017-01-02", conditions: weekly })],
      statuses("paid"),
      "7",
      today,
    );
    expect(result.find((r) => r.date === "2017-01-02")).toBeUndefined();
    expect(result.filter((r) => r.date >= today).every((r) => r.forceUpcoming)).toBe(true);
  });

  it("does not crash when a recurring schedule has an end date in the past", () => {
    const result = computeSchedulePreviewTransactions(
      [
        makeSchedule({
          id: "sched-1",
          nextDate: "2016-08-25",
          conditions: [
            {
              field: "date",
              op: "isapprox",
              value: {
                start: "2016-01-25",
                frequency: "monthly",
                endMode: "on_date",
                endDate: "2016-08-25",
              },
            },
          ],
        }),
      ],
      statuses("missed"),
      "7",
      today,
    );
    expect(result.map((r) => r.date)).toEqual(["2016-08-25"]);
  });
});

describe("getScheduleOccurrenceMatchStartDate", () => {
  const occurrenceDate = "2024-03-10";

  it("uses exact date for one-time schedules", () => {
    expect(
      getScheduleOccurrenceMatchStartDate(
        { conditions: [{ op: "is", field: "date" }] },
        occurrenceDate,
      ),
    ).toBe(occurrenceDate);
  });

  it("uses exact date for auto-posted recurring schedules", () => {
    expect(getScheduleOccurrenceMatchStartDate({ postsTransaction: true }, occurrenceDate)).toBe(
      occurrenceDate,
    );
  });

  it("uses a 2-day lookback for manual recurring schedules", () => {
    expect(getScheduleOccurrenceMatchStartDate({ postsTransaction: false }, occurrenceDate)).toBe(
      "2024-03-08",
    );
  });

  it("uses exact date for recurring schedules with op is", () => {
    expect(
      getScheduleOccurrenceMatchStartDate(
        { postsTransaction: false, conditions: [{ op: "is", field: "date" }] },
        occurrenceDate,
      ),
    ).toBe(occurrenceDate);
  });
});

describe("indexPostedScheduleTransactions", () => {
  it("groups schedule-linked transactions by schedule id", () => {
    const indexed = indexPostedScheduleTransactions([
      { schedule: "sched-1", date: "2024-03-09" },
      { schedule: "sched-2", date: "2024-03-10" },
      { schedule: "sched-1", date: "2024-04-10" },
      { date: "2024-03-11" },
    ]);
    expect(indexed.get("sched-1")).toEqual([
      { schedule: "sched-1", date: "2024-03-09" },
      { schedule: "sched-1", date: "2024-04-10" },
    ]);
    expect(indexed.get("sched-2")).toEqual([{ schedule: "sched-2", date: "2024-03-10" }]);
    expect(indexed.has("missing")).toBe(false);
  });
});

describe("isScheduleOccurrencePosted", () => {
  const occurrenceDate = "2024-03-10";
  const manual = { postsTransaction: false };
  const autoPost = { postsTransaction: true };
  const oneTime = { conditions: [{ op: "is", field: "date" }] };
  const manualWithIs = { postsTransaction: false, conditions: [{ op: "is", field: "date" }] };

  it.each([
    ["same-day manual recurring", manual, occurrenceDate, true],
    ["early pay day before due for recurring date cond", manualWithIs, "2024-03-09", false],
    ["early pay within 2 days", manual, "2024-03-09", true],
    ["early pay outside window", manual, "2024-03-07", false],
    ["auto-post day before due", autoPost, "2024-03-09", false],
    ["auto-post on due date", autoPost, occurrenceDate, true],
    ["one-time on due date", oneTime, occurrenceDate, true],
    ["one-time day before due", oneTime, "2024-03-09", false],
    ["later month tx does not satisfy earlier occurrence", manual, "2024-04-10", false],
  ] as const)("%s", (_label, schedule, txDate, expected) => {
    expect(
      isScheduleOccurrencePosted({
        schedule,
        scheduleId: "sched-1",
        occurrenceDate,
        postedTransactions: [{ schedule: "sched-1", date: txDate }],
      }),
    ).toBe(expected);
  });
});

describe("getNextDate", () => {
  it("returns last occurrence for a recurring schedule with an end date in the past", () => {
    const cond = {
      op: "isapprox",
      value: {
        start: "2016-01-25",
        frequency: "monthly",
        endMode: "on_date",
        endDate: "2016-08-25",
      } as RecurConfig,
    };
    expect(getNextDate(cond, today)).toBe("2016-08-25");
  });

  it("returns null when the end date is before the start date", () => {
    const cond = {
      op: "isapprox",
      value: {
        start: "2016-03-25",
        frequency: "monthly",
        endMode: "on_date",
        endDate: "2016-01-25",
      } as RecurConfig,
    };
    expect(getNextDate(cond, today)).toBeNull();
  });

  it("works with date conditions", () => {
    expect(getNextDate({ op: "is", value: "2021-04-30" }, today)).toBe("2021-04-30");
    expect(
      getNextDate(
        {
          op: "is",
          value: {
            start: "2020-12-20",
            frequency: "monthly",
            patterns: [
              { type: "day", value: 15 },
              { type: "day", value: 30 },
            ],
          },
        },
        today,
      ),
    ).toBe("2020-12-30");
  });
});

describe("getNextDateAfter", () => {
  // December 2020: Saturdays are the 5th, 12th, 19th and 26th.
  const weeklyOnSaturday = (extra: Partial<RecurConfig> = {}) => ({
    op: "isapprox",
    value: { start: "2020-12-05", frequency: "weekly", patterns: [], ...extra } as RecurConfig,
  });

  it("returns the next occurrence after the given date", () => {
    expect(getNextDateAfter(weeklyOnSaturday(), "2020-12-05")).toBe("2020-12-12");
  });

  it("returns the next occurrence when moving `after` the weekend", () => {
    const cond = weeklyOnSaturday({ skipWeekend: true, weekendSolveMode: "after" });
    expect(getNextDateAfter(cond, "2020-12-07")).toBe("2020-12-14");
  });

  it("includes a weekend occurrence moved `after` the given date", () => {
    const cond = weeklyOnSaturday({ skipWeekend: true, weekendSolveMode: "after" });
    expect(getNextDateAfter(cond, "2020-12-13")).toBe("2020-12-14");
  });

  it("does not return the same occurrence when moving `after` the weekend", () => {
    const cond = weeklyOnSaturday({
      start: "2020-12-06",
      skipWeekend: true,
      weekendSolveMode: "after",
    });
    expect(getNextDateAfter(cond, "2020-12-07")).toBe("2020-12-14");
  });

  it("does not return the same occurrence when moving `before` the weekend", () => {
    const cond = weeklyOnSaturday({ skipWeekend: true, weekendSolveMode: "before" });
    expect(getNextDateAfter(cond, "2020-12-04")).toBe("2020-12-11");
  });

  it("keeps a Monday occurrence that follows a `before` weekend adjustment", () => {
    const cond = weeklyOnSaturday({
      start: "2020-12-04",
      frequency: "daily",
      skipWeekend: true,
      weekendSolveMode: "before",
    });
    expect(getNextDateAfter(cond, "2020-12-04")).toBe("2020-12-07");
  });

  it("walks past every occurrence that resolves on or before the given date", () => {
    const cond = weeklyOnSaturday({
      start: "2026-08-24",
      frequency: "daily",
      skipWeekend: true,
      weekendSolveMode: "before",
    });
    expect(getNextDateAfter(cond, "2026-08-28")).toBe("2026-08-31");
  });

  it("returns null when the schedule has no further occurrences", () => {
    const cond = weeklyOnSaturday({ endMode: "after_n_occurrences", endOccurrences: 2 });
    expect(getNextDateAfter(cond, "2020-12-05")).toBe("2020-12-12");
    expect(getNextDateAfter(cond, "2020-12-12")).toBeNull();
  });
});

describe("upcoming length presets", () => {
  it("every preset has a label entry", () => {
    for (const value of UPCOMING_LENGTH_PRESET_VALUES)
      expect(typeof UPCOMING_LENGTH_PRESET_LABELS[value]).toBe("string");
  });

  it("isCustomUpcomingLength recognizes presets and custom values", () => {
    for (const value of UPCOMING_LENGTH_PRESET_VALUES)
      expect(isCustomUpcomingLength(value)).toBe(false);
    expect(isCustomUpcomingLength("1-day")).toBe(true);
    expect(isCustomUpcomingLength("2-week")).toBe(true);
    expect(isCustomUpcomingLength(null)).toBe(false);
    expect(isCustomUpcomingLength(undefined)).toBe(false);
  });
});

describe("getOccurrencesBetween", () => {
  const monthly15 = {
    op: "is",
    value: {
      start: "2024-01-15",
      interval: 1,
      frequency: "monthly",
      patterns: [],
      skipWeekend: false,
      weekendSolveMode: "before",
      endMode: "never",
      endOccurrences: 1,
      endDate: "2099-01-01",
    } as RecurConfig,
  };
  const saturdays = (weekendSolveMode: "before" | "after") => ({
    op: "isapprox",
    value: {
      start: "2020-12-05",
      interval: 1,
      frequency: "weekly",
      patterns: [],
      skipWeekend: true,
      weekendSolveMode,
      endMode: "never",
    } as RecurConfig,
  });

  it("returns every monthly occurrence within the range", () => {
    expect(getOccurrencesBetween(monthly15, "2024-01-01", "2024-04-01")).toEqual([
      "2024-01-15",
      "2024-02-15",
      "2024-03-15",
    ]);
  });

  it("returns an empty array when the single non-repeating date is outside the range", () => {
    expect(
      getOccurrencesBetween({ op: "is", value: "2023-06-01" }, "2024-01-01", "2024-04-01"),
    ).toEqual([]);
  });

  it("returns the single date when a non-repeating date is inside the range", () => {
    expect(
      getOccurrencesBetween({ op: "is", value: "2024-02-01" }, "2024-01-01", "2024-04-01"),
    ).toEqual(["2024-02-01"]);
  });

  it("excludes an occurrence that falls exactly on the exclusive endDay", () => {
    expect(getOccurrencesBetween(monthly15, "2024-01-01", "2024-02-15")).toEqual(["2024-01-15"]);
  });

  it("returns an empty array when a recurring schedule ended before the range", () => {
    const ended = {
      op: "isapprox",
      value: {
        start: "2016-01-25",
        frequency: "monthly",
        endMode: "on_date",
        endDate: "2016-08-25",
      } as RecurConfig,
    };
    expect(getOccurrencesBetween(ended, "2016-08-26", "2026-01-01")).toEqual([]);
  });

  it("does not truncate occurrences when `before` shifts a date behind the search start", () => {
    expect(getOccurrencesBetween(saturdays("before"), "2020-12-05", "2020-12-26")).toEqual([
      "2020-12-11",
      "2020-12-18",
      "2020-12-25",
    ]);
  });

  it("includes a raw occurrence on the exclusive endDay moved back into range", () => {
    expect(getOccurrencesBetween(saturdays("before"), "2020-12-20", "2020-12-26")).toEqual([
      "2020-12-25",
    ]);
  });

  it("excludes a raw occurrence on startDay moved back out of range", () => {
    expect(getOccurrencesBetween(saturdays("before"), "2020-12-19", "2020-12-26")).toEqual([
      "2020-12-25",
    ]);
  });

  it("includes a raw occurrence before startDay moved forward into range", () => {
    expect(getOccurrencesBetween(saturdays("after"), "2020-12-07", "2020-12-12")).toEqual([
      "2020-12-07",
    ]);
  });

  it("excludes a raw occurrence before endDay moved forward out of range", () => {
    expect(getOccurrencesBetween(saturdays("after"), "2020-12-05", "2020-12-14")).toEqual([
      "2020-12-07",
    ]);
  });
});

describe("getScheduleDates", () => {
  const dates = (date: RecurConfig | string, options: Parameters<typeof getScheduleDates>[1]) =>
    getScheduleDates(date, options);

  it("returns a single date inside the window and nothing outside it", () => {
    expect(dates("2024-01-15", { start: "2024-01-01", end: "2024-01-31" })).toEqual(["2024-01-15"]);
    expect(dates("2024-02-15", { start: "2024-01-01", end: "2024-01-31" })).toEqual([]);
    expect(dates("2023-12-31", { start: "2024-01-01" })).toEqual([]);
  });

  it("expands frequencies and intervals", () => {
    expect(
      dates(
        { frequency: "daily", interval: 3, start: "2024-01-01" },
        { start: "2024-01-01", count: 4 },
      ),
    ).toEqual(["2024-01-01", "2024-01-04", "2024-01-07", "2024-01-10"]);
    expect(
      dates(
        { frequency: "weekly", interval: 2, start: "2024-01-01" },
        { start: "2024-01-01", end: "2024-02-01" },
      ),
    ).toEqual(["2024-01-01", "2024-01-15", "2024-01-29"]);
    expect(
      dates({ frequency: "yearly", start: "2024-03-15" }, { start: "2024-01-01", count: 3 }),
    ).toEqual(["2024-03-15", "2025-03-15", "2026-03-15"]);
  });

  it("expands monthly patterns", () => {
    expect(
      dates(
        {
          frequency: "monthly",
          start: "2024-01-01",
          patterns: [
            { type: "day", value: 15 },
            { type: "day", value: 1 },
          ],
        },
        { start: "2024-01-01", end: "2024-02-29" },
      ),
    ).toEqual(["2024-01-01", "2024-01-15", "2024-02-01", "2024-02-15"]);
    expect(
      dates(
        { frequency: "monthly", start: "2024-01-01", patterns: [{ type: "day", value: -1 }] },
        { start: "2024-01-01", end: "2024-04-30" },
      ),
    ).toEqual(["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30"]);
    expect(
      dates(
        {
          frequency: "monthly",
          start: "2024-01-01",
          patterns: [
            { type: "FR", value: -1 },
            { type: "MO", value: 2 },
          ],
        },
        { start: "2024-01-01", end: "2024-02-29" },
      ),
    ).toEqual(["2024-01-08", "2024-01-26", "2024-02-12", "2024-02-23"]);
  });

  it("applies windows and end modes", () => {
    expect(
      dates({ frequency: "daily", start: "2024-01-01" }, { start: "2024-03-01", count: 2 }),
    ).toEqual(["2024-03-01", "2024-03-02"]);
    expect(
      dates({ frequency: "monthly", start: "2024-01-10" }, { start: "2023-01-01", count: 1 }),
    ).toEqual(["2024-01-10"]);
    expect(
      dates(
        {
          frequency: "monthly",
          start: "2024-01-10",
          endMode: "after_n_occurrences",
          endOccurrences: 3,
        },
        { start: "2024-01-01" },
      ),
    ).toEqual(["2024-01-10", "2024-02-10", "2024-03-10"]);
    expect(
      dates(
        { frequency: "weekly", start: "2024-01-01", endMode: "on_date", endDate: "2024-01-20" },
        { start: "2024-01-01" },
      ),
    ).toEqual(["2024-01-01", "2024-01-08", "2024-01-15"]);
    expect(
      dates(
        { frequency: "daily", start: "2024-01-01" },
        { start: "2024-01-01", end: "2024-12-31", count: 2 },
      ),
    ).toEqual(["2024-01-01", "2024-01-02"]);
    expect(
      dates({ frequency: "daily", start: "2024-01-01" }, { start: "2024-01-01", count: 0 }),
    ).toEqual([]);
    expect(dates("2024-01-01", { start: "2024-01-01", count: 0 })).toEqual([]);
  });

  describe("weekend handling", () => {
    // 2024-06-01, 2024-09-01 and 2024-12-01 fall on a weekend.
    const firstOfMonth: RecurConfig = {
      frequency: "monthly",
      start: "2024-06-01",
      skipWeekend: true,
    };

    it("moves weekend dates to the following Monday or the previous Friday", () => {
      expect(
        dates(
          { ...firstOfMonth, weekendSolveMode: "after" },
          { start: "2024-06-01", end: "2024-12-31" },
        ),
      ).toEqual([
        "2024-06-03",
        "2024-07-01",
        "2024-08-01",
        "2024-09-02",
        "2024-10-01",
        "2024-11-01",
        "2024-12-02",
      ]);
      expect(
        dates(
          { ...firstOfMonth, weekendSolveMode: "before" },
          { start: "2024-05-01", end: "2024-12-31" },
        ),
      ).toEqual([
        "2024-05-31",
        "2024-07-01",
        "2024-08-01",
        "2024-08-30",
        "2024-10-01",
        "2024-11-01",
        "2024-11-29",
      ]);
    });

    it("applies the window to the moved date, not the original one", () => {
      const before: RecurConfig = { ...firstOfMonth, weekendSolveMode: "before" };
      expect(dates(before, { start: "2024-05-01", end: "2024-05-31" })).toEqual(["2024-05-31"]);
      expect(dates(before, { start: "2024-06-01", end: "2024-06-30" })).toEqual([]);
      const after: RecurConfig = {
        frequency: "monthly",
        start: "2024-06-30",
        skipWeekend: true,
        weekendSolveMode: "after",
      };
      expect(dates(after, { start: "2024-06-01", end: "2024-06-30" })).toEqual([]);
      expect(dates(after, { start: "2024-07-01", end: "2024-07-01" })).toEqual(["2024-07-01"]);
    });

    it("lists a date once when several occurrences move onto it", () => {
      const daily: RecurConfig = { frequency: "daily", start: "2024-06-01", skipWeekend: true };
      expect(
        dates({ ...daily, weekendSolveMode: "after" }, { start: "2024-06-01", count: 3 }),
      ).toEqual(["2024-06-03", "2024-06-04", "2024-06-05"]);
      expect(
        dates(
          { ...daily, weekendSolveMode: "before", start: "2024-05-31" },
          { start: "2024-05-31", end: "2024-06-04" },
        ),
      ).toEqual(["2024-05-31", "2024-06-03", "2024-06-04"]);
    });

    it("keeps weekend dates when skipWeekend is off", () => {
      expect(
        dates({ ...firstOfMonth, skipWeekend: false }, { start: "2024-06-01", count: 1 }),
      ).toEqual(["2024-06-01"]);
    });
  });

  it("rejects an open-ended recurrence without an end or a count", () => {
    expect(() =>
      dates({ frequency: "daily", start: "2024-01-01" }, { start: "2024-01-01" }),
    ).toThrow("needs an `end` date or a `count`");
    expect(() =>
      dates({ frequency: "daily", start: "2024-01-01", endMode: "never" }, { start: "2024-01-01" }),
    ).toThrow("needs an `end` date or a `count`");
  });

  it("rejects skipWeekend without a weekendSolveMode", () => {
    expect(() =>
      dates(
        { frequency: "daily", start: "2024-01-01", skipWeekend: true },
        { start: "2024-01-01", count: 1 },
      ),
    ).toThrow("`weekendSolveMode` is required");
  });
});

describe("getRecurringDescription", () => {
  const describeIt = (config: RecurConfig, format = "MM/dd/yyyy") =>
    getRecurringDescription(config, format);

  it("describes weekly interval", () => {
    expect(describeIt({ start: "2021-05-17", frequency: "weekly" })).toBe("Every week on Monday");
    expect(describeIt({ start: "2021-05-17", frequency: "weekly", interval: 2 })).toBe(
      "Every 2 weeks on Monday",
    );
  });

  it("describes monthly interval", () => {
    const monthly = (extra: Partial<RecurConfig>) =>
      describeIt({ start: "2021-04-25", frequency: "monthly", ...extra });
    expect(monthly({})).toBe("Every month on the 25th");
    expect(monthly({ interval: 2 })).toBe("Every 2 months on the 25th");
    expect(monthly({ patterns: [{ type: "day", value: 25 }] })).toBe("Every month on the 25th");
    expect(monthly({ interval: 2, patterns: [{ type: "day", value: 25 }] })).toBe(
      "Every 2 months on the 25th",
    );
    expect(monthly({ patterns: [{ type: "day", value: 31 }] })).toBe("Every month on the 31st");
    expect(monthly({ patterns: [{ type: "day", value: -1 }] })).toBe("Every month on the last day");
    expect(monthly({ patterns: [{ type: "FR", value: 2 }] })).toBe("Every month on the 2nd Friday");
    expect(monthly({ patterns: [{ type: "FR", value: -1 }] })).toBe(
      "Every month on the last Friday",
    );
  });

  it("describes monthly interval with multiple days", () => {
    const monthly = (patterns: NonNullable<RecurConfig["patterns"]>) =>
      describeIt({ start: "2021-04-25", frequency: "monthly", patterns });
    expect(
      monthly([
        { type: "day", value: 15 },
        { type: "day", value: 3 },
        { type: "day", value: 20 },
      ]),
    ).toBe("Every month on the 3rd, 15th, and 20th");
    expect(
      monthly([
        { type: "day", value: 3 },
        { type: "day", value: -1 },
        { type: "day", value: 20 },
      ]),
    ).toBe("Every month on the 3rd, 20th, and last day");
    expect(
      monthly([
        { type: "day", value: 3 },
        { type: "day", value: -1 },
        { type: "FR", value: 2 },
      ]),
    ).toBe("Every month on the 2nd Friday, 3rd, and last day");
    expect(
      monthly([
        { type: "SA", value: 1 },
        { type: "day", value: 2 },
        { type: "FR", value: 3 },
        { type: "day", value: 10 },
      ]),
    ).toBe("Every month on the 1st Saturday, 3rd Friday, 2nd, and 10th");
  });

  it("describes yearly interval", () => {
    expect(describeIt({ start: "2021-05-17", frequency: "yearly" })).toBe("Every year on May 17th");
    expect(describeIt({ start: "2021-05-17", frequency: "yearly", interval: 2 })).toBe(
      "Every 2 years on May 17th",
    );
  });

  it("describes intervals with limited occurrences", () => {
    const limited = (frequency: RecurConfig["frequency"], endOccurrences: number) =>
      describeIt({
        start: "2021-05-17",
        frequency,
        interval: 2,
        endMode: "after_n_occurrences",
        endOccurrences,
      });
    expect(limited("weekly", 2)).toBe("Every 2 weeks on Monday, 2 times");
    expect(limited("weekly", 1)).toBe("Every 2 weeks on Monday, once");
    expect(limited("monthly", 2)).toBe("Every 2 months on the 17th, 2 times");
    expect(limited("yearly", 2)).toBe("Every 2 years on May 17th, 2 times");
  });

  it("describes intervals with an end date", () => {
    const until = (frequency: RecurConfig["frequency"], format: string) =>
      describeIt(
        { start: "2021-05-17", frequency, interval: 2, endMode: "on_date", endDate: "2021-06-01" },
        format,
      );
    expect(until("weekly", "MM/dd/yyyy")).toBe("Every 2 weeks on Monday, until 06/01/2021");
    expect(until("monthly", "yyyy-MM-dd")).toBe("Every 2 months on the 17th, until 2021-06-01");
  });

  it("annotates weekend moves, after the end mode", () => {
    expect(
      describeIt({
        start: "2021-05-17",
        frequency: "weekly",
        interval: 1,
        skipWeekend: true,
        weekendSolveMode: "after",
      }),
    ).toBe("Every week on Monday (after weekend)");
    expect(
      describeIt({
        start: "2021-05-17",
        frequency: "weekly",
        interval: 2,
        endMode: "after_n_occurrences",
        endOccurrences: 2,
        skipWeekend: true,
        weekendSolveMode: "before",
      }),
    ).toBe("Every 2 weeks on Monday, 2 times (before weekend)");
  });

  it("describes daily interval", () => {
    expect(describeIt({ start: "2021-05-17", frequency: "daily" })).toBe("Every day");
    expect(describeIt({ start: "2021-05-17", frequency: "daily", interval: 3 })).toBe(
      "Every 3 days",
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  ALL_TIME,
  customSpan,
  monthInRange,
  nextSort,
  rangeItems,
  rangeLabel,
  rangeStart,
  signedChange,
  toggled,
} from "./insights.ts";

describe("changes", () => {
  it("signs a change, and has nothing for none", () => {
    expect(signedChange(8)).toBe("+8");
    expect(signedChange(-3, (value) => `${value}.00`)).toBe("\u22123.00");
    expect(signedChange(0)).toBeNull();
  });
  it("counts a month in range when any of it is", () => {
    expect(monthInRange("2026-10", "2026-10-02")).toBe(true);
    expect(monthInRange("2026-09", "2026-10-02")).toBe(false);
    expect(monthInRange("2020-01", undefined)).toBe(true);
    expect(monthInRange("2026-03", "2026-01-15", "2026-03-01")).toBe(true);
    expect(monthInRange("2026-04", "2026-01-15", "2026-03-31")).toBe(false);
  });
});

describe("ranges", () => {
  it("starts a range on the same day, or the last of a shorter month", () => {
    expect(rangeStart("2026-11-02", 3)).toBe("2026-08-02");
    expect(rangeStart("2026-05-31", 3)).toBe("2026-02-28");
    expect(rangeStart("2026-01-15", 2)).toBe("2025-11-15");
  });
  it("names a range, one month and all time apart", () => {
    expect([rangeLabel(1), rangeLabel(4), rangeLabel(null)]).toEqual([
      "Last month",
      "Last 4 months",
      "All time",
    ]);
  });
  it("offers the presets in order, the current range among them, then all time", () => {
    const values = (months: number | null) => rangeItems([3, 6], months).map((each) => each.value);
    expect(values(null)).toEqual(["3", "6", ALL_TIME]);
    expect(values(6)).toEqual(["3", "6", ALL_TIME]);
    expect(values(4)).toEqual(["3", "4", "6", ALL_TIME]);
  });
});

describe("nextSort", () => {
  const numbers = new Set(["amount"]);
  it("starts a column in its natural order, and reverses the current one", () => {
    const name = { key: "name", descending: false };
    expect(nextSort(name, "amount", numbers)).toEqual({ key: "amount", descending: true });
    expect(nextSort(name, "name", numbers)).toEqual({ key: "name", descending: true });
    expect(nextSort({ key: "name", descending: true }, "name", numbers)).toEqual(name);
  });
  it("goes back to `reset` after both orders, when there is one", () => {
    const reset = { key: "name", descending: false };
    const first = nextSort(reset, "amount", numbers, reset);
    const second = nextSort(first, "amount", numbers, reset);
    expect(second).toEqual({ key: "amount", descending: false });
    expect(nextSort(second, "amount", numbers, reset)).toEqual(reset);
  });
});

describe("toggled", () => {
  it("adds what is missing and takes out what is there", () => {
    expect([...toggled(new Set(["a"]), "b")]).toEqual(["a", "b"]);
    expect([...toggled(new Set(["a"]), "a")]).toEqual([]);
  });
});

describe("customSpan", () => {
  it("leaves a blank side open", () => {
    expect(customSpan({ from: "", to: "" })).toEqual({ since: undefined, until: undefined });
    expect(customSpan({ from: "2026-01-01", to: "" })).toEqual({
      since: "2026-01-01",
      until: undefined,
    });
    expect(customSpan({ from: "", to: "2026-01-31" })).toEqual({
      since: undefined,
      until: "2026-01-31",
    });
  });
  it("reads dates typed the wrong way round", () => {
    expect(customSpan({ from: "2026-03-01", to: "2026-01-01" })).toEqual({
      since: "2026-01-01",
      until: "2026-03-01",
    });
  });
});

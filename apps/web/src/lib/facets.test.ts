import { describe, expect, it } from "vitest";
import { sameFilters } from "./facets.ts";

describe("sameFilters", () => {
  it("compares filters whatever their order, ignoring empty groups", () => {
    expect(sameFilters({ a: ["1", "2"], b: [] }, { a: ["2", "1"] })).toBe(true);
    expect(sameFilters({ a: ["1"] }, { a: ["1"], b: ["2"] })).toBe(false);
  });
});

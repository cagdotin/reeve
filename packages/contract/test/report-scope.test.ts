import { describe, expect, it } from "vitest";
import type { AccountScope } from "../src/catalog/reports.ts";
import { effectiveScope, followsScope, pageScope, sameScope } from "../src/rules.ts";

const checking: AccountScope = { mode: "selected", ids: ["checking"] };
const budgeted: AccountScope = { mode: "budgeted" };
const fixed = { mode: "fixed", value: budgeted } as const;
const inherit = { mode: "inherit" } as const;

describe("effectiveScope", () => {
  it("takes the first source that applies", () => {
    expect(effectiveScope({})).toEqual({ mode: "all" });
    expect(effectiveScope({ saved: checking })).toEqual(checking);
    expect(
      effectiveScope({ placement: inherit, saved: checking }),
      "a dashboard inherits the report",
    ).toEqual(checking);
    expect(
      effectiveScope({ placement: inherit, host: { mode: "offbudget" }, saved: checking }),
    ).toEqual({
      mode: "offbudget",
    });
    expect(effectiveScope({ placement: fixed, host: checking, saved: checking })).toEqual(budgeted);
    expect(effectiveScope({ explored: checking, placement: fixed, host: budgeted })).toEqual(
      checking,
    );
  });

  it("follows the page while inherited and ignores it while fixed", () => {
    const on = (page: string, placement: typeof inherit | typeof fixed) =>
      effectiveScope({ placement, host: pageScope(page), saved: { mode: "all" } });
    expect(on("checking", inherit)).toEqual(checking);
    expect(on("offbudget", inherit)).toEqual({ mode: "offbudget" });
    expect(on("checking", fixed)).toEqual(on("offbudget", fixed));
  });
});

describe("pageScope", () => {
  it("reads the Accounts pages' scope", () => {
    expect(pageScope("all")).toEqual({ mode: "all" });
    expect(pageScope("budgeted")).toEqual(budgeted);
    expect(pageScope("offbudget")).toEqual({ mode: "offbudget" });
    expect(pageScope("checking")).toEqual(checking);
  });
});

describe("followsScope", () => {
  it("leaves out budget-wide and plan-wide reports", () => {
    expect(followsScope({ type: "net-worth", settings: {} })).toBe(true);
    expect(followsScope({ type: "custom", settings: { balanceType: "Payment" } })).toBe(true);
    expect(followsScope({ type: "custom", settings: { balanceType: "Budgeted" } })).toBe(false);
    for (const type of [
      "budget-analysis",
      "sankey",
      "crossover",
      "formula",
      "monte-carlo",
    ] as const)
      expect([type, followsScope({ type, settings: {} })]).toEqual([type, false]);
  });
});

describe("sameScope", () => {
  it("compares selected accounts as a set", () => {
    expect(
      sameScope({ mode: "selected", ids: ["a", "b"] }, { mode: "selected", ids: ["b", "a"] }),
    ).toBe(true);
    expect(sameScope({ mode: "selected", ids: ["a"] }, { mode: "selected", ids: ["a", "b"] })).toBe(
      false,
    );
    expect(sameScope(budgeted, { mode: "offbudget" })).toBe(false);
  });
});

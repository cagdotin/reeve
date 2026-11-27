import { describe, expect, it } from "vitest";
import { scopedAccount, scopedLink, scopeAt, scopeInput, scopeSearch } from "./account-scope.ts";

describe("account scope", () => {
  it("is read from the register's address, or else from ?account=", () => {
    expect(scopeAt("/accounts/all", {})).toBe("all");
    expect(scopeAt("/accounts/abc", { account: "ignored" })).toBe("abc");
    expect(scopeAt("/schedules", { account: "abc" })).toBe("abc");
    expect(scopeAt("/rules", {})).toBe("all");
  });

  it("reads the uncategorized queue as the budget accounts it draws on", () => {
    expect(scopeAt("/accounts/uncategorized", {})).toBe("budgeted");
  });

  it("carries over to each tab", () => {
    expect(scopedLink("/accounts/all", "abc")).toEqual({ to: "/accounts/abc" });
    expect(scopedLink("/payees", "abc")).toEqual({ to: "/payees", search: { account: "abc" } });
    expect(scopedLink("/payees", "all")).toEqual({ to: "/payees", search: {} });
    expect(scopeSearch("all")).toEqual({});
  });

  it("becomes an operation's input", () => {
    expect(scopeInput("all")).toEqual({});
    expect(scopeInput("budgeted")).toEqual({ onBudget: true });
    expect(scopeInput("offbudget")).toEqual({ onBudget: false });
    expect(scopeInput("abc")).toEqual({ account: "abc" });
    expect(scopedAccount("abc")).toBe("abc");
    expect(scopedAccount("budgeted")).toBeUndefined();
  });
});

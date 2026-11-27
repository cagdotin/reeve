import type { Account, RegisterRow } from "@reeve/contract";
import { describe, expect, it } from "vitest";
import {
  activityInput,
  type Activity,
  attentionItems,
  filterGroups,
  isFiltered,
  isOnly,
  registerInput,
  selectionInput,
  selectRows,
  toggleSelected,
  searchFrom,
  summedAccounts,
  toggleOnly,
  validateRegisterSearch,
  withMonths,
} from "./register.ts";

const account = (fields: Partial<Account> = {}): Account => ({
  id: "a",
  name: "Checking",
  type: "asset",
  onBudget: true,
  closed: false,
  sortOrder: 0,
  balance: 0,
  cleared: 0,
  uncleared: 0,
  notes: null,
  ...fields,
});

const row = (date: string): RegisterRow => ({ date }) as unknown as RegisterRow;

const attention = (fields: Partial<Activity["attention"]> = {}): Activity["attention"] => ({
  uncategorized: 0,
  oldUncleared: 0,
  toReconcile: 0,
  lastReconciled: null,
  missedSchedules: 0,
  ...fields,
});

const TODAY = "2026-11-02";

describe("the register's address", () => {
  it("keeps what other pages link with and drops the rest", () => {
    expect(
      validateRegisterSearch({
        accounts: ["a", 1],
        categories: ["c"],
        payees: [],
        status: ["cleared"],
        month: "2026-10",
        check: "stale",
        other: "x",
      }),
    ).toEqual({
      accounts: ["a"],
      categories: ["c"],
      status: ["cleared"],
      month: "2026-10",
      check: "stale",
    });
    expect(validateRegisterSearch({ month: "October", check: "nope" })).toEqual({});
  });

  it("writes back only what is set", () => {
    expect(searchFrom({ payees: ["p"], status: [] }, undefined, undefined)).toEqual({
      payees: ["p"],
    });
    expect(searchFrom({}, "2026-10", "uncategorized")).toEqual({
      month: "2026-10",
      check: "uncategorized",
    });
  });
});

describe("registerInput", () => {
  it("lists an account or a view, narrowed", () => {
    expect(registerInput("a", "", {}, undefined, undefined, TODAY)).toEqual({ account: "a" });
    expect(registerInput("budgeted", " x ", {}, undefined, undefined, TODAY)).toEqual({
      onBudget: true,
      query: "x",
    });
    expect(
      registerInput("all", "", { status: ["cleared", "bad"] }, "2026-02", undefined, TODAY),
    ).toEqual({ from: "2026-02-01", to: "2026-02-28", status: ["cleared"] });
  });

  it("narrows to a check, keeping the earlier of a month's end and the check's day", () => {
    expect(registerInput("a", "", {}, undefined, "uncategorized", TODAY)).toMatchObject({
      uncategorized: true,
    });
    expect(registerInput("a", "", {}, undefined, "stale", TODAY)).toEqual({
      account: "a",
      status: ["uncleared"],
      to: "2026-10-02",
    });
    expect(registerInput("a", "", {}, "2026-11", "stale", TODAY).to).toBe("2026-10-02");
    expect(registerInput("a", "", {}, "2026-02", "stale", TODAY).to).toBe("2026-02-28");
  });

  it("counts a check as a filter", () => {
    expect(isFiltered("", {}, undefined)).toBe(false);
    expect(isFiltered("", {}, undefined, "stale")).toBe(true);
    expect(isFiltered(" ", { payees: ["p"] }, undefined)).toBe(true);
  });
});

describe("the page's scope", () => {
  const accounts = [
    account({ id: "b", onBudget: true }),
    account({ id: "o", onBudget: false }),
    account({ id: "c", closed: true }),
  ];

  it("sums a view's open accounts", () => {
    expect(summedAccounts("all", accounts, undefined).map((each) => each.id)).toEqual(["b", "o"]);
    expect(summedAccounts("budgeted", accounts, undefined).map((each) => each.id)).toEqual(["b"]);
    expect(summedAccounts("offbudget", accounts, undefined).map((each) => each.id)).toEqual(["o"]);
    expect(summedAccounts(null, accounts, accounts[2]).map((each) => each.id)).toEqual(["c"]);
    expect(summedAccounts(null, accounts, undefined)).toEqual([]);
  });

  it("offers accounts in the filter only for a view of several", () => {
    expect(filterGroups(undefined, []).map((group) => group.id)).toEqual(["categories", "status"]);
    expect(filterGroups(accounts, []).map((group) => group.id)).toEqual([
      "accounts",
      "categories",
      "status",
    ]);
  });

  it("asks for activity by account or view, with a range and a month", () => {
    expect(activityInput("a", 12, undefined)).toEqual({ account: "a", months: 12 });
    expect(activityInput("uncategorized", null, "2026-10")).toEqual({
      uncategorized: true,
      month: "2026-10",
    });
  });
});

describe("toggling a filter from a check", () => {
  it("sets one value and clears it on the second click, leaving other filters", () => {
    const on = toggleOnly({ payees: ["p"] }, "categories", "c");
    expect(on).toEqual({ payees: ["p"], categories: ["c"] });
    expect(isOnly(on, "categories", "c")).toBe(true);
    expect(toggleOnly(on, "categories", "c")).toEqual({ payees: ["p"] });
  });

  it("replaces a wider choice rather than clearing it", () => {
    expect(toggleOnly({ categories: ["c", "d"] }, "categories", "c")).toEqual({
      categories: ["c"],
    });
  });
});

describe("withMonths", () => {
  it("puts a divider before each month, newest first", () => {
    const lines = withMonths([row("2026-11-01"), row("2026-10-30"), row("2026-10-02")]);
    expect(lines.map((line) => (line.kind === "month" ? line.month : line.row.date))).toEqual([
      "2026-11",
      "2026-11-01",
      "2026-10",
      "2026-10-30",
      "2026-10-02",
    ]);
  });

  it("has no dividers within one month, or with no rows", () => {
    expect(withMonths([row("2026-10-30"), row("2026-10-02")]).map((line) => line.kind)).toEqual([
      "row",
      "row",
    ]);
    expect(withMonths([])).toEqual([]);
  });
});

describe("the selection", () => {
  const line = (transactionId: string, accountId: string) =>
    ({ transactionId, accountId }) as unknown as RegisterRow;

  it("remembers each row's account, so a row no longer shown is still written", () => {
    const picked = toggleSelected(toggleSelected(new Map(), line("t", "a")), line("u", "b"));
    // Whatever the table shows by now, the write covers both.
    expect(selectionInput(picked)).toEqual({
      ids: ["t", "u"],
      accountOf: [
        { id: "t", account: "a" },
        { id: "u", account: "b" },
      ],
    });
    expect([...toggleSelected(picked, line("t", "a")).keys()]).toEqual(["u"]);
  });

  it("counts a transfer's two rows once when selecting all", () => {
    const all = selectRows([line("t", "a"), line("t", "b"), line("u", "b")]);
    expect(selectionInput(all)).toEqual({
      ids: ["t", "u"],
      accountOf: [
        { id: "t", account: "a" },
        { id: "u", account: "b" },
      ],
    });
  });
});

describe("attentionItems", () => {
  const scope = {
    view: null,
    account: account(),
    today: TODAY,
    formatDay: (day: string) => day,
  };
  const ids = (items: ReadonlyArray<{ id: string }>) => items.map((item) => item.id);

  it("has the checks for a budget account, with nothing to say about reconciling yet", () => {
    expect(ids(attentionItems(attention(), scope))).toEqual(["uncategorized", "stale", "missed"]);
  });

  it("asks nothing about categories off budget", () => {
    expect(
      ids(attentionItems(attention(), { ...scope, account: account({ onBudget: false }) })),
    ).toEqual(["stale", "missed"]);
    expect(
      ids(attentionItems(attention(), { ...scope, view: "offbudget", account: undefined })),
    ).toEqual(["stale", "missed"]);
  });

  it("does not add its own queue to the uncategorized view", () => {
    expect(
      attentionItems(attention({ uncategorized: 3 }), { ...scope, view: "uncategorized" }),
    ).toEqual([]);
  });

  it("opens reconciling only with something new to reconcile, well after the last time", () => {
    const check = (lastReconciled: string, toReconcile: number) =>
      attentionItems(attention({ lastReconciled, toReconcile }), scope).find(
        (item) => item.id === "reconcile",
      )!.count;
    expect(check("2026-08-01", 3)).toBe(93);
    expect(check("2026-08-01", 0)).toBe(0);
    expect(check("2026-10-20", 3)).toBe(0);
  });

  it("does not check reconciling across several accounts", () => {
    const items = attentionItems(attention({ lastReconciled: "2020-01-01", toReconcile: 9 }), {
      ...scope,
      view: "all",
      account: undefined,
    });
    expect(ids(items)).toEqual(["uncategorized", "stale", "missed"]);
  });

  it("names one missed schedule in the singular", () => {
    const open = (missedSchedules: number) =>
      attentionItems(attention({ missedSchedules }), scope).find((item) => item.id === "missed")!
        .open;
    expect(open(1)).toBe("missed schedule");
    expect(open(2)).toBe("missed schedules");
  });
});

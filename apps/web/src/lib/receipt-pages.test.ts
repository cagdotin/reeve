import type { ReceiptOverview } from "@reeve/contract/catalog";
import { describe, expect, it } from "vitest";
import { nextSort } from "./insights.ts";
import {
  attentionItems,
  categoryStack,
  coverageShare,
  DEFAULT_SORT,
  deleteConsequences,
  emptyTable,
  DESCENDING_FIRST,
  flowPaths,
  listInput,
  liveStatus,
  monthDays,
  nextStep,
  NO_STORE,
  pipelineFlow,
  sameFocus,
  searchesPastRange,
  statusWords,
  storeGroup,
  topCategories,
  topStores,
  type ReceiptListState,
} from "./receipt-pages.ts";

const format = (amount: number) => (amount / 100).toFixed(2);

const status = {
  itemsTotal: 0,
  adjustmentsTotal: 0,
  expectedTotal: 1000,
  difference: 0,
  balanced: true,
  paidAmount: 1000,
  matched: true,
  categorized: true,
  applied: true,
  lineCount: 2,
  unassignedLines: 0,
  uncategorizedLines: 0,
};

describe("nextStep", () => {
  it("says how far a receipt is off", () => {
    const step = nextStep({ ...status, balanced: false, difference: -120 }, 1000, format);
    expect(step).toMatchObject({ stage: "balance", label: "1.20 off" });
  });
  it("tells no lines from lines that miss", () => {
    const step = nextStep({ ...status, balanced: false, lineCount: 0 }, 1000, format);
    expect(step.label).toBe("No lines yet");
  });
  it("asks for a payment, or says what is left of one", () => {
    const off = { ...status, matched: false };
    expect(nextStep({ ...off, paidAmount: 0 }, 1000, format).label).toBe("Link a payment");
    expect(nextStep({ ...off, paidAmount: 400 }, 1000, format).label).toBe("6.00 left to link");
    expect(nextStep({ ...off, paidAmount: 1100 }, 1000, format).label).toBe("1.00 overpaid");
  });
  it("reads a refund by size: what is left of it, and what went over", () => {
    const off = { ...status, matched: false };
    expect(nextStep({ ...off, paidAmount: -200 }, -500, format).label).toBe("3.00 left to link");
    expect(nextStep({ ...off, paidAmount: -700 }, -500, format).label).toBe("2.00 overpaid");
  });
  it("calls a zero total an error to fix, whatever else is open", () => {
    for (const open of [{ balanced: false }, { matched: false }, { lineCount: 0 }]) {
      const step = nextStep({ ...status, ...open, paidAmount: 0 }, 0, format);
      expect(step.label).toBe("Total is zero");
      expect(step.detail).toContain("can't be zero");
    }
  });
  it("counts the lines to categorize", () => {
    const off = { ...status, categorized: false };
    expect(nextStep({ ...off, uncategorizedLines: 1 }, 1000, format).label).toBe(
      "Categorize 1 line",
    );
    expect(nextStep({ ...off, uncategorizedLines: 3 }, 1000, format).label).toBe(
      "Categorize 3 lines",
    );
  });
  it("goes on to applying, then finished", () => {
    expect(nextStep({ ...status, applied: false }, 1000, format).stage).toBe("apply");
    expect(nextStep(status, 1000, format).label).toBe("Finished");
  });
  it("stops at the first step left, whatever the later flags say", () => {
    const step = nextStep({ ...status, balanced: false, difference: 5 }, 1000, format);
    expect(step.stage).toBe("balance");
  });
});

describe("statusWords", () => {
  it("keeps the words of the four flags", () => {
    expect(statusWords({ ...status, matched: false, applied: false })).toEqual([
      "Balanced",
      "Unmatched",
      "Categorized",
      "Not applied",
    ]);
  });
});

describe("liveStatus", () => {
  const receipt = {
    total: 1000,
    lines: [{ id: "a", lineTotal: 1000 }],
    adjustments: [],
    payments: [],
    status,
  } as never;
  it("follows what is being typed", () => {
    const live = liveStatus(receipt, new Map([["a", 880]]));
    expect(live).toMatchObject({ balanced: false, difference: 120, expectedTotal: 880 });
  });
  it("reads as saved with nothing typed", () => {
    expect(liveStatus(receipt, new Map())).toMatchObject({ balanced: true, difference: 0 });
  });
});

describe("pipelineFlow", () => {
  const flow = pipelineFlow({ balance: 2, match: 3, categorize: 0, apply: 1, finished: 4 });
  it("passes on what each step does not keep", () => {
    expect(flow.map((each) => [each.stage, each.arriving, each.passing])).toEqual([
      ["balance", 10, 8],
      ["match", 8, 5],
      ["categorize", 5, 5],
      ["apply", 5, 4],
      ["finished", 4, 0],
    ]);
  });
  it("draws no waiting block where nothing waits", () => {
    const paths = flowPaths(flow);
    expect(paths.width).toBe(500);
    expect(paths.waiting).toHaveLength(3);
    expect(paths.band.startsWith("M0,100")).toBe(true);
  });
  it("draws an empty flow without dividing by zero", () => {
    const empty = pipelineFlow({ balance: 0, match: 0, categorize: 0, apply: 0, finished: 0 });
    expect(flowPaths(empty).band).not.toContain("NaN");
  });
});

describe("listInput", () => {
  const base: ReceiptListState = {
    query: "",
    filters: {},
    since: "2026-08-01",
    month: null,
    focus: null,
    category: null,
    sort: DEFAULT_SORT,
    limit: 50,
  };
  it("asks for the range, sorted and limited", () => {
    expect(listInput(base)).toEqual({
      from: "2026-08-01",
      sort: "date",
      descending: true,
      limit: 50,
    });
  });
  it("lets a month replace the range", () => {
    const input = listInput({ ...base, month: "2026-02" });
    expect(input).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("searches all time, whatever the range", () => {
    const input = listInput({ ...base, query: "milk" });
    expect(input).toMatchObject({ query: "milk" });
    expect(input).not.toHaveProperty("from");
    expect(listInput({ ...base, query: "   " })).toHaveProperty("from");
  });
  it("keeps a chosen month while searching", () => {
    expect(listInput({ ...base, query: "milk", month: "2026-02" })).toMatchObject({
      from: "2026-02-01",
    });
  });
  it("keeps filters in the range", () => {
    expect(listInput({ ...base, filters: { missing: ["unmatched"] } })).toHaveProperty("from");
  });
  it("carries the status flags, stores and search", () => {
    const input = listInput({
      ...base,
      query: "  milk ",
      filters: { missing: ["unmatched", "unapplied"], store: ["p1", NO_STORE] },
    });
    expect(input).toMatchObject({
      query: "milk",
      unmatched: true,
      unapplied: true,
      payeeIds: ["p1"],
      noStore: true,
    });
    expect(input).not.toHaveProperty("unbalanced");
  });
  it("carries a step, a check and a category", () => {
    expect(listInput({ ...base, focus: { kind: "stage", stage: "match" } })).toMatchObject({
      stage: "match",
    });
    expect(listInput({ ...base, focus: { kind: "check", check: "old" } })).toMatchObject({
      check: "old",
    });
    expect(listInput({ ...base, category: { id: "c", name: "Food" } })).toMatchObject({
      itemCategoryId: "c",
    });
    expect(listInput({ ...base, category: { id: null, name: "None" } })).toMatchObject({
      noItemCategory: true,
    });
  });
});

describe("searching past the range", () => {
  const state = { query: "", since: "2026-08-01", month: null };
  it("says so only while it does", () => {
    expect(searchesPastRange({ ...state, query: "milk" })).toBe(true);
    expect(searchesPastRange(state)).toBe(false);
    expect(searchesPastRange({ ...state, query: "milk", since: undefined })).toBe(false);
    expect(searchesPastRange({ ...state, query: "milk", month: "2026-02" })).toBe(false);
  });
});

describe("emptyTable", () => {
  const state = { query: "", since: "2026-08-01", month: null };
  it("tells a search of all time from a range", () => {
    expect(emptyTable({ ...state, query: "milk" }, true, true)).toEqual({
      text: "No receipt matches, in all time.",
      offerAllTime: false,
    });
  });
  it("offers all time when filters find nothing in the range", () => {
    expect(emptyTable(state, true, true)).toEqual({
      text: "No receipt matches in this range.",
      offerAllTime: true,
    });
    expect(emptyTable(state, false, true).offerAllTime).toBe(true);
  });
  it("offers nothing with all time on, or no receipts at all", () => {
    expect(emptyTable({ ...state, since: undefined }, true, true).offerAllTime).toBe(false);
    expect(emptyTable(state, false, false).offerAllTime).toBe(false);
  });
  it("names a chosen month", () => {
    expect(emptyTable({ ...state, month: "2026-02" }, true, true).text).toContain("February 2026");
  });
});

describe("sameFocus", () => {
  it("compares by what it narrows to", () => {
    const stage = { kind: "stage", stage: "match" } as const;
    expect(sameFocus(stage, { kind: "stage", stage: "match" })).toBe(true);
    expect(sameFocus(stage, { kind: "check", check: "old" })).toBe(false);
    expect(sameFocus(null, stage)).toBe(false);
    expect(sameFocus(null, null)).toBe(true);
  });
});

describe("sorting", () => {
  it("starts money and dates high, text low", () => {
    expect(nextSort(DEFAULT_SORT, "total", DESCENDING_FIRST).descending).toBe(true);
    expect(nextSort(DEFAULT_SORT, "store", DESCENDING_FIRST).descending).toBe(false);
  });
});

describe("attentionItems", () => {
  const attention: ReceiptOverview["attention"] = {
    off: 2,
    offAmount: 340,
    noLines: 1,
    noPayment: 3,
    uncategorizedLines: 2,
    uncategorizedLineCount: 5,
    unapplied: 0,
    lineMismatch: 0,
    old: 4,
    oldDays: 30,
  };
  const items = attentionItems(attention, format);
  it("says how much is off and how many lines are left", () => {
    expect(items.find((each) => each.id === "off")?.open).toContain("3.40 off");
    expect(items.find((each) => each.id === "uncategorized")?.open).toContain("5 lines");
  });
  it("names the check each opens", () => {
    expect(items.map((each) => each.check)).toEqual([
      "off",
      "no_lines",
      "no_payment",
      "uncategorized_lines",
      "unapplied",
      "line_mismatch",
      "old",
    ]);
  });
});

describe("the cards", () => {
  it("rank what was spent and leave out refunds on balance", () => {
    const store = (name: string, spent: number) => ({
      id: name,
      name,
      spent,
      previous: 0,
      receipts: 1,
      recorded: 0,
    });
    expect(topStores([store("a", 10), store("b", -5)]).map((each) => each.name)).toEqual(["a"]);
    const category = (name: string, spent: number) => ({
      id: name,
      name,
      spent,
      previous: 0,
      lines: 1,
    });
    expect(topCategories([category("x", 0), category("y", 3)]).map((each) => each.name)).toEqual([
      "y",
    ]);
  });
  it("offers no store only when a receipt has none", () => {
    const choices = [{ id: "p", name: "Hofer" }];
    expect(storeGroup(choices, false).options).toHaveLength(1);
    expect(storeGroup(choices, true).options.at(-1)?.value).toBe(NO_STORE);
  });
  it("gives coverage as a share, or none with nothing recorded", () => {
    expect(coverageShare({ recorded: 1000, covered: 250, unlinked: 0 })).toBe(25);
    expect(coverageShare({ recorded: 1000, covered: 2500, unlinked: 0 })).toBe(100);
    expect(coverageShare({ recorded: 0, covered: 0, unlinked: 0 })).toBeNull();
  });
  it("gives a month's days", () => {
    expect(monthDays("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});

describe("categoryStack", () => {
  const month = (name: string, parts: Array<[string | null, number]>) => ({
    month: name,
    receipts: 1,
    spent: 0,
    average: 0,
    unfinished: 0,
    categories: parts.map(([id, spent]) => ({
      id,
      name: id === null ? "No item category" : id.toUpperCase(),
      spent,
    })),
  });
  it("keeps the largest five and folds the rest into Other", () => {
    const { legend, months } = categoryStack([
      month("2026-01", [
        ["a", 70],
        ["b", 60],
        ["c", 50],
        ["d", 40],
        ["e", 30],
        ["f", 20],
        ["g", 10],
      ]),
    ]);
    expect(legend.map((each) => each.name)).toEqual(["A", "B", "C", "D", "E", "Other"]);
    expect(months[0]?.parts.at(-1)).toMatchObject({ name: "Other", spent: 30 });
    expect(months[0]?.total).toBe(280);
  });
  it("names a category that is nowhere in the range's list", () => {
    const { legend } = categoryStack([month("2026-01", [["dairy", 70]])]);
    expect(legend[0]?.name).toBe("DAIRY");
  });
  it("keeps a category's slot from month to month, and draws no refund", () => {
    const { months } = categoryStack([
      month("2026-01", [
        ["a", 100],
        ["b", 10],
      ]),
      month("2026-02", [
        ["b", 20],
        ["a", -5],
      ]),
    ]);
    expect(months[1]?.parts).toEqual([{ key: "b", name: "B", slot: 1, spent: 20 }]);
    expect(months[0]?.parts.map((each) => each.slot)).toEqual([0, 1]);
  });
});

describe("deleteConsequences", () => {
  it("says an applied transaction keeps its split", () => {
    const text = deleteConsequences({ photoCount: 2, paymentCount: 1, applied: true }).join(" ");
    expect(text).toContain("keeps the split");
    expect(text).toContain("2 photos");
    expect(text).toContain("undo");
  });
  it("says a linked transaction stays as it is", () => {
    const text = deleteConsequences({ photoCount: 0, paymentCount: 2, applied: false }).join(" ");
    expect(text).toContain("2 transactions");
    expect(text).toContain("stay as they are");
  });
  it("says the ledger does not change with nothing linked", () => {
    const text = deleteConsequences({ photoCount: 0, paymentCount: 0, applied: false }).join(" ");
    expect(text).toContain("the ledger does not change");
  });
});

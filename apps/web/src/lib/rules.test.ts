import type { RuleActivity, RuleOverview } from "@reeve/contract/catalog";
import { describe, expect, it } from "vitest";
import type { Names } from "../components/rules/rule-model.ts";
import {
  actionClause,
  attentionItems,
  conditionClause,
  DEFAULT_SORT,
  DESCENDING_FIRST,
  draftForPayee,
  duplicateDraft,
  matchesRuleSearch,
  passesRuleFilters,
  problemsOf,
  registerSearchFor,
  ruleFilterGroups,
  ruleSentence,
  ruleWithConditions,
  scheduleConditions,
  sortRules,
} from "./rules.ts";
import { nextSort } from "./insights.ts";

const names: Names = {
  accounts: new Map([["checking", "Checking"]]),
  categories: new Map([
    ["food", "Food"],
    ["bills", "Bills"],
  ]),
  groups: new Map(),
  payees: new Map([
    ["grocer", "Corner Grocer"],
    ["cafe", "Cafe"],
  ]),
};
const format = (amount: number) => (amount / 100).toFixed(2);

const clean = { conflict: false, duplicate: false, quiet: false, disagrees: false, stale: [] };

const rule = (id: string, fields: Partial<RuleActivity> = {}): RuleActivity => ({
  id,
  everyAccount: true,
  stage: "default",
  conditionsOp: "and",
  conditions: [{ field: "payee", op: "is", value: "grocer" }],
  actions: [{ op: "set", field: "category", value: "food" }],
  position: 1,
  schedule: null,
  matches: 0,
  totalMatches: 0,
  lastMatch: null,
  months: [],
  categorized: 0,
  carryingCategory: 0,
  problems: clean,
  ...fields,
});

const overview = (rules: ReadonlyArray<RuleActivity>, uncategorizedPayees = 0): RuleOverview => ({
  rules,
  summary: { active: 0, transactions: 0, covered: 0, uncategorized: 0, previous: null },
  months: [],
  suggestions: [],
  suggestionCount: 0,
  uncategorizedPayees,
});

describe("a rule in words", () => {
  it("reads as one sentence with names and money", () => {
    expect(
      ruleSentence(
        rule("a", {
          conditions: [
            { field: "payee", op: "is", value: "grocer" },
            { field: "amount", op: "lt", value: -2000 },
          ],
          actions: [
            { op: "set", field: "category", value: "food" },
            { op: "append-notes", value: "weekly" },
          ],
        }),
        names,
        format,
      ),
    ).toBe(
      "If payee is Corner Grocer and amount is less than -20.00, set category to Food and add to its notes weekly",
    );
  });

  it("joins with or, and says when nothing can match", () => {
    expect(
      ruleSentence(
        rule("a", {
          conditionsOp: "or",
          conditions: [
            { field: "payee", op: "is", value: "grocer" },
            { field: "payee", op: "is", value: "cafe" },
          ],
        }),
        names,
        format,
      ),
    ).toContain("Corner Grocer or payee is Cafe");
    expect(ruleSentence(rule("a", { conditions: [] }), names, format)).toContain("never matches");
  });

  it("leaves out the value of an operator that takes none", () => {
    expect(
      conditionClause({ field: "account", op: "onBudget", value: null }, names, format),
    ).toEqual({ lead: "account is on budget", value: "" });
  });

  it("describes templates, formulas, splits and other actions", () => {
    const words = (action: Parameters<typeof actionClause>[0]) =>
      actionClause(action, names, format);
    expect(words({ op: "set", field: "notes", value: null, template: "{{payee_name}}" })).toEqual({
      lead: "set notes to the template",
      value: "{{payee_name}}",
    });
    expect(words({ op: "set", field: "amount", value: null, formula: "=amount/2" })).toEqual({
      lead: "set amount to the formula",
      value: "=amount/2",
    });
    expect(words({ op: "set", field: "category", value: "food", splitIndex: 2 }).lead).toBe(
      "set category on split 2 to",
    );
    expect(
      words({ op: "set-split-amount", splitIndex: 1, method: "fixed-percent", value: 40 }),
    ).toEqual({ lead: "give split 1 a percent of", value: "40%" });
    expect(words({ op: "set-split-amount", splitIndex: 2, method: "remainder" }).lead).toBe(
      "give split 2 what remains",
    );
    expect(words({ op: "delete-transaction" }).lead).toBe("delete it");
    expect(words({ op: "link-schedule", value: "s" }).lead).toBe("link it to its schedule");
  });

  it("marks an id it cannot name as deleted", () => {
    expect(conditionClause({ field: "payee", op: "is", value: "gone" }, names, format).value).toBe(
      "(deleted)",
    );
  });
});

describe("attention", () => {
  it("counts each check and says how to list it", () => {
    const items = attentionItems(
      overview(
        [
          rule("a", { problems: { ...clean, conflict: true } }),
          rule("b", { problems: { ...clean, conflict: true, duplicate: true } }),
          rule("c", {
            problems: {
              ...clean,
              stale: [{ state: "closed", field: "account", name: "Old" }],
            },
          }),
        ],
        2,
      ),
    );
    const byId = new Map(items.map((item) => [item.id, item]));
    expect(byId.get("conflict")?.count).toBe(2);
    expect(byId.get("duplicate")?.count).toBe(1);
    expect(byId.get("duplicate")?.open).toBe("is a duplicate");
    expect(byId.get("stale")?.filters).toEqual({ status: ["stale"] });
    expect(byId.get("quiet")?.count).toBe(0);
    expect(byId.get("uncategorized-payees")?.count).toBe(2);
    expect(byId.get("uncategorized-payees")?.filters).toBeNull();
  });

  it("explains a rule's problems plainly", () => {
    expect(problemsOf(rule("a"), names)).toEqual([]);
    const problems = problemsOf(
      rule("a", {
        categorized: 5,
        carryingCategory: 1,
        lastMatch: null,
        problems: {
          conflict: true,
          duplicate: false,
          quiet: true,
          disagrees: true,
          stale: [
            { state: "hidden", field: "category", name: "Old stuff" },
            { state: "deleted", field: "category", name: null },
          ],
        },
      }),
      names,
    );
    expect(problems.join(" ")).toContain("sets a different category");
    expect(problems.join(" ")).toContain("only 1 of its 5");
    expect(problems.join(" ")).toContain("Old stuff, which is hidden");
    expect(problems.join(" ")).toContain("a deleted category");
    expect(problems.join(" ")).toContain("match no transaction");
  });
});

describe("filters and search", () => {
  it("offers only options some rule would keep, each with its count", () => {
    const groups = ruleFilterGroups(
      [rule("a", { problems: { ...clean, duplicate: true }, matches: 3 }), rule("b")],
      {
        accounts: [{ value: "checking", label: "Checking" }],
        categories: [{ value: "food", label: "Food" }],
        payees: [{ value: "grocer", label: "Corner Grocer" }],
      },
      names,
    );
    const status = groups.find((group) => group.id === "status")?.options;
    expect(status?.map(({ value, count }) => [value, count])).toEqual([
      ["duplicate", 1],
      ["unmatched", 1],
      ["plain", 2],
    ]);
    expect(groups.some((group) => group.id === "account")).toBe(false);
    expect(groups.find((group) => group.id === "payee")?.options[0]?.count).toBe(2);
    expect(groups.find((group) => group.id === "stage")?.options).toHaveLength(1);
  });

  it("combines groups with and, values within one with or", () => {
    const one = rule("a", { stage: "pre", problems: { ...clean, quiet: true } });
    expect(passesRuleFilters(one, {})).toBe(true);
    expect(passesRuleFilters(one, { stage: ["pre", "post"] })).toBe(true);
    expect(passesRuleFilters(one, { stage: ["default"] })).toBe(false);
    expect(passesRuleFilters(one, { status: ["duplicate", "quiet"] })).toBe(true);
    expect(passesRuleFilters(one, { status: ["duplicate"] })).toBe(false);
    expect(passesRuleFilters(one, { stage: ["pre"], status: ["duplicate"] })).toBe(false);
  });

  it("keeps a payee filter from the address working on conditions and actions", () => {
    expect(passesRuleFilters(rule("a"), { payee: ["grocer"] })).toBe(true);
    expect(passesRuleFilters(rule("a"), { payee: ["cafe"] })).toBe(false);
    expect(
      passesRuleFilters(rule("b", { actions: [{ op: "set", field: "payee", value: "cafe" }] }), {
        payee: ["cafe"],
      }),
    ).toBe(true);
  });

  it("filters by what it sets", () => {
    expect(passesRuleFilters(rule("a"), { sets: ["category"] })).toBe(true);
    expect(passesRuleFilters(rule("a"), { sets: ["notes"] })).toBe(false);
    expect(passesRuleFilters(rule("a"), { setsCategory: ["food"] })).toBe(true);
    expect(passesRuleFilters(rule("a"), { setsCategory: ["bills"] })).toBe(false);
  });

  it("searches the sentence, whatever the case", () => {
    expect(matchesRuleSearch("If payee is Corner Grocer", " grocer ")).toBe(true);
    expect(matchesRuleSearch("If payee is Corner Grocer", "cafe")).toBe(false);
  });
});

describe("sorting", () => {
  const rows = [
    rule("a", { position: 2, matches: 5, lastMatch: "2026-01-01" }),
    rule("b", { position: 1, matches: 9, lastMatch: null }),
    rule("c", {
      position: 3,
      matches: 1,
      lastMatch: "2026-06-01",
      conditions: [{ field: "payee", op: "is", value: "cafe" }],
      actions: [{ op: "set", field: "category", value: "bills" }],
    }),
  ];
  const ids = (sort: Parameters<typeof sortRules>[1]) =>
    sortRules(rows, sort, names, format).map((each) => each.id);

  it("starts in run order", () => {
    expect(ids(DEFAULT_SORT)).toEqual(["b", "a", "c"]);
  });

  it("puts rules that never matched last in either direction", () => {
    expect(ids({ key: "last", descending: true })).toEqual(["c", "a", "b"]);
    expect(ids({ key: "last", descending: false })).toEqual(["a", "c", "b"]);
  });

  it("sorts by matches and by the words of each half", () => {
    expect(ids({ key: "matches", descending: true })).toEqual(["b", "a", "c"]);
    expect(ids({ key: "condition", descending: false })[0]).toBe("c");
    expect(ids({ key: "action", descending: false })[0]).toBe("c");
  });

  it("starts numbers from the most and words from the first; a second click reverses", () => {
    expect(nextSort(DEFAULT_SORT, "matches", DESCENDING_FIRST)).toEqual({
      key: "matches",
      descending: true,
    });
    expect(nextSort(DEFAULT_SORT, "condition", DESCENDING_FIRST)).toEqual({
      key: "condition",
      descending: false,
    });
    expect(nextSort(DEFAULT_SORT, "run", DESCENDING_FIRST)).toEqual({
      key: "run",
      descending: true,
    });
  });
});

describe("drafts", () => {
  it("fills in a payee and the category its transactions carry", () => {
    expect(draftForPayee("cafe", "food")).toEqual({
      stage: "default",
      conditionsOp: "and",
      conditions: [{ field: "payee", op: "is", value: "cafe" }],
      actions: [{ op: "set", field: "category", value: "food" }],
    });
    expect(draftForPayee("cafe", null).actions).toEqual([
      { op: "set", field: "category", value: null },
    ]);
  });

  it("duplicates without the id or the schedule link", () => {
    const copy = duplicateDraft(
      rule("a", {
        stage: "post",
        actions: [
          { op: "link-schedule", value: "s" },
          { op: "set", field: "notes", value: "x" },
        ],
      }),
    );
    expect(copy.id).toBeUndefined();
    expect(copy.stage).toBe("post");
    expect(copy.actions).toEqual([{ op: "set", field: "notes", value: "x" }]);
    expect(
      duplicateDraft(rule("a", { actions: [{ op: "link-schedule", value: "s" }] })).actions,
    ).toEqual([{ op: "set", field: "category", value: null }]);
  });

  it("locks the conditions a schedule reads, and no others", () => {
    const conditions = [
      { field: "payee", op: "is", value: "grocer" },
      { field: "account", op: "is", value: "checking" },
      { field: "amount", op: "isapprox", value: -100 },
      { field: "date", op: "isapprox", value: "2026-01-01" },
      { field: "notes", op: "contains", value: "x" },
      { field: "amount", op: "lt", value: 0 },
    ] as const;
    const locked = scheduleConditions(conditions);
    expect(locked.size).toBe(4);
    expect(locked.has(conditions[4])).toBe(false);
    expect(locked.has(conditions[5])).toBe(false);
  });

  it("finds another rule with the same conditions, in any order and case", () => {
    const other = rule("other", {
      conditions: [
        { field: "notes", op: "contains", value: "SHOP" },
        { field: "amount", op: "lt", value: 0 },
      ],
    });
    const same = [
      { field: "amount", op: "lt", value: 0 },
      { field: "notes", op: "contains", value: "shop" },
    ] as const;
    expect(ruleWithConditions([other], same, "and", undefined)?.id).toBe("other");
    expect(ruleWithConditions([other], same, "or", undefined)).toBeUndefined();
    expect(ruleWithConditions([other], same, "and", "other")).toBeUndefined();
    expect(ruleWithConditions([other], [], "and", undefined)).toBeUndefined();
  });
});

describe("registerSearchFor", () => {
  const conditions = (...list: RuleActivity["conditions"]) => rule("a", { conditions: list });

  it("says a payee, category and account rule in the register's filters", () => {
    expect(
      registerSearchFor(
        conditions(
          { field: "payee", op: "is", value: "grocer" },
          { field: "category", op: "oneOf", value: ["food", "bills"] },
          { field: "account", op: "is", value: "checking" },
        ),
      ),
    ).toEqual({ payees: ["grocer"], categories: ["food", "bills"], accounts: ["checking"] });
  });

  it("gives up when the register cannot say the same", () => {
    expect(registerSearchFor(conditions())).toBeNull();
    expect(registerSearchFor(conditions({ field: "payee", op: "is", value: null }))).toBeNull();
    expect(registerSearchFor(conditions({ field: "amount", op: "lt", value: 0 }))).toBeNull();
    expect(registerSearchFor(conditions({ field: "payee", op: "isNot", value: "x" }))).toBeNull();
    expect(
      registerSearchFor(
        conditions(
          { field: "payee", op: "is", value: "a" },
          { field: "payee", op: "is", value: "b" },
        ),
      ),
    ).toBeNull();
    expect(
      registerSearchFor(
        rule("a", {
          conditionsOp: "or",
          conditions: [
            { field: "payee", op: "is", value: "a" },
            { field: "category", op: "is", value: "b" },
          ],
        }),
      ),
    ).toBeNull();
  });
});

import type { LeftoverRule } from "@reeve/contract/targets";
import { describe, expect, it } from "vitest";
import { leftoverForm, leftoverRules } from "./model.ts";

describe("the leftover form", () => {
  const cases: Array<ReadonlyArray<LeftoverRule>> = [
    [],
    [{ kind: "give-back" }],
    [{ kind: "send", to: "savings" }],
    [{ kind: "pool-give", pool: "Bills" }],
    [{ kind: "receive", weight: 2 }],
    [
      { kind: "give-back" },
      { kind: "receive", weight: 1 },
      { kind: "pool-receive", pool: "Fun", weight: 3 },
      { kind: "pool-cover", pool: "Bills" },
    ],
  ];

  it.each(cases)("round-trips %j", (...rules) => {
    expect(leftoverRules(leftoverForm(rules))).toEqual(rules);
  });

  it("keeps a second destination it has no field for", () => {
    const rules: Array<LeftoverRule> = [
      { kind: "give-back" },
      { kind: "pool-give", pool: "Bills" },
    ];
    const form = leftoverForm(rules);
    expect(form.choice).toEqual({ kind: "give-back" });
    expect(leftoverRules(form)).toEqual(rules);
  });

  it("is incomplete until a send has a category and a pool a name", () => {
    const form = leftoverForm([]);
    expect(leftoverRules({ ...form, choice: { kind: "send", to: null } })).toBeNull();
    expect(leftoverRules({ ...form, choice: { kind: "pool-give", pool: " " } })).toBeNull();
    expect(leftoverRules({ ...form, choice: { kind: "keep" } })).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import type { CategoryGroup } from "@reeve/contract";
import { groupRuleCount, ruleCounts } from "./categories.ts";

describe("ruleCounts", () => {
  it("counts a rule once per category it names, in a condition or an action", () => {
    const counts = ruleCounts([
      {
        conditions: [{ field: "category", op: "oneOf", value: ["food", "fun"] }],
        actions: [{ op: "set", field: "category", value: "food" }],
      },
      {
        conditions: [{ field: "payee", op: "is", value: "food" }],
        actions: [{ op: "set", field: "category", value: "fun" }, { op: "link-schedule" }],
      },
    ]);
    expect(counts.get("food")).toBe(1);
    expect(counts.get("fun")).toBe(2);
    expect(counts.get("rent")).toBeUndefined();
  });
});

describe("groupRuleCount", () => {
  it("counts a rule once when it names the group or any of its categories", () => {
    const group = { id: "fun-group", categories: [{ id: "games" }, { id: "films" }] };
    const count = groupRuleCount(
      [
        {
          conditions: [{ field: "category", op: "oneOf", value: ["games", "films"] }],
          actions: [{ op: "set", field: "category", value: "games" }],
        },
        { conditions: [{ field: "category_group", op: "is", value: "fun-group" }], actions: [] },
        { conditions: [], actions: [{ op: "set", field: "category", value: "rent" }] },
      ],
      group as unknown as CategoryGroup,
    );
    expect(count).toBe(2);
  });
});

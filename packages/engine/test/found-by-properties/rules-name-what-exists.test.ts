import { afterEach, beforeEach, expect, it } from "vitest";
import { scratch, writeOlderRule } from "../helpers.ts";

let s: ReturnType<typeof scratch>;
let food: string;

beforeEach(async () => {
  s = scratch();
  const categories = (await s.call<Array<any>>("list_categories")).flatMap(
    (group) => group.categories,
  );
  food = categories.find((each: any) => each.name === "Food").id;
});

afterEach(() => s.dispose());

const setsNotes = [{ op: "set", field: "notes", value: "seen" }];
const namesPayee = (value: unknown) => [{ op: "is", field: "payee", value }];

it.each([
  ["payee", { conditions: namesPayee("gone"), actions: setsNotes }],
  [
    "category",
    {
      conditions: [{ op: "contains", field: "notes", value: "x" }],
      actions: [{ op: "set", field: "category", value: "gone" }],
    },
  ],
  [
    "group",
    { conditions: [{ op: "is", field: "category_group", value: "gone" }], actions: setsNotes },
  ],
  [
    "account",
    { conditions: [{ op: "oneOf", field: "account", value: ["gone"] }], actions: setsNotes },
  ],
])("refuses a rule that names a missing %s", async (_name, rule) => {
  expect((await s.fails("create_rule", rule))._tag).toBe("NotFound");
  expect(await s.call("list_rules")).toEqual([]);
});

it("still reads text conditions on id fields as text", async () => {
  const rule = await s.call("create_rule", {
    conditions: [{ op: "contains", field: "payee", value: "shop" }],
    actions: setsNotes,
  });
  expect(rule.conditions[0].value).toBe("shop");
});

it("refuses an update that names something missing", async () => {
  const rule = await s.call("create_rule", {
    conditions: [{ op: "contains", field: "notes", value: "x" }],
    actions: setsNotes,
  });
  await s.fails("update_rule", {
    id: rule.id,
    actions: [{ op: "set", field: "category", value: "gone" }],
  });
  expect((await s.call("get_rule", { id: rule.id })).actions).toEqual(setsNotes);
});

it("lets a rule from an older book be edited with the name it already had", async () => {
  const rule = await s.call("create_rule", {
    conditions: [{ op: "contains", field: "notes", value: "x" }],
    actions: [{ op: "set", field: "category", value: food }],
  });
  const stale = [{ op: "set", field: "category", value: "gone" }];
  writeOlderRule((await s.call("get_book")).file, rule.id, stale);
  const edited = await s.call("update_rule", {
    id: rule.id,
    conditions: [{ op: "contains", field: "notes", value: "y" }],
  });
  expect(edited.actions).toEqual(stale);
});

it("refuses a payee rename rule to a missing payee", async () => {
  const failure = await s.fails("create_payee_rename_rule", { fromNames: ["x"], to: "gone" });
  expect(failure._tag).toBe("NotFound");
  expect(await s.call("list_rules")).toEqual([]);
});

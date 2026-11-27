import { afterEach, beforeEach, expect, it } from "vitest";
import { scratch } from "../helpers.ts";

let s: ReturnType<typeof scratch>;

beforeEach(() => {
  s = scratch();
});

afterEach(() => s.dispose());

it("refuses a note on nothing", async () => {
  expect((await s.fails("set_note", { id: "gone", note: "lost" }))._tag).toBe("NotFound");
});

it("sets notes on an account, a category, a group and a budget month", async () => {
  const account = await s.call("create_account", { name: "Checking" });
  const [group] = await s.call<Array<any>>("list_categories");
  for (const id of [account.id, group.id, group.categories[0].id, "budget-2026-06"])
    expect((await s.call("set_note", { id, note: "kept" })).note).toBe("kept");
});

it("deletes a group's note with the group, and undo brings both back", async () => {
  const group = await s.call("create_category_group", { name: "Temporary" });
  await s.call("set_note", { id: group.id, note: "kept" });
  await s.call("delete_category_group", { id: group.id });
  await s.fails("set_note", { id: group.id, note: "again" });
  await s.call("undo");
  expect((await s.call("set_note", { id: group.id, note: "again" })).note).toBe("again");
});

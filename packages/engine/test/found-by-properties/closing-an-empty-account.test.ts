import { today } from "@reeve/contract/rules";
import { afterEach, beforeEach, expect, it } from "vitest";
import { scratch } from "../helpers.ts";

let s: ReturnType<typeof scratch>;
let empty: string;

beforeEach(async () => {
  s = scratch();
  empty = (await s.call("create_account", { name: "Empty" })).id;
});

afterEach(() => s.dispose());

const setsNotes = [{ op: "set", field: "notes", value: "seen" }];

it("takes the account out of the rules that name it, as deleting a category does", async () => {
  const needs = await s.call("create_rule", {
    conditions: [{ op: "is", field: "account", value: empty }],
    actions: setsNotes,
  });
  const moves = await s.call("create_rule", {
    conditions: [{ op: "contains", field: "notes", value: "x" }],
    actions: [{ op: "set", field: "account", value: empty }, ...setsNotes],
  });
  expect((await s.call("close_account", { id: empty })).deleted).toBe(true);
  await s.fails("get_rule", { id: needs.id });
  expect((await s.call("get_rule", { id: moves.id })).actions).toEqual(setsNotes);
  await s.call("undo");
  expect((await s.call("get_rule", { id: needs.id })).id).toBe(needs.id);
  expect((await s.call("get_rule", { id: moves.id })).actions).toHaveLength(2);
});

it("takes the account's note with it", async () => {
  await s.call("set_note", { id: empty, note: "old" });
  await s.call("close_account", { id: empty });
  await s.fails("set_note", { id: empty, note: "again" });
  await s.call("undo");
  expect((await s.call("set_note", { id: empty, note: "again" })).note).toBe("again");
});

it("keeps an account a schedule needs, closed", async () => {
  const schedule = await s.call("create_schedule", {
    account: empty,
    amount: -100,
    date: today(),
  });
  expect((await s.call("close_account", { id: empty })).deleted).toBe(false);
  const account = (await s.call("list_accounts", { closed: true })).find(
    (each: any) => each.id === empty,
  );
  expect(account.closed).toBe(true);
  expect((await s.call("get_schedule", { id: schedule.id })).id).toBe(schedule.id);
});

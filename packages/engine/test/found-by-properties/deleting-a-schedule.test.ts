import { today } from "@reeve/contract/rules";
import { afterEach, beforeEach, expect, it } from "vitest";
import { scratch } from "../helpers.ts";

let s: ReturnType<typeof scratch>;

beforeEach(() => {
  s = scratch();
});

afterEach(() => s.dispose());

it("unlinks the transactions it posted, and undo links them again", async () => {
  const account = (await s.call("create_account", { name: "Checking" })).id;
  const schedule = await s.call("create_schedule", { account, amount: -100, date: today() });
  const { id } = await s.call("post_schedule_transaction", { id: schedule.id });
  expect((await s.call("get_transaction", { id })).scheduleId).toBe(schedule.id);
  await s.call("delete_schedule", { id: schedule.id });
  expect((await s.call("get_transaction", { id })).scheduleId).toBe(null);
  await s.call("undo");
  expect((await s.call("get_transaction", { id })).scheduleId).toBe(schedule.id);
});

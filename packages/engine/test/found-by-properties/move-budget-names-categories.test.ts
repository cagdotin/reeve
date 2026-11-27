import { afterEach, beforeEach, expect, it } from "vitest";
import { scratch } from "../helpers.ts";

let s: ReturnType<typeof scratch>;

beforeEach(() => {
  s = scratch();
});

afterEach(() => s.dispose());

it.each([
  ["from", { from: "gone", to: "to-budget" }],
  ["to", { from: "to-budget", to: "gone" }],
])(
  "says a missing %s category is not found, rather than failing in storage",
  async (_side, move) => {
    const failure = await s.fails("move_budget", { month: "2026-06", amount: 100, ...move });
    expect(failure._tag).toBe("NotFound");
  },
);

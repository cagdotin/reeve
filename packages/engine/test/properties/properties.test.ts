import { currentMonth, today } from "@reeve/contract/rules";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSequence, type Tally } from "./run.ts";
import { coverage, stepArbitrary } from "./steps.ts";
import { DEFAULT_RUNS, runsOr, SEED as seed } from "./budget.ts";
import { BEYOND_UNDO, freezeClock, openWorld, thawClock, THIS_MONTH } from "./world.ts";

const MAX_STEPS = 40;
/** A run this long should see every step kind succeed; one that never does tests only its refusal. */
const LONG_RUN = 500;

const runs = runsOr(DEFAULT_RUNS);
const report = process.env["REEVE_PROPERTY_REPORT"] !== undefined;
/** The benchmark wants the first failure as it happened, not the smallest one shrinking reaches. */
const shrink = process.env["REEVE_PROPERTY_SHRINK"] !== "0";

const sequence = fc.array(stepArbitrary, { maxLength: MAX_STEPS, size: "max" });
const tally: Tally = new Map();
let steps = 0;

beforeAll(freezeClock);
afterAll(thawClock);

describe("the ledger under random operations", () => {
  it("keeps the rules after every step", { timeout: 3_600_000 }, async () => {
    await fc.assert(
      fc.asyncProperty(sequence, async (drawn) => {
        steps += drawn.length;
        await runSequence(drawn, tally);
      }),
      { numRuns: runs, seed, endOnFailure: !shrink, includeErrorInReport: true },
    );
    if (report) printReport();
    expect(runs >= LONG_RUN ? neverRan() : []).toEqual([]);
  });
});

describe("the harness", () => {
  it("lives on the fixed clock, in the date helpers and the book", async () => {
    expect(today()).toBe(`${THIS_MONTH}-15`);
    expect(currentMonth()).toBe(THIS_MONTH);
    const world = await openWorld();
    try {
      await world.call("create_account", { name: "Checking", balance: 100 });
      const [row] = world.all<{ date: number; created_at: number }>(
        "SELECT date, created_at FROM transactions",
      );
      expect(row).toEqual({ date: 20_260_615, created_at: Date.parse("2026-06-15T12:00:00Z") });
    } finally {
      await world.close();
    }
  });

  it("replays a seed exactly, down to the final database", { timeout: 120_000 }, async () => {
    const drawn = fc.sample(fc.array(stepArbitrary, { minLength: 30, maxLength: 30 }), {
      seed,
      numRuns: 1,
    })[0]!;
    const [first, second] = [await runSequence(drawn), await runSequence(drawn)];
    expect(second).toEqual(first);
    expect(first.trace).toHaveLength(30);
  });

  it("only draws write operations of the catalog", () => {
    expect(coverage().notWrites).toEqual([]);
  });

  it("records undo for every table but the bookkeeping, generated or not", async () => {
    const world = await openWorld();
    try {
      const unrecorded = world.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
           AND name NOT IN ('__migrations', 'undo_log', 'undo_state', ${BEYOND_UNDO.map((table) => `'${table}'`).join(", ")})
           AND 'undo_' || name || '_delete' NOT IN
             (SELECT name FROM sqlite_master WHERE type = 'trigger')`,
      );
      expect(unrecorded).toEqual([]);
    } finally {
      await world.close();
    }
  });
});

const neverRan = () => coverage().covered.filter((name) => (tally.get(name)?.ok ?? 0) === 0);

const printReport = () => {
  const { writes, covered, notCovered } = coverage();
  const refused = [...tally.values()].reduce((sum, each) => sum + each.refused, 0);
  const ok = [...tally.values()].reduce((sum, each) => sum + each.ok, 0);
  const lines = [
    `seed ${seed}, ${runs} runs, ${steps} drawn steps: ${ok} ran, ${refused} refused`,
    `write operations: ${covered.length} of ${writes.length} covered`,
    ...covered.map((name) => {
      const each = tally.get(name);
      return `  ${name}: ${each?.ok ?? 0} ok, ${each?.refused ?? 0} refused`;
    }),
    `not covered (${notCovered.length}): ${notCovered.join(", ")}`,
    ...[...tally].flatMap(([name, each]) =>
      [...each.reasons].map(([why, times]) => `refused ${name} x${times}: ${why}`),
    ),
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
};

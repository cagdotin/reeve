import { createHash } from "node:crypto";
import {
  clearedMarksStay,
  everyCentHasAPlace,
  mergeKeepsBothCopies,
  noRuleRefuses,
  onlyLearningRewritesRules,
  pickedCategoryStays,
  postingsOf,
  reconciledPostings,
  reconciledPostingsStay,
  referencesExist,
  refusalChangedNothing,
  restored,
  rolloverAfter,
  rolloverAsSaid,
  ruleBodies,
  RuleBroken,
  transactionsBalance,
  transferCategoriesStay,
  type Postings,
  type Reconciled,
  type Rollover,
  type RuleBodies,
} from "./rules.ts";
import {
  allTransactions,
  emptyPools,
  refreshTransactionsAfter,
  SETUP,
  STEP_KINDS,
  type Context,
  type Step,
} from "./steps.ts";
import { isRefusal, openWorld, type Dump, type World } from "./world.ts";

/** How each operation fared across a run, for the coverage report. */
export type Tally = Map<string, { ok: number; refused: number; reasons: Map<string, number> }>;

const count = (tally: Tally, op: string) => {
  const entry = tally.get(op) ?? { ok: 0, refused: 0, reasons: new Map() };
  tally.set(op, entry);
  return entry;
};

type Outcome =
  | { readonly ok: true; readonly value: any }
  | { readonly ok: false; readonly why: string };

/** Runs an operation; only a refusal comes back as an outcome. */
const attempt = async (
  world: World,
  op: string,
  input: Record<string, unknown>,
): Promise<Outcome> => {
  try {
    return { ok: true, value: await world.call(op, input) };
  } catch (error) {
    if (!isRefusal(error)) throw error;
    return { ok: false, why: `${(error as { _tag: string })._tag}: ${(error as Error).message}` };
  }
};

interface State {
  readonly dump: Dump;
  readonly reconciled: Reconciled;
  readonly postings: Postings;
  readonly rules: RuleBodies;
  /** What set_carryover said so far: it follows undo and redo along with the book. */
  readonly rollover: Rollover;
}

/**
 * The states undo and redo walk, as the book should remember them: `at` is the present. A write
 * forgets what could be redone, and one that records a step adds a state.
 */
interface Timeline {
  states: Array<State>;
  at: number;
}

const stateOf = (world: World, rollover: Rollover): State => ({
  dump: world.dump(),
  reconciled: reconciledPostings(world),
  postings: postingsOf(world),
  rules: ruleBodies(world),
  rollover,
});

const checkInvariants = async (world: World) => {
  transactionsBalance(world);
  referencesExist(world);
  await everyCentHasAPlace(world);
};

const reverse = async (world: World, op: "undo" | "redo", expected: Dump, what: string) => {
  const { done } = await world.call(op);
  if (!done) throw new RuleBroken("Rule 6: undo and redo", `${op} found nothing ${what}`);
  restored(expected, world.dump(), `${op} ${what}`);
};

/** Undo or redo as a step: it lands on the state the timeline remembers, and reverses itself. */
const walk = async (world: World, timeline: Timeline, op: "undo" | "redo", done: boolean) => {
  const present = timeline.states[timeline.at]!;
  const target = op === "undo" ? timeline.at - 1 : timeline.at + 1;
  const expected = timeline.states[target];
  if (!done) {
    if (expected !== undefined)
      throw new RuleBroken("Rule 6: undo and redo", `${op} did nothing with a step to reverse`);
    restored(present.dump, world.dump(), `${op} with nothing to reverse`);
    return;
  }
  if (expected === undefined)
    throw new RuleBroken("Rule 6: undo and redo", `${op} reversed a step no write recorded`);
  restored(expected.dump, world.dump(), `${op} to state ${target}`);
  const opposite = op === "undo" ? "redo" : "undo";
  await reverse(world, opposite, present.dump, `after the ${op}`);
  await reverse(world, op, expected.dump, `again after the ${opposite}`);
  timeline.at = target;
};

/** A write that succeeded: the rules hold after it, and undo and redo cross it exactly. */
const afterWrite = async (
  world: World,
  timeline: Timeline,
  op: string,
  input: Record<string, any>,
  result: any,
  before: State,
  stepBefore: number | null,
) => {
  const after = stateOf(world, rolloverAfter(before.rollover, op, input));
  reconciledPostingsStay(before.reconciled, after.reconciled, op, input);
  clearedMarksStay(before.postings, after.postings, before.rules, op, input);
  transferCategoriesStay(before.postings, after.postings, before.rules, op, input);
  pickedCategoryStays(world, op, input, result);
  onlyLearningRewritesRules(before.rules, after.rules, op);
  if (op === "merge_transactions") mergeKeepsBothCopies(before.postings, after.postings, input);
  await rolloverAsSaid(world, after.rollover);
  timeline.states.length = timeline.at + 1;
  const recorded = world.latestUndoStep() !== stepBefore;
  if (!recorded) {
    restored(before.dump, after.dump, `${op} recorded no undo step`);
    return;
  }
  await reverse(world, "undo", before.dump, `of ${op}`);
  await reverse(world, "redo", after.dump, `of ${op}`);
  timeline.states.push(after);
  timeline.at += 1;
};

const runStep = async (context: Context, timeline: Timeline, tally: Tally, step: Step) => {
  const { world, pools } = context;
  const kind = STEP_KINDS[step.op];
  const input = await kind.input(step.args, context);
  const before = timeline.states[timeline.at]!;
  const whole = { ...world.dump(), ...world.bookkeeping() };
  const stepBefore = world.latestUndoStep();
  const outcome = await attempt(world, step.op, input);
  const counts = count(tally, step.op);
  if (!outcome.ok) {
    counts.refused += 1;
    const reason = outcome.why.replaceAll(/[0-9a-f-]{36}|-?\d+/g, "#");
    counts.reasons.set(reason, (counts.reasons.get(reason) ?? 0) + 1);
    refusalChangedNothing(whole, world.fullDump(), step.op, outcome.why);
    await noRuleRefuses(world, step.op, input, outcome.why);
    return `${step.op} refused: ${outcome.why}`;
  }
  counts.ok += 1;
  kind.made?.(outcome.value, pools, step.args);
  if (refreshTransactionsAfter.has(step.op)) await allTransactions(context);
  if (step.op === "undo" || step.op === "redo") {
    await walk(world, timeline, step.op, outcome.value.done);
    await checkInvariants(world);
    return `${step.op} ${outcome.value.done}`;
  }
  await checkInvariants(world);
  await afterWrite(world, timeline, step.op, input, outcome.value, before, stepBefore);
  return `${step.op} ok`;
};

/** Runs a whole sequence on a fresh book; what each step did and a hash of the final database. */
export const runSequence = async (
  steps: ReadonlyArray<Step>,
  tally: Tally = new Map(),
  finish: (world: World) => Promise<void> = async () => {},
) => {
  const world = await openWorld();
  try {
    const pools = emptyPools();
    for (const group of await world.call("list_categories")) {
      pools.groups.push(group.id);
      for (const category of group.categories) pools.categories.push(category.id);
    }
    const context: Context = { world, pools };
    const timeline: Timeline = { states: [stateOf(world, new Map())], at: 0 };
    const trace: Array<string> = [];
    for (const step of SETUP) {
      const outcome = await runStep(context, timeline, tally, step);
      if (outcome.includes(" refused: ")) throw new Error(`The setup was refused: ${outcome}`);
    }
    for (const account of await world.call("list_ledger_accounts"))
      if (account.system !== null) pools.system.push(account.id);
    for (const [index, step] of steps.entries()) {
      try {
        trace.push(await runStep(context, timeline, tally, step));
      } catch (error) {
        if (error instanceof RuleBroken) error.message = `Step ${index}: ${error.message}`;
        throw error;
      }
    }
    await finish(world);
    const final = createHash("sha256").update(JSON.stringify(world.fullDump())).digest("hex");
    return { trace, final };
  } finally {
    await world.close();
  }
};

// Measures the property suite by the bugs we know (docs/rules/ledger.md, docs/testing.md).
//
//   node scripts/property-benchmark.ts [--runs 300] [--seeds 20261102,1,2] [--only K1,K2] [--jobs 4]
//     puts each known bug back on a temporary copy of this tree, one at a time, proves it is back with
//     its own test, and reports which rule of the suite catches it, after how many runs.
//
//   node scripts/property-benchmark.ts --commit b6f6571 [--runs 300] [--seeds 10]
//     runs today's suite as a whole on that commit, in a temporary git worktree, seed after seed, and
//     reports which rule fails first on each.
//
// Nothing here writes to the source tree. It exits 1 when a patch stops applying, when a proof does not
// fail, when the suite fails on the unpatched copy, or when a reachable bug is missed.
import { spawn, spawnSync } from "node:child_process";
import { availableParallelism, tmpdir } from "node:os";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_RUNS, DEFAULT_SEED } from "../packages/engine/test/properties/budget.ts";
import { KNOWN_BUGS, type KnownBug } from "../packages/engine/test/properties/known-bugs/bugs.ts";

const REPO = join(import.meta.dirname, "..");
const PROPERTIES = "packages/engine/test/properties";
const SUITE_TEST = "the ledger under random operations";

const { values: options } = parseArgs({
  options: {
    commit: { type: "string" },
    runs: { type: "string", default: "300" },
    seeds: { type: "string" },
    only: { type: "string" },
    jobs: { type: "string", default: String(Math.min(6, availableParallelism() - 1)) },
  },
});
const runs = Number(options.runs);
const jobs = Number(options.jobs);

const log = (line: string) => process.stdout.write(`${line}\n`);
class Loud extends Error {}

const temporaryFolder = () => realpathSync(mkdtempSync(join(tmpdir(), "reeve-benchmark-")));

interface TestResult {
  readonly fullName: string;
  readonly status: string;
  readonly failureMessages: ReadonlyArray<string>;
}

/** Runs Vitest on files in a copy, through its JSON report: what ran, not what it printed. */
const vitest = (
  root: string,
  files: ReadonlyArray<string>,
  env: Readonly<Record<string, string>> = {},
) =>
  new Promise<ReadonlyArray<TestResult>>((resolve, reject) => {
    const report = join(mkdtempSync(join(tmpdir(), "reeve-report-")), "report.json");
    const child = spawn(
      process.execPath,
      [
        join(root, "node_modules/vitest/vitest.mjs"),
        "run",
        ...files,
        "--reporter=json",
        `--outputFile=${report}`,
      ],
      { cwd: root, env: { ...process.env, TZ: "UTC", ...env }, stdio: "ignore" },
    );
    child.on("error", reject);
    child.on("close", () => {
      if (!existsSync(report)) return reject(new Loud(`Vitest wrote no report in ${root}`));
      const { testResults } = JSON.parse(readFileSync(report, "utf8")) as {
        testResults: ReadonlyArray<{
          message?: string;
          assertionResults: ReadonlyArray<TestResult>;
        }>;
      };
      rmSync(join(report, ".."), { recursive: true, force: true });
      const broken = testResults.find((file) => file.assertionResults.length === 0 && file.message);
      if (broken !== undefined)
        return reject(new Loud(`A test file did not load:\n${broken.message}`));
      resolve(testResults.flatMap((file) => file.assertionResults));
    });
  });

type Verdict =
  | { readonly caught: false }
  | { readonly caught: true; readonly by: string; readonly after: number };

/** The first line of what stopped the suite: a rule's name, or an operation's unexpected failure. */
const whatFailed = (message: string) => {
  const got = /\nShrunk \d+ time\(s\)\nGot (.*)/.exec(message)?.[1];
  if (got === undefined) throw new Loud(`No error in the report:\n${message.slice(0, 2000)}`);
  return /Rule \d+.*/.exec(got)?.[0] ?? `operation failed: ${got.slice(0, 90)}`;
};

/** Runs the suite alone at a seed, without shrinking: the first failure is the one reported. */
const runSuite = async (root: string, seed: number, budget: number): Promise<Verdict> => {
  const results = await vitest(root, [`${PROPERTIES}/properties.test.ts`], {
    REEVE_PROPERTY_RUNS: String(budget),
    REEVE_PROPERTY_SEED: String(seed),
    REEVE_PROPERTY_SHRINK: "0",
  });
  const suite = results.find((each) => each.fullName.includes(SUITE_TEST));
  if (suite === undefined) throw new Loud(`The suite did not run in ${root}`);
  if (suite.status === "passed") return { caught: false };
  const message = suite.failureMessages.join("\n");
  const after = /Property failed after (\d+) tests/.exec(message)?.[1];
  // A failure fast-check did not report is not a catch; the coverage check of long runs lands here.
  if (after === undefined) throw new Loud(`The suite failed by itself:\n${message.slice(0, 2000)}`);
  return { caught: true, by: whatFailed(message), after: Number(after) };
};

const proofFails = async (root: string, { proof }: KnownBug) => {
  const results = await vitest(root, [proof.file]);
  const named = results.filter((each) => each.fullName.includes(proof.test));
  if (named.length === 0) throw new Loud(`No test named "${proof.test}" in ${proof.file}`);
  return named.some((each) => each.status === "failed");
};

const copyTree = (root: string) => {
  const skipped = new Set(["dist", "release", ".vite", ".turbo"]);
  cpSync(join(REPO, "packages"), join(root, "packages"), {
    recursive: true,
    verbatimSymlinks: true,
    filter: (source) => !skipped.has(source.split("/").at(-1)!),
  });
  for (const file of ["package.json", "pnpm-workspace.yaml", "tsconfig.json", "vitest.config.ts"])
    cpSync(join(REPO, file), join(root, file));
  // The packages' own node_modules link relatively: to each other inside the copy, so a patch is what
  // the tests load, and to the store through this one link.
  symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));
};

const gitApply = (root: string, patch: string, ...flags: ReadonlyArray<string>) =>
  spawnSync("git", ["apply", ...flags, join(root, PROPERTIES, "known-bugs", patch)], {
    cwd: root,
    encoding: "utf8",
  });

interface BugResult {
  readonly bug: KnownBug;
  readonly verdicts: ReadonlyArray<Verdict>;
}

/** Puts a bug back on a copy, proves it, measures the suite against it, and takes it out again. */
const measure = async (root: string, bug: KnownBug, seeds: ReadonlyArray<number>) => {
  const applied = gitApply(root, bug.patch);
  if (applied.status !== 0)
    throw new Loud(`${bug.id}: ${bug.patch} no longer applies:\n${applied.stderr}`);
  // A failure here ends the whole run, and the copy goes with it; the source tree never had the bug.
  if (!(await proofFails(root, bug)))
    throw new Loud(`${bug.id}: ${bug.patch} applied, but "${bug.proof.test}" still passes`);
  const verdicts: Array<Verdict> = [];
  for (const seed of seeds) verdicts.push(await runSuite(root, seed, runs));
  const reverted = gitApply(root, bug.patch, "-R");
  if (reverted.status !== 0) throw new Loud(`${bug.id}: could not take it out of the copy`);
  return { bug, verdicts };
};

const table = (rows: ReadonlyArray<ReadonlyArray<string>>) => {
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => row[column]!.length)));
  return rows
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column]!))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
};

const benchmarkKnownBugs = async () => {
  const seeds = (options.seeds ?? String(DEFAULT_SEED)).split(",").map(Number);
  const wanted = options.only?.split(",");
  const bugs = KNOWN_BUGS.filter((bug) => wanted === undefined || wanted.includes(bug.id));
  const roots = Array.from({ length: Math.min(jobs, bugs.length) }, temporaryFolder);
  try {
    for (const root of roots) copyTree(root);
    log(`Clean copy: the suite at ${runs} runs on seed(s) ${seeds.join(", ")}, and every proof.`);
    const clean = await Promise.all(seeds.map((seed) => runSuite(roots[0]!, seed, runs)));
    const failing = clean.find((verdict) => verdict.caught);
    if (failing !== undefined)
      throw new Loud(`The suite fails with no bug put back: ${JSON.stringify(failing)}`);
    for (const file of new Set(bugs.map((bug) => bug.proof.file))) {
      const results = await vitest(roots[0]!, [file]);
      const bad = results.find((each) => each.status === "failed");
      if (bad !== undefined) throw new Loud(`A proof fails with no bug: ${bad.fullName}`);
    }
    log(`Clean. Now ${bugs.length} bugs, ${jobs} at a time.\n`);

    const queue = [...bugs];
    const results: Array<BugResult> = [];
    await Promise.all(
      roots.map(async (root) => {
        for (let bug = queue.shift(); bug !== undefined; bug = queue.shift()) {
          const result = await measure(root, bug, seeds);
          results.push(result);
          log(`  ${bug.id}: done`);
        }
      }),
    );
    results.sort((a, b) => bugs.indexOf(a.bug) - bugs.indexOf(b.bug));

    const rows = results.map(({ bug, verdicts }) => {
      const caught = verdicts.flatMap((each) => (each.caught ? [each] : []));
      const first = verdicts[0]!;
      return [
        bug.id,
        caught.length === 0
          ? bug.unreachable === undefined
            ? "MISSED"
            : "unreachable"
          : caught.length === verdicts.length
            ? "caught"
            : `caught on ${caught.length}/${verdicts.length}`,
        verdicts.map((each) => (each.caught ? String(each.after) : "-")).join(" "),
        first.caught && first.after <= DEFAULT_RUNS ? "yes" : "no",
        caught[0]?.by.slice(0, 80) ?? "",
      ];
    });
    log(
      `\n${table([["bug", "result", `runs to catch, per seed (budget ${runs})`, `first seed within ${DEFAULT_RUNS}`, "first caught by"], ...rows])}\n`,
    );
    for (const bug of bugs) log(`${bug.id}: ${bug.bug}`);
    const missed = results.filter(
      ({ bug, verdicts }) => bug.unreachable === undefined && verdicts.some((each) => !each.caught),
    );
    const unreachable = results.filter(({ bug }) => bug.unreachable !== undefined);
    for (const { bug } of unreachable) log(`\n${bug.id} is unreachable: ${bug.unreachable}.`);
    const caught = results.filter(({ verdicts }) => verdicts.some((each) => each.caught));
    log(`\nCaught ${caught.length} of ${results.length}. Every patch applied and its test failed.`);
    return missed.length === 0;
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
};

/** What b6f6571 does not know, taken out at the door there: the suite itself stays as it is. */
const INPUTS_IT_DOES_NOT_KNOW = ["confirmReconciled"];

const adaptSuite = (root: string) => {
  const world = join(root, PROPERTIES, "world.ts");
  const text = readFileSync(world, "utf8");
  const door = "    call: home.call,\n";
  if (!text.includes(door)) throw new Loud(`${door.trim()} is no longer in world.ts`);
  writeFileSync(
    world,
    text.replace(
      door,
      `    call: (name: string, input: Record<string, unknown> = {}) =>
      home.call(name, Object.fromEntries(Object.entries(input).filter(
        ([key]) => !${JSON.stringify(INPUTS_IT_DOES_NOT_KNOW)}.includes(key),
      ))),\n`,
    ),
  );
};

const benchmarkCommit = async (commit: string) => {
  const seedCount = Number(options.seeds ?? 10);
  const seeds = Array.from({ length: seedCount }, (_, index) => DEFAULT_SEED + index);
  const root = temporaryFolder();
  const shell = (command: string, args: ReadonlyArray<string>, cwd: string) => {
    const done = spawnSync(command, args, { cwd, encoding: "utf8" });
    if (done.status !== 0)
      throw new Loud(`${command} ${args.join(" ")} failed:\n${done.stdout}\n${done.stderr}`);
  };
  try {
    log(`A worktree of ${commit} at ${root}.`);
    rmSync(root, { recursive: true, force: true });
    shell("git", ["worktree", "add", "--detach", root, commit], REPO);
    shell("pnpm", ["install", "--frozen-lockfile", "--prefer-offline"], root);
    rmSync(join(root, PROPERTIES), { recursive: true, force: true });
    cpSync(join(REPO, PROPERTIES), join(root, PROPERTIES), {
      recursive: true,
      filter: (source) => !source.endsWith("known-bugs"),
    });
    adaptSuite(root);
    // fast-check came after that commit.
    const fastCheck = join(root, "node_modules/fast-check");
    if (!existsSync(fastCheck))
      symlinkSync(realpathSync(join(REPO, "node_modules/fast-check")), fastCheck);
    log(`Today's suite, ${runs} runs at most, ${seeds.length} seeds:\n`);
    const queue = [...seeds];
    const rows: Array<Array<string>> = [];
    const firsts = new Map<string, number>();
    await Promise.all(
      Array.from({ length: Math.min(jobs, seeds.length) }, async () => {
        for (let seed = queue.shift(); seed !== undefined; seed = queue.shift()) {
          const verdict = await runSuite(root, seed, runs);
          const by = verdict.caught ? verdict.by.replace(/^(Rule \d+).*/, "$1") : "nothing";
          firsts.set(by, (firsts.get(by) ?? 0) + 1);
          rows.push([
            String(seed),
            verdict.caught ? String(verdict.after) : "-",
            verdict.caught ? verdict.by.slice(0, 90) : "passed",
          ]);
        }
      }),
    );
    rows.sort((a, b) => Number(a[0]) - Number(b[0]));
    log(table([["seed", "after runs", "first failure"], ...rows]));
    log(`\nFirst failures: ${[...firsts].map(([by, n]) => `${by} x${n}`).join(", ")}`);
    return true;
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", root], { cwd: REPO });
    spawnSync("git", ["worktree", "prune"], { cwd: REPO });
    rmSync(root, { recursive: true, force: true });
  }
};

const main = async () => {
  const started = Date.now();
  const fine =
    options.commit === undefined
      ? await benchmarkKnownBugs()
      : await benchmarkCommit(options.commit);
  log(`\n${Math.round((Date.now() - started) / 1000)} s.`);
  process.exitCode = fine ? 0 : 1;
};

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Loud ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

/**
 * The repo's rules that lint and the tests cannot express. Each check returns its violations;
 * `pnpm check:rules` fails when any has one. RULES.md (docs/rules/README.md) indexes the rules.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const git = (...args: Array<string>) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const walk = (dir: string, keep: (path: string) => boolean): Array<string> =>
  readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(path, keep);
    return keep(path) ? [path] : [];
  });

const GENERATED = [
  "packages/contract/src/routes.gen.ts",
  ".agents/skills/reeve/SKILL.md",
  "packages/engine/src/db/migrations.gen.ts",
];
const MIGRATIONS = "packages/engine/drizzle";

const fingerprint = () => {
  const files = [...GENERATED, ...walk(MIGRATIONS, () => true)];
  return new Map(
    files.map((file) => [file, createHash("sha1").update(read(file)).digest("hex")] as const),
  );
};

const generatedInSync = () => {
  const before = fingerprint();
  execFileSync("pnpm", ["--silent", "catalog:generate"], { cwd: root, stdio: "ignore" });
  execFileSync("pnpm", ["--silent", "db:generate"], { cwd: root, stdio: "ignore" });
  const after = fingerprint();
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((file) => before.get(file) !== after.get(file))
    .map((file) => `${file} was stale; the generator rewrote it, so commit the result`);
};

const committedMigrationsUnchanged = () => {
  const changed = (range: Array<string>) =>
    git("diff", "--name-only", "--diff-filter=MD", ...range, "--", MIGRATIONS)
      .split("\n")
      .filter((file) => file !== "" && !file.endsWith("meta/_journal.json"));
  const base = (() => {
    try {
      return git("merge-base", "HEAD", "origin/master");
    } catch {
      return undefined;
    }
  })();
  return [...new Set([...changed(["HEAD"]), ...(base ? changed([`${base}...HEAD`]) : [])])].map(
    (file) => `${file} is a committed migration: write a new one with pnpm db:generate instead`,
  );
};

const effectPinnedExactly = () =>
  ["package.json", ...walk("packages", isManifest), ...walk("apps", isManifest)].flatMap((file) => {
    const manifest = JSON.parse(read(file)) as Record<string, Record<string, string> | undefined>;
    return ["dependencies", "devDependencies", "peerDependencies"].flatMap((field) =>
      Object.entries(manifest[field] ?? {})
        .filter(([name, version]) => /^(effect|@effect\/)/.test(name) && !/^\d/.test(version))
        .map(([name, version]) => `${file}: ${name} is "${version}"; pin Effect to one version`),
    );
  });
const isManifest = (path: string) => path.endsWith("/package.json");

const ACCOUNTS_TAB_DIALOGS = new Set([
  "apps/web/src/components/payees/payee-dialogs.tsx",
  "apps/web/src/components/payees/suggested-merges.tsx",
  "apps/web/src/components/register/account-menu.tsx",
  "apps/web/src/components/register/import-dialog.tsx",
  "apps/web/src/components/rules/account-suggestions.tsx",
  "apps/web/src/components/rules/rule-dialogs.tsx",
  "apps/web/src/components/rules/rule-suggestions.tsx",
  "apps/web/src/components/schedules/schedule-dialogs.tsx",
]);

const accountsTabsEditInThePane = () =>
  ["payees", "rules", "schedules", "register"]
    .flatMap((dir) => walk(`apps/web/src/components/${dir}`, (path) => path.endsWith(".tsx")))
    .filter((file) => /<Dialog\b/.test(read(file)) && !ACCOUNTS_TAB_DIALOGS.has(file))
    .map(
      (file) =>
        `${file} opens a Dialog: details and create/edit forms on the Accounts tabs go in SplitPanel; ` +
        "only a confirmation, merge, import or suggestion list is a dialog (allowlist in scripts/check-rules.ts)",
    );

const onePageAlert = () =>
  walk("apps/web/src", (path) => /\.tsx?$/.test(path))
    .filter((file) => read(file).includes('role="alert"'))
    .map(
      (file) => `${file} sets role="alert": say it through PageAlert (components/page-alert.tsx)`,
    );

const DOCS = () => [
  "AGENTS.md",
  "README.md",
  ...walk("docs", (path) => path.endsWith(".md")),
  ...walk(".agents/skills/based", (path) => path.endsWith(".md")),
];

const docLinksResolve = () =>
  DOCS()
    .filter((file) => existsSync(join(root, file)))
    .flatMap((file) =>
      [...read(file).matchAll(/\]\(([^)\s]+)\)/g)]
        .map((match) => match[1]!.split("#")[0]!)
        .filter((target) => target !== "" && !/^[a-z]+:/.test(target))
        .filter((target) => !existsSync(resolve(root, dirname(file), target)))
        .map((target) => `${file} links to ${target}, which does not exist`),
    );

const grep = (...args: Array<string>) => {
  try {
    return git("grep", ...args);
  } catch {
    return "";
  }
};

const noDecisionNumbers = () =>
  grep(
    "--untracked",
    "-nE",
    String.raw`[Dd]ecisions? [0-9]{4}|decisions/[0-9]{4}`,
    "--",
    ".",
    ":!pnpm-lock.yaml",
  )
    .split("\n")
    .filter((line) => line !== "" && !line.startsWith("scripts/check-rules.ts"))
    .map((line) => `${line.slice(0, 140)}: name the rules file instead (RULES.md lists them)`);

const rulesIndexed = () => {
  const index = read("RULES.md");
  return walk("docs/rules", (path) => path.endsWith(".md") && !path.endsWith("README.md"))
    .filter((file) => !index.includes(`](${relative("docs/rules", file)})`))
    .map((file) => `${file} has no row in RULES.md (docs/rules/README.md)`);
};

const CHECKS: Record<string, () => Array<string>> = {
  "generated files match their sources": generatedInSync,
  "committed migrations never change": committedMigrationsUnchanged,
  "Effect is pinned to one version": effectPinnedExactly,
  "Accounts tabs edit in the pane": accountsTabsEditInThePane,
  "PageAlert is the page's only alert": onePageAlert,
  "doc links resolve": docLinksResolve,
  "no decision numbers": noDecisionNumbers,
  "every rules file is in RULES.md": rulesIndexed,
};

const only = process.argv.slice(2);
let failed = 0;
for (const [name, check] of Object.entries(CHECKS)) {
  if (only.length > 0 && !only.some((word) => name.includes(word))) continue;
  const violations = check();
  console.log(`${violations.length === 0 ? "ok  " : "FAIL"} ${name}`);
  for (const violation of violations) console.log(`     ${violation}`);
  failed += violations.length;
}
if (failed > 0) process.exit(1);

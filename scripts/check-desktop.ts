// Guards the desktop bundle, which `pnpm check` otherwise never runs: builds the web app and
// apps/desktop, fails when a bundle loads a module it does not carry (a require or import of
// anything but a Node builtin, electron, or ws's optional add-ons), then starts the bundled server
// and CLI from a folder outside the repo, where no node_modules can hide a missing dependency.
import { execFile, execFileSync, spawn } from "node:child_process";
import { builtinModules } from "node:module";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseSync } from "oxc-parser";

const root = join(import.meta.dirname, "..");
const dist = join(root, "apps/desktop/dist");
const webDir = join(root, "apps/web/dist");
const started = Date.now();

const fail = (message: string): never => {
  console.error(`check-desktop: ${message}`);
  process.exit(1);
};

// ---------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------

await Promise.all(
  ["@reeve/web", "@reeve/desktop"].map((filter) =>
    promisify(execFile)("pnpm", ["--filter", filter, "build"], { cwd: root }).catch(
      (error: { stdout: string; stderr: string }) =>
        fail(`${filter} does not build:\n${error.stdout}${error.stderr}`),
    ),
  ),
);

// ---------------------------------------------------------------------------------------------
// What the bundles load
// ---------------------------------------------------------------------------------------------

/** Optional native add-ons ws tries in a try/catch and does without. */
const OPTIONAL = new Set(["bufferutil", "utf-8-validate"]);
const builtins = new Set(builtinModules);
const bundles: Record<string, { readonly electron: boolean }> = {
  "main.mjs": { electron: true },
  "preload.cjs": { electron: true },
  "server.mjs": { electron: false },
  "cli.mjs": { electron: false },
};

const allowed = (specifier: string, electron: boolean) =>
  specifier.startsWith("node:") ||
  builtins.has(specifier) ||
  OPTIONAL.has(specifier) ||
  (electron && specifier === "electron");

type Node = { readonly type?: string; readonly [key: string]: unknown };

const literal = (node: unknown) => {
  const value = (node as Node | undefined)?.type === "Literal" ? (node as Node)["value"] : null;
  return typeof value === "string" ? value : null;
};

/**
 * A call that loads a module by name: `require("x")` under any name the bundler gave it
 * (`__require`, `require$1`), `require.resolve("x")`, or `createRequire(...)("x")`.
 */
const isRequire = (callee: Node): boolean =>
  (callee.type === "Identifier" && /require/i.test(String(callee["name"]))) ||
  (callee.type === "MemberExpression" &&
    isRequire(callee["object"] as Node) &&
    (callee["property"] as Node)["name"] === "resolve") ||
  (callee.type === "CallExpression" && isRequire(callee["callee"] as Node)) ||
  (callee.type === "ParenthesizedExpression" && isRequire(callee["expression"] as Node));

/** Every module name the code loads, statically or at run time. */
const loads = (code: string, file: string) => {
  const { program, errors } = parseSync(file, code);
  if (errors.length > 0) fail(`${file} does not parse: ${errors[0]?.message}`);
  const found = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const { type } = node as Node;
    let specifier: string | null = null;
    if (
      type === "ImportDeclaration" ||
      type === "ExportAllDeclaration" ||
      type === "ExportNamedDeclaration" ||
      type === "ImportExpression"
    )
      specifier = literal((node as Node)["source"]);
    else if (type === "CallExpression" && isRequire((node as Node)["callee"] as Node))
      specifier = literal(((node as Node)["arguments"] as Array<unknown>)[0]);
    if (specifier !== null) found.add(specifier);
    for (const value of Object.values(node)) if (typeof value === "object") visit(value);
  };
  visit(program);
  return found;
};

const strays: Array<string> = [];
for (const [file, { electron }] of Object.entries(bundles)) {
  for (const specifier of loads(readFileSync(join(dist, file), "utf8"), file))
    if (!allowed(specifier, electron)) strays.push(`${file} loads "${specifier}"`);
}
if (strays.length > 0)
  fail(
    `the desktop bundle loads modules it does not include, which fail when Electron starts:\n  ${strays.join("\n  ")}\nImport them statically so tsdown bundles them (see packages/engine/src/rschedule.ts).`,
  );

// ---------------------------------------------------------------------------------------------
// Smoke start
// ---------------------------------------------------------------------------------------------

const scratch = mkdtempSync(join(tmpdir(), "reeve-check-desktop-"));
const home = join(scratch, "home");
for (const file of ["server.mjs", "cli.mjs"]) copyFileSync(join(dist, file), join(scratch, file));

const recurrence = { start: "2026-01-15", frequency: "monthly", interval: 1, count: 3 };
const MONTHLY = "Every month on the 15th";

const smokeServer = async () => {
  const child = spawn(process.execPath, [join(scratch, "server.mjs")], {
    cwd: scratch,
    env: { ...process.env, REEVE_HOME: home, REEVE_PORT: "0", REEVE_WEB_DIR: webDir },
    stdio: ["ignore", "inherit", "pipe", "ipc"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("did not listen within 20 s")), 20_000);
      child.once("message", (message: { listening?: string; message?: string }) => {
        clearTimeout(timeout);
        if (message.listening === undefined) reject(new Error(message.message));
        else resolve(message.listening);
      });
      void exited.then((code) => reject(new Error(`exited (${code}) before it listened`)));
    });
    const index = await fetch(new URL("/", url));
    if (!index.ok || !(await index.text()).includes('<div id="root">'))
      throw new Error(`GET / did not serve the web app (${index.status})`);
    const preview = await fetch(new URL("/api/books/~/schedules/preview-recurrence", url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(recurrence),
    });
    const body = (await preview.json()) as { description?: string; dates?: Array<string> };
    if (!preview.ok || body.description !== MONTHLY || body.dates?.length !== 3)
      throw new Error(`preview_recurrence answered ${preview.status} ${JSON.stringify(body)}`);
  } catch (error) {
    child.kill("SIGKILL");
    fail(`the bundled server failed: ${(error as Error).message}\n${stderr}`);
  }
  child.kill("SIGTERM");
  if ((await exited) !== 0) fail(`the bundled server did not close cleanly\n${stderr}`);
};

const smokeCli = () => {
  try {
    const out = execFileSync(
      process.execPath,
      [
        join(scratch, "cli.mjs"),
        ...["schedules", "preview", "--start", recurrence.start, "--frequency", "monthly"],
        "--json",
      ],
      { cwd: scratch, env: { ...process.env, REEVE_HOME: home }, encoding: "utf8" },
    );
    if (!out.includes(MONTHLY)) throw new Error(`printed ${out}`);
  } catch (error) {
    fail(`the bundled CLI failed: ${(error as Error).message}`);
  }
};

try {
  await smokeServer();
  smokeCli();
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(
  `check-desktop: bundles load only builtins; server and CLI start (${Date.now() - started} ms)`,
);

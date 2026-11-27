import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    webDir: string;
  }
}

/** Builds the web app once into a temporary folder, which every test's server serves. */
export default function setup(project: TestProject) {
  const given = process.env["REEVE_E2E_WEB_DIR"];
  if (given !== undefined && given !== "") {
    project.provide("webDir", given);
    return;
  }
  const webDir = mkdtempSync(join(tmpdir(), "reeve-e2e-web-"));
  execFileSync(
    "pnpm",
    [
      "--filter",
      "@reeve/web",
      "exec",
      "vite",
      "build",
      "--outDir",
      webDir,
      "--emptyOutDir",
      "--logLevel",
      "error",
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  project.provide("webDir", webDir);
  return () => rmSync(webDir, { recursive: true, force: true });
}

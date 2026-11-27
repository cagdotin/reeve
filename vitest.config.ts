import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

const scratchHome = mkdtempSync(join(tmpdir(), "reeve-vitest-home-"));

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/src/**/*.test.{ts,tsx}"],
    // Code that resolves the home on import (the CLI, the server) lands here, never in the real one.
    env: { REEVE_HOME: scratchHome, XDG_CONFIG_HOME: scratchHome },
  },
});

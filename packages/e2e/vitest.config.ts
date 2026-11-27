import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["test/**/*.e2e.ts"],
    globalSetup: ["src/global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Each file runs its own Chromium and servers: more workers overload the machine and time out.
    maxWorkers: 4,
  },
});

import { resolve } from "node:path";
import { defineConfig, mergeConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";
import base from "./vitest.config.ts";

const packages = resolve(import.meta.dirname, "packages");
const isPropertySuite = (spec: TestSpecification) => spec.moduleId.includes("/test/properties/");

/** With bail, a mutant stops at its first failing test, so the slowest file should run last. */
class PropertySuiteLast extends BaseSequencer {
  override async sort(files: TestSpecification[]) {
    const sorted = await super.sort(files);
    return [...sorted.filter((f) => !isPropertySuite(f)), ...sorted.filter(isPropertySuite)];
  }
}

export default mergeConfig(
  base,
  defineConfig({
    resolve: {
      // Stryker links each package's node_modules from the real tree, so without these an import of
      // @reeve/contract or @reeve/engine reaches unmutated source and its mutants look untested.
      alias: [
        { find: /^@reeve\/contract$/, replacement: `${packages}/contract/src/domain.ts` },
        { find: /^@reeve\/contract\/(.+)$/, replacement: `${packages}/contract/src/$1.ts` },
        { find: /^@reeve\/engine$/, replacement: `${packages}/engine/src/index.ts` },
      ],
    },
    test: {
      exclude:
        process.env["REEVE_MUTATION_PROPERTIES"] === "0"
          ? ["packages/engine/test/properties/**"]
          : [],
      sequence: { sequencer: PropertySuiteLast },
    },
  }),
);

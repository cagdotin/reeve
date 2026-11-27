/**
 * rschedule with the standard date adapter. Its subpath entry points are folders with a
 * package.json, which Node's ESM loader cannot resolve, so this imports the CommonJS builds by
 * file; a static import also lets the desktop app's bundler include them.
 */
import "@rschedule/standard-date-adapter/umd/setup.js";
import generators from "@rschedule/core/umd/generators.js";

export const { Schedule } = generators;

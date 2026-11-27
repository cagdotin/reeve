// The CommonJS builds `rschedule.ts` imports by file, typed as the entry points they build.
declare module "@rschedule/standard-date-adapter/umd/setup.js" {}
declare module "@rschedule/core/umd/generators.js" {
  const generators: typeof import("@rschedule/core/generators");
  export default generators;
}

/** Runs in `pnpm test`, sized to about 15 s; `pnpm test:properties` asks for more. */
export const DEFAULT_RUNS = 75;
export const DEFAULT_SEED = 20_261_102;

const seedSetting = process.env["REEVE_PROPERTY_SEED"];

/** The fixed seed, unless `REEVE_PROPERTY_SEED` names another or asks for `random`. */
export const SEED =
  seedSetting === "random"
    ? Math.floor(Math.random() * 2 ** 31)
    : Number(seedSetting ?? DEFAULT_SEED);

/** A property's own budget, unless `REEVE_PROPERTY_RUNS` asks for another. */
export const runsOr = (fallback: number) => Number(process.env["REEVE_PROPERTY_RUNS"] ?? fallback);

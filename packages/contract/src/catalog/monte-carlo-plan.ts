import { Schema } from "effect";
import { Id } from "../domain.ts";

const Fraction = Schema.Number.annotate({ description: "A decimal fraction: 0.06 is 6%" });
const optional = <S extends Schema.Top>(schema: S) => Schema.optionalKey(schema);
const Age = Schema.NullOr(Schema.Number);

const AllocationPreset = Schema.Literals([
  "equity-100",
  "equity-80",
  "equity-60",
  "equity-40",
  "cash",
  "custom-mix",
  "custom",
]);

const investmentFields = {
  allocationPreset: optional(AllocationPreset),
  allocationStocks: optional(Fraction),
  allocationBonds: optional(Fraction),
  allocationCash: optional(Fraction),
  expectedReturnMean: optional(Fraction),
  returnStdDev: optional(Fraction),
  annualFeeFixed: optional(Schema.Number),
  feeAdjustsWithInflation: optional(Schema.Boolean),
  annualFeeRate: optional(Fraction),
};

const MonteCarloPot = Schema.Struct({
  id: Schema.String,
  name: optional(Schema.String),
  startingBalance: optional(Schema.Number),
  ...investmentFields,
  accessAge: optional(Age),
  accountId: optional(Schema.NullOr(Id)).annotate({
    description: "An account whose balance is the pot's starting balance",
  }),
  withdrawalTaxRate: optional(Fraction),
  taxableFraction: optional(Fraction),
  isSurplus: optional(Schema.Boolean),
  investmentPhases: optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        fromAge: optional(Schema.Number),
        transition: optional(Schema.Literals(["at-once", "gradual"])),
        ...investmentFields,
      }),
    ),
  ),
});

/** A Monte Carlo widget's plan, as Actual's `MonteCarloWidget` meta stores it. */
export const monteCarloPlanFields = {
  pots: optional(Schema.Array(MonteCarloPot)),
  withdrawalStrategy: optional(
    Schema.Literals(["proportional", "sequential", "best-performer", "target-mix"]),
  ),
  returnModel: optional(
    Schema.Literals([
      "normal",
      "historical-bootstrap",
      "historical-block-bootstrap",
      "historical-sequence",
    ]),
  ),
  withdrawalRule: optional(
    Schema.Struct({
      type: Schema.Literals(["none", "guardrails", "ratcheting", "floor-ceiling", "boundaries"]),
      prosperityTriggerPct: optional(Schema.Number),
      prosperityIncreasePct: optional(Schema.Number),
      preservationTriggerPct: optional(Schema.Number),
      preservationCutPct: optional(Schema.Number),
      balanceThresholdMultiple: optional(Schema.Number),
      consecutiveYears: optional(Schema.Number),
      ratchetIncreasePct: optional(Schema.Number),
      floorPct: optional(Schema.Number),
      ceilingPct: optional(Schema.Number),
      upperRateThreshold: optional(Schema.Number),
      upperCutPct: optional(Schema.Number),
      lowerRateThreshold: optional(Schema.Number),
      lowerIncreasePct: optional(Schema.Number),
    }),
  ),
  minimumSpending: optional(Schema.Number),
  spendingPhases: optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: optional(Schema.String),
        fromAge: optional(Age),
        annualWithdrawal: optional(Schema.Number),
      }),
    ),
  ),
  contributions: optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: optional(Schema.String),
        potId: optional(Schema.String),
        fromAge: optional(Age),
        toAge: optional(Age),
        annualAmount: optional(Schema.Number),
        adjustsWithInflation: optional(Schema.Boolean),
        sourceIncomeStreamId: optional(Schema.NullOr(Schema.String)),
        beforeTax: optional(Schema.Boolean),
      }),
    ),
  ),
  incomeStreams: optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: optional(Schema.String),
        fromAge: optional(Age),
        toAge: optional(Age),
        annualAmount: optional(Schema.Number),
        adjustsWithInflation: optional(Schema.Boolean),
        taxRate: optional(Fraction),
        taxableFraction: optional(Fraction),
      }),
    ),
  ),
  inflationMean: optional(Schema.NullOr(Fraction)),
  inflationStdDev: optional(Fraction),
  taxModel: optional(Schema.Literals(["flat", "bands"])),
  taxBands: optional(
    Schema.Array(
      Schema.Struct({ id: Schema.String, from: optional(Schema.Number), rate: optional(Fraction) }),
    ),
  ),
  currentAge: optional(Schema.Number),
  targetAge: optional(Schema.Number),
  simulationCount: optional(Schema.Int),
  historicalBlockLength: optional(Schema.Number),
};

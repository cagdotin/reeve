/**
 * Actual's Monte Carlo report, run in the engine: the widget's plan with each account-linked pot
 * at its account's balance (Actual's `useResolvedMonteCarloConfig`), simulated by
 * `@reeve/contract/monte-carlo`, and its runs ranked worst first.
 */
import {
  getMonteCarloHorizonYears,
  monteCarloConfigFromMeta,
  rankSimulationsWorstFirst,
  runMonteCarloSimulation,
  type MonteCarloConfig,
  type MonteCarloMeta,
} from "@reeve/contract/monte-carlo";
import type { Book } from "../book.ts";

export interface MonteCarloInput extends MonteCarloMeta {
  readonly seed?: number | undefined;
  readonly captureRunDetail?: number | undefined;
  readonly todaysMoney?: boolean | undefined;
}

const DEFAULT_SEED = 1234;

/** The plan with each linked pot at its account's balance, never below zero. */
const resolveLinkedPots = (book: Book, config: MonteCarloConfig): MonteCarloConfig => {
  const linked = config.pots.flatMap((pot) => (pot.accountId == null ? [] : [pot.accountId]));
  if (linked.length === 0) return config;
  const balances = new Map(
    (
      book.client
        .prepare(
          `SELECT a.id, coalesce(sum(p.amount), 0) AS balance FROM accounts a
           LEFT JOIN postings p ON p.account_id = a.id
           WHERE a.id IN (${linked.map(() => "?").join(", ")}) GROUP BY a.id`,
        )
        .all(...linked) as Array<{ id: string; balance: number }>
    ).map((row) => [row.id, row.balance]),
  );
  return {
    ...config,
    pots: config.pots.map((pot) => {
      const balance = pot.accountId == null ? undefined : balances.get(pot.accountId);
      return balance === undefined ? pot : { ...pot, startingBalance: Math.max(0, balance) };
    }),
  };
};

export const monteCarloReport = (book: Book, input: MonteCarloInput) => {
  const { seed, captureRunDetail, todaysMoney, ...meta } = input;
  const config = resolveLinkedPots(book, monteCarloConfigFromMeta(meta));
  const result = runMonteCarloSimulation({
    ...config,
    horizonYears: getMonteCarloHorizonYears(config),
    seed: seed ?? DEFAULT_SEED,
    deflateToTodaysMoney: todaysMoney ?? true,
    ...(captureRunDetail === undefined ? {} : { captureRunDetail }),
  });
  return {
    config,
    successRate: result.successRate,
    percentileBands: result.percentileBands,
    depletionHistogram: result.depletionHistogram,
    depletionProbabilityByYear: result.depletionProbabilityByYear,
    medianEndingBalance: result.medianEndingBalance,
    medianTotalWithdrawn: result.medianTotalWithdrawn,
    medianDepletionYear: result.medianDepletionYear,
    earliestDepletionYear: result.earliestDepletionYear,
    latestDepletionYear: result.latestDepletionYear,
    worstRunPath: result.worstRunPath,
    endingBalances: [...result.endingBalances],
    depletionYearBySimulation: [...result.depletionYearBySimulation],
    totalWithdrawnBySimulation: [...result.totalWithdrawnBySimulation],
    rankedRuns: rankSimulationsWorstFirst(result.endingBalances, result.depletionYearBySimulation),
    ...(result.runDetail === undefined ? {} : { runDetail: result.runDetail }),
    simulationCount: result.simulationCount,
    horizonYears: result.horizonYears,
  };
};

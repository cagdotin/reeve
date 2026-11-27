import type { projections } from "@reeve/contract/catalog";
import type { DomainHandlers } from "../handler.ts";
import { balanceForecastReport } from "./balance-forecast.ts";
import { monteCarloReport, type MonteCarloInput } from "./monte-carlo.ts";

/** The projection reports: balance forecast and Monte Carlo. */
export const projectionHandlers = {
  balance_forecast_report: (book, input) => balanceForecastReport(book, input),
  // The catalog's arrays are readonly; the simulation never changes them.
  monte_carlo_report: (book, input) => monteCarloReport(book, input as MonteCarloInput),
} satisfies DomainHandlers<typeof projections>;

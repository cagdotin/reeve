import type { MonteCarloReport } from "@reeve/contract/catalog";
import {
  HISTORICAL_YEARS,
  monteCarloConfigFromMeta,
  type MonteCarloConfig,
  type MonteCarloMeta,
  type MonteCarloRunDetailRow,
} from "@reeve/contract/monte-carlo";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useChoices } from "@/components/reports/choices";
import { Choice, Segmented } from "@/components/reports/controls";
import { monteCarloInput } from "@/components/reports/inputs";
import {
  GRAPH_VIEWS,
  RUN_PERCENTILES,
  type MonteCarloGraphView,
} from "@/components/reports/monte-carlo/charts";
import { MonteCarloConfiguration } from "@/components/reports/monte-carlo/configuration";
import {
  MonteCarloCashflowGraph,
  MonteCarloGraph,
  MonteCarloHistogram,
  MonteCarloPotBalancesGraph,
} from "@/components/reports/monte-carlo/graphs";
import { MonteCarloRunDetail, MonteCarloRunsTable } from "@/components/reports/monte-carlo/runs";
import { QueryBody } from "@/components/page";
import { ReportLoading, ReportShell } from "@/components/reports/report-shell";
import {
  type Saver,
  prepareSaver,
  reportMeta,
  useReportState,
  useSavedReport,
  validateReportSearch,
} from "@/components/reports/report-state";
import { Money } from "@/components/money";
import { Checkbox } from "@reeve/ui/components/checkbox";
import { cn } from "@reeve/ui/lib/utils";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";

export const Route = createFileRoute("/reports/monte-carlo")({
  validateSearch: validateReportSearch,
  component: MonteCarloPage,
});

function MonteCarloPage() {
  const { report: id } = Route.useSearch();
  const saved = useSavedReport<MonteCarloMeta>("monte-carlo", id);
  if (saved.loading) return <ReportLoading name="Monte Carlo Analysis" query={saved.query} />;
  const initial = reportMeta<MonteCarloMeta>(saved.report);
  return <MonteCarlo key={saved.report?.id ?? "new"} initial={initial} saver={saved.saver} />;
}

type ResultsView = "chart" | "cashflow" | "pots" | "runs";

const VIEW_NOTES: Record<Exclude<MonteCarloGraphView, "all">, (count: number) => string> = {
  "single-worst": (count) =>
    `The unluckiest of all ${count} simulated runs - the one that ran out of money earliest.`,
  "worst-case": () => "95% of scenarios stayed above this line.",
  pessimistic: () => "70% of scenarios stayed above this line.",
  median: () => "Half of scenarios stayed above this line.",
  optimistic: () => "30% of scenarios stayed above this line.",
};

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      {children}
    </div>
  );
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("grid min-w-0 gap-3 rounded-xl border p-4", className)}>
      {children}
    </section>
  );
}

function ModelNote({ model }: { model: MonteCarloConfig["returnModel"] }) {
  const years = `${HISTORICAL_YEARS.first}-${HISTORICAL_YEARS.last}`;
  switch (model) {
    case "normal":
      return (
        <p>
          Keep in mind this is a simplified model: returns are drawn independently each year from a
          normal distribution, which ignores sequence-of-returns clustering and fat tails, and fees
          and taxes are modeled only as accurately as the rates you enter. Treat the results as a
          rough guide, not a guarantee.
        </p>
      );
    case "historical-bootstrap":
      return (
        <p>
          Returns are actual US market years ({years}, S&amp;P 500 / 10-year Treasuries / T-bills,
          Damodaran data) drawn in random order for each pot&apos;s allocation mix. Each sampled
          year brings its own actual US inflation with it, so high-inflation markets stay
          high-inflation. Real crash years are included, but multi-year momentum is lost by
          shuffling, fees and taxes are only as accurate as the rates you enter, and US history has
          been unusually good, so results may be optimistic for globally diversified portfolios.
        </p>
      );
    case "historical-block-bootstrap":
      return (
        <p>
          Each scenario chains together blocks of consecutive actual US market years ({years},
          S&amp;P 500 / 10-year Treasuries / T-bills, Damodaran data): each year usually carries on
          to the next real year, and now and then jumps to a different point in history, wrapping
          around the end of the data. Each year brings its own actual US inflation with it. Crashes
          keep the years that followed them within a block, but patterns are broken where blocks
          join, fees and taxes are only as accurate as the rates you enter, and US history may be
          optimistic for globally diversified portfolios.
        </p>
      );
    default:
      return (
        <p>
          Each scenario replays actual US market history ({years}, S&amp;P 500 / 10-year Treasuries
          / T-bills, Damodaran data) starting from a different year, wrapping around the end of the
          data. Each replayed year brings its own actual US inflation with it. This preserves real
          crashes and recoveries, but there are only as many scenarios as start years, fees and
          taxes are only as accurate as the rates you enter, and US history may be optimistic for
          globally diversified portfolios.
        </p>
      );
  }
}

function MonteCarlo({ initial, saver }: { initial: MonteCarloMeta; saver: Saver<MonteCarloMeta> }) {
  const { id: book } = useBook();
  const queryClient = useQueryClient();
  const { accounts } = useChoices(book);
  const accountItems = accounts
    .filter((account) => !account.closed)
    .map((account) => ({ value: account.id, label: account.name }));
  const [todaysMoney, setTodaysMoney] = useState(true);

  const { meta, set, save } = useReportState<MonteCarloMeta>(
    {
      ...(initial.name === undefined ? {} : { name: initial.name }),
      ...monteCarloConfigFromMeta(initial),
    },
    {},
    // Actual saves the resolved plan, so linked pots keep their latest balance as a fallback
    prepareSaver(saver, (next) => ({
      ...initial,
      ...next,
      pots: resolvedPots(
        next,
        queryClient.getQueryData(
          bookQuery(book, "monte_carlo_report", monteCarloInput(next, { todaysMoney })).queryKey,
        )?.config,
      ),
    })),
  );
  const config = monteCarloConfigFromMeta(meta);
  const input = monteCarloInput(meta, { todaysMoney });
  const result = useQuery({
    ...bookQuery(book, "monte_carlo_report", input),
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });

  return (
    <ReportShell
      name={meta.name || "Monte Carlo Analysis"}
      onRename={saver.update ? (name) => set({ name }) : undefined}
      save={save}
      controls={
        // oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the checkbox inside is the control.
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            aria-label="Show values in today's money"
            checked={todaysMoney}
            onCheckedChange={setTodaysMoney}
          />
          Show values in today&apos;s money
        </label>
      }
    >
      <MonteCarloConfiguration
        config={{
          ...config,
          pots: resolvedPots(config, result.data?.config) as MonteCarloConfig["pots"],
        }}
        accounts={accountItems}
        onChange={(changes) => set(changes)}
      />
      <QueryBody query={result}>
        {(data) => (
          <Results
            data={data}
            config={config}
            fetching={result.isPlaceholderData || result.isFetching}
          >
            <ResultsPanel
              data={data}
              meta={meta}
              todaysMoney={todaysMoney}
              fetching={result.isPlaceholderData}
            />
          </Results>
        )}
      </QueryBody>
    </ReportShell>
  );
}

/** The plan's pots with each linked pot at the balance the last run resolved it to. */
const resolvedPots = (
  meta: MonteCarloMeta,
  resolved: { pots?: ReadonlyArray<unknown> } | undefined,
) => {
  const balances = new Map(
    ((resolved?.pots ?? []) as MonteCarloConfig["pots"]).map((pot) => [
      pot.id,
      pot.startingBalance,
    ]),
  );
  return (meta.pots ?? []).map((pot) =>
    pot.accountId == null || !balances.has(pot.id ?? "")
      ? pot
      : { ...pot, startingBalance: balances.get(pot.id ?? "")! },
  );
};

/** The headline figures, the results panel, when plans ran out, and how the simulation works. */
function Results({
  data,
  config,
  fetching,
  children,
}: {
  data: MonteCarloReport;
  config: MonteCarloConfig;
  fetching: boolean;
  children: ReactNode;
}) {
  const startAge = config.currentAge;
  const endAge = startAge + data.horizonYears;
  const successPercent = Math.round(data.successRate * 1000) / 10;
  const depletionPercent = Math.round((1 - data.successRate) * 1000) / 10;
  const failedCount = data.depletionHistogram.reduce((sum, entry) => sum + entry.count, 0);
  const successColor =
    data.successRate >= 0.75
      ? "text-success-foreground"
      : data.successRate >= 0.5
        ? "text-warning-foreground"
        : "text-destructive-foreground";
  return (
    <>
      <Panel className={cn("transition-opacity", fetching && "opacity-60")}>
        <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
          <Stat label="Success rate">
            <span className={cn("text-3xl font-semibold tabular-nums", successColor)}>
              {`${successPercent}%`}
            </span>
          </Stat>
          <Stat label="Median ending balance">
            <Money amount={Math.round(data.medianEndingBalance)} className="text-lg font-medium" />
          </Stat>
          <Stat label="Median total withdrawn">
            <Money amount={Math.round(data.medianTotalWithdrawn)} className="text-lg font-medium" />
          </Stat>
          <Stat label="Chance of running out of money">
            <span className="text-lg font-medium tabular-nums">{`${depletionPercent}%`}</span>
          </Stat>
          {data.medianDepletionYear !== null && (
            <Stat label="Typical failure runs out at">
              <span className="text-lg font-medium">
                {`Age ${startAge + data.medianDepletionYear - 1}`}
              </span>
            </Stat>
          )}
        </div>
        <p className="text-sm">
          {`In ${successPercent}% of ${data.simulationCount} simulated scenarios, your pot lasted until age ${endAge}.`}
        </p>
      </Panel>
      {children}
      <Panel>
        <h2 className="text-sm font-semibold">When did the pot run out?</h2>
        {failedCount > 0 ? (
          <>
            <p className="text-sm text-muted-foreground">
              {`Only the ${failedCount} of ${data.simulationCount} scenarios that ran out of money are shown here - the other ${data.simulationCount - failedCount} kept a positive balance for the full horizon.`}
            </p>
            <MonteCarloHistogram
              histogram={data.depletionHistogram}
              startAge={startAge}
              medianDepletionYear={data.medianDepletionYear}
              simulationCount={data.simulationCount}
            />
            <p className="text-sm text-muted-foreground">
              {`Worst case: money ran out at age ${startAge + (data.earliestDepletionYear ?? 1) - 1}. Among failures, the typical depletion age was ${startAge + (data.medianDepletionYear ?? 1) - 1}; the luckiest failure lasted until age ${startAge + (data.latestDepletionYear ?? 1) - 1}.`}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            The pot survived the full time horizon in every simulated scenario.
          </p>
        )}
      </Panel>
      <Panel className="text-sm text-muted-foreground [&_p]:max-w-prose">
        <h2 className="text-sm font-semibold text-foreground">How does this simulation work?</h2>
        <p>
          Each scenario replays your retirement with a different sequence of yearly investment
          returns. Every year, any income arrives and any contributions are paid in at the start -
          some of them out of that income; the income then pays for the year&apos;s spending first
          and the withdrawal covers the rest; anything left unspent is saved into the Surplus cash
          pot for later years when the plan keeps one, and otherwise leaves the plan; and then each
          pot grows or shrinks with that year&apos;s return. Pots with an access age stay invested
          but can&apos;t fund withdrawals until you reach it - if the accessible pots can&apos;t
          cover what a year&apos;s spending still needs, the plan counts as having run out, even if
          locked pots still hold money. The shaded bands show the range of outcomes across all
          scenarios: the darker band covers the middle half, and the lighter band covers 80% of
          them.
        </p>
        <ModelNote model={config.returnModel} />
        <p>
          The simulation runs in reeve&apos;s engine with a fixed seed, so the same plan always
          gives the same results; agents can run it too, as the monte_carlo_report operation.
        </p>
      </Panel>
    </>
  );
}

const VIEW_TITLES: Record<ResultsView, string> = {
  chart: "Portfolio performance",
  cashflow: "Cashflow",
  pots: "Pot balances",
  runs: "Simulation runs",
};

const RUN_NOTES = {
  cashflow:
    "Money flowing in and out each year of this simulated run: withdrawals and income above zero; planned spending, tax, contributions and money saved into the surplus pot below.",
  pots: "What each pot was worth at the end of every year of this simulated run, stacked to the plan's total - locked pots and the surplus pot included.",
};

interface RunProps {
  data: MonteCarloReport;
  meta: MonteCarloMeta;
  todaysMoney: boolean;
  fetching: boolean;
}

/**
 * One run, re-simulated with its detail captured (runs are seeded, so this reproduces it exactly):
 * its cashflow, its pot balances, or both above its year-by-year table.
 */
function SingleRun({
  data,
  meta,
  todaysMoney,
  fetching,
  runIndex,
  show,
  onBack,
}: RunProps & {
  runIndex: number;
  show: "cashflow" | "pots" | "detail";
  onBack?: () => void;
}) {
  const { id: book } = useBook();
  const detail = useQuery({
    ...bookQuery(
      book,
      "monte_carlo_report",
      monteCarloInput(meta, { todaysMoney, captureRunDetail: runIndex }),
    ),
    enabled: !fetching,
    staleTime: Infinity,
  });
  return (
    <QueryBody
      query={{
        data: detail.data?.runDetail as MonteCarloRunDetailRow[] | undefined,
        error: detail.error,
      }}
    >
      {(rows) => (
        <RunViews rows={rows} data={data} runIndex={runIndex} show={show} onBack={onBack} />
      )}
    </QueryBody>
  );
}

function RunViews({
  rows,
  data,
  runIndex,
  show,
  onBack,
}: {
  rows: MonteCarloRunDetailRow[];
  data: MonteCarloReport;
  runIndex: number;
  show: "cashflow" | "pots" | "detail";
  onBack: (() => void) | undefined;
}) {
  const resolved = data.config as MonteCarloConfig;
  const startAge = resolved.currentAge;
  const cashflow = (
    <MonteCarloCashflowGraph
      rows={rows}
      pots={resolved.pots}
      startAge={startAge}
      contributions={resolved.contributions}
      incomeStreams={resolved.incomeStreams}
      spendingPhases={resolved.spendingPhases}
    />
  );
  const potBalances = (
    <MonteCarloPotBalancesGraph rows={rows} pots={resolved.pots} startAge={startAge} />
  );
  if (show === "cashflow") return cashflow;
  if (show === "pots") return potBalances;
  return (
    <MonteCarloRunDetail
      rows={rows}
      simulationIndex={runIndex}
      simulationCount={data.simulationCount}
      depletionYear={data.depletionYearBySimulation[runIndex] ?? -1}
      startAge={startAge}
      charts={
        <>
          {cashflow}
          {potBalances}
        </>
      }
      onBack={onBack ?? (() => undefined)}
    />
  );
}

/** Every run ranked, or the one picked from them; a pick expires when the plan changes. */
function Runs({ data, meta, todaysMoney, fetching }: RunProps) {
  const plan = JSON.stringify(monteCarloConfigFromMeta(meta));
  const [selected, setSelected] = useState<{ plan: string; index: number } | null>(null);
  if (selected === null || selected.plan !== plan)
    return (
      <MonteCarloRunsTable
        rankedRuns={data.rankedRuns}
        endingBalances={data.endingBalances}
        depletionYearBySimulation={data.depletionYearBySimulation}
        totalWithdrawnBySimulation={data.totalWithdrawnBySimulation}
        startAge={(data.config as MonteCarloConfig).currentAge}
        onSelectRun={(index) => setSelected({ plan, index })}
      />
    );
  return (
    <SingleRun
      data={data}
      meta={meta}
      todaysMoney={todaysMoney}
      fetching={fetching}
      runIndex={selected.index}
      show="detail"
      onBack={() => setSelected(null)}
    />
  );
}

/** The results: the fan chart, one run's cashflow or pot balances, or every run ranked. */
function ResultsPanel(props: RunProps) {
  const { data, fetching } = props;
  const [graphView, setGraphView] = useState<MonteCarloGraphView>("all");
  const [resultsView, setResultsView] = useState<ResultsView>("chart");
  // Which run the single-run views chart, as a percentile of the worst-first ranking
  const [scenarioPercentile, setScenarioPercentile] = useState("0.5");
  const scenarioRun =
    data.rankedRuns[Math.round(Number(scenarioPercentile) * (data.simulationCount - 1))] ?? 0;
  const singleRun = resultsView === "cashflow" || resultsView === "pots";
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">{VIEW_TITLES[resultsView]}</h2>
          <Segmented
            label="Results view"
            items={[
              { value: "chart", label: "Chart" },
              { value: "cashflow", label: "Cashflow" },
              { value: "pots", label: "Pots" },
              { value: "runs", label: "Runs" },
            ]}
            value={resultsView}
            onChange={setResultsView}
          />
        </div>
        {resultsView === "chart" && (
          <Choice label="Scenario" items={GRAPH_VIEWS} value={graphView} onChange={setGraphView} />
        )}
        {singleRun && (
          <Choice
            label="Run"
            items={RUN_PERCENTILES}
            value={scenarioPercentile}
            onChange={setScenarioPercentile}
          />
        )}
      </div>
      {resultsView === "chart" && (
        <>
          {graphView !== "all" && (
            <p className="text-sm text-muted-foreground">
              {VIEW_NOTES[graphView](data.simulationCount)}
            </p>
          )}
          <MonteCarloGraph
            bands={data.percentileBands}
            startAge={(data.config as MonteCarloConfig).currentAge}
            worstRunPath={data.worstRunPath}
            view={graphView}
            fetching={fetching}
          />
        </>
      )}
      {singleRun && (
        <>
          <p className="text-sm text-muted-foreground">{RUN_NOTES[resultsView]}</p>
          <SingleRun {...props} runIndex={scenarioRun} show={resultsView} />
        </>
      )}
      {resultsView === "runs" && <Runs {...props} />}
    </Panel>
  );
}

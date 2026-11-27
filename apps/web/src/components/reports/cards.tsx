import type { CustomReport } from "@reeve/contract/catalog";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Money } from "@/components/money";
import { cn } from "@reeve/ui/lib/utils";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import { scopeInput } from "@/lib/report-scope";
import { Headline, WidgetQuery, type WidgetBodyProps } from "./card-body";
import { ForecastGraph, SeriesSummary } from "./balance-forecast";
import { CalendarMonth } from "./calendar";
import { CashFlowGraph } from "./cash-flow";
import { CrossoverGraph } from "./crossover";
import { CustomGraph } from "./custom-graphs";
import { type GraphType } from "./custom-options";
import {
  balanceForecastInput,
  calendarInput,
  cashFlowInput,
  crossoverInput,
  monteCarloInput,
  netWorthInput,
  spendingInput,
  summaryInput,
} from "./inputs";
import { Markdown } from "./markdown";
import {
  formulaText,
  rangeLabel,
  summaryContent,
  type BalanceForecastMeta,
  type CalendarMeta,
  type CashFlowMeta,
  type CrossoverMeta,
  type FormulaMeta,
  type MarkdownMeta,
  type MonteCarloMeta,
  type NetWorthMeta,
  type SpendingMeta,
  type SummaryMeta,
} from "./meta";
import { MonteCarloGraph } from "./monte-carlo/graphs";
import { NetWorthGraph } from "./net-worth";
import { SpendingGraph } from "./spending";
import { comparisonLabel, spendingDifference } from "./spending-math";

export function NetWorthBody({ meta, scope }: WidgetBodyProps<NetWorthMeta>) {
  const { id: book } = useBook();
  const report = useQuery({
    ...bookQuery(book, "net_worth_report", { ...netWorthInput(meta), ...scopeInput(scope) }),
    placeholderData: keepPreviousData,
  });
  return (
    <WidgetQuery query={report}>
      {(data) => (
        <>
          <Headline
            sub={
              <>
                <Money amount={data.totalChange} tone="balance" className="font-sans" /> ·{" "}
                {rangeLabel(data.start, data.end)}
              </>
            }
          >
            <Money amount={data.netWorth} tone="none" className="font-sans" />
          </Headline>
          <NetWorthGraph
            report={data}
            mode={meta.mode}
            compact
            className="grid min-h-0 flex-1 grid-rows-[0_1fr]"
          />
        </>
      )}
    </WidgetQuery>
  );
}

export function CashFlowBody({ meta, scope }: WidgetBodyProps<CashFlowMeta>) {
  const { id: book } = useBook();
  const report = useQuery({
    ...bookQuery(book, "cash_flow_report", { ...cashFlowInput(meta), ...scopeInput(scope) }),
    placeholderData: keepPreviousData,
  });
  return (
    <WidgetQuery query={report}>
      {(data) => (
        <>
          <Headline sub={rangeLabel(data.start, data.end)}>
            <Money
              amount={data.totalIncome + data.totalExpenses + data.totalTransfers}
              tone="balance"
              className="font-sans"
            />
          </Headline>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>
              Income <Money amount={data.totalIncome} tone="none" className="text-foreground" />
            </span>
            <span>
              Expenses <Money amount={data.totalExpenses} tone="none" className="text-foreground" />
            </span>
          </div>
          <CashFlowGraph
            report={data}
            showBalance={false}
            compact
            className="grid min-h-0 flex-1 grid-rows-[0_1fr]"
          />
        </>
      )}
    </WidgetQuery>
  );
}

export function SpendingBody({ meta, scope }: WidgetBodyProps<SpendingMeta>) {
  const { id: book, format } = useBook();
  const mode = meta.mode ?? "single-month";
  const report = useQuery({
    ...bookQuery(book, "spending_report", { ...spendingInput(meta), ...scopeInput(scope) }),
    placeholderData: keepPreviousData,
  });
  return (
    <WidgetQuery query={report}>
      {(data) => {
        const difference = spendingDifference(data, mode);
        return (
          <>
            <Headline sub={`than ${comparisonLabel(mode, data).toLowerCase()}`}>
              {difference === 0
                ? "Spent the same"
                : `Spent ${format(Math.abs(difference))} ${difference > 0 ? "more" : "less"}`}
            </Headline>
            <SpendingGraph
              report={data}
              mode={mode}
              compact
              className="grid min-h-0 flex-1 grid-rows-[0_1fr]"
            />
          </>
        );
      }}
    </WidgetQuery>
  );
}

/** A summary's value: money, or a percentage. */
export function SummaryValue({
  value,
  percentage,
  size,
}: {
  value: number;
  percentage: boolean;
  size?: number | undefined;
}) {
  const { format } = useBook();
  return (
    <span
      className={cn("leading-tight font-semibold", value < 0 && "text-destructive-foreground")}
      style={{ fontSize: size ?? 28 }}
    >
      {percentage
        ? `${(Math.round(value * 100) / 100).toLocaleString()}%`
        : format(Math.round(value))}
    </span>
  );
}

export function SummaryBody({ meta, fontSize, scope }: WidgetBodyProps<SummaryMeta>) {
  const { id: book } = useBook();
  const content = summaryContent(meta);
  const report = useQuery({
    ...bookQuery(book, "summary_report", { ...summaryInput(meta), ...scopeInput(scope) }),
    placeholderData: keepPreviousData,
  });
  return (
    <WidgetQuery query={report}>
      {(data) => (
        <div className="flex flex-1 flex-col items-center justify-center gap-1">
          <SummaryValue
            value={data.total}
            percentage={content.type === "percentage"}
            size={fontSize ?? 20}
          />
          <span className="text-xs text-muted-foreground">{rangeLabel(data.start, data.end)}</span>
        </div>
      )}
    </WidgetQuery>
  );
}

export function CalendarBody({ meta, scope }: WidgetBodyProps<CalendarMeta>) {
  const { id: book } = useBook();
  const report = useQuery({
    ...bookQuery(book, "calendar_report", { ...calendarInput(meta), ...scopeInput(scope) }),
    placeholderData: keepPreviousData,
  });
  return (
    <WidgetQuery query={report}>
      {(data) => (
        <div className="grid min-h-0 flex-1 auto-cols-[minmax(10rem,1fr)] grid-flow-col gap-4 overflow-hidden">
          {data.months.toReversed().map((month) => (
            <CalendarMonth key={month.month} month={month} compact />
          ))}
        </div>
      )}
    </WidgetQuery>
  );
}

export function CrossoverBody({ meta }: WidgetBodyProps<CrossoverMeta>) {
  const { id: book } = useBook();
  const report = useQuery({
    ...bookQuery(book, "crossover_report", crossoverInput(meta)),
    placeholderData: keepPreviousData,
  });
  return (
    <WidgetQuery query={report}>
      {(data) => (
        <>
          <Headline
            sub={
              data.crossoverMonth === null
                ? "No crossover in the projection"
                : `Crossover ${data.crossoverMonth}`
            }
          >
            {data.yearsToRetire === null
              ? "—"
              : `${Math.round(data.yearsToRetire * 10) / 10} years to go`}
          </Headline>
          <CrossoverGraph report={data} compact className="grid min-h-0 flex-1 grid-rows-[0_1fr]" />
        </>
      )}
    </WidgetQuery>
  );
}

export function BalanceForecastBody({ meta, scope }: WidgetBodyProps<BalanceForecastMeta>) {
  const { id: book, book: info } = useBook();
  const report = useQuery({
    ...bookQuery(book, "balance_forecast_report", {
      ...balanceForecastInput(meta, info.settings.budgetType === "tracking"),
      ...scopeInput(scope),
    }),
    placeholderData: keepPreviousData,
  });
  return (
    <WidgetQuery query={report}>
      {(data) => {
        const comparison = data.lines.some((line) => line.name !== "");
        const ending = data.lines[0]?.endingPoint;
        const lowest = data.lines[0]?.lowestPoint;
        return (
          <>
            {comparison ? (
              <div className="min-h-0 shrink overflow-hidden">
                <span className="text-xs text-muted-foreground">
                  {rangeLabel(data.start, data.end)}
                </span>
                <SeriesSummary lines={data.lines} compact />
              </div>
            ) : (
              <Headline
                sub={
                  <>
                    {rangeLabel(data.start, data.end)}
                    {lowest && ending && lowest.date !== ending.date && (
                      <>
                        {" · Low "}
                        <Money amount={lowest.balance} className="font-sans" />
                      </>
                    )}
                  </>
                }
              >
                {ending ? <Money amount={ending.balance} className="font-sans" /> : "—"}
              </Headline>
            )}
            {data.chartData.length > 0 ? (
              <ForecastGraph
                report={data}
                yAxisBase={meta.yAxisBase}
                compact
                className="min-h-0 flex-1"
              />
            ) : (
              <p className="text-xs text-muted-foreground">No transactions in this forecast.</p>
            )}
          </>
        );
      }}
    </WidgetQuery>
  );
}

export function MonteCarloBody({ meta }: WidgetBodyProps<MonteCarloMeta>) {
  const { id: book } = useBook();
  const report = useQuery({
    ...bookQuery(book, "monte_carlo_report", monteCarloInput(meta, { todaysMoney: true })),
    staleTime: Infinity,
  });
  return (
    <WidgetQuery query={report}>
      {(data) => (
        <>
          <Headline
            sub={`Success rate to age ${(data.config.currentAge ?? 60) + data.horizonYears}`}
          >
            {`${Math.round(data.successRate * 1000) / 10}%`}
          </Headline>
          <MonteCarloGraph
            bands={data.percentileBands}
            startAge={data.config.currentAge ?? 60}
            compact
            className="min-h-0 flex-1"
          />
        </>
      )}
    </WidgetQuery>
  );
}

export function FormulaBody({ meta, fontSize }: WidgetBodyProps<FormulaMeta>) {
  const { id: book } = useBook();
  const formula = meta.formula ?? "=0";
  const result = useQuery({
    ...bookQuery(book, "evaluate_formula", {
      formula,
      queries: (meta.queries ?? {}) as Record<string, never>,
    }),
    placeholderData: keepPreviousData,
  });
  return (
    <WidgetQuery query={result}>
      {(data) => (
        <div className="flex flex-1 items-center justify-center">
          {data.error !== null ? (
            <span className="text-xs text-destructive-foreground">{data.error}</span>
          ) : (
            <span className="font-semibold" style={{ fontSize: fontSize ?? 28 }}>
              {formulaText(data.result)}
            </span>
          )}
        </div>
      )}
    </WidgetQuery>
  );
}

type CustomSettings = Pick<CustomReport, "mode" | "graphType" | "groupBy" | "balanceType">;

export function CustomBody({ meta, reportId, scope }: WidgetBodyProps<CustomSettings>) {
  const { id: book } = useBook();
  const report = useQuery({
    ...bookQuery(book, "run_custom_report", { id: reportId ?? "", ...scopeInput(scope) }),
    enabled: reportId !== undefined,
    placeholderData: keepPreviousData,
  });
  return (
    <WidgetQuery query={report}>
      {(data) => (
        <>
          <span className="text-xs text-muted-foreground">{rangeLabel(data.start, data.end)}</span>
          <div className="min-h-0 flex-1">
            <CustomGraph
              report={data}
              mode={meta.mode ?? "total"}
              graph={(meta.graphType ?? "BarGraph") as GraphType}
              groupBy={meta.groupBy ?? "Category"}
              balanceType={meta.balanceType ?? "Payment"}
              compact
            />
          </div>
        </>
      )}
    </WidgetQuery>
  );
}

export function MarkdownBody({ meta }: WidgetBodyProps<MarkdownMeta>) {
  return <Markdown source={meta.content ?? ""} align={meta.text_align} />;
}

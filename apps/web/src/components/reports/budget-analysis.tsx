import type { BudgetAnalysisReport } from "@reeve/contract/catalog";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import -- the reports routes are code-split, so recharts loads only with them.
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Money } from "@/components/money";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import { categoryAxis, gridProps, valueAxis } from "./axes";
import { Headline, WidgetQuery, type WidgetBodyProps } from "./card-body";
import { ChartBox, ChartLegend } from "./chart-parts";
import { slot, useChartTheme } from "./chart-theme";
import { budgetAnalysisInput } from "./inputs";
import { intervalLabel, rangeLabel, type BudgetAnalysisMeta } from "./meta";
import { seriesTooltip } from "./series-tooltip";

const NAMES = {
  budgeted: "Budgeted",
  spent: "Spent",
  overspendingAdjustment: "Overspending adjustment",
  balance: "Balance",
};

/**
 * Per month what was budgeted, spent and reset as overspending, as bars or lines, with the running
 * balance as a line.
 */
export function BudgetAnalysisGraph({
  report,
  graphType = "Bar",
  showBalance = true,
  balanceOnly = false,
  compact = false,
  fetching,
  className,
}: {
  report: BudgetAnalysisReport;
  graphType?: "Bar" | "Line" | undefined;
  showBalance?: boolean | undefined;
  balanceOnly?: boolean | undefined;
  compact?: boolean | undefined;
  fetching?: boolean | undefined;
  className?: string | undefined;
}) {
  const theme = useChartTheme();
  const series = balanceOnly
    ? []
    : ([
        ["budgeted", slot(theme, 0)],
        ["spent", theme.out],
        ["overspendingAdjustment", slot(theme, 1)],
      ] as const);
  const names: Record<string, string> = {
    ...Object.fromEntries(series.map(([key]) => [key, NAMES[key]])),
    ...(showBalance ? { balance: NAMES.balance } : {}),
  };
  return (
    <div className={className ?? "grid h-80 grid-rows-[auto_1fr] gap-2"}>
      {compact ? (
        <span />
      ) : (
        <ChartLegend
          items={[
            ...series.map(([key, color]) => ({
              label: NAMES[key],
              color,
              mark: graphType === "Line" ? ("line" as const) : ("rect" as const),
            })),
            ...(showBalance ? [{ label: "Balance", color: theme.ink, mark: "line" as const }] : []),
          ]}
        />
      )}
      <ChartBox fetching={fetching}>
        <ComposedChart data={report.intervals} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          {!compact && <CartesianGrid {...gridProps(theme)} />}
          <XAxis
            dataKey="date"
            {...categoryAxis(theme)}
            tickFormatter={intervalLabel}
            hide={compact}
          />
          <YAxis {...valueAxis(theme)} hide={compact} />
          <ReferenceLine y={0} stroke={theme.axis} />
          <Tooltip
            cursor={{ fill: theme.grid, fillOpacity: 0.6 }}
            content={seriesTooltip({
              names,
              title: intervalLabel,
              mark: graphType === "Line" ? "line" : "rect",
            })}
          />
          {series.map(([key, color]) =>
            graphType === "Line" ? (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={color}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ) : (
              <Bar
                key={key}
                dataKey={key}
                fill={color}
                radius={2}
                maxBarSize={compact ? 8 : 18}
                isAnimationActive={false}
              />
            ),
          )}
          {showBalance && (
            <Line
              type="monotone"
              dataKey="balance"
              stroke={theme.ink}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: theme.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ChartBox>
    </div>
  );
}

/** The dashboard card: the ending balance over the chart. */
export function BudgetAnalysisBody({ meta }: WidgetBodyProps<BudgetAnalysisMeta>) {
  const { id: book } = useBook();
  const report = useQuery({
    ...bookQuery(book, "budget_analysis_report", budgetAnalysisInput(meta)),
    placeholderData: keepPreviousData,
  });
  return (
    <WidgetQuery query={report}>
      {(data) => (
        <>
          <Headline sub={rangeLabel(data.start, data.end)}>
            <Money amount={data.endingBalance} tone="balance" className="font-sans" />
          </Headline>
          <BudgetAnalysisGraph
            report={data}
            graphType={meta.graphType ?? "Bar"}
            showBalance={meta.showBalance ?? true}
            balanceOnly={meta.balanceOnly ?? false}
            compact
            className="grid min-h-0 flex-1 grid-rows-[0_1fr]"
          />
        </>
      )}
    </WidgetQuery>
  );
}

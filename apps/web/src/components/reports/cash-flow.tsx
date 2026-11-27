import type { CashFlowReport } from "@reeve/contract/catalog";
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
import { slot, useChartTheme } from "./chart-theme";
import { ChartBox, ChartLegend } from "./chart-parts";
import { categoryAxis, gridProps, valueAxis } from "./axes";
import { seriesTooltip } from "./series-tooltip";
import { intervalLabel } from "./meta";

/** Income above the baseline, expenses below it, and the balance of the budget accounts. */
export function CashFlowGraph({
  report,
  showBalance = true,
  compact = false,
  fetching,
  className,
}: {
  report: CashFlowReport;
  showBalance?: boolean | undefined;
  compact?: boolean | undefined;
  fetching?: boolean | undefined;
  className?: string | undefined;
}) {
  const theme = useChartTheme();
  const names: Record<string, string> = {
    income: "Income",
    expenses: "Expenses",
    ...(showBalance ? { balance: "Balance" } : {}),
  };
  const barSize = compact ? 10 : report.points.length > 40 ? undefined : 20;
  return (
    <div className={className ?? "grid h-80 grid-rows-[auto_1fr] gap-2"}>
      {compact ? (
        <span />
      ) : (
        <ChartLegend
          items={[
            { label: "Income", color: slot(theme, 0) },
            { label: "Expenses", color: theme.out },
            ...(showBalance ? [{ label: "Balance", color: theme.ink, mark: "line" as const }] : []),
          ]}
        />
      )}
      <ChartBox fetching={fetching}>
        <ComposedChart
          data={report.points}
          stackOffset="sign"
          margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
        >
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
            content={seriesTooltip({ names, title: intervalLabel })}
          />
          <Bar
            dataKey="income"
            stackId="flow"
            fill={slot(theme, 0)}
            radius={[4, 4, 0, 0]}
            {...(barSize === undefined ? {} : { barSize })}
            isAnimationActive={false}
          />
          <Bar
            dataKey="expenses"
            stackId="flow"
            fill={theme.out}
            radius={[0, 0, 4, 4]}
            {...(barSize === undefined ? {} : { barSize })}
            isAnimationActive={false}
          />
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

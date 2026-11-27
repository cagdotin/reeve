import type { SpendingReport } from "@reeve/contract/catalog";
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import -- the reports routes are code-split, so recharts loads only with them.
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { slot, useChartTheme } from "./chart-theme";
import { ChartBox, ChartLegend } from "./chart-parts";
import { categoryAxis, gridProps, valueAxis } from "./axes";
import { seriesTooltip } from "./series-tooltip";
import { shortMonth, type SpendingMode } from "./meta";
import { comparisonLabel, spendingRows } from "./spending-math";

export function SpendingGraph({
  report,
  mode,
  compact = false,
  fetching,
  className,
}: {
  report: SpendingReport;
  mode: SpendingMode;
  compact?: boolean | undefined;
  fetching?: boolean | undefined;
  className?: string | undefined;
}) {
  const theme = useChartTheme();
  const other = comparisonLabel(mode, report);
  const names = { compare: shortMonth(report.compare), other };
  return (
    <div className={className ?? "grid h-80 grid-rows-[auto_1fr] gap-2"}>
      {compact ? (
        <span />
      ) : (
        <ChartLegend
          items={[
            { label: names.compare, color: slot(theme, 0), mark: "line" },
            { label: other, color: slot(theme, 1), mark: "line" },
          ]}
        />
      )}
      <ChartBox fetching={fetching}>
        <LineChart
          data={spendingRows(report, mode)}
          margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
        >
          {!compact && <CartesianGrid {...gridProps(theme)} />}
          <XAxis dataKey="day" {...categoryAxis(theme)} hide={compact} />
          <YAxis {...valueAxis(theme)} hide={compact} />
          <Tooltip
            cursor={{ stroke: theme.axis }}
            content={seriesTooltip({ names, title: (day) => `Day ${Number(day)}` })}
          />
          <Line
            type="monotone"
            dataKey="other"
            stroke={slot(theme, 1)}
            strokeWidth={1.5}
            strokeDasharray="1 4"
            strokeLinecap="round"
            dot={false}
            activeDot={{ r: 4, stroke: theme.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="compare"
            stroke={slot(theme, 0)}
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 4, stroke: theme.surface, strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartBox>
    </div>
  );
}

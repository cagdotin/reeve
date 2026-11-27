import type { NetWorthReport } from "@reeve/contract/catalog";
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import -- the reports routes are code-split, so recharts loads only with them.
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { slot, useChartTheme } from "./chart-theme";
import { ChartBox, ChartLegend } from "./chart-parts";
import { categoryAxis, gridProps, valueAxis } from "./axes";
import { seriesTooltip } from "./series-tooltip";
import { foldSeries } from "./fold";
import { intervalLabel } from "./meta";

/**
 * Net worth over time: one area in trend mode; in stacked mode each account's balance stacked,
 * past the eighth account folded into "Other".
 */
export function NetWorthGraph({
  report,
  mode = "trend",
  compact = false,
  fetching,
  className,
}: {
  report: NetWorthReport;
  mode?: "trend" | "stacked" | undefined;
  compact?: boolean | undefined;
  fetching?: boolean | undefined;
  className?: string | undefined;
}) {
  const theme = useChartTheme();
  const series =
    mode === "stacked"
      ? foldSeries(
          report.accounts.map((account) => ({
            id: account.id,
            name: account.name,
            size: Math.abs(report.points.at(-1)?.balances[account.id] ?? 0),
          })),
        )
      : [];
  const data = report.points.map((point) => {
    const row: Record<string, number | string> = { date: point.date, netWorth: point.netWorth };
    for (const each of series)
      row[each.id] = each.members.reduce((sum, id) => sum + (point.balances[id] ?? 0), 0);
    return row;
  });
  const names: Record<string, string> =
    mode === "stacked"
      ? Object.fromEntries(series.map((each) => [each.id, each.name]))
      : { netWorth: "Net worth" };

  return (
    <div className={className ?? "grid h-80 grid-rows-[auto_1fr] gap-2"}>
      {mode === "stacked" && !compact ? (
        <ChartLegend
          items={series.map((each, index) => ({ label: each.name, color: slot(theme, index) }))}
        />
      ) : (
        <span />
      )}
      <ChartBox fetching={fetching}>
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          {!compact && <CartesianGrid {...gridProps(theme)} />}
          <XAxis
            dataKey="date"
            {...categoryAxis(theme)}
            tickFormatter={intervalLabel}
            hide={compact}
          />
          <YAxis {...valueAxis(theme)} hide={compact} />
          <Tooltip
            cursor={{ stroke: theme.axis }}
            content={seriesTooltip({ names, title: intervalLabel })}
          />
          {mode === "trend" ? (
            <Area
              type="monotone"
              dataKey="netWorth"
              stroke={slot(theme, 0)}
              strokeWidth={2}
              fill={slot(theme, 0)}
              fillOpacity={0.04}
              activeDot={{ r: 4, stroke: theme.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ) : (
            series.map((each, index) => (
              <Area
                key={each.id}
                type="monotone"
                dataKey={each.id}
                stackId="balances"
                stroke={slot(theme, index)}
                strokeWidth={1.5}
                fill={slot(theme, index)}
                fillOpacity={0.25}
                isAnimationActive={false}
              />
            ))
          )}
        </AreaChart>
      </ChartBox>
    </div>
  );
}

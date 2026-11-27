import type { Output } from "@/lib/api";
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import -- the reports routes are code-split, so recharts loads only with them.
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { valueAxis } from "./axes";
import { ChartBox } from "./chart-parts";
import { slot, useChartTheme } from "./chart-theme";
import { seriesTooltip } from "./series-tooltip";

/** How many groups the chart draws; the table lists them all. */
const SHOWN = 12;

/** What each group (item category, product or store) took, as horizontal bars, largest first. */
export function ItemSpendingGraph({
  report,
  fetching,
}: {
  report: Output<"item_spending">;
  fetching?: boolean | undefined;
}) {
  const theme = useChartTheme();
  const rows = report.groups
    .toSorted((a, b) => b.amount - a.amount)
    .slice(0, SHOWN)
    .map((group) => ({ name: group.name, amount: group.amount }));
  return (
    <div style={{ height: 48 + rows.length * 30 }}>
      <ChartBox fetching={fetching} className="h-full">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={theme.grid} horizontal={false} />
          <XAxis type="number" {...valueAxis(theme)} />
          <YAxis
            type="category"
            dataKey="name"
            width={140}
            tick={{ fill: theme.tick, fontSize: 11 }}
            axisLine={{ stroke: theme.axis }}
            tickLine={false}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: theme.grid, opacity: 0.5 }}
            content={seriesTooltip({ names: { amount: "Spent" }, mark: "rect" })}
          />
          <Bar
            dataKey="amount"
            fill={slot(theme, 0)}
            radius={[0, 4, 4, 0]}
            maxBarSize={20}
            isAnimationActive={false}
          />
        </BarChart>
      </ChartBox>
    </div>
  );
}

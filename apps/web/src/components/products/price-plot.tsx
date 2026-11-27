import { format as formatDate, parseISO } from "date-fns";
import { categoryAxis, gridProps, valueAxis } from "@/components/reports/axes";
import { ChartBox } from "@/components/reports/chart-parts";
import { slot, useChartTheme } from "@/components/reports/chart-theme";
import { seriesTooltip } from "@/components/reports/series-tooltip";
import { useBook } from "@/lib/book";
import type { StoreSeries } from "@/lib/products";

// This whole file loads lazily, from price-chart.tsx, so the page never waits on recharts.
const { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } =
  await import("recharts");

/** The drawn part of the price chart: the store to buy at stands out, the others step back. */
export default function PricePlot({
  rows,
  stores,
  best,
  bestPrice,
  shownUnit,
}: {
  rows: ReadonlyArray<Record<string, number | string>>;
  stores: ReadonlyArray<StoreSeries>;
  best: string | null;
  /** The price to beat in the shown unit, as a line across the chart. */
  bestPrice: number | null;
  shownUnit: string;
}) {
  const theme = useChartTheme();
  const { format, formatDay } = useBook();
  const data = rows.map((row) => ({ ...row, time: parseISO(String(row["date"])).getTime() }));
  const names = Object.fromEntries(stores.map((store) => [store.key, store.name]));
  const day = (time: number) => formatDay(formatDate(time, "yyyy-MM-dd"));
  const lone = stores.length === 1;
  return (
    <ChartBox className="absolute inset-0">
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid {...gridProps(theme)} />
        <XAxis
          dataKey="time"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          {...categoryAxis(theme)}
          tickFormatter={day}
        />
        <YAxis
          {...valueAxis(theme)}
          tickFormatter={(value: number) => format(value)}
          domain={["auto", "auto"]}
        />
        <Tooltip
          cursor={{ stroke: theme.axis }}
          content={seriesTooltip({
            names,
            title: (time) => `${day(Number(time))} · per ${shownUnit}`,
          })}
        />
        {bestPrice !== null && (
          <ReferenceLine
            y={bestPrice}
            stroke={theme.ink}
            strokeDasharray="4 4"
            strokeOpacity={0.45}
            ifOverflow="extendDomain"
          />
        )}
        {stores.map((store, index) => {
          const color = slot(theme, lone ? 0 : index);
          const strong = lone || store.key === best;
          return (
            <Line
              key={store.key}
              type="linear"
              dataKey={store.key}
              stroke={color}
              strokeOpacity={strong ? 1 : 0.55}
              strokeWidth={strong ? 2.25 : 1.25}
              dot={{
                r: strong ? 2.5 : 1.75,
                fill: color,
                strokeWidth: 0,
                fillOpacity: strong ? 1 : 0.7,
              }}
              activeDot={{ r: 4, stroke: theme.surface, strokeWidth: 2 }}
              connectNulls
              isAnimationActive={false}
            />
          );
        })}
      </LineChart>
    </ChartBox>
  );
}

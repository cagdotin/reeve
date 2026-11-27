import type { AgeOfMoneyReport } from "@reeve/contract/catalog";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { format, parse } from "date-fns";
import { useId } from "react";
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import -- the reports routes are code-split, so recharts loads only with them.
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { cn } from "@reeve/ui/lib/utils";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import { scopeInput } from "@/lib/report-scope";
import { categoryAxis, gridProps } from "./axes";
import { WidgetQuery, type WidgetBodyProps } from "./card-body";
import { ChartBox } from "./chart-parts";
import { slot, useChartTheme } from "./chart-theme";
import { ageText, ageTone, TARGET_AGE, TREND } from "./age";
import { ageOfMoneyInput } from "./inputs";
import { intervalLabel, rangeLabel, type AgeOfMoneyMeta } from "./meta";

/** Round day ticks from zero to a little above the highest age. */
const dayTicks = (highest: number) => {
  const top = highest * 1.1;
  const step = top > 400 ? 100 : top > 200 ? 50 : top > 60 ? 20 : 10;
  return Array.from({ length: Math.ceil(top / step) + 1 }, (_, index) => index * step);
};

/** A period key with its year: the axis leaves the year out, the tooltip does not. */
const periodTitle = (key: string) =>
  key.length === 7
    ? format(parse(key, "yyyy-MM", new Date()), "MMMM yyyy")
    : format(parse(key, "yyyy-MM-dd", new Date()), "MMM d, yyyy");

function AgeTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || payload.length === 0 || typeof payload[0]?.value !== "number") return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg/5">
      <div className="mb-1 font-medium text-muted-foreground">{periodTitle(String(label))}</div>
      <span className="font-medium tabular-nums">{ageText(payload[0].value)}</span>
    </div>
  );
}

/** The average age of the last ten outflows over time, against the 30-day mark. */
export function AgeOfMoneyGraph({
  report,
  compact = false,
  fetching,
  className,
}: {
  report: AgeOfMoneyReport;
  compact?: boolean | undefined;
  fetching?: boolean | undefined;
  className?: string | undefined;
}) {
  const theme = useChartTheme();
  const gradient = useId();
  const color = slot(theme, 0);
  const ticks = dayTicks(Math.max(TARGET_AGE, ...report.points.map((point) => point.ageOfMoney)));
  if (report.points.length === 0)
    return (
      <div
        className={cn(
          "flex items-center justify-center text-sm text-muted-foreground",
          className ?? "h-80",
        )}
      >
        No spending to age in this range.
      </div>
    );
  return (
    <div className={className ?? "grid h-80 grid-rows-[0_1fr]"}>
      <span />
      <ChartBox fetching={fetching}>
        <AreaChart data={report.points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.1} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {!compact && <CartesianGrid {...gridProps(theme)} />}
          <XAxis
            dataKey="date"
            {...categoryAxis(theme)}
            tickFormatter={intervalLabel}
            hide={compact}
          />
          <YAxis
            tickFormatter={(value: number) => `${value}d`}
            tick={{ fill: theme.tick, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={40}
            domain={[0, ticks.at(-1) ?? TARGET_AGE]}
            ticks={ticks}
            hide={compact}
          />
          <Tooltip cursor={{ stroke: theme.axis }} content={AgeTooltip} />
          {!compact && (
            <ReferenceLine
              y={TARGET_AGE}
              stroke={slot(theme, 2)}
              strokeDasharray="5 5"
              label={{
                value: "30 days",
                position: "insideTopRight",
                fill: theme.tick,
                fontSize: 11,
              }}
            />
          )}
          <Area
            type="monotone"
            dataKey="ageOfMoney"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradient})`}
            dot={false}
            activeDot={{ r: 4, stroke: theme.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartBox>
    </div>
  );
}

/** The dashboard card: the current age, its trend and the chart. */
export function AgeOfMoneyBody({ meta, scope }: WidgetBodyProps<AgeOfMoneyMeta>) {
  const { id: book } = useBook();
  const report = useQuery({
    ...bookQuery(book, "age_of_money_report", { ...ageOfMoneyInput(meta), ...scopeInput(scope) }),
    placeholderData: keepPreviousData,
  });
  return (
    <WidgetQuery query={report}>
      {(data) => (
        <>
          <div className="flex items-end justify-between gap-2">
            <div className="grid gap-0.5">
              <span className={cn("text-xl font-semibold", ageTone(data.currentAge))}>
                {ageText(data.currentAge)}
              </span>
              <span className="text-xs text-muted-foreground">
                {data.currentAge === null ? "" : `${TREND[data.trend]} · `}
                {rangeLabel(data.start, data.end)}
              </span>
            </div>
            {data.insufficientData && (
              <span className="text-[11px] text-warning-foreground">Incomplete data</span>
            )}
          </div>
          <AgeOfMoneyGraph
            report={data}
            compact
            className="grid min-h-0 flex-1 grid-rows-[0_1fr]"
          />
        </>
      )}
    </WidgetQuery>
  );
}

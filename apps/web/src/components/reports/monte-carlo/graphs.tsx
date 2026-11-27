import type {
  MonteCarloContribution,
  MonteCarloIncomeStream,
  MonteCarloPercentileBand,
  MonteCarloPot,
  MonteCarloRunDetailRow,
  MonteCarloSpendingPhase,
} from "@reeve/contract/monte-carlo";
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import -- the reports routes are code-split, so recharts loads only with them.
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useBook } from "@/lib/book";
import { categoryAxis, gridProps, valueAxis } from "../axes";
import { ChartBox, TooltipCard } from "../chart-parts";
import { slot, useChartTheme, type ChartTheme } from "../chart-theme";
import {
  buildMonteCarloCashflowChart,
  buildMonteCarloPotBalancesChart,
  interpolate,
  type MonteCarloCashflowDataPoint,
  type MonteCarloCashflowSeries,
  type MonteCarloCashflowTooltipGroup,
  type MonteCarloColors,
  type MonteCarloGraphView,
} from "./charts";

type FanPoint = {
  year: number;
  age: number;
  band80: [number, number];
  band50: [number, number];
  p5: number;
  p10: number;
  p25: number;
  p30: number;
  p50: number;
  p70: number;
  p75: number;
  p90: number;
  worstRun?: number | undefined;
};

/** Which data point each focused view plots: the graph draws this key and the tooltip reads it. */
const VIEW_DATA_KEYS = {
  "single-worst": "worstRun",
  "worst-case": "p5",
  pessimistic: "p30",
  median: "p50",
  optimistic: "p70",
} as const satisfies Record<Exclude<MonteCarloGraphView, "all">, keyof FanPoint>;

const VIEW_LABELS: Record<Exclude<MonteCarloGraphView, "all">, string> = {
  "single-worst": "Single worst run",
  "worst-case": "Worst-case (5th percentile)",
  pessimistic: "Pessimistic (30th percentile)",
  median: "Median (50th percentile)",
  optimistic: "Optimistic (70th percentile)",
};

const ageTitle = (point: { year: number; age: number }) =>
  point.year === 0 ? `Start (age ${point.age})` : `Age ${point.age}`;

const monteCarloColors = (theme: ChartTheme): MonteCarloColors => ({
  series: theme.series.slice(0, 7),
  negative: theme.out,
});

/**
 * The fan chart: the 10th-90th and 25th-75th percentile bands around the median balance by age,
 * or one scenario's line (a percentile, or the single worst run).
 */
export function MonteCarloGraph({
  bands,
  startAge,
  worstRunPath,
  view = "all",
  compact = false,
  fetching,
  className,
}: {
  bands: ReadonlyArray<MonteCarloPercentileBand>;
  startAge: number;
  worstRunPath?: ReadonlyArray<number> | undefined;
  view?: MonteCarloGraphView | undefined;
  compact?: boolean | undefined;
  fetching?: boolean | undefined;
  className?: string | undefined;
}) {
  const theme = useChartTheme();
  const fill = slot(theme, 0);
  const data: FanPoint[] = bands.map((band) => ({
    year: band.year,
    age: startAge + band.year,
    band80: [band.p10, band.p90],
    band50: [band.p25, band.p75],
    p5: band.p5,
    p10: band.p10,
    p25: band.p25,
    p30: band.p30,
    p50: band.p50,
    p70: band.p70,
    p75: band.p75,
    p90: band.p90,
    worstRun: worstRunPath?.[band.year],
  }));
  return (
    <ChartBox fetching={fetching} className={className ?? "h-96"}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        {!compact && <CartesianGrid {...gridProps(theme)} />}
        <XAxis dataKey="age" {...categoryAxis(theme)} hide={compact} />
        <YAxis {...valueAxis(theme)} hide={compact} />
        <Tooltip
          cursor={{ stroke: theme.axis }}
          isAnimationActive={false}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as FanPoint | undefined;
            if (!active || point === undefined) return null;
            const rows =
              view === "all"
                ? [
                    { key: "p90", label: "Best 10%", value: point.p90 },
                    { key: "p75", label: "Top quartile", value: point.p75 },
                    { key: "p50", label: "Median", value: point.p50 },
                    { key: "p25", label: "Bottom quartile", value: point.p25 },
                    { key: "p10", label: "Worst 10%", value: point.p10 },
                  ]
                : [
                    {
                      key: view,
                      label: VIEW_LABELS[view],
                      value: point[VIEW_DATA_KEYS[view]] ?? 0,
                    },
                  ];
            return (
              <TooltipCard
                title={ageTitle(point)}
                rows={rows.map((row) => ({ ...row, color: fill }))}
              />
            );
          }}
        />
        {view === "all" ? (
          <>
            <Area
              type="monotone"
              dataKey="band80"
              name="10th to 90th percentile"
              stroke="none"
              fill={fill}
              fillOpacity={0.15}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="band50"
              name="25th to 75th percentile"
              stroke="none"
              fill={fill}
              fillOpacity={0.3}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="p50"
              name="Median"
              dot={false}
              stroke={fill}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </>
        ) : (
          <Area
            type="monotone"
            dataKey={VIEW_DATA_KEYS[view]}
            name={VIEW_LABELS[view]}
            stroke={fill}
            strokeWidth={2}
            fill={fill}
            fillOpacity={0.08}
            isAnimationActive={false}
          />
        )}
      </ComposedChart>
    </ChartBox>
  );
}

/** How many failing scenarios ran out at each age, with the typical failure age marked. */
export function MonteCarloHistogram({
  histogram,
  startAge,
  medianDepletionYear,
  simulationCount,
  className,
}: {
  histogram: ReadonlyArray<{ year: number; count: number }>;
  startAge: number;
  medianDepletionYear: number | null;
  simulationCount: number;
  className?: string | undefined;
}) {
  const theme = useChartTheme();
  // The age of the year that couldn't be funded, matching the run detail
  const data = histogram.map((entry) => ({ ...entry, age: startAge + entry.year - 1 }));
  return (
    <ChartBox className={className ?? "h-52"}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid {...gridProps(theme)} />
        <XAxis dataKey="age" {...categoryAxis(theme)} />
        <YAxis
          allowDecimals={false}
          tick={{ fill: theme.tick, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        <Tooltip
          cursor={{ fill: theme.grid }}
          isAnimationActive={false}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as (typeof data)[number] | undefined;
            if (!active || point === undefined) return null;
            return (
              <div className="max-w-56 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg/5">
                {`${point.count} of ${simulationCount} scenarios ran out of money at age ${point.age}`}
              </div>
            );
          }}
        />
        {medianDepletionYear !== null && (
          <ReferenceLine
            x={startAge + medianDepletionYear - 1}
            stroke={theme.tick}
            strokeDasharray="4 4"
          />
        )}
        <Bar dataKey="count" fill={slot(theme, 7)} isAnimationActive={false} />
      </BarChart>
    </ChartBox>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-[3px]"
      style={{ backgroundColor: color }}
    />
  );
}

function LegendGroup({
  heading,
  series,
}: {
  heading: string;
  series: ReadonlyArray<MonteCarloCashflowSeries>;
}) {
  if (series.length === 0) return null;
  return (
    <div className="grid gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{heading}</span>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {series.map((entry) => (
          <span key={entry.key} className="flex items-center gap-1.5">
            <Swatch color={entry.color} />
            {entry.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** The single-run tooltip: a year's groups (Withdrawals, Income, Tax, ...) with their members. */
function GroupsTooltip({
  point,
  groups,
  afterDepletionNote = "The pots had already run out - this spending went unfunded.",
  showZeroMembers = false,
}: {
  point: MonteCarloCashflowDataPoint;
  groups: ReadonlyArray<MonteCarloCashflowTooltipGroup>;
  afterDepletionNote?: string;
  showZeroMembers?: boolean;
}) {
  const { format } = useBook();
  const sections = groups
    .map((group) => {
      const members = group.series
        .map((series) => ({ ...series, value: point.amounts[series.key] ?? 0 }))
        .filter((series) => showZeroMembers || series.value !== 0);
      return { ...group, members, total: members.reduce((sum, series) => sum + series.value, 0) };
    })
    .filter((group) => group.members.length > 0);
  return (
    <div className="min-w-52 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg/5">
      <div className="mb-1 font-medium">{`Age ${point.age}`}</div>
      {point.afterDepletion && (
        <p className="mb-1 max-w-56 text-destructive-foreground">{afterDepletionNote}</p>
      )}
      {point.unspentIncome > 0 && (
        <p className="mb-1 max-w-56 text-muted-foreground">
          {`Unspent income: ${format(point.unspentIncome)} - it leaves the plan.`}
        </p>
      )}
      <div className="grid gap-0.5">
        {sections.map((group) => (
          <div key={group.key} className="grid gap-0.5">
            <div className="flex items-center justify-between gap-5 font-medium">
              <span className="flex items-center gap-1.5">
                {!group.listMembers && <Swatch color={group.members[0]!.color} />}
                {group.heading}
              </span>
              <span className="tabular-nums">{format(group.total)}</span>
            </div>
            {group.listMembers &&
              group.members.map((member) => (
                <div key={member.key} className="flex items-center justify-between gap-5 ps-4">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Swatch color={member.color} />
                    {member.label}
                  </span>
                  <span className="tabular-nums">{format(member.value)}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Bars for years after the plan ran out are dimmed to this opacity */
const UNFUNDED_BAR_OPACITY = 0.45;

interface RunGraphProps {
  /** The captured run to chart, one row per simulated year */
  rows: MonteCarloRunDetailRow[];
  pots: MonteCarloPot[];
  startAge: number;
  className?: string | undefined;
}

/**
 * Yearly cashflow of one simulated run as stacked bars: money in above zero, money out below (see
 * `buildMonteCarloCashflowChart`).
 */
export function MonteCarloCashflowGraph({
  rows,
  pots,
  contributions,
  incomeStreams,
  spendingPhases,
  startAge,
  className,
}: RunGraphProps & {
  contributions: MonteCarloContribution[];
  incomeStreams: MonteCarloIncomeStream[];
  spendingPhases: MonteCarloSpendingPhase[];
}) {
  const theme = useChartTheme();
  const { data, inflowSeries, outflowSeries, tooltipGroups } = buildMonteCarloCashflowChart({
    rows,
    pots,
    contributions,
    incomeStreams,
    spendingPhases,
    startAge,
    colors: monteCarloColors(theme),
    translate: interpolate,
  });
  return (
    <div className={className}>
      <ChartBox className="h-80">
        <ComposedChart
          stackOffset="sign"
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        >
          <CartesianGrid {...gridProps(theme)} />
          <XAxis dataKey="age" {...categoryAxis(theme)} minTickGap={30} />
          <YAxis {...valueAxis(theme)} />
          <Tooltip
            cursor={{ fill: theme.grid }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as MonteCarloCashflowDataPoint | undefined;
              if (!active || point === undefined) return null;
              return <GroupsTooltip point={point} groups={tooltipGroups} />;
            }}
          />
          <ReferenceLine y={0} stroke={theme.axis} />
          {[...inflowSeries, ...outflowSeries].map((series) => (
            <Bar
              key={series.key}
              dataKey={`amounts.${series.key}`}
              name={series.label}
              stackId="flow"
              fill={series.color}
              maxBarSize={50}
              isAnimationActive={false}
            >
              {/* Only spending remains after the plan runs out; dim it so those years read as
                  planned but unfunded */}
              {series.kind === "phase" &&
                data.map((point) => (
                  <Cell
                    key={point.year}
                    fill={series.color}
                    fillOpacity={point.afterDepletion ? UNFUNDED_BAR_OPACITY : 1}
                  />
                ))}
            </Bar>
          ))}
        </ComposedChart>
      </ChartBox>
      <div className="mt-3 flex flex-wrap gap-x-10 gap-y-3">
        <LegendGroup heading="Money in" series={inflowSeries} />
        <LegendGroup heading="Money out" series={outflowSeries} />
      </div>
    </div>
  );
}

/** Each pot's end-of-year balance in one simulated run, stacked to the plan's total. */
export function MonteCarloPotBalancesGraph({ rows, pots, startAge, className }: RunGraphProps) {
  const theme = useChartTheme();
  const { data, series, tooltipGroups } = buildMonteCarloPotBalancesChart({
    rows,
    pots,
    startAge,
    colors: monteCarloColors(theme),
    translate: interpolate,
  });
  return (
    <div className={className}>
      <ChartBox className="h-80">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...gridProps(theme)} />
          <XAxis dataKey="age" {...categoryAxis(theme)} minTickGap={30} />
          <YAxis {...valueAxis(theme)} />
          <Tooltip
            cursor={{ stroke: theme.axis }}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as MonteCarloCashflowDataPoint | undefined;
              if (!active || point === undefined) return null;
              return (
                <GroupsTooltip
                  point={point}
                  groups={tooltipGroups}
                  afterDepletionNote="The pots had run out by this year."
                  showZeroMembers
                />
              );
            }}
          />
          {series.map((potSeries) => (
            <Area
              key={potSeries.key}
              type="monotone"
              dataKey={`amounts.${potSeries.key}`}
              name={potSeries.label}
              stackId="pots"
              stroke={potSeries.color}
              fill={potSeries.color}
              fillOpacity={0.35}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ChartBox>
      <div className="mt-3">
        <LegendGroup heading="Pots" series={series} />
      </div>
    </div>
  );
}

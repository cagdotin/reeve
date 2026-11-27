import type { CustomReportResult } from "@reeve/contract/catalog";
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import -- the reports routes are code-split, so recharts loads only with them.
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TooltipContentProps } from "recharts";
import { Money } from "@/components/money";
import { slot, useChartTheme } from "./chart-theme";
import { ChartBox, ChartLegend, DataTable, TooltipCard, type Column } from "./chart-parts";
import { categoryAxis, gridProps, valueAxis } from "./axes";
import { seriesTooltip } from "./series-tooltip";
import { foldSeries } from "./fold";
import { intervalLabel } from "./meta";
import {
  amountOf,
  isMoneyOut,
  type BalanceType,
  type GraphType,
  type GroupBy,
  type ReportMode,
  type Totals,
} from "./custom-options";

const keyOf = (group: { id: string; name: string }) => group.id || group.name;

interface Options {
  readonly report: CustomReportResult;
  readonly mode: ReportMode;
  readonly graph: GraphType;
  readonly groupBy: GroupBy;
  readonly balanceType: BalanceType;
  readonly compact?: boolean | undefined;
  readonly fetching?: boolean | undefined;
}

/** Rows of a total-mode graph: one per group, or one per interval when split by interval. */
const totalRows = (report: CustomReportResult, groupBy: GroupBy, balanceType: BalanceType) =>
  groupBy === "Interval"
    ? report.intervals.map((interval) => ({
        key: interval.date,
        name: intervalLabel(interval.date),
        value: amountOf(interval, balanceType),
      }))
    : report.groups.map((group) => ({
        key: keyOf(group),
        name: group.name,
        value: amountOf(group, balanceType),
      }));

function BarTotals({ report, groupBy, balanceType, compact = false, fetching = false }: Options) {
  const theme = useChartTheme();
  const rows = totalRows(report, groupBy, balanceType);
  return (
    <ChartBox fetching={fetching} className="h-full">
      <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        {!compact && <CartesianGrid {...gridProps(theme)} />}
        <XAxis
          dataKey="name"
          {...categoryAxis(theme)}
          {...(compact ? {} : { interval: 0 })}
          hide={compact}
        />
        <YAxis {...valueAxis(theme)} hide={compact} />
        <ReferenceLine y={0} stroke={theme.axis} />
        <Tooltip
          cursor={{ fill: theme.grid, fillOpacity: 0.6 }}
          content={seriesTooltip({ names: { value: balanceType }, mark: "rect" })}
        />
        <Bar
          dataKey="value"
          fill={isMoneyOut(balanceType) ? theme.out : slot(theme, 0)}
          radius={[4, 4, 0, 0]}
          maxBarSize={24}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartBox>
  );
}

function AreaTotals({ report, balanceType, compact = false, fetching = false }: Options) {
  const theme = useChartTheme();
  const rows = totalRows(report, "Interval", balanceType);
  return (
    <ChartBox fetching={fetching} className="h-full">
      <AreaChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        {!compact && <CartesianGrid {...gridProps(theme)} />}
        <XAxis dataKey="name" {...categoryAxis(theme)} hide={compact} />
        <YAxis {...valueAxis(theme)} hide={compact} />
        <Tooltip
          cursor={{ stroke: theme.axis }}
          content={seriesTooltip({ names: { value: balanceType } })}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={isMoneyOut(balanceType) ? theme.out : slot(theme, 0)}
          strokeWidth={2}
          fill={isMoneyOut(balanceType) ? theme.out : slot(theme, 0)}
          fillOpacity={0.04}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartBox>
  );
}

function Donut({ report, groupBy, balanceType, compact = false, fetching = false }: Options) {
  const theme = useChartTheme();
  const rows = totalRows(report, groupBy, balanceType).filter((row) => row.value > 0);
  const series = foldSeries(rows.map((row) => ({ id: row.key, name: row.name, size: row.value })));
  const data = series.map((each) => ({
    key: each.id,
    name: each.name,
    value: rows
      .filter((row) => each.members.includes(row.key))
      .reduce((sum, row) => sum + row.value, 0),
  }));
  const total = data.reduce((sum, row) => sum + row.value, 0);
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr] gap-2">
      {compact ? (
        <span />
      ) : (
        <ChartLegend
          items={data.map((row, index) => ({ label: row.name, color: slot(theme, index) }))}
        />
      )}
      <ChartBox fetching={fetching}>
        <PieChart>
          <Tooltip
            content={({ active, payload }: TooltipContentProps) => {
              const entry = payload[0];
              if (!active || entry === undefined || typeof entry.value !== "number") return null;
              const share = total === 0 ? 0 : Math.round((entry.value / total) * 1000) / 10;
              return (
                <TooltipCard
                  title={`${String(entry.name)} · ${share}%`}
                  rows={[{ key: "value", label: balanceType, value: entry.value, mark: "none" }]}
                />
              );
            }}
          />
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="58%"
            outerRadius="90%"
            stroke={theme.surface}
            strokeWidth={2}
            isAnimationActive={false}
          >
            {data.map((row, index) => (
              <Cell key={row.key} fill={slot(theme, index)} />
            ))}
          </Pie>
        </PieChart>
      </ChartBox>
    </div>
  );
}

/** The groups of a time-mode graph as series, past eight folded into "Other". */
const timeSeries = (report: CustomReportResult, balanceType: BalanceType) => {
  const series = foldSeries(
    report.groups.map((group) => ({
      id: keyOf(group),
      name: group.name,
      size: Math.abs(amountOf(group, balanceType)),
    })),
  );
  const data = report.intervals.map((interval) => {
    const row: Record<string, number | string> = { date: interval.date };
    for (const each of series)
      row[each.id] = each.members.reduce((sum, id) => sum + (interval.stacked[id] ?? 0), 0);
    return row;
  });
  return { series, data };
};

function TimeGraph({ report, graph, balanceType, compact = false, fetching = false }: Options) {
  const theme = useChartTheme();
  const { series, data } = timeSeries(report, balanceType);
  const names = Object.fromEntries(series.map((each) => [each.id, each.name]));
  const common = (
    <>
      {!compact && <CartesianGrid {...gridProps(theme)} />}
      <XAxis dataKey="date" {...categoryAxis(theme)} tickFormatter={intervalLabel} hide={compact} />
      <YAxis {...valueAxis(theme)} hide={compact} />
    </>
  );
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr] gap-2">
      {compact ? (
        <span />
      ) : (
        <ChartLegend
          items={series.map((each, index) => ({
            label: each.name,
            color: slot(theme, index),
            mark: graph === "LineGraph" ? "line" : "rect",
          }))}
        />
      )}
      <ChartBox fetching={fetching}>
        {graph === "LineGraph" ? (
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            {common}
            <Tooltip
              cursor={{ stroke: theme.axis }}
              content={seriesTooltip({ names, title: intervalLabel })}
            />
            {series.map((each, index) => (
              <Line
                key={each.id}
                type="monotone"
                dataKey={each.id}
                stroke={slot(theme, index)}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        ) : (
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            {common}
            <Tooltip
              cursor={{ fill: theme.grid, fillOpacity: 0.6 }}
              content={seriesTooltip({ names, title: intervalLabel, mark: "rect" })}
            />
            {series.map((each, index) => (
              <Bar
                key={each.id}
                dataKey={each.id}
                stackId="groups"
                fill={slot(theme, index)}
                stroke={theme.surface}
                strokeWidth={1}
                maxBarSize={32}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        )}
      </ChartBox>
    </div>
  );
}

interface TableRow {
  readonly key: string;
  readonly name: string;
  readonly totals: Totals;
  readonly intervals: ReadonlyArray<Totals & { readonly date: string }>;
  readonly depth: number;
}

/** Actual's table: a row per group (categories under their group when split by category). */
export function ReportTable({ report, mode, groupBy, balanceType }: Options) {
  const signed = (totals: Totals) =>
    balanceType === "Payment"
      ? totals.totalDebts
      : balanceType === "Deposit"
        ? totals.totalAssets
        : balanceType === "Net Payment"
          ? -Math.abs(totals.netDebts)
          : balanceType === "Net Deposit"
            ? totals.netAssets
            : totals.totalTotals;
  const rows: Array<TableRow> =
    groupBy === "Interval"
      ? report.intervals.map((interval) => ({
          key: interval.date,
          name: intervalLabel(interval.date),
          totals: interval,
          intervals: [],
          depth: 0,
        }))
      : groupBy === "Category"
        ? report.groupedData.flatMap((group) => [
            {
              key: `g:${keyOf(group)}`,
              name: group.name,
              totals: group,
              intervals: group.intervals,
              depth: 0,
            },
            ...(group.categories ?? []).map((category) => ({
              key: keyOf(category),
              name: category.name,
              totals: category,
              intervals: category.intervals,
              depth: 1,
            })),
          ])
        : report.groups.map((group) => ({
            key: keyOf(group),
            name: group.name,
            totals: group,
            intervals: group.intervals,
            depth: 0,
          }));
  const intervals =
    mode === "time" && groupBy !== "Interval" ? report.intervals.map((each) => each.date) : [];
  const showSplit = balanceType === "Net" && intervals.length === 0;
  const columns: Array<Column<TableRow>> = [
    {
      key: "name",
      label:
        groupBy === "Interval" ? "Interval" : groupBy === "CategoryGroup" ? "Category" : groupBy,
      value: (row) => (
        <span className={row.depth === 0 && groupBy === "Category" ? "font-medium" : "ps-4"}>
          {row.name}
        </span>
      ),
    },
    ...intervals.map((date, index): Column<TableRow> => ({
      key: date,
      label: intervalLabel(date),
      align: "right",
      value: (row) => {
        const entry = row.intervals[index];
        return entry === undefined ? "" : <Money amount={signed(entry)} />;
      },
    })),
    ...(showSplit
      ? [
          {
            key: "deposits",
            label: "Deposits",
            align: "right" as const,
            value: (row: TableRow) => <Money amount={row.totals.totalAssets} />,
          },
          {
            key: "payments",
            label: "Payments",
            align: "right" as const,
            value: (row: TableRow) => <Money amount={row.totals.totalDebts} />,
          },
        ]
      : []),
    {
      key: "total",
      label: "Total",
      align: "right",
      className: "font-medium",
      value: (row) => <Money amount={signed(row.totals)} />,
    },
    ...(intervals.length > 0
      ? [
          {
            key: "average",
            label: "Average",
            align: "right" as const,
            value: (row: TableRow) => (
              <Money amount={Math.round(signed(row.totals) / Math.max(intervals.length, 1))} />
            ),
          },
        ]
      : []),
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(row) => row.key}
      footer={{
        key: "totals",
        name: "Totals",
        totals: report,
        intervals: report.intervals,
        depth: 0,
      }}
    />
  );
}

/** The custom report's graph of the chosen type, or its table. */
export function CustomGraph(options: Options) {
  if (options.graph === "TableGraph") {
    if (options.compact) return <CompactTable {...options} />;
    return <ReportTable {...options} />;
  }
  if (options.mode === "time") return <TimeGraph {...options} />;
  if (options.graph === "DonutGraph") return <Donut {...options} />;
  if (options.graph === "AreaGraph") return <AreaTotals {...options} />;
  return <BarTotals {...options} />;
}

/** A widget's table: the largest rows and the total. */
function CompactTable({ report, groupBy, balanceType }: Options) {
  const rows = totalRows(report, groupBy, balanceType)
    .toSorted((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 6);
  return (
    <div className="grid content-start gap-1 text-xs">
      {rows.map((row) => (
        <div key={row.key} className="flex justify-between gap-2">
          <span className="truncate text-muted-foreground">{row.name}</span>
          <Money amount={row.value} tone="none" />
        </div>
      ))}
    </div>
  );
}

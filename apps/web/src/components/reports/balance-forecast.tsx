import type { BalanceForecastReport } from "@reeve/contract/catalog";
import { currentMonth, today } from "@reeve/contract/rules";
import { useQuery } from "@tanstack/react-query";
import { format, parse } from "date-fns";
import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import -- the reports routes are code-split, so recharts loads only with them.
import { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import type { Choices } from "@/components/rules/rule-editor";
import type { Names } from "@/components/rules/rule-model";
import { Money } from "@/components/money";
import { ScheduleEditor } from "@/components/schedules/schedule-editor";
import { Button } from "@reeve/ui/components/button";
import { Input } from "@reeve/ui/components/input";
import { cn } from "@reeve/ui/lib/utils";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import { categoryAxis, gridProps, valueAxis } from "./axes";
import { ChartBox, TooltipCard } from "./chart-parts";
import { slot, useChartTheme, type ChartTheme } from "./chart-theme";
import { AppliedFilters, FilterButton, MultiChoice } from "./controls";
import type { ForecastSeriesMeta } from "./meta";
import { usePaneLeave } from "@/components/split-panel";

export const MAX_FORECAST_SERIES = 4;

type Line = BalanceForecastReport["lines"][number];

/** Each comparison line's colour and dash, so lines stay apart without colour alone. */
const seriesStyle = (theme: ChartTheme, index: number) => {
  const dash = [undefined, "8 4", "3 3", "10 3 2 3"][index % MAX_FORECAST_SERIES];
  return {
    stroke: slot(theme, index % MAX_FORECAST_SERIES),
    ...(dash === undefined ? {} : { strokeDasharray: dash }),
  };
};

const negative = (theme: ChartTheme) => slot(theme, 7);

/** A forecast date: a day as `Mar 5`, a month as `Mar 24`. */
const forecastDateLabel = (date: string) =>
  date.length === 10
    ? format(parse(date, "yyyy-MM-dd", new Date()), "MMM d")
    : format(parse(date, "yyyy-MM", new Date()), "MMM yy");

const longDate = (date: string) =>
  date.length === 10
    ? format(parse(date, "yyyy-MM-dd", new Date()), "MMM d, yyyy")
    : format(parse(date, "yyyy-MM", new Date()), "MMMM yyyy");

function SeriesKey({ index, name }: { index: number; name: string }) {
  const theme = useChartTheme();
  const style = seriesStyle(theme, index);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <svg width={24} height={12} aria-hidden className="shrink-0">
        <line x1={0} y1={6} x2={24} y2={6} strokeWidth={2} {...style} />
      </svg>
      <span className="truncate">{name}</span>
    </span>
  );
}

/**
 * The forecast as a line: one balance whose stroke turns red below zero, or each comparison line
 * in its own colour and dash. Today and zero are marked.
 */
export function ForecastGraph({
  report,
  yAxisBase = "Auto",
  compact = false,
  fetching,
  className,
}: {
  report: BalanceForecastReport;
  yAxisBase?: "Auto" | "Zero-Based" | undefined;
  compact?: boolean | undefined;
  fetching?: boolean | undefined;
  className?: string | undefined;
}) {
  const theme = useChartTheme();
  const comparison = report.lines.length > 1 || report.lines[0]?.name !== "";
  const gradient = `balance-forecast-${compact ? "card" : "page"}`;
  const todayKey = report.granularity === "Daily" ? today() : currentMonth();
  const showsToday = report.chartData.some((row) => row.date === todayKey);
  const offset = report.zeroCrossingOffset;
  return (
    <ChartBox fetching={fetching} className={className ?? "h-80"}>
      <LineChart
        data={[...report.chartData]}
        margin={{ top: compact ? 8 : 22, right: 8, bottom: 0, left: 0 }}
      >
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            {offset === null ? (
              <stop
                offset="0%"
                stopColor={report.hasNegativeBalance ? negative(theme) : slot(theme, 0)}
              />
            ) : (
              <>
                <stop offset={`${offset}%`} stopColor={slot(theme, 0)} />
                <stop offset={`${offset}%`} stopColor={negative(theme)} />
              </>
            )}
          </linearGradient>
        </defs>
        {!compact && <CartesianGrid {...gridProps(theme)} />}
        <XAxis
          dataKey="date"
          {...categoryAxis(theme)}
          tickFormatter={forecastDateLabel}
          hide={compact}
        />
        <YAxis
          {...valueAxis(theme)}
          hide={compact}
          domain={[yAxisBase === "Zero-Based" ? 0 : "auto", "auto"]}
          allowDataOverflow={false}
        />
        <Tooltip
          cursor={{ stroke: theme.axis }}
          isAnimationActive={false}
          content={({ active, payload }) => {
            const row = payload?.[0]?.payload as { date?: string } | undefined;
            if (!active || row?.date === undefined) return null;
            const date = row.date;
            return (
              <TooltipCard
                title={longDate(date)}
                rows={report.lines.flatMap((line, index) => {
                  const point = line.points.find((each) => each.date === date);
                  return point === undefined
                    ? []
                    : [
                        {
                          key: line.id,
                          label: comparison ? line.name : "Balance",
                          value: point.balance,
                          color: comparison
                            ? seriesStyle(theme, index).stroke
                            : point.balance < 0
                              ? negative(theme)
                              : slot(theme, 0),
                        },
                      ];
                })}
              />
            );
          }}
        />
        {showsToday && (
          <ReferenceLine
            x={todayKey}
            stroke={theme.tick}
            strokeDasharray="4 4"
            {...(compact
              ? {}
              : {
                  label: {
                    value: "Today",
                    position: "top",
                    fill: theme.tick,
                    fontSize: 11,
                    offset: 6,
                  },
                })}
          />
        )}
        {report.hasNegativeBalance && <ReferenceLine y={0} stroke={theme.axis} />}
        {comparison ? (
          report.lines.map((line, index) => (
            <Line
              key={line.id}
              name={line.name}
              dataKey={line.dataKey}
              type="monotone"
              {...seriesStyle(theme, index)}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: theme.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))
        ) : (
          <Line
            type="monotone"
            dataKey="balance"
            name="Balance"
            stroke={`url(#${gradient})`}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: theme.surface, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        )}
      </LineChart>
    </ChartBox>
  );
}

/** Each comparison line's ending balance and, on the page, its lowest point. */
export function SeriesSummary({
  lines,
  compact = false,
}: {
  lines: ReadonlyArray<Line>;
  compact?: boolean | undefined;
}) {
  return (
    <table className={cn("w-full text-xs", compact ? "mb-1" : "mb-2")}>
      <thead className="text-muted-foreground">
        <tr>
          <th className="pb-1 text-left font-normal">Line</th>
          <th className="pb-1 text-right font-normal">Ending balance</th>
          {!compact && <th className="pb-1 text-right font-normal">Lowest visible point</th>}
        </tr>
      </thead>
      <tbody>
        {lines.map((line, index) => (
          <tr key={line.id}>
            <th
              scope="row"
              className={cn("pr-3 text-left font-normal", compact ? "py-0.5" : "py-1")}
            >
              <SeriesKey index={index} name={line.name} />
            </th>
            <td className="text-right whitespace-nowrap">
              {line.endingPoint ? <Money amount={line.endingPoint.balance} /> : "No data"}
            </td>
            {!compact && (
              <td className="pl-4 text-right whitespace-nowrap">
                {line.lowestPoint ? (
                  <>
                    <Money amount={line.lowestPoint.balance} />{" "}
                    <span className="text-muted-foreground">
                      ({longDate(line.lowestPoint.date)})
                    </span>
                  </>
                ) : (
                  "No data"
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type Contributors = NonNullable<BalanceForecastReport["contributors"]>;
type Contributor = Contributors["inflows"][number];

function ContributorsTable({
  direction,
  contributors,
  onEdit,
}: {
  direction: "inflow" | "outflow";
  contributors: ReadonlyArray<Contributor>;
  onEdit: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? contributors : contributors.slice(0, 5);
  const remaining = contributors.slice(visible.length);
  const total = contributors.reduce((sum, each) => sum + each.amount, 0);
  return (
    <div className="min-w-0 flex-[1_1_22rem]">
      <table className="w-full text-[13px]">
        <caption className="mb-2 text-left font-medium">
          {direction === "inflow" ? "Scheduled inflows" : "Scheduled outflows"}
        </caption>
        <thead className="text-xs text-muted-foreground">
          <tr>
            <th className="py-1 text-left font-normal">Schedule</th>
            <th className="px-2 py-1 text-right font-normal">Occurrences</th>
            <th className="py-1 text-right font-normal">Net amount</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((each) => (
            <tr key={`${each.scheduleId}:${each.amount > 0}`} className="border-t">
              <td className="py-1">
                <button
                  type="button"
                  className="cursor-pointer text-left font-medium underline underline-offset-2 hover:text-foreground/80"
                  onClick={() => onEdit(each.scheduleId)}
                >
                  {each.scheduleName || "Unnamed schedule"}
                </button>
                {each.isAccountless && (
                  <div className="text-xs text-muted-foreground">No account assigned</div>
                )}
                {each.isTransfer && <div className="text-xs text-muted-foreground">Transfer</div>}
              </td>
              <td className="px-2 text-right tabular-nums">{each.count}</td>
              <td className="text-right">
                <Money amount={each.amount} />
              </td>
            </tr>
          ))}
          {remaining.length > 0 && (
            <tr className="border-t text-muted-foreground">
              <td className="py-2">
                Other {remaining.length} {remaining.length === 1 ? "schedule" : "schedules"}
              </td>
              <td className="px-2 text-right tabular-nums">
                {remaining.reduce((sum, each) => sum + each.count, 0)}
              </td>
              <td className="text-right">
                <Money amount={remaining.reduce((sum, each) => sum + each.amount, 0)} />
              </td>
            </tr>
          )}
          {contributors.length === 0 && (
            <tr>
              <td colSpan={3} className="py-3 text-muted-foreground">
                No scheduled contributions in this direction.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t font-medium">
            <th scope="row" colSpan={2} className="py-2 text-left">
              Total
            </th>
            <td className="text-right">
              <Money amount={total} />
            </td>
          </tr>
        </tfoot>
      </table>
      {contributors.length > 5 && (
        <Button variant="link" className="px-0" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show top five" : "Show all"}
        </Button>
      )}
    </div>
  );
}

function EditSchedule({ id, onClose }: { id: string; onClose: () => void }) {
  const { id: book } = useBook();
  const schedule = useQuery(bookQuery(book, "get_schedule", { id })).data;
  return (
    <ScheduleEditor
      schedule={schedule ?? null}
      draft={null}
      open={schedule !== undefined}
      onOpenChange={(open) => !open && onClose()}
    />
  );
}

/** Actual's "What drives this forecast?": the balance's parts and each schedule's share. */
export function ForecastContributors({
  contributors,
  fetching,
}: {
  contributors: Contributors;
  fetching?: boolean | undefined;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const leave = usePaneLeave();
  const edit = (id: string) => leave(() => setEditing(id));
  const figures = [
    { label: "Opening balance", amount: contributors.openingBalance },
    { label: "Recorded transactions (net)", amount: contributors.recordedNet },
    { label: "Scheduled changes (net)", amount: contributors.scheduledNet },
    { label: "Ending balance", amount: contributors.endingBalance },
  ];
  return (
    <section
      aria-labelledby="forecast-contributors-heading"
      aria-busy={fetching}
      className={cn("grid gap-3 transition-opacity", fetching && "opacity-60")}
    >
      <div className="grid gap-1">
        <h2 id="forecast-contributors-heading" className="text-sm font-semibold">
          What drives this forecast?
        </h2>
        <p className="text-xs text-muted-foreground">
          Upcoming schedules follow this report's range and filters. Select a schedule to edit it.
          Recorded occurrences are excluded from scheduled changes; transfers between included
          accounts cancel out.
        </p>
      </div>
      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        {figures.map((figure) => (
          <div key={figure.label}>
            <dt className="mb-1 text-xs text-muted-foreground">{figure.label}</dt>
            <dd>
              <Money amount={figure.amount} />
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-6">
        <ContributorsTable direction="inflow" contributors={contributors.inflows} onEdit={edit} />
        <ContributorsTable direction="outflow" contributors={contributors.outflows} onEdit={edit} />
      </div>
      {contributors.internalTransferCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {contributors.internalTransferCount} internal transfer{" "}
          {contributors.internalTransferCount === 1 ? "occurrence has" : "occurrences have"} no net
          effect.
        </p>
      )}
      {editing !== null && <EditSchedule id={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

/** Edits the comparison's lines: each one's name, accounts and filters. */
export function SeriesEditor({
  series,
  onChange,
  names,
  choices,
}: {
  series: ReadonlyArray<ForecastSeriesMeta>;
  onChange: (series: ReadonlyArray<ForecastSeriesMeta>) => void;
  names: Names;
  choices: Choices;
}) {
  const update = (id: string, change: Partial<ForecastSeriesMeta>) =>
    onChange(series.map((line) => (line.id === id ? { ...line, ...change } : line)));
  return (
    <div id="forecast-series-editor" className="grid gap-3">
      {series.map((line, index) => (
        <fieldset
          key={line.id}
          aria-label={`Forecast line ${index + 1}`}
          className="grid gap-2 border-b pb-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <SeriesKey index={index} name={`Line ${index + 1}`} />
            <Input
              className="w-52"
              aria-label={`Line ${index + 1} name`}
              maxLength={80}
              value={line.name}
              onChange={(event) => update(line.id, { name: event.target.value })}
            />
            <MultiChoice
              label={`Line ${index + 1} accounts`}
              none="All accounts"
              items={choices.accounts}
              value={line.accounts ?? []}
              onChange={(accounts) => {
                const { accounts: _accounts, ...rest } = line;
                onChange(
                  series.map((each) =>
                    each.id === line.id
                      ? accounts.length === 0
                        ? rest
                        : { ...rest, accounts }
                      : each,
                  ),
                );
              }}
            />
            <FilterButton
              choices={choices}
              onAdd={(condition) =>
                update(line.id, { conditions: [...line.conditions, condition] })
              }
            />
            <Button
              variant="ghost"
              disabled={series.length === 1}
              aria-label={`Remove line ${index + 1}`}
              onClick={() => onChange(series.filter((each) => each.id !== line.id))}
            >
              <XIcon />
              Remove
            </Button>
          </div>
          <AppliedFilters
            conditions={line.conditions}
            conditionsOp={line.conditionsOp}
            names={names}
            choices={choices}
            onChange={(conditions, conditionsOp) => update(line.id, { conditions, conditionsOp })}
          />
        </fieldset>
      ))}
      <div>
        <Button
          variant="outline"
          disabled={series.length >= MAX_FORECAST_SERIES}
          onClick={() =>
            onChange([
              ...series,
              {
                id: crypto.randomUUID(),
                name: `Line ${series.length + 1}`,
                conditions: [],
                conditionsOp: "and",
              },
            ])
          }
        >
          <PlusIcon />
          Add line
        </Button>
      </div>
    </div>
  );
}

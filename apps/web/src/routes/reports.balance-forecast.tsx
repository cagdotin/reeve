import {
  addMonths,
  currentMonth,
  firstDay,
  lastDay,
  monthOf,
  monthRange,
} from "@reeve/contract/rules";
import type { BalanceForecastReport } from "@reeve/contract/catalog";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CalendarRangeIcon } from "lucide-react";
import { useState } from "react";
import {
  ForecastContributors,
  ForecastGraph,
  SeriesEditor,
  SeriesSummary,
} from "@/components/reports/balance-forecast";
import { useChoices, useEarliestMonth } from "@/components/reports/choices";
import {
  AppliedFilters,
  Choice,
  FilterButton,
  MultiChoice,
  Segmented,
} from "@/components/reports/controls";
import { balanceForecastInput } from "@/components/reports/inputs";
import {
  longMonth,
  shortMonth,
  type BalanceForecastMeta,
  type ForecastSeriesMeta,
  type TimeFrame,
} from "@/components/reports/meta";
import { QueryBody } from "@/components/page";
import { ReportLoading, ReportShell } from "@/components/reports/report-shell";
import {
  type Saver,
  prepareSaver,
  reportMeta,
  useReportState,
  useSavedReport,
  validateReportSearch,
} from "@/components/reports/report-state";
import { Money } from "@/components/money";
import { Button } from "@reeve/ui/components/button";
import { Input } from "@reeve/ui/components/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@reeve/ui/components/menu";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";

export const Route = createFileRoute("/reports/balance-forecast")({
  validateSearch: validateReportSearch,
  component: BalanceForecastPage,
});

function BalanceForecastPage() {
  const { report: id } = Route.useSearch();
  const saved = useSavedReport<BalanceForecastMeta>("balance-forecast", id);
  if (saved.loading) return <ReportLoading name="Balance Forecast" query={saved.query} />;
  return (
    <BalanceForecast
      key={saved.report?.id ?? "new"}
      initial={reportMeta<BalanceForecastMeta>(saved.report)}
      saver={saved.saver}
    />
  );
}

/** The forecast's default range, as Actual's: this month and the next eleven, static. */
const defaultForecastFrame = (): TimeFrame => ({
  start: currentMonth(),
  end: addMonths(currentMonth(), 11),
  mode: "static",
});

/** The settings Actual's page saves: the dates twice over, and the first line's filters on the report. */
const savedMeta = (meta: BalanceForecastMeta, tracking: boolean): BalanceForecastMeta => {
  const frame = meta.timeFrame ?? defaultForecastFrame();
  const series = meta.series?.map((line, index) => ({
    ...line,
    name: line.name.trim() || `Line ${index + 1}`,
  }));
  return {
    ...meta,
    conditions: meta.conditions ?? [],
    conditionsOp: meta.conditionsOp ?? "and",
    startDate: frame.start,
    endDate: frame.end,
    granularity: tracking ? "Monthly" : (meta.granularity ?? "Monthly"),
    yAxisBase: meta.yAxisBase ?? "Auto",
    source: meta.source ?? "schedules",
    ...(series !== undefined && series.length > 0
      ? {
          series,
          accounts: series[0]!.accounts,
          conditions: series[0]!.conditions,
          conditionsOp: series[0]!.conditionsOp,
        }
      : {}),
    timeFrame: frame,
  };
};

/**
 * The forecast's range: months, or exact days when daily, with Actual's future ranges. Picking
 * dates keeps the range static.
 */
function ForecastRange({
  frame,
  daily,
  earliest,
  latest,
  onChange,
}: {
  frame: TimeFrame;
  daily: boolean;
  earliest: string | undefined;
  latest: string;
  onChange: (frame: TimeFrame) => void;
}) {
  const now = currentMonth();
  const startMonth = monthOf(frame.start);
  const endMonth = monthOf(frame.end);
  const first = [earliest ?? addMonths(now, -12), startMonth].sort()[0]!;
  const last = [addMonths(now, 24), endMonth, latest].sort().at(-1)!;
  const months = monthRange(first, last)
    .toReversed()
    .map((month) => ({ value: month, label: shortMonth(month) }));
  const presets = [
    { label: "Next 3 months", frame: { start: now, end: addMonths(now, 2) } },
    { label: "Next 6 months", frame: { start: now, end: addMonths(now, 5) } },
    { label: "Next year", frame: { start: now, end: addMonths(now, 11) } },
    { label: "All future", frame: { start: now, end: latest > now ? latest : now } },
  ];
  const day = (value: string, edge: "start" | "end") =>
    value.length === 10 ? value : edge === "start" ? firstDay(value) : lastDay(value);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {daily ? (
        <>
          <Input
            type="date"
            aria-label="First day"
            className="w-36"
            value={day(frame.start, "start")}
            onChange={(event) =>
              event.target.value !== "" &&
              onChange({ ...frame, start: event.target.value, mode: "static" })
            }
          />
          <span className="text-muted-foreground">to</span>
          <Input
            type="date"
            aria-label="Last day"
            className="w-36"
            value={day(frame.end, "end")}
            onChange={(event) =>
              event.target.value !== "" &&
              onChange({ ...frame, end: event.target.value, mode: "static" })
            }
          />
        </>
      ) : (
        <>
          <Choice
            label="First month"
            items={months}
            value={startMonth}
            onChange={(start) =>
              onChange({ start, end: start > endMonth ? start : endMonth, mode: "static" })
            }
          />
          <span className="text-muted-foreground">to</span>
          <Choice
            label="Last month"
            items={months}
            value={endMonth}
            onChange={(end) =>
              onChange({ start: end < startMonth ? end : startMonth, end, mode: "static" })
            }
          />
        </>
      )}
      <Menu>
        <MenuTrigger render={<Button variant="ghost" />}>
          <CalendarRangeIcon />
          Ranges
        </MenuTrigger>
        <MenuPopup align="start">
          {presets.map((preset) => (
            <MenuItem
              key={preset.label}
              onClick={() => onChange({ ...preset.frame, mode: "static" })}
            >
              {preset.label}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </div>
  );
}

/** The settings the page starts from: a report saved by Actual carries only the dates, not a frame. */
const startingMeta = (initial: BalanceForecastMeta): BalanceForecastMeta =>
  initial.timeFrame !== undefined || initial.startDate === undefined
    ? initial
    : {
        ...initial,
        timeFrame: {
          start: initial.startDate,
          end: initial.endDate ?? addMonths(currentMonth(), 11),
          mode: "static",
        },
      };

/** What the forecast is drawn from: the tracking budget (when chosen), or comparison lines. */
const forecastMode = (meta: BalanceForecastMeta, tracking: boolean) => {
  const isTracking = meta.source === "tracking-budget" && tracking;
  const series = isTracking || !meta.series?.length ? undefined : meta.series;
  return { isTracking, series };
};

function BalanceForecast({
  initial,
  saver,
}: {
  initial: BalanceForecastMeta;
  saver: Saver<BalanceForecastMeta>;
}) {
  const { id: book, book: info } = useBook();
  const tracking = info.settings.budgetType === "tracking";
  const { names, choices } = useChoices(book);
  const { meta, set, save, scope } = useReportState(
    startingMeta(initial),
    { timeFrame: defaultForecastFrame() },
    prepareSaver(saver, (next) => savedMeta(next, tracking)),
  );
  const [editingLines, setEditingLines] = useState(false);
  const { isTracking, series } = forecastMode(meta, tracking);
  const report = useQuery({
    ...bookQuery(book, "balance_forecast_report", {
      ...balanceForecastInput(meta, tracking),
      scope,
    }),
    placeholderData: keepPreviousData,
  });
  const conditions = meta.conditions ?? [];
  const showsFilters = !isTracking && series === undefined && conditions.length > 0;

  return (
    <ReportShell
      name={meta.name || "Balance Forecast"}
      onRename={saver.update ? (name) => set({ name }) : undefined}
      save={save}
      controls={
        <ForecastControls
          meta={meta}
          set={set}
          tracking={tracking}
          latest={
            report.data ? monthOf(report.data.forecastEndDate) : addMonths(currentMonth(), 24)
          }
          editingLines={editingLines}
          onEditLines={setEditingLines}
        />
      }
      filters={
        showsFilters ? (
          <AppliedFilters
            conditions={conditions}
            conditionsOp={meta.conditionsOp ?? "and"}
            names={names}
            choices={choices}
            onChange={(next, conditionsOp) => set({ conditions: next, conditionsOp })}
          />
        ) : undefined
      }
    >
      {series !== undefined && editingLines && (
        <SeriesEditor
          series={series}
          names={names}
          choices={choices}
          onChange={(next) => set({ series: next })}
        />
      )}
      <QueryBody query={report}>
        {(data) => (
          <ForecastBody
            data={data}
            comparison={series !== undefined}
            isTracking={isTracking}
            hasFilters={!isTracking && conditions.length > 0}
            yAxisBase={meta.yAxisBase}
            fetching={report.isFetching}
          />
        )}
      </QueryBody>
    </ReportShell>
  );
}

const dateLabel = (date: string) => (date.length === 7 ? longMonth(date) : date);

/** The single line's ending balance and, when it differs, its lowest visible point. */
function Headline({ line }: { line: BalanceForecastReport["lines"][number] | undefined }) {
  const ending = line?.endingPoint;
  if (!ending) return null;
  const lowest = line.lowestPoint;
  return (
    <div className="grid justify-items-end gap-0.5 text-right">
      <Money amount={ending.balance} className="font-sans text-3xl" />
      <span className="text-sm text-muted-foreground">
        Ending balance: {dateLabel(ending.date)}
      </span>
      {lowest && lowest.date !== ending.date && (
        <span className="text-xs text-muted-foreground">
          Lowest visible point: <Money amount={lowest.balance} /> ({dateLabel(lowest.date)})
        </span>
      )}
    </div>
  );
}

/** The note under the graph: what the forecast is made of over this range. */
const contentNote = (data: BalanceForecastReport, comparison: boolean, isTracking: boolean) => {
  if (comparison)
    return "Each line includes its own matching transactions and upcoming schedules. Lines are not added together.";
  if (isTracking)
    return "Tracking budget forecast uses on-budget balance plus monthly budgeted income minus budgeted expenses.";
  const count = data.scheduledOccurrences;
  if (count === 0)
    return "This range shows posted transactions only; no scheduled occurrences fall in it.";
  return `${count} scheduled ${count === 1 ? "transaction" : "transactions"} included in this date range`;
};

/** The note at the foot: what the line's value means. */
const basisNote = (comparison: boolean, hasFilters: boolean) => {
  if (comparison)
    return "Transaction filters show a running total of matches, not necessarily an account balance. Transfers between selected accounts offset each other when both sides match.";
  return hasFilters
    ? "This forecast shows the running total of matching posted transactions, plus upcoming scheduled transactions in the future."
    : "This forecast shows your running balance from posted transactions, plus upcoming scheduled transactions in the future.";
};

/** The forecast once loaded: its headline, graph, footnotes and contributors. */
function ForecastBody({
  data,
  comparison,
  isTracking,
  hasFilters,
  yAxisBase,
  fetching,
}: {
  data: BalanceForecastReport;
  comparison: boolean;
  isTracking: boolean;
  hasFilters: boolean;
  yAxisBase: BalanceForecastMeta["yAxisBase"];
  fetching: boolean;
}) {
  return (
    <>
      {comparison ? <SeriesSummary lines={data.lines} /> : <Headline line={data.lines[0]} />}
      {data.chartData.length > 0 ? (
        <>
          <ForecastGraph report={data} yAxisBase={yAxisBase} fetching={fetching} />
          <p className="text-xs text-muted-foreground">
            {contentNote(data, comparison, isTracking)}
          </p>
          {data.contributors !== null && (
            <ForecastContributors contributors={data.contributors} fetching={fetching} />
          )}
        </>
      ) : (
        <p className="py-16 text-center text-sm text-muted-foreground">
          No transactions are included in this report. Adjust your filters, accounts, or date range
          to see a balance projection.
        </p>
      )}
      {!isTracking && (
        <p className="text-xs text-muted-foreground">{basisNote(comparison, hasFilters)}</p>
      )}
    </>
  );
}

/** A frame cut back to whole months, for the monthly views. */
const monthly = (frame: TimeFrame): TimeFrame => ({
  ...frame,
  start: monthOf(frame.start),
  end: monthOf(frame.end),
});

/** The first comparison line: the forecast's own accounts and filters. */
const firstLine = (meta: BalanceForecastMeta): ForecastSeriesMeta => ({
  id: crypto.randomUUID(),
  name: "Line 1",
  ...(meta.accounts === undefined ? {} : { accounts: meta.accounts }),
  conditions: meta.conditions ?? [],
  conditionsOp: meta.conditionsOp ?? "and",
});

const linesLabel = (editing: boolean, comparing: boolean) =>
  editing ? "Hide line editor" : comparing ? "Edit lines" : "Compare lines";

/** The forecast's controls: range, source, granularity, axis, accounts, filters and lines. */
function ForecastControls({
  meta,
  set,
  tracking,
  latest,
  editingLines,
  onEditLines,
}: {
  meta: BalanceForecastMeta;
  set: (change: Partial<BalanceForecastMeta>) => void;
  tracking: boolean;
  latest: string;
  editingLines: boolean;
  onEditLines: (editing: boolean) => void;
}) {
  const { id: book } = useBook();
  const { choices } = useChoices(book);
  const earliest = useEarliestMonth(book);
  const { isTracking, series } = forecastMode(meta, tracking);
  const frame = meta.timeFrame ?? defaultForecastFrame();
  const daily = !isTracking && meta.granularity === "Daily";
  return (
    <>
      <ForecastRange
        frame={frame}
        daily={daily}
        earliest={earliest}
        latest={latest}
        onChange={(timeFrame) => set({ timeFrame })}
      />
      {tracking && (
        <Choice
          label="Forecast source"
          items={[
            { value: "schedules", label: "Scheduled transactions" },
            { value: "tracking-budget", label: "Tracking budget" },
          ]}
          value={isTracking ? "tracking-budget" : "schedules"}
          onChange={(source) =>
            set(
              source === "tracking-budget"
                ? { source, granularity: "Monthly", timeFrame: monthly(frame) }
                : { source },
            )
          }
        />
      )}
      <Segmented
        label="Granularity"
        items={[
          { value: "Monthly", label: "Monthly" },
          { value: "Daily", label: "Daily" },
        ]}
        value={daily ? "Daily" : "Monthly"}
        onChange={(granularity) =>
          !isTracking &&
          set(
            granularity === "Monthly"
              ? { granularity, timeFrame: monthly(frame) }
              : { granularity },
          )
        }
      />
      <Segmented
        label="Y axis"
        items={[
          { value: "Auto", label: "Auto" },
          { value: "Zero-Based", label: "Zero-based" },
        ]}
        value={meta.yAxisBase ?? "Auto"}
        onChange={(yAxisBase) => set({ yAxisBase })}
      />
      {!isTracking && series === undefined && (
        <>
          <MultiChoice
            label="Accounts"
            none="All accounts"
            items={choices.accounts}
            value={meta.accounts ?? []}
            onChange={(accounts) => set({ accounts: accounts.length === 0 ? undefined : accounts })}
          />
          <FilterButton
            choices={choices}
            onAdd={(condition) => set({ conditions: [...(meta.conditions ?? []), condition] })}
          />
        </>
      )}
      {!isTracking && (
        <Button
          variant="outline"
          aria-expanded={editingLines}
          aria-controls="forecast-series-editor"
          onClick={() => {
            if (series === undefined) set({ series: [firstLine(meta)] });
            onEditLines(!editingLines);
          }}
        >
          {linesLabel(editingLines, series !== undefined)}
        </Button>
      )}
    </>
  );
}

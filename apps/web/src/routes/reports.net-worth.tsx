import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DataTable, Figure } from "@/components/reports/chart-parts";
import { useChoices, useEarliestMonth } from "@/components/reports/choices";
import {
  AppliedFilters,
  Choice,
  FilterButton,
  Segmented,
  TimeFramePicker,
} from "@/components/reports/controls";
import { netWorthInput } from "@/components/reports/inputs";
import {
  defaultFrame,
  intervalLabel,
  rangeLabel,
  type NetWorthMeta,
} from "@/components/reports/meta";
import { NetWorthGraph } from "@/components/reports/net-worth";
import { QueryBody } from "@/components/page";
import { ReportLoading, ReportShell } from "@/components/reports/report-shell";
import {
  type Saver,
  reportMeta,
  useReportState,
  useSavedReport,
  validateReportSearch,
} from "@/components/reports/report-state";
import { Money } from "@/components/money";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";

export const Route = createFileRoute("/reports/net-worth")({
  validateSearch: validateReportSearch,
  component: NetWorthPage,
});

function NetWorthPage() {
  const { report: id } = Route.useSearch();
  const saved = useSavedReport<NetWorthMeta>("net-worth", id);
  if (saved.loading) return <ReportLoading name="Net Worth" query={saved.query} />;
  return (
    <NetWorth
      key={saved.report?.id ?? "new"}
      initial={reportMeta<NetWorthMeta>(saved.report)}
      saver={saved.saver}
    />
  );
}

const INTERVALS = [
  { value: "Daily", label: "Daily" },
  { value: "Weekly", label: "Weekly" },
  { value: "Monthly", label: "Monthly" },
  { value: "Yearly", label: "Yearly" },
] as const;

function NetWorth({ initial, saver }: { initial: NetWorthMeta; saver: Saver<NetWorthMeta> }) {
  const { id: book } = useBook();
  const { names, choices } = useChoices(book);
  const earliest = useEarliestMonth(book);
  const { meta, set, save, scope } = useReportState(initial, { timeFrame: defaultFrame() }, saver);
  const report = useQuery({
    ...bookQuery(book, "net_worth_report", { ...netWorthInput(meta), scope }),
    placeholderData: keepPreviousData,
  });

  return (
    <ReportShell
      name={meta.name || "Net Worth"}
      onRename={saver.update ? (name) => set({ name }) : undefined}
      save={save}
      controls={
        <>
          <TimeFramePicker
            frame={meta.timeFrame ?? defaultFrame()}
            earliest={earliest}
            onChange={(timeFrame) => set({ timeFrame })}
          />
          <FilterButton
            choices={choices}
            onAdd={(condition) => set({ conditions: [...(meta.conditions ?? []), condition] })}
          />
          <span className="ms-auto flex items-center gap-2">
            <Choice
              label="Interval"
              items={INTERVALS}
              value={meta.interval ?? report.data?.interval ?? "Monthly"}
              onChange={(interval) => set({ interval })}
            />
            <Segmented
              label="Graph"
              items={[
                { value: "trend", label: "Trend" },
                { value: "stacked", label: "Stacked" },
              ]}
              value={meta.mode ?? "trend"}
              onChange={(mode) => set({ mode })}
            />
          </span>
        </>
      }
      filters={
        <AppliedFilters
          conditions={meta.conditions ?? []}
          conditionsOp={meta.conditionsOp ?? "and"}
          onChange={(conditions, conditionsOp) => set({ conditions, conditionsOp })}
          names={names}
          choices={choices}
        />
      }
    >
      <QueryBody query={report}>
        {(data) => (
          <>
            <div className="flex flex-wrap items-end gap-8">
              <Figure label={`Net worth · ${rangeLabel(data.start, data.end)}`}>
                <Money amount={data.netWorth} tone="none" className="font-sans text-2xl" />
              </Figure>
              <Figure label="Change">
                <Money amount={data.totalChange} tone="balance" className="font-sans" />
              </Figure>
              {data.highest !== null && (
                <Figure label="Highest">
                  <Money amount={data.highest} tone="none" className="font-sans" />
                </Figure>
              )}
              {data.lowest !== null && (
                <Figure label="Lowest">
                  <Money amount={data.lowest} tone="none" className="font-sans" />
                </Figure>
              )}
            </div>
            <NetWorthGraph report={data} mode={meta.mode ?? "trend"} fetching={report.isFetching} />
            <DataTable
              rows={data.points.toReversed()}
              rowKey={(point) => point.date}
              columns={[
                { key: "date", label: "Date", value: (point) => intervalLabel(point.date) },
                {
                  key: "assets",
                  label: "Assets",
                  align: "right",
                  value: (point) => <Money amount={point.assets} tone="none" />,
                },
                {
                  key: "debt",
                  label: "Debt",
                  align: "right",
                  value: (point) => <Money amount={-point.debt} />,
                },
                {
                  key: "net",
                  label: "Net worth",
                  align: "right",
                  value: (point) => <Money amount={point.netWorth} />,
                },
                {
                  key: "change",
                  label: "Change",
                  align: "right",
                  value: (point) => <Money amount={point.change} tone="balance" />,
                },
              ]}
            />
          </>
        )}
      </QueryBody>
    </ReportShell>
  );
}

import { addMonths, currentMonth, monthRange } from "@reeve/contract/rules";
import type { SpendingReport } from "@reeve/contract/catalog";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DataTable, Figure } from "@/components/reports/chart-parts";
import { useChoices, useEarliestMonth } from "@/components/reports/choices";
import { AppliedFilters, Choice, FilterButton, Segmented } from "@/components/reports/controls";
import { averageKey, spendingInput } from "@/components/reports/inputs";
import {
  shortMonth,
  type SpendingAverage,
  type SpendingMeta,
  type SpendingMode,
} from "@/components/reports/meta";
import { QueryBody } from "@/components/page";
import { ReportLoading, ReportShell } from "@/components/reports/report-shell";
import {
  type Saver,
  reportMeta,
  useReportState,
  useSavedReport,
  validateReportSearch,
} from "@/components/reports/report-state";
import { SpendingGraph } from "@/components/reports/spending";
import { type SpendingFigure, SpendingRecords } from "@/components/reports/spending-records";
import {
  comparisonDay,
  comparisonLabel,
  spendingDifference,
  spendingRows,
} from "@/components/reports/spending-math";
import { Money } from "@/components/money";
import { Button } from "@reeve/ui/components/button";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import { indentStyle } from "@/lib/categories";
import { monthLabel } from "@/lib/months";
import { useState } from "react";

export const Route = createFileRoute("/reports/spending")({
  validateSearch: validateReportSearch,
  component: SpendingPage,
});

function SpendingPage() {
  const { report: id } = Route.useSearch();
  const saved = useSavedReport<SpendingMeta>("spending", id);
  if (saved.loading) return <ReportLoading name="Monthly Spending" query={saved.query} />;
  return (
    <Spending
      key={saved.report?.id ?? "new"}
      initial={reportMeta<SpendingMeta>(saved.report)}
      saver={saved.saver}
    />
  );
}

const MODES = [
  { value: "single-month", label: "Single month" },
  { value: "budget", label: "Budgeted" },
  { value: "average", label: "Average" },
] as const;

const AVERAGES: ReadonlyArray<{ value: string; label: string; range: SpendingAverage }> = [
  { value: "last-n-months:3", label: "Last 3 months", range: { mode: "last-n-months", months: 3 } },
  { value: "last-n-months:6", label: "Last 6 months", range: { mode: "last-n-months", months: 6 } },
  {
    value: "last-n-months:12",
    label: "Last 12 months",
    range: { mode: "last-n-months", months: 12 },
  },
  { value: "year-to-date", label: "Year to date", range: { mode: "year-to-date" } },
  { value: "all-time", label: "All time", range: { mode: "all-time" } },
];

function Spending({ initial, saver }: { initial: SpendingMeta; saver: Saver<SpendingMeta> }) {
  const { id: book } = useBook();
  const { names, choices } = useChoices(book);
  const depths = new Map(choices.categories.map((each) => [each.value, each.depth]));
  const earliest = useEarliestMonth(book);
  const { meta, set, save, scope } = useReportState(
    initial,
    { isLive: true, mode: "single-month" as SpendingMode },
    saver,
  );
  const report = useQuery({
    ...bookQuery(book, "spending_report", { ...spendingInput(meta), scope }),
    placeholderData: keepPreviousData,
  });
  const mode = meta.mode ?? "single-month";
  const [figure, setFigure] = useState<SpendingFigure | null>(null);
  const conditions = spendingInput(meta).conditions ?? [];

  return (
    <ReportShell
      name={meta.name || "Monthly Spending"}
      onRename={saver.update ? (name) => set({ name }) : undefined}
      save={save}
      controls={
        <>
          <SpendingControls meta={meta} set={set} data={report.data} earliest={earliest} />
          <FilterButton
            choices={choices}
            onAdd={(condition) => set({ conditions: [...(meta.conditions ?? []), condition] })}
          />
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
      {figure !== null && (
        <SpendingRecords
          figure={figure}
          conditions={conditions}
          conditionsOp={meta.conditionsOp ?? "and"}
          scope={scope}
          onClose={() => setFigure(null)}
        />
      )}
      <QueryBody query={report}>
        {(data) => (
          <>
            <SpendingFigures data={data} mode={mode} />
            <SpendingGraph report={data} mode={mode} fetching={report.isFetching} />
            <DataTable
              rows={data.categories}
              rowKey={(category) => category.id}
              columns={[
                {
                  key: "name",
                  label: "Category",
                  value: (category) => (
                    <span style={indentStyle(depths.get(category.id))}>{category.name}</span>
                  ),
                },
                {
                  key: "compare",
                  label: shortMonth(data.compare),
                  align: "right",
                  value: (category) => (
                    <FigureButton
                      amount={category.compare}
                      label={`${category.name}, ${monthLabel(data.compare)}`}
                      onOpen={() => setFigure({ category, month: data.compare })}
                    />
                  ),
                },
                {
                  key: "compareTo",
                  label: shortMonth(data.compareTo),
                  align: "right",
                  value: (category) => (
                    <FigureButton
                      amount={category.compareTo}
                      label={`${category.name}, ${monthLabel(data.compareTo)}`}
                      onOpen={() => setFigure({ category, month: data.compareTo })}
                    />
                  ),
                },
                {
                  key: "average",
                  label: "Average",
                  align: "right",
                  value: (category) => <Money amount={category.average} />,
                },
                {
                  key: "budgeted",
                  label: "Budgeted",
                  align: "right",
                  value: (category) => <Money amount={category.budgeted} tone="none" />,
                },
              ]}
            />
          </>
        )}
      </QueryBody>
    </ReportShell>
  );
}

function FigureButton({
  amount,
  label,
  onOpen,
}: {
  amount: number;
  label: string;
  onOpen: () => void;
}) {
  const { format } = useBook();
  if (amount === 0) return <Money amount={amount} />;
  return (
    <button
      type="button"
      aria-label={`${label}, ${format(amount)}, show transactions`}
      onClick={onOpen}
      className="cursor-pointer rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Money amount={amount} />
    </button>
  );
}

/** What the compare month spent by the comparison day, against its comparison. */
function SpendingFigures({ data, mode }: { data: SpendingReport; mode: SpendingMode }) {
  const row = spendingRows(data, mode)[comparisonDay(data) - 1];
  const mtd = data.compare === currentMonth() ? " MTD" : "";
  return (
    <div className="flex flex-wrap items-end gap-8">
      <Figure label={`Spent ${shortMonth(data.compare)}${mtd}`}>
        <Money amount={row?.compare ?? 0} tone="none" className="font-sans text-2xl" />
      </Figure>
      <Figure label={`${comparisonLabel(mode, data)}${mtd}`}>
        <Money amount={row?.other ?? 0} tone="none" className="font-sans" />
      </Figure>
      <Figure label="Difference">
        <Money amount={-spendingDifference(data, mode)} tone="balance" className="font-sans" />
      </Figure>
    </div>
  );
}

function SpendingControls({
  meta,
  set,
  data,
  earliest,
}: {
  meta: SpendingMeta;
  set: (change: Partial<SpendingMeta>) => void;
  data: SpendingReport | undefined;
  earliest: string | undefined;
}) {
  const mode = meta.mode ?? "single-month";
  const live = meta.isLive !== false;
  const compare = data?.compare ?? meta.compare ?? currentMonth();
  const compareTo = data?.compareTo ?? meta.compareTo ?? addMonths(currentMonth(), -1);
  const months = monthRange(earliest ?? addMonths(currentMonth(), -12), currentMonth())
    .toReversed()
    .map((month) => ({ value: month, label: shortMonth(month) }));
  return (
    <>
      <Button
        variant={live ? "secondary" : "outline"}
        onClick={() => set(live ? { isLive: false, compare, compareTo } : { isLive: true })}
      >
        {live ? "Live" : "Static"}
      </Button>
      <span className="text-sm text-muted-foreground">Compare</span>
      <Choice
        label="Compare"
        items={months}
        value={compare}
        onChange={(next) => set({ isLive: false, compare: next, compareTo })}
      />
      {mode === "single-month" && (
        <>
          <span className="text-sm text-muted-foreground">to</span>
          <Choice
            label="Compare to"
            items={months}
            value={compareTo}
            onChange={(next) => set({ isLive: false, compare, compareTo: next })}
          />
        </>
      )}
      <Segmented
        label="Compare with"
        items={MODES}
        value={mode}
        onChange={(next) => set({ mode: next })}
      />
      {mode === "average" && (
        <Choice
          label="Average of"
          items={AVERAGES}
          value={averageKey(meta.averageRange)}
          onChange={(next) => {
            const picked = AVERAGES.find((each) => each.value === next);
            if (picked) set({ averageRange: picked.range });
          }}
        />
      )}
    </>
  );
}

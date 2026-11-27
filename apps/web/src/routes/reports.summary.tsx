import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { SummaryReport } from "@reeve/contract/catalog";
import { SummaryValue } from "@/components/reports/cards";
import { Figure } from "@/components/reports/chart-parts";
import { useChoices, useEarliestMonth } from "@/components/reports/choices";
import {
  AppliedFilters,
  Choice,
  ConditionsEditor,
  FilterButton,
  TimeFramePicker,
} from "@/components/reports/controls";
import { summaryInput } from "@/components/reports/inputs";
import {
  defaultFrame,
  summaryContent,
  rangeLabel,
  type SummaryContent,
  type SummaryContentType,
  type SummaryMeta,
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
import { Checkbox } from "@reeve/ui/components/checkbox";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";

export const Route = createFileRoute("/reports/summary")({
  validateSearch: validateReportSearch,
  component: SummaryPage,
});

function SummaryPage() {
  const { report: id } = Route.useSearch();
  const saved = useSavedReport<SummaryMeta>("summary", id);
  if (saved.loading) return <ReportLoading name="Summary" query={saved.query} />;
  return (
    <Summary
      key={saved.report?.id ?? "new"}
      initial={reportMeta<SummaryMeta>(saved.report)}
      saver={saved.saver}
    />
  );
}

const CONTENTS: ReadonlyArray<{ value: SummaryContentType; label: string }> = [
  { value: "sum", label: "Sum" },
  { value: "avgPerMonth", label: "Average per month" },
  { value: "avgPerYear", label: "Average per year" },
  { value: "avgPerTransact", label: "Average per transaction" },
  { value: "percentage", label: "Percentage" },
];

function Summary({ initial, saver }: { initial: SummaryMeta; saver: Saver<SummaryMeta> }) {
  const { id: book } = useBook();
  const { names, choices } = useChoices(book);
  const earliest = useEarliestMonth(book);
  const { meta, set, save, scope } = useReportState(
    initial,
    { timeFrame: defaultFrame(), content: { type: "sum" } },
    saver,
  );
  const content = summaryContent(meta);
  const setContent = (change: Partial<SummaryContent>) =>
    set({ content: { ...content, ...change } });
  const report = useQuery({
    ...bookQuery(book, "summary_report", { ...summaryInput(meta), scope }),
    placeholderData: keepPreviousData,
  });
  const percentage = content.type === "percentage";

  return (
    <ReportShell
      name={meta.name || "Summary"}
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
              label="Show"
              items={CONTENTS}
              value={content.type}
              onChange={(type) => setContent({ type })}
            />
          </span>
        </>
      }
      filters={
        <>
          <AppliedFilters
            conditions={meta.conditions ?? []}
            conditionsOp={meta.conditionsOp ?? "and"}
            onChange={(conditions, conditionsOp) => set({ conditions, conditionsOp })}
            names={names}
            choices={choices}
          />
          {percentage && (
            <DivisorFilter
              content={content}
              setContent={setContent}
              names={names}
              choices={choices}
            />
          )}
        </>
      }
    >
      <QueryBody query={report}>
        {(data) => <SummaryResult data={data} content={content} />}
      </QueryBody>
    </ReportShell>
  );
}

function DivisorFilter({
  content,
  setContent,
  names,
  choices,
}: {
  content: SummaryContent;
  setContent: (change: Partial<SummaryContent>) => void;
  names: ReturnType<typeof useChoices>["names"];
  choices: ReturnType<typeof useChoices>["choices"];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Divided by</span>
      <ConditionsEditor
        conditions={content.divisorConditions ?? []}
        conditionsOp={content.divisorConditionsOp ?? "and"}
        onChange={(divisorConditions, divisorConditionsOp) =>
          setContent({ divisorConditions, divisorConditionsOp })
        }
        names={names}
        choices={choices}
      />
      <div className="ms-2 flex items-center gap-1.5 text-muted-foreground">
        <Checkbox
          aria-label="Divisor over all time"
          checked={content.divisorAllTimeDateRange ?? false}
          onCheckedChange={(checked) => setContent({ divisorAllTimeDateRange: checked })}
        />
        Divisor over all time
      </div>
    </div>
  );
}

const DIVISOR_LABELS: Record<SummaryContentType, string> = {
  sum: "Months",
  avgPerMonth: "Months",
  avgPerYear: "Years",
  avgPerTransact: "Transactions",
  percentage: "Divisor",
};

function SummaryResult({ data, content }: { data: SummaryReport; content: SummaryContent }) {
  const percentage = content.type === "percentage";
  return (
    <>
      <div className="grid min-h-64 place-items-center rounded-xl border bg-card p-8">
        <div className="grid justify-items-center gap-2">
          <SummaryValue value={data.total} percentage={percentage} />
          <span className="text-xs text-muted-foreground">{rangeLabel(data.start, data.end)}</span>
        </div>
      </div>
      {content.type !== "sum" && (
        <div className="flex flex-wrap gap-8">
          <Figure label={percentage ? "Matching" : "Sum"}>
            <SummaryValue value={data.dividend} percentage={false} size={18} />
          </Figure>
          <Figure label={DIVISOR_LABELS[content.type]}>
            {percentage ? (
              <SummaryValue value={data.divisor} percentage={false} size={18} />
            ) : (
              <span className="text-lg font-semibold">{Math.round(data.divisor * 100) / 100}</span>
            )}
          </Figure>
        </div>
      )}
    </>
  );
}

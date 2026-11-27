import { PageAlert } from "@/components/page-alert";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ageText, ageTone, TREND } from "@/components/reports/age";
import { AgeOfMoneyGraph } from "@/components/reports/age-of-money";
import { useChoices, useEarliestMonth } from "@/components/reports/choices";
import {
  AppliedFilters,
  FilterButton,
  Segmented,
  TimeFramePicker,
} from "@/components/reports/controls";
import { ageOfMoneyInput } from "@/components/reports/inputs";
import { defaultFrame, rangeLabel, type AgeOfMoneyMeta } from "@/components/reports/meta";
import { QueryBody } from "@/components/page";
import { ReportLoading, ReportShell } from "@/components/reports/report-shell";
import {
  type Saver,
  reportMeta,
  useReportState,
  useSavedReport,
  validateReportSearch,
} from "@/components/reports/report-state";
import { cn } from "@reeve/ui/lib/utils";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";

export const Route = createFileRoute("/reports/age-of-money")({
  validateSearch: validateReportSearch,
  component: AgeOfMoneyPage,
});

function AgeOfMoneyPage() {
  const { report: id } = Route.useSearch();
  const saved = useSavedReport<AgeOfMoneyMeta>("age-of-money", id);
  if (saved.loading) return <ReportLoading name="Age of Money" query={saved.query} />;
  return (
    <AgeOfMoney
      key={saved.report?.id ?? "new"}
      initial={reportMeta<AgeOfMoneyMeta>(saved.report)}
      saver={saved.saver}
    />
  );
}

function AgeOfMoney({ initial, saver }: { initial: AgeOfMoneyMeta; saver: Saver<AgeOfMoneyMeta> }) {
  const { id: book } = useBook();
  const { names, choices } = useChoices(book);
  const earliest = useEarliestMonth(book);
  const { meta, set, save, scope } = useReportState(
    initial,
    { timeFrame: defaultFrame(), granularity: "monthly" },
    saver,
  );
  const report = useQuery({
    ...bookQuery(book, "age_of_money_report", { ...ageOfMoneyInput(meta), scope }),
    placeholderData: keepPreviousData,
  });

  return (
    <ReportShell
      name={meta.name || "Age of Money"}
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
          <div className="ms-auto">
            <Segmented
              label="Granularity"
              items={[
                { value: "daily", label: "Daily" },
                { value: "weekly", label: "Weekly" },
                { value: "monthly", label: "Monthly" },
              ]}
              value={meta.granularity ?? "monthly"}
              onChange={(granularity) => set({ granularity })}
            />
          </div>
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
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">
                Age of money · {rangeLabel(data.start, data.end)}
              </span>
              <span className={cn("text-3xl font-semibold", ageTone(data.currentAge))}>
                {ageText(data.currentAge)}
              </span>
              <span className="text-sm text-muted-foreground">{TREND[data.trend]}</span>
              {data.insufficientData && (
                <PageAlert variant="info" title="Some spending could not be matched to income">
                  Spending exceeded income in this period.
                </PageAlert>
              )}
            </div>
            <AgeOfMoneyGraph report={data} fetching={report.isFetching} />
            <div className="grid max-w-prose gap-2 text-sm text-muted-foreground">
              <p>
                <strong className="text-foreground">Age of money</strong> is how many days, on
                average, money sits in the budget before it is spent. Above 30 days you are spending
                last month's income rather than living paycheck to paycheck.
              </p>
              <p>
                Spending draws on the oldest income first (first in, first out); its age is the days
                between receiving that income and spending it. The figure is the average of the last
                ten outflows. Only budget accounts count, and transfers between them are left out.
              </p>
            </div>
          </>
        )}
      </QueryBody>
    </ReportShell>
  );
}

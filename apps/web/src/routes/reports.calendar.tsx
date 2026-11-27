import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { useState } from "react";
import { CalendarMonth } from "@/components/reports/calendar";
import { slot, useChartTheme } from "@/components/reports/chart-theme";
import { ChartLegend, Figure } from "@/components/reports/chart-parts";
import { useChoices, useEarliestMonth } from "@/components/reports/choices";
import { AppliedFilters, FilterButton, TimeFramePicker } from "@/components/reports/controls";
import { calendarInput } from "@/components/reports/inputs";
import { defaultFrame, type CalendarMeta } from "@/components/reports/meta";
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
import { Button } from "@reeve/ui/components/button";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";

export const Route = createFileRoute("/reports/calendar")({
  validateSearch: validateReportSearch,
  component: CalendarPage,
});

function CalendarPage() {
  const { report: id } = Route.useSearch();
  const saved = useSavedReport<CalendarMeta>("calendar", id);
  if (saved.loading) return <ReportLoading name="Calendar" query={saved.query} />;
  return (
    <Calendar
      key={saved.report?.id ?? "new"}
      initial={reportMeta<CalendarMeta>(saved.report)}
      saver={saved.saver}
    />
  );
}

function Calendar({ initial, saver }: { initial: CalendarMeta; saver: Saver<CalendarMeta> }) {
  const { id: book } = useBook();
  const theme = useChartTheme();
  const { names, choices } = useChoices(book);
  const earliest = useEarliestMonth(book);
  const [day, setDay] = useState<string | null>(null);
  const { meta, set, save, scope } = useReportState(initial, { timeFrame: defaultFrame(3) }, saver);
  const report = useQuery({
    ...bookQuery(book, "calendar_report", { ...calendarInput(meta), scope }),
    placeholderData: keepPreviousData,
  });

  return (
    <ReportShell
      name={meta.name || "Calendar"}
      onRename={saver.update ? (name) => set({ name }) : undefined}
      save={save}
      controls={
        <>
          <TimeFramePicker
            frame={meta.timeFrame ?? defaultFrame(3)}
            earliest={earliest}
            onChange={(timeFrame) => set({ timeFrame })}
          />
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
      <QueryBody query={report}>
        {(data) => (
          <>
            <div className="flex flex-wrap items-end gap-8">
              <Figure label="Income">
                <Money
                  amount={data.months.reduce((sum, month) => sum + month.totalIncome, 0)}
                  tone="none"
                  className="font-sans"
                />
              </Figure>
              <Figure label="Expenses">
                <Money
                  amount={data.months.reduce((sum, month) => sum + month.totalExpense, 0)}
                  tone="none"
                  className="font-sans"
                />
              </Figure>
              <ChartLegend
                className="ms-auto"
                items={[
                  { label: "Income", color: slot(theme, 0) },
                  { label: "Expenses", color: theme.out },
                ]}
              />
            </div>
            {day !== null && <DayTransactions day={day} onClose={() => setDay(null)} />}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-6">
              {data.months.toReversed().map((month) => (
                <CalendarMonth key={month.month} month={month} onPickDay={setDay} />
              ))}
            </div>
          </>
        )}
      </QueryBody>
    </ReportShell>
  );
}

/** The transactions of the day picked on the calendar. */
function DayTransactions({ day, onClose }: { day: string; onClose: () => void }) {
  const { id: book, formatDay } = useBook();
  const transactions = useQuery(bookQuery(book, "list_transactions", { from: day, to: day }));
  return (
    <div className="rounded-xl border">
      <div className="flex h-9 items-center border-b px-3 text-sm font-medium">
        {formatDay(day)}
        <Button
          size="icon"
          variant="ghost"
          className="ms-auto"
          aria-label="Close"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
      <QueryBody query={transactions}>
        {({ rows }) =>
          rows.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">No transactions.</p>
          ) : (
            rows.map((row) => (
              <div
                key={row.postingId}
                className="flex h-8 items-center gap-3 border-b px-3 text-[13px] last:border-b-0"
              >
                <span className="w-40 truncate">{row.payee ?? "—"}</span>
                <span className="w-32 truncate text-muted-foreground">{row.accountName}</span>
                <span className="flex-1 truncate text-muted-foreground">
                  {("name" in row.counterpart ? row.counterpart.name : null) ?? row.notes ?? ""}
                </span>
                <Money amount={row.amount} />
              </div>
            ))
          )
        }
      </QueryBody>
    </div>
  );
}

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CashFlowGraph } from "@/components/reports/cash-flow";
import { DataTable, Figure } from "@/components/reports/chart-parts";
import { useChoices, useEarliestMonth } from "@/components/reports/choices";
import { AppliedFilters, FilterButton, TimeFramePicker } from "@/components/reports/controls";
import { cashFlowInput } from "@/components/reports/inputs";
import {
  defaultFrame,
  intervalLabel,
  rangeLabel,
  type CashFlowMeta,
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
import { Money } from "@/components/money";
import { Button } from "@reeve/ui/components/button";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";

export const Route = createFileRoute("/reports/cash-flow")({
  validateSearch: validateReportSearch,
  component: CashFlowPage,
});

function CashFlowPage() {
  const { report: id } = Route.useSearch();
  const saved = useSavedReport<CashFlowMeta>("cash-flow", id);
  if (saved.loading) return <ReportLoading name="Cash Flow" query={saved.query} />;
  return (
    <CashFlow
      key={saved.report?.id ?? "new"}
      initial={reportMeta<CashFlowMeta>(saved.report)}
      saver={saved.saver}
    />
  );
}

function CashFlow({ initial, saver }: { initial: CashFlowMeta; saver: Saver<CashFlowMeta> }) {
  const { id: book } = useBook();
  const { names, choices } = useChoices(book);
  const earliest = useEarliestMonth(book);
  const { meta, set, save, scope } = useReportState(
    initial,
    { timeFrame: defaultFrame(), showBalance: true },
    saver,
  );
  const report = useQuery({
    ...bookQuery(book, "cash_flow_report", { ...cashFlowInput(meta), scope }),
    placeholderData: keepPreviousData,
  });
  const showBalance = meta.showBalance ?? true;

  return (
    <ReportShell
      name={meta.name || "Cash Flow"}
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
          <Button
            variant="outline"
            className="ms-auto"
            onClick={() => set({ showBalance: !showBalance })}
          >
            {showBalance ? "Hide balance" : "Show balance"}
          </Button>
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
              <Figure label={`Change · ${rangeLabel(data.start, data.end)}`}>
                <Money
                  amount={data.totalIncome + data.totalExpenses + data.totalTransfers}
                  tone="balance"
                  className="font-sans text-2xl"
                />
              </Figure>
              <Figure label="Income">
                <Money amount={data.totalIncome} tone="none" className="font-sans" />
              </Figure>
              <Figure label="Expenses">
                <Money amount={data.totalExpenses} tone="none" className="font-sans" />
              </Figure>
              <Figure label="Transfers">
                <Money amount={data.totalTransfers} tone="none" className="font-sans" />
              </Figure>
              <Figure label="Ending balance">
                <Money amount={data.balance} tone="none" className="font-sans" />
              </Figure>
            </div>
            <CashFlowGraph report={data} showBalance={showBalance} fetching={report.isFetching} />
            <DataTable
              rows={data.points.toReversed()}
              rowKey={(point) => point.date}
              columns={[
                { key: "date", label: "Date", value: (point) => intervalLabel(point.date) },
                {
                  key: "income",
                  label: "Income",
                  align: "right",
                  value: (point) => <Money amount={point.income} tone="none" />,
                },
                {
                  key: "expenses",
                  label: "Expenses",
                  align: "right",
                  value: (point) => <Money amount={point.expenses} />,
                },
                {
                  key: "transfers",
                  label: "Transfers",
                  align: "right",
                  value: (point) => <Money amount={point.transfers} />,
                },
                {
                  key: "balance",
                  label: "Balance",
                  align: "right",
                  value: (point) => <Money amount={point.balance} />,
                },
              ]}
            />
          </>
        )}
      </QueryBody>
    </ReportShell>
  );
}

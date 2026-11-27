import type { BudgetAnalysisReport } from "@reeve/contract/catalog";
import { currentMonth } from "@reeve/contract/rules";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DownloadIcon, Settings2Icon } from "lucide-react";
import { BudgetAnalysisGraph } from "@/components/reports/budget-analysis";
import { DataTable, Figure } from "@/components/reports/chart-parts";
import { useChoices, useEarliestMonth } from "@/components/reports/choices";
import {
  AppliedFilters,
  FilterButton,
  Segmented,
  TimeFramePicker,
} from "@/components/reports/controls";
import { budgetAnalysisInput } from "@/components/reports/inputs";
import {
  defaultFrame,
  longMonth,
  rangeLabel,
  type BudgetAnalysisMeta,
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
import { Menu, MenuCheckboxItem, MenuPopup, MenuTrigger } from "@reeve/ui/components/menu";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";

export const Route = createFileRoute("/reports/budget-analysis")({
  validateSearch: validateReportSearch,
  component: BudgetAnalysisPage,
});

function BudgetAnalysisPage() {
  const { report: id } = Route.useSearch();
  const saved = useSavedReport<BudgetAnalysisMeta>("budget-analysis", id);
  if (saved.loading)
    return (
      <ReportLoading
        name="Budget Analysis"
        query={saved.query}
        actions={
          <Button variant="ghost" disabled>
            <DownloadIcon />
            Export CSV
          </Button>
        }
      />
    );
  return (
    <BudgetAnalysis
      key={saved.report?.id ?? "new"}
      initial={reportMeta<BudgetAnalysisMeta>(saved.report)}
      saver={saved.saver}
    />
  );
}

/** The months the pickers offer run to December of next year, for planning ahead. */
const lastSelectableMonth = () => `${Number(currentMonth().slice(0, 4)) + 1}-12`;

const amount = (value: number) => (value / 100).toFixed(2);

/** The report as CSV, as Actual's export: month, budgeted, spent, adjustment, balance. */
const toCsv = (report: BudgetAnalysisReport) =>
  [
    "Month,Budgeted,Spent,Overspending Adjustment,Balance",
    ...report.intervals.map((row) =>
      [
        row.date,
        amount(row.budgeted),
        amount(row.spent),
        amount(row.overspendingAdjustment),
        amount(row.balance),
      ].join(","),
    ),
  ].join("\n");

const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
};

function BudgetAnalysis({
  initial,
  saver,
}: {
  initial: BudgetAnalysisMeta;
  saver: Saver<BudgetAnalysisMeta>;
}) {
  const { id: book } = useBook();
  const { names, choices } = useChoices(book);
  const earliest = useEarliestMonth(book);
  const { meta, set, save } = useReportState(
    initial,
    {
      timeFrame: defaultFrame(),
      graphType: "Bar",
      showBalance: true,
      balanceOnly: false,
      showHiddenCategories: false,
    },
    saver,
  );
  const report = useQuery({
    ...bookQuery(book, "budget_analysis_report", budgetAnalysisInput(meta)),
    placeholderData: keepPreviousData,
  });
  const name = meta.name || "Budget Analysis";

  return (
    <ReportShell
      name={name}
      onRename={saver.update ? (next) => set({ name: next }) : undefined}
      save={save}
      actions={
        <Button
          variant="ghost"
          disabled={report.data === undefined}
          onClick={() =>
            report.data && download(`${name.replace(/[^\w -]/g, "")}.csv`, toCsv(report.data))
          }
        >
          <DownloadIcon />
          Export CSV
        </Button>
      }
      controls={
        <>
          <TimeFramePicker
            frame={meta.timeFrame ?? defaultFrame()}
            earliest={earliest}
            latest={lastSelectableMonth()}
            onChange={(timeFrame) => set({ timeFrame })}
          />
          <FilterButton
            choices={choices}
            onAdd={(condition) => set({ conditions: [...(meta.conditions ?? []), condition] })}
          />
          <div className="ms-auto flex items-center gap-2">
            <Segmented
              label="Chart type"
              items={[
                { value: "Bar", label: "Bars" },
                { value: "Line", label: "Lines" },
              ]}
              value={meta.graphType ?? "Bar"}
              onChange={(graphType) => set({ graphType })}
            />
            <Menu>
              <MenuTrigger render={<Button variant="outline" />}>
                <Settings2Icon />
                Options
              </MenuTrigger>
              <MenuPopup align="end">
                <MenuCheckboxItem
                  checked={meta.showBalance ?? true}
                  onCheckedChange={(showBalance) => set({ showBalance })}
                >
                  Show balance
                </MenuCheckboxItem>
                <MenuCheckboxItem
                  checked={!(meta.balanceOnly ?? false)}
                  onCheckedChange={(shown) => set({ balanceOnly: !shown })}
                >
                  Show categories
                </MenuCheckboxItem>
                <MenuCheckboxItem
                  checked={meta.showHiddenCategories ?? false}
                  onCheckedChange={(showHiddenCategories) => set({ showHiddenCategories })}
                >
                  Show hidden categories
                </MenuCheckboxItem>
              </MenuPopup>
            </Menu>
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
            <div className="flex flex-wrap items-end gap-8">
              <Figure label={`Ending balance · ${rangeLabel(data.start, data.end)}`}>
                <Money amount={data.endingBalance} tone="balance" className="font-sans text-2xl" />
              </Figure>
              <Figure label="Budgeted">
                <Money amount={data.totalBudgeted} tone="none" className="font-sans" />
              </Figure>
              <Figure label="Spent">
                <Money amount={data.totalSpent} tone="none" className="font-sans" />
              </Figure>
              <Figure label="Overspending adjustment">
                <Money
                  amount={data.totalOverspendingAdjustment}
                  tone="none"
                  className="font-sans"
                />
              </Figure>
            </div>
            <BudgetAnalysisGraph
              report={data}
              graphType={meta.graphType ?? "Bar"}
              showBalance={meta.showBalance ?? true}
              balanceOnly={meta.balanceOnly ?? false}
              fetching={report.isFetching}
            />
            <DataTable
              rows={data.intervals.toReversed()}
              rowKey={(row) => row.date}
              columns={[
                { key: "date", label: "Month", value: (row) => longMonth(row.date) },
                {
                  key: "budgeted",
                  label: "Budgeted",
                  align: "right",
                  value: (row) => <Money amount={row.budgeted} tone="none" />,
                },
                {
                  key: "spent",
                  label: "Spent",
                  align: "right",
                  value: (row) => <Money amount={row.spent} tone="none" />,
                },
                {
                  key: "overspendingAdjustment",
                  label: "Overspending adjustment",
                  align: "right",
                  value: (row) => <Money amount={row.overspendingAdjustment} tone="none" />,
                },
                {
                  key: "balance",
                  label: "Balance",
                  align: "right",
                  value: (row) => <Money amount={row.balance} />,
                },
              ]}
            />
            <div className="grid max-w-prose gap-2 text-sm text-muted-foreground">
              <p>
                <strong className="text-foreground">Budgeted</strong> is what the expense categories
                were given each month, <strong className="text-foreground">spent</strong> what they
                spent. The <strong className="text-foreground">overspending adjustment</strong> is
                last month's overspending in categories that do not roll it over, reset at the
                month's start.
              </p>
              <p>
                The <strong className="text-foreground">balance</strong> starts from what the month
                before the range carries over and follows each category's rollover setting. Only
                category and category group filters apply.
              </p>
            </div>
          </>
        )}
      </QueryBody>
    </ReportShell>
  );
}

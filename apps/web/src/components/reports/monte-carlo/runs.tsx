import type { MonteCarloRunDetailRow } from "@reeve/contract/monte-carlo";
import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Money } from "@/components/money";
import { Button } from "@reeve/ui/components/button";
import { cn } from "@reeve/ui/lib/utils";
import { DataTable } from "../chart-parts";
import { Choice } from "../controls";
import { RUN_PERCENTILES } from "./charts";

const PAGE_SIZE = 20;

type SortOrder = "worst-first" | "best-first";

/** Every simulated run, ranked, a page at a time; picking one opens its year-by-year detail. */
export function MonteCarloRunsTable({
  rankedRuns,
  endingBalances,
  depletionYearBySimulation,
  totalWithdrawnBySimulation,
  startAge,
  onSelectRun,
}: {
  /** Every run's index, worst outcome first */
  rankedRuns: ReadonlyArray<number>;
  endingBalances: ReadonlyArray<number>;
  depletionYearBySimulation: ReadonlyArray<number>;
  totalWithdrawnBySimulation: ReadonlyArray<number>;
  startAge: number;
  onSelectRun: (simulationIndex: number) => void;
}) {
  const [sortOrder, setSortOrder] = useState<SortOrder>("worst-first");
  const [page, setPage] = useState(0);
  const [highlightedRank, setHighlightedRank] = useState<number | null>(null);
  const count = rankedRuns.length;
  const pageCount = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * PAGE_SIZE;
  const rows = Array.from(
    { length: Math.max(0, Math.min(PAGE_SIZE, count - pageStart)) },
    (_, offset) => {
      const rank = pageStart + offset;
      return { rank, index: rankedRuns[sortOrder === "best-first" ? count - 1 - rank : rank]! };
    },
  );
  const jumpTo = (percentile: number) => {
    const worstFirstRank = Math.round(percentile * (count - 1));
    const rank = sortOrder === "worst-first" ? worstFirstRank : count - 1 - worstFirstRank;
    setPage(Math.floor(rank / PAGE_SIZE));
    setHighlightedRank(rank);
  };
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          {`Showing ${pageStart + 1}-${pageStart + rows.length} of ${count} runs`}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Choice
            label="Jump to"
            items={[{ value: "", label: "Jump to..." }, ...RUN_PERCENTILES]}
            value=""
            onChange={(value) => value !== "" && jumpTo(Number(value))}
          />
          <Choice
            label="Sort order"
            items={[
              { value: "worst-first", label: "Worst outcomes first" },
              { value: "best-first", label: "Best outcomes first" },
            ]}
            value={sortOrder}
            onChange={(next) => {
              setSortOrder(next);
              setPage(0);
              setHighlightedRank(null);
            }}
          />
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/60 text-xs text-muted-foreground">
            <tr>
              <th className="h-8 w-20 px-3 text-left font-normal">Rank</th>
              <th className="h-8 px-3 text-left font-normal">Outcome</th>
              <th className="h-8 px-3 text-right font-normal">Ending balance</th>
              <th className="h-8 px-3 text-right font-normal">Total withdrawn</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ rank, index }) => {
              const depletionYear = depletionYearBySimulation[index]!;
              const survived = depletionYear === -1;
              return (
                <tr
                  key={index}
                  className={cn(
                    "cursor-pointer border-t hover:bg-row-hover",
                    highlightedRank === rank && "bg-accent",
                  )}
                >
                  <td className="h-8 px-3 tabular-nums">
                    <button
                      type="button"
                      className="underline-offset-2 hover:underline"
                      aria-label={`Open run ranked ${rank + 1}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectRun(index);
                      }}
                    >
                      {rank + 1}
                    </button>
                  </td>
                  <td
                    className={cn(
                      "px-3",
                      survived ? "text-success-foreground" : "text-destructive-foreground",
                    )}
                  >
                    {survived ? "Survived" : `Ran out at age ${startAge + depletionYear - 1}`}
                  </td>
                  <td className="px-3 text-right">
                    {survived ? <Money amount={Math.round(endingBalances[index]!)} /> : "-"}
                  </td>
                  <td className="px-3 text-right">
                    <Money amount={Math.round(totalWithdrawnBySimulation[index]!)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          disabled={currentPage === 0}
          onClick={() => {
            setPage(currentPage - 1);
            setHighlightedRank(null);
          }}
        >
          <ChevronLeftIcon />
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">{`Page ${currentPage + 1} of ${pageCount}`}</span>
        <Button
          variant="outline"
          disabled={currentPage >= pageCount - 1}
          onClick={() => {
            setPage(currentPage + 1);
            setHighlightedRank(null);
          }}
        >
          Next
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  );
}

const amount = (value: number) => <Money amount={Math.round(value)} />;

/**
 * One run year by year: its cashflow and pot balances charts, then what came in, went out and grew
 * each year. Ends at the failure year when the run ran out.
 */
export function MonteCarloRunDetail({
  rows,
  simulationIndex,
  simulationCount,
  depletionYear,
  startAge,
  charts,
  onBack,
}: {
  rows: ReadonlyArray<MonteCarloRunDetailRow>;
  simulationIndex: number;
  /** The year the run ran out, or -1 when it survived */
  depletionYear: number;
  simulationCount: number;
  startAge: number;
  charts: ReactNode;
  onBack: () => void;
}) {
  const funded = rows.filter((row) => !row.afterDepletion);
  const hasIncome = funded.some((row) => row.income !== 0);
  const hasContributions = funded.some((row) => row.contributions !== 0 || row.surplusSaved !== 0);
  const hasTax = funded.some((row) => row.taxPaid !== 0 || row.incomeTax !== 0);
  const hasFees = funded.some((row) => row.feesPaid !== 0);
  type Row = MonteCarloRunDetailRow;
  const columns = [
    { key: "age", label: "Age", value: (row: Row) => startAge + row.year - 1 },
    {
      key: "start",
      label: "Start balance",
      align: "right" as const,
      value: (row: Row) => amount(row.startBalance),
    },
    ...(hasIncome
      ? [
          {
            key: "income",
            label: "Income",
            align: "right" as const,
            value: (row: Row) => amount(row.income),
          },
        ]
      : []),
    ...(hasContributions
      ? [
          {
            key: "contributions",
            label: "Paid in",
            align: "right" as const,
            value: (row: Row) => amount(row.contributions + row.surplusSaved),
          },
        ]
      : []),
    {
      key: "withdrawal",
      label: "Withdrawn",
      align: "right" as const,
      value: (row: Row) => amount(row.withdrawal),
    },
    ...(hasTax
      ? [
          {
            key: "tax",
            label: "Tax",
            align: "right" as const,
            value: (row: Row) => amount(row.taxPaid + row.incomeTax),
          },
        ]
      : []),
    {
      key: "spent",
      label: "Spent",
      align: "right" as const,
      value: (row: Row) => (
        <span className={cn(row.spent < row.plannedSpending - 1 && "text-destructive-foreground")}>
          {amount(row.spent)}
        </span>
      ),
    },
    {
      key: "planned",
      label: "Planned",
      align: "right" as const,
      value: (row: Row) => amount(row.plannedSpending),
    },
    ...(hasFees
      ? [
          {
            key: "fees",
            label: "Fees",
            align: "right" as const,
            value: (row: Row) => amount(row.feesPaid),
          },
        ]
      : []),
    {
      key: "growth",
      label: "Growth",
      align: "right" as const,
      value: (row: Row) => amount(row.growth),
    },
    {
      key: "inflation",
      label: "Inflation",
      align: "right" as const,
      value: (row: Row) =>
        row.inflation === null ? "-" : `${Math.round(row.inflation * 1000) / 10}%`,
    },
    {
      key: "end",
      label: "End balance",
      align: "right" as const,
      value: (row: Row) => amount(row.endBalance),
    },
  ];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeftIcon />
          All runs
        </Button>
        <span className="text-sm text-muted-foreground">
          {`Run ${simulationIndex + 1} of ${simulationCount}`}
          {depletionYear === -1
            ? " - survived"
            : ` - ran out at age ${startAge + depletionYear - 1}`}
        </span>
      </div>
      {charts}
      <DataTable columns={columns} rows={funded} rowKey={(row) => String(row.year)} />
    </div>
  );
}

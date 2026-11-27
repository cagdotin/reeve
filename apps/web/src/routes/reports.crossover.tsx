import type { CrossoverReport } from "@reeve/contract/catalog";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Figure } from "@/components/reports/chart-parts";
import { useChoices, useEarliestMonth } from "@/components/reports/choices";
import { Choice, MultiChoice, TimeFramePicker } from "@/components/reports/controls";
import { CrossoverGraph } from "@/components/reports/crossover";
import { crossoverInput } from "@/components/reports/inputs";
import { defaultFrame, longMonth, type CrossoverMeta } from "@/components/reports/meta";
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
import { Input } from "@reeve/ui/components/input";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";

export const Route = createFileRoute("/reports/crossover")({
  validateSearch: validateReportSearch,
  component: CrossoverPage,
});

function CrossoverPage() {
  const { report: id } = Route.useSearch();
  const saved = useSavedReport<CrossoverMeta>("crossover", id);
  if (saved.loading) return <ReportLoading name="Crossover Point" query={saved.query} />;
  return (
    <Crossover
      key={saved.report?.id ?? "new"}
      initial={reportMeta<CrossoverMeta>(saved.report)}
      saver={saved.saver}
    />
  );
}

const PROJECTIONS = [
  { value: "hampel", label: "Hampel filtered median" },
  { value: "median", label: "Median" },
  { value: "mean", label: "Mean" },
] as const;

/** A number typed as a percentage, kept as a fraction; empty is null. */
function PercentField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string | undefined;
}) {
  const [text, setText] = useState(value === null ? "" : String(Math.round(value * 10000) / 100));
  return (
    <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
      {label}
      <Input
        inputMode="decimal"
        className="w-20"
        aria-label={label}
        placeholder={placeholder}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const trimmed = event.target.value.trim();
          if (trimmed === "") onChange(null);
          else if (Number.isFinite(Number(trimmed))) onChange(Number(trimmed) / 100);
        }}
      />
      %
    </label>
  );
}

function Crossover({ initial, saver }: { initial: CrossoverMeta; saver: Saver<CrossoverMeta> }) {
  const { id: book } = useBook();
  const { accounts, categories, groups } = useChoices(book);
  const earliest = useEarliestMonth(book);
  const { meta, set, save } = useReportState(initial, { timeFrame: defaultFrame(12) }, saver);
  const report = useQuery({
    ...bookQuery(book, "crossover_report", crossoverInput(meta)),
    placeholderData: keepPreviousData,
  });
  const incomeGroups = new Set(groups.filter((group) => group.isIncome).map((group) => group.id));
  const expenseCategories = categories
    .filter((category) => !incomeGroups.has(category.groupId))
    .map((category) => ({ value: category.id, label: category.name }));
  const assetAccounts = accounts
    .filter((account) => !account.closed)
    .map((account) => ({ value: account.id, label: account.name }));

  return (
    <ReportShell
      name={meta.name || "Crossover Point"}
      onRename={saver.update ? (name) => set({ name }) : undefined}
      save={save}
      controls={
        <>
          <TimeFramePicker
            frame={meta.timeFrame ?? defaultFrame(12)}
            earliest={earliest}
            onChange={(timeFrame) => set({ timeFrame })}
          />
          <MultiChoice
            label="Investment accounts"
            none="All accounts"
            items={assetAccounts}
            value={meta.incomeAccountIds ?? []}
            onChange={(incomeAccountIds) => set({ incomeAccountIds })}
          />
          <MultiChoice
            label="Expense categories"
            none="All expense categories"
            items={expenseCategories}
            value={meta.expenseCategoryIds ?? []}
            onChange={(expenseCategoryIds) => set({ expenseCategoryIds })}
          />
        </>
      }
      filters={<Assumptions meta={meta} set={set} />}
    >
      <QueryBody query={report}>
        {(data) => (
          <>
            <Figures data={data} />
            <CrossoverGraph report={data} fetching={report.isFetching} />
          </>
        )}
      </QueryBody>
    </ReportShell>
  );
}

/** The projection's assumptions: withdrawal rate, return, contribution and expenses. */
function Assumptions({
  meta,
  set,
}: {
  meta: CrossoverMeta;
  set: (change: Partial<CrossoverMeta>) => void;
}) {
  const { format, parse } = useBook();
  const [contribution, setContribution] = useState(
    meta.expectedContribution == null ? "" : format(meta.expectedContribution),
  );
  return (
    <div className="flex flex-wrap items-center gap-4">
      <PercentField
        label="Safe withdrawal rate"
        value={meta.safeWithdrawalRate ?? 0.04}
        onChange={(rate) => set({ safeWithdrawalRate: rate ?? 0.04 })}
      />
      <PercentField
        label="Expected return"
        placeholder="History"
        value={meta.estimatedReturn ?? null}
        onChange={(estimatedReturn) => set({ estimatedReturn })}
      />
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        Monthly contribution
        <Input
          inputMode="decimal"
          className="w-28 tabular-nums"
          aria-label="Monthly contribution"
          placeholder="None"
          value={contribution}
          onChange={(event) => {
            setContribution(event.target.value);
            if (event.target.value.trim() === "") set({ expectedContribution: null });
            else {
              const amount = parse(event.target.value);
              if (amount !== null) set({ expectedContribution: amount });
            }
          }}
        />
      </div>
      <PercentField
        label="Expense adjustment"
        value={meta.expenseAdjustmentFactor ?? 1}
        onChange={(factor) => set({ expenseAdjustmentFactor: factor ?? 1 })}
      />
      <Choice
        label="Expense projection"
        items={PROJECTIONS}
        value={meta.projectionType ?? "hampel"}
        onChange={(projectionType) => set({ projectionType })}
      />
    </div>
  );
}

function Figures({ data }: { data: CrossoverReport }) {
  return (
    <div className="flex flex-wrap items-end gap-8">
      <Figure label="Crossover">
        <span className="text-2xl">
          {data.crossoverMonth === null ? "Not in sight" : longMonth(data.crossoverMonth)}
        </span>
      </Figure>
      <Figure label="Years to go">
        {data.yearsToRetire === null ? "—" : Math.round(data.yearsToRetire * 10) / 10}
      </Figure>
      {data.targetNestEgg !== null && (
        <Figure label="Target nest egg">
          <Money amount={data.targetNestEgg} tone="none" className="font-sans" />
        </Figure>
      )}
      <Figure label="Balance now">
        <Money amount={data.lastKnownBalance} tone="none" className="font-sans" />
      </Figure>
      <Figure label="Monthly income">
        <Money amount={data.lastKnownMonthlyIncome} tone="none" className="font-sans" />
      </Figure>
      <Figure label="Monthly expenses">
        <Money amount={data.lastKnownMonthlyExpenses} tone="none" className="font-sans" />
      </Figure>
      <Figure label="Historical return">
        {data.historicalReturn === null ? "—" : `${Math.round(data.historicalReturn * 1000) / 10}%`}
      </Figure>
    </div>
  );
}

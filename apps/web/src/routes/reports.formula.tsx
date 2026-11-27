import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { formulaText } from "@/components/reports/meta";
import { useChoices, useEarliestMonth } from "@/components/reports/choices";
import { ConditionsEditor, TimeFramePicker } from "@/components/reports/controls";
import { defaultFrame, type FormulaMeta, type FormulaQueryMeta } from "@/components/reports/meta";
import { QueryBody } from "@/components/page";
import { ReportLoading, ReportShell } from "@/components/reports/report-shell";
import {
  type Saver,
  reportMeta,
  useReportState,
  useSavedReport,
  validateReportSearch,
} from "@/components/reports/report-state";
import { Button } from "@reeve/ui/components/button";
import { Input } from "@reeve/ui/components/input";
import { Textarea } from "@reeve/ui/components/textarea";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";

export const Route = createFileRoute("/reports/formula")({
  validateSearch: validateReportSearch,
  component: FormulaPage,
});

function FormulaPage() {
  const { report: id } = Route.useSearch();
  const saved = useSavedReport<FormulaMeta>("formula", id);
  if (saved.loading) return <ReportLoading name="Formula" query={saved.query} />;
  return (
    <Formula
      key={saved.report?.id ?? "new"}
      initial={reportMeta<FormulaMeta>(saved.report)}
      saver={saved.saver}
    />
  );
}

const FUNCTIONS = [
  'QUERY("name")',
  'QUERY_COUNT("name")',
  'BALANCE_OF("Account")',
  "BUDGET_QUERY(dimension, categories, start, end)",
  "INTEGER_TO_AMOUNT(n)",
  "FIXED(n, digits)",
  "FORMATCURRENCY(n)",
];

function Formula({ initial, saver }: { initial: FormulaMeta; saver: Saver<FormulaMeta> }) {
  const { id: book } = useBook();
  const { names, choices } = useChoices(book);
  const earliest = useEarliestMonth(book);
  const { meta, set, save } = useReportState(initial, { formula: "=1+1", queries: {} }, saver);
  const [newQuery, setNewQuery] = useState("");
  const queries = meta.queries ?? {};
  const result = useQuery({
    ...bookQuery(book, "evaluate_formula", {
      formula: meta.formula ?? "=0",
      queries: queries as Record<string, never>,
    }),
    placeholderData: keepPreviousData,
  });
  const setQuery = (name: string, query: FormulaQueryMeta | null) => {
    const next = { ...queries };
    if (query === null) delete next[name];
    else next[name] = query;
    set({ queries: next });
  };

  return (
    <ReportShell
      name={meta.name || "Formula"}
      onRename={saver.update ? (name) => set({ name }) : undefined}
      save={save}
    >
      <div className="grid min-h-40 place-items-center rounded-xl border bg-card p-6">
        <QueryBody query={result}>
          {(data) =>
            data.error ? (
              <span className="text-sm text-destructive-foreground">{data.error}</span>
            ) : (
              <span className="font-semibold" style={{ fontSize: 28 }}>
                {formulaText(data.result)}
              </span>
            )
          }
        </QueryBody>
      </div>
      <section className="grid gap-2">
        <h2 className="text-sm font-medium">Formula</h2>
        <Textarea
          aria-label="Formula"
          className="min-h-24 font-mono text-xs"
          value={meta.formula ?? ""}
          onChange={(event) => set({ formula: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Spreadsheet functions, plus {FUNCTIONS.join(", ")}.
        </p>
      </section>
      <section className="grid gap-3">
        <h2 className="text-sm font-medium">Queries</h2>
        {Object.entries(queries).map(([name, query]) => (
          <div key={name} className="grid gap-2 rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">QUERY("{name}")</code>
              <Button
                size="icon"
                variant="ghost"
                className="ms-auto"
                aria-label={`Delete query ${name}`}
                onClick={() => setQuery(name, null)}
              >
                <Trash2Icon />
              </Button>
            </div>
            <TimeFramePicker
              frame={query.timeFrame ?? defaultFrame()}
              earliest={earliest}
              onChange={(timeFrame) => setQuery(name, { ...query, timeFrame })}
            />
            <ConditionsEditor
              conditions={query.conditions ?? []}
              conditionsOp={query.conditionsOp ?? "and"}
              onChange={(conditions, conditionsOp) =>
                setQuery(name, { ...query, conditions, conditionsOp })
              }
              names={names}
              choices={choices}
            />
          </div>
        ))}
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const name = newQuery.trim();
            if (name === "" || name in queries) return;
            setQuery(name, { conditions: [], conditionsOp: "and", timeFrame: defaultFrame() });
            setNewQuery("");
          }}
        >
          <Input
            className="w-48"
            aria-label="Query name"
            placeholder="Query name"
            value={newQuery}
            onChange={(event) => setNewQuery(event.target.value)}
          />
          <Button variant="outline" type="submit">
            <PlusIcon />
            Add query
          </Button>
        </form>
      </section>
    </ReportShell>
  );
}

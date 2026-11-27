import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Settings2Icon } from "lucide-react";
import { useChoices, useEarliestMonth } from "@/components/reports/choices";
import {
  AppliedFilters,
  Choice,
  FilterButton,
  Segmented,
  TimeFramePicker,
} from "@/components/reports/controls";
import { ALL_NODES, nodesThatFit, sankeyInput } from "@/components/reports/inputs";
import {
  defaultFrame,
  rangeLabel,
  type SankeyLayer,
  type SankeyMeta,
} from "@/components/reports/meta";
import { QueryBody } from "@/components/page";
import { ReportLoading, ReportShell } from "@/components/reports/report-shell";
import { SankeyGraph, useSize } from "@/components/reports/sankey";
import {
  type Saver,
  reportMeta,
  useReportState,
  useSavedReport,
  validateReportSearch,
} from "@/components/reports/report-state";
import { Button } from "@reeve/ui/components/button";
import { Menu, MenuCheckboxItem, MenuPopup, MenuTrigger } from "@reeve/ui/components/menu";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";

export const Route = createFileRoute("/reports/sankey")({
  validateSearch: validateReportSearch,
  component: SankeyPage,
});

function SankeyPage() {
  const { report: id } = Route.useSearch();
  const saved = useSavedReport<SankeyMeta>("sankey", id);
  if (saved.loading) return <ReportLoading name="Sankey" query={saved.query} />;
  return (
    <SankeyReport
      key={saved.report?.id ?? "new"}
      initial={reportMeta<SankeyMeta>(saved.report)}
      saver={saved.saver}
    />
  );
}

type View = "spent" | "budgeted";

const LAYER_ORDER: ReadonlyArray<SankeyLayer> = [
  "payee",
  "income_category",
  "account",
  "budget",
  "category_group",
  "category",
];

const LAYER_LABELS: Record<SankeyLayer, string> = {
  payee: "Payee",
  income_category: "Income category",
  account: "Account",
  budget: "Budget",
  category_group: "Category group",
  category: "Category",
};

const TOP_N = [ALL_NODES, 10, 15, 20, 25, 30] as const;

const SORTS = [
  { value: "per-group", label: "Sort per group" },
  { value: "global", label: "Sort all" },
  { value: "budget-order", label: "Sort as budget" },
] as const;

/** The columns a view can show: spending starts at payees, budgeting has the budget column. */
const layersOf = (view: View) =>
  LAYER_ORDER.filter((layer) => (view === "budgeted" ? layer !== "payee" : layer !== "budget"));

const defaultRange = (view: View) => ({
  from: view === "budgeted" ? ("income_category" as const) : ("payee" as const),
  to: "category" as const,
});

const isLayer = (value: string | undefined): value is SankeyLayer =>
  value !== undefined && (LAYER_ORDER as ReadonlyArray<string>).includes(value);

/**
 * Actual's `normalizeLayerRange`: keeps `from` before `to`, moving the other end when one is
 * changed past it, and falls back to the view's default range.
 */
const normalizeRange = (
  view: View,
  candidate: { from: string | undefined; to: string | undefined },
  changed?: "from" | "to",
): { from: SankeyLayer; to: SankeyLayer } => {
  const layers = layersOf(view);
  const fallback = defaultRange(view);
  let from =
    isLayer(candidate.from) && layers.includes(candidate.from) ? candidate.from : fallback.from;
  let to = isLayer(candidate.to) && layers.includes(candidate.to) ? candidate.to : fallback.to;
  if (layers.indexOf(from) >= layers.indexOf(to)) {
    if (changed === "from") {
      const index = Math.min(
        layers.length - 1,
        Math.max(layers.indexOf(from) + 1, layers.indexOf(fallback.to)),
      );
      to = layers[index] ?? fallback.to;
    } else if (changed === "to") {
      const index = Math.max(0, Math.min(layers.indexOf(to) - 1, layers.indexOf(fallback.from)));
      from = layers[index] ?? fallback.from;
    } else {
      from = fallback.from;
      to = fallback.to;
    }
  }
  return layers.indexOf(from) >= layers.indexOf(to) ? fallback : { from, to };
};

function SankeyReport({ initial, saver }: { initial: SankeyMeta; saver: Saver<SankeyMeta> }) {
  const { id: book } = useBook();
  const { names, choices } = useChoices(book);
  const earliest = useEarliestMonth(book);
  const initialView = initial.mode ?? "spent";
  const initialRange = normalizeRange(initialView, {
    from: initial.layerFrom,
    to: initial.layerTo,
  });
  const { meta, set, save } = useReportState(
    initial,
    {
      timeFrame: defaultFrame(),
      mode: "spent",
      topNcategories: 15,
      categorySort: "per-group",
      showPercentages: false,
      groupAccounts: false,
      showTransfers: false,
      layerFrom: initialRange.from,
      layerTo: initialRange.to,
    },
    saver,
  );
  const view = meta.mode ?? "spent";
  const range = normalizeRange(view, { from: meta.layerFrom, to: meta.layerTo });
  const topN = meta.topNcategories ?? 15;
  const [measure, box] = useSize();
  const report = useQuery({
    ...bookQuery(
      book,
      "sankey_report",
      sankeyInput({ ...meta, layerFrom: range.from, layerTo: range.to }, nodesThatFit(box.height)),
    ),
    enabled: box.height > 0,
    placeholderData: keepPreviousData,
  });
  const layers = layersOf(view);
  const changeLayer = (direction: "from" | "to", layer: SankeyLayer) => {
    const next = normalizeRange(view, { ...range, [direction]: layer }, direction);
    set({ layerFrom: next.from, layerTo: next.to });
  };
  const options = [
    { key: "showPercentages", label: "Show as percentages" },
    { key: "groupAccounts", label: "Group accounts" },
    { key: "showTransfers", label: "Show transfers" },
  ] as const;

  return (
    <ReportShell
      name={meta.name || "Sankey"}
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
          <Segmented
            label="View"
            items={[
              { value: "spent", label: "Spent" },
              { value: "budgeted", label: "Budgeted" },
            ]}
            value={view}
            onChange={(mode) => {
              const next = normalizeRange(mode, range);
              set({ mode, layerFrom: next.from, layerTo: next.to });
            }}
          />
          <div className="ms-auto flex flex-wrap items-center gap-1.5">
            <Choice
              label="From column"
              items={layers
                .slice(0, layers.indexOf(range.to))
                .map((layer) => ({ value: layer, label: `From ${LAYER_LABELS[layer]}` }))}
              value={range.from}
              onChange={(layer) => changeLayer("from", layer)}
            />
            <Choice
              label="To column"
              items={layers
                .slice(layers.indexOf(range.from) + 1)
                .map((layer) => ({ value: layer, label: `To ${LAYER_LABELS[layer]}` }))}
              value={range.to}
              onChange={(layer) => changeLayer("to", layer)}
            />
            <Choice
              label="Categories shown"
              items={TOP_N.map((n) => ({
                value: String(n),
                label: `Show up to ${n === ALL_NODES ? "all" : n}`,
              }))}
              value={String(TOP_N.includes(topN as (typeof TOP_N)[number]) ? topN : 15)}
              onChange={(value) => set({ topNcategories: Number(value) })}
            />
            <Choice
              label="Category order"
              items={SORTS}
              value={meta.categorySort ?? "per-group"}
              onChange={(categorySort) => set({ categorySort })}
            />
            <Menu>
              <MenuTrigger render={<Button variant="outline" />}>
                <Settings2Icon />
                Options
              </MenuTrigger>
              <MenuPopup align="end">
                {options.map((option) => (
                  <MenuCheckboxItem
                    key={option.key}
                    checked={meta[option.key] ?? false}
                    onCheckedChange={(checked) => set({ [option.key]: checked })}
                  >
                    {option.label}
                  </MenuCheckboxItem>
                ))}
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
      {report.data && (
        <span className="text-sm text-muted-foreground">
          {rangeLabel(report.data.start, report.data.end)} ·{" "}
          {report.data.view === "budgeted" ? "Budgeted" : "Spent"}
        </span>
      )}
      <div ref={measure} className="h-[36rem] min-h-0">
        <QueryBody query={report}>
          {(data) => (
            <SankeyGraph
              report={data}
              showPercentages={meta.showPercentages}
              fetching={report.isFetching}
              className="h-full"
            />
          )}
        </QueryBody>
      </div>
      <div className="grid max-w-prose gap-2 text-sm text-muted-foreground">
        <p>
          <strong className="text-foreground">Spent</strong> follows the range's transactions from
          payees through income categories and accounts to expense categories.{" "}
          <strong className="text-foreground">Budgeted</strong> follows income through the budget
          into what each category was given, with money carried in from the month before and left
          for the month after.
        </p>
        <p>
          Categories past the limit fold into "Other"; hover it to see them. Opening balances show
          as "Starting Balances". Transfers between budget accounts are left out unless shown.
        </p>
      </div>
    </ReportShell>
  );
}

import type { AccountScope, CustomReport, CustomReportResult } from "@reeve/contract/catalog";
import { addMonths, currentMonth, monthRange, today } from "@reeve/contract/rules";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AreaChartIcon,
  ChartBarIcon,
  ChartBarStackedIcon,
  ChartLineIcon,
  ChartPieIcon,
  ChevronDownIcon,
  TableIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Figure } from "@/components/reports/chart-parts";
import { useChoices } from "@/components/reports/choices";
import { AppliedFilters, Choice, FilterButton } from "@/components/reports/controls";
import { CustomGraph } from "@/components/reports/custom-graphs";
import {
  amountOf,
  GRAPH_LABELS,
  GRAPHS,
  splitAllowed,
  typeAllowed,
  type BalanceType,
  type GraphType,
  type GroupBy,
  type ReportMode,
} from "@/components/reports/custom-options";
import { rangeLabel, shortMonth } from "@/components/reports/meta";
import { ReportSelector } from "@/components/reports/report-selector";
import { Page, QueryBody } from "@/components/page";
import { ExploredScopeAlert, ReportShell } from "@/components/reports/report-shell";
import {
  differs,
  exploreOf,
  scopeOf,
  useExplore,
  useReportScope,
  type Explore,
} from "@/components/reports/report-state";
import { MissingReportAlert, useConfirmedUpdate } from "@/components/reports/save-report";
import { RenameDialog } from "@/components/reports/widget-card";
import { Money } from "@/components/money";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@reeve/ui/components/alert-dialog";
import { Button } from "@reeve/ui/components/button";
import { Checkbox } from "@reeve/ui/components/checkbox";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@reeve/ui/components/menu";
import { Toggle } from "@reeve/ui/components/toggle";
import { cn } from "@reeve/ui/lib/utils";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";

interface CustomSearch {
  readonly id?: string;
  readonly explore?: Explore | undefined;
  readonly scope?: AccountScope | undefined;
}

export const Route = createFileRoute("/reports/custom")({
  validateSearch: (search: Record<string, unknown>): CustomSearch => ({
    ...(typeof search["id"] === "string" && search["id"] !== "" ? { id: search["id"] } : {}),
    ...exploreOf(search),
    ...scopeOf(search),
  }),
  component: CustomReportPage,
});

type Definition = Omit<CustomReport, "id" | "name">;

/** Actual's new custom report: payments by category over the last six months. */
const defaults = (): Definition => ({
  startDate: `${addMonths(currentMonth(), -5)}-01`,
  endDate: today(),
  isDateStatic: false,
  dateRange: "Last 6 months",
  includeCurrentInterval: true,
  mode: "total",
  groupBy: "Category",
  interval: "Monthly",
  balanceType: "Payment",
  sortBy: "desc",
  showEmpty: false,
  showOffBudget: false,
  showHiddenCategories: false,
  showUncategorized: false,
  trimIntervals: false,
  showTrendLines: false,
  graphType: "BarGraph",
  conditions: [],
  conditionsOp: "and",
});

const definitionOf = (report: CustomReport): Definition => {
  const { id: _id, name: _name, ...definition } = report;
  return definition;
};

function CustomReportPage() {
  const { id: book } = useBook();
  const { id } = Route.useSearch();
  const reports = useQuery(bookQuery(book, "list_custom_reports", {}));
  if (id !== undefined && reports.data === undefined)
    return (
      <Page
        title="Custom report"
        context={<ReportSelector name="Custom report" />}
        query={reports}
        actions={
          <Button variant="ghost" disabled>
            Save
            <ChevronDownIcon />
          </Button>
        }
      >
        {() => null}
      </Page>
    );
  const saved = reports.data?.find((each) => each.id === id);
  return <Builder key={saved?.id ?? "new"} saved={saved} missing={id !== undefined && !saved} />;
}

const SPLITS: ReadonlyArray<{ value: GroupBy; label: string }> = [
  { value: "Category", label: "Category" },
  { value: "Group", label: "Group" },
  { value: "CategoryGroup", label: "Category + group" },
  { value: "Payee", label: "Payee" },
  { value: "Account", label: "Account" },
  { value: "Tag", label: "Tag" },
  { value: "Interval", label: "Interval" },
];

const TYPES: ReadonlyArray<{ value: BalanceType; label: string }> = [
  { value: "Payment", label: "Payment" },
  { value: "Deposit", label: "Deposit" },
  { value: "Net", label: "Net" },
  { value: "Net Payment", label: "Net payment" },
  { value: "Net Deposit", label: "Net deposit" },
  { value: "Budgeted", label: "Budgeted" },
];

const INTERVALS = [
  { value: "Daily", label: "Daily" },
  { value: "Weekly", label: "Weekly" },
  { value: "Monthly", label: "Monthly" },
  { value: "Quarterly", label: "Quarterly" },
  { value: "Yearly", label: "Yearly" },
] as const;

const PER: Record<Definition["interval"], string> = {
  Daily: "day",
  Weekly: "week",
  Monthly: "month",
  Quarterly: "quarter",
  Yearly: "year",
};

const SORTS = [
  { value: "desc", label: "Descending" },
  { value: "asc", label: "Ascending" },
  { value: "name", label: "Name" },
  { value: "budget", label: "Budget" },
] as const;

const RANGES: ReadonlyArray<{ value: Definition["dateRange"]; label: string }> = [
  "This week",
  "Last week",
  "This month",
  "Last month",
  "Current quarter",
  "Previous quarter",
  "Last 30 days",
  "Last 3 months",
  "Last 6 months",
  "Last 12 months",
  "Year to date",
  "Last year",
  "Prior year to date",
  "All time",
].map((range) => ({ value: range as Definition["dateRange"], label: range }));

const GRAPH_ICONS: Record<GraphType, ReactNode> = {
  TableGraph: <TableIcon />,
  BarGraph: <ChartBarIcon />,
  AreaGraph: <AreaChartIcon />,
  DonutGraph: <ChartPieIcon />,
  LineGraph: <ChartLineIcon />,
  StackedBarGraph: <ChartBarStackedIcon />,
};

const asGraph = (graph: string, mode: ReportMode): GraphType =>
  (GRAPHS[mode] as ReadonlyArray<string>).includes(graph) ? (graph as GraphType) : "TableGraph";

/** The custom report as shown: its definition run over the accounts it covers. */
const useCustomRun = (saved: CustomReport | undefined, definition: Definition) => {
  const { id: book } = useBook();
  const stored = useQuery({
    ...bookQuery(book, "get_saved_report", { id: saved?.id ?? "" }),
    enabled: saved !== undefined,
  });
  const { scope, explored } = useReportScope(
    stored.data && "definition" in stored.data ? stored.data.definition.scope.accounts : undefined,
  );
  const report = useQuery({
    ...bookQuery(book, "run_custom_report", { ...definition, scope }),
    enabled: saved === undefined || stored.data !== undefined || stored.isError,
    placeholderData: keepPreviousData,
  });
  return { report, scope, explored };
};

function Builder({ saved, missing }: { saved: CustomReport | undefined; missing: boolean }) {
  const { id: book } = useBook();
  const navigate = useNavigate({ from: Route.fullPath });
  const { names, choices } = useChoices(book);
  const base = saved ? definitionOf(saved) : defaults();
  const { meta: definition, set, reset } = useExplore(base);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const create = useBookMutation(book, "create_saved_report");
  const update = useBookMutation(book, "update_custom_report");
  const remove = useBookMutation(book, "delete_custom_report");
  const usage = useQuery({
    ...bookQuery(book, "get_saved_report_usage", { id: saved?.id ?? "" }),
    enabled: saved !== undefined && dialog === "delete",
  });
  const { report, scope, explored } = useCustomRun(saved, definition);
  const graph = asGraph(definition.graphType, definition.mode);
  const dirty = saved !== undefined && differs(base, definition);
  const confirmed = useConfirmedUpdate({
    report: saved,
    dirty,
    update: saved && (() => void update.mutateAsync({ id: saved.id, ...definition }).then(reset)),
    onSaveAs: () => setDialog("save"),
  });

  const setGraph = (next: GraphType) => {
    const change: { -readonly [K in keyof Definition]?: Definition[K] } = { graphType: next };
    if (!splitAllowed(definition.mode, next, definition.groupBy))
      change.groupBy = next === "AreaGraph" ? "Interval" : "Category";
    if (!typeAllowed(definition.mode, next, definition.balanceType)) change.balanceType = "Payment";
    set(change);
  };
  const setMode = (mode: ReportMode) => {
    const next: GraphType =
      graph === "TableGraph" ? "TableGraph" : mode === "time" ? "StackedBarGraph" : "BarGraph";
    set({
      mode,
      graphType: next,
      ...(mode === "time" && definition.groupBy === "Interval"
        ? { groupBy: "Category" as const }
        : {}),
    });
  };

  return (
    <ReportShell
      name={saved?.name ?? "New custom report"}
      actions={
        <SaveMenu
          saved={saved}
          dirty={dirty}
          onSave={() => confirmed.request?.()}
          onRevert={() => void reset()}
          onDialog={setDialog}
          onNew={() => void navigate({ search: {} })}
        />
      }
      controls={
        <>
          <DateControls definition={definition} set={set} />
          <FilterButton
            choices={choices}
            onAdd={(condition) => set({ conditions: [...definition.conditions, condition] })}
          />
          <GraphPicker mode={definition.mode} graph={graph} onChange={setGraph} />
        </>
      }
      filters={
        <AppliedFilters
          conditions={definition.conditions}
          conditionsOp={definition.conditionsOp}
          onChange={(conditions, conditionsOp) => set({ conditions, conditionsOp })}
          names={names}
          choices={choices}
        />
      }
    >
      <div className="grid gap-5 lg:grid-cols-[14rem_1fr]">
        <Options definition={definition} graph={graph} set={set} setMode={setMode} />
        <div className="grid min-w-0 content-start gap-4">
          <QueryBody query={report}>
            {(data) => (
              <ReportResult
                data={data}
                definition={definition}
                graph={graph}
                fetching={report.isFetching}
              />
            )}
          </QueryBody>
        </div>
      </div>
      <RenameDialog
        open={dialog === "save" || dialog === "rename"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog === "rename" ? "Rename report" : "Save report"}
        name={dialog === "rename" ? (saved?.name ?? "") : ""}
        onSave={(name) =>
          dialog === "rename" && saved
            ? update.mutate({ id: saved.id, name })
            : create.mutate(
                {
                  name,
                  definition: {
                    version: 1,
                    type: "custom",
                    settings: definition,
                    scope: { accounts: scope },
                  } as never,
                },
                {
                  onSuccess: (created) =>
                    void navigate({ replace: true, search: { id: created.id } }),
                },
              )
        }
      />
      {missing && <MissingReportAlert />}
      <ExploredScopeAlert scope={explored} />
      {confirmed.dialog}
      <DeleteDialog
        open={dialog === "delete"}
        name={saved?.name ?? ""}
        placements={usage.data?.placements}
        failed={usage.isError || remove.isError}
        pending={usage.isFetching || remove.isPending}
        onClose={() => setDialog(null)}
        onDelete={() =>
          saved &&
          usage.data &&
          void remove
            .mutateAsync({
              id: saved.id,
              expectedPlacementIds: usage.data.placements.map((p) => p.id),
            })
            .then(
              () => navigate({ to: "/reports" }),
              () => undefined,
            )
        }
      />
    </ReportShell>
  );
}

const monthEnd = (month: string) =>
  String(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()).padStart(
    2,
    "0",
  );

function Option({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean | undefined;
}) {
  return (
    <label className={cn("flex items-center gap-2 text-sm", disabled && "opacity-50")}>
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={(next) => onChange(next)} />
      {label}
    </label>
  );
}

/** The report's settings, as in Actual: mode, split, type, interval, sort and what rows to show. */
function Options({
  definition,
  graph,
  set,
  setMode,
}: {
  definition: Definition;
  graph: GraphType;
  set: (change: Partial<Definition>) => void;
  setMode: (mode: ReportMode) => void;
}) {
  return (
    <div className="grid content-start gap-3 rounded-xl border p-3">
      <Option label="Mode">
        <Choice
          label="Mode"
          className="w-full"
          items={[
            { value: "total", label: "Total" },
            { value: "time", label: "Time" },
          ]}
          value={definition.mode}
          onChange={setMode}
        />
      </Option>
      <Option label="Split">
        <Choice
          label="Split"
          className="w-full"
          items={SPLITS.filter((each) => splitAllowed(definition.mode, graph, each.value))}
          value={definition.groupBy}
          onChange={(groupBy) => set({ groupBy })}
        />
      </Option>
      <Option label="Type">
        <Choice
          label="Type"
          className="w-full"
          items={TYPES.filter((each) => typeAllowed(definition.mode, graph, each.value))}
          value={definition.balanceType}
          onChange={(balanceType) => set({ balanceType })}
        />
      </Option>
      <Option label="Interval">
        <Choice
          label="Interval"
          className="w-full"
          items={INTERVALS}
          value={definition.interval}
          onChange={(interval) => set({ interval })}
        />
      </Option>
      {definition.mode === "total" && graph !== "AreaGraph" && (
        <Option label="Sort">
          <Choice
            label="Sort"
            className="w-full"
            items={SORTS}
            value={definition.sortBy}
            onChange={(sortBy) => set({ sortBy })}
          />
        </Option>
      )}
      <div className="grid gap-2 border-t pt-3">
        <Check
          label="Show hidden categories"
          checked={definition.showHiddenCategories}
          onChange={(showHiddenCategories) => set({ showHiddenCategories })}
        />
        <Check
          label="Show empty rows"
          checked={definition.showEmpty}
          onChange={(showEmpty) => set({ showEmpty })}
        />
        <Check
          label="Show off budget"
          checked={definition.showOffBudget}
          onChange={(showOffBudget) => set({ showOffBudget })}
        />
        <Check
          label="Show uncategorized"
          checked={definition.showUncategorized}
          onChange={(showUncategorized) => set({ showUncategorized })}
        />
        <Check
          label="Trim intervals"
          checked={definition.trimIntervals}
          disabled={definition.mode !== "time"}
          onChange={(trimIntervals) => set({ trimIntervals })}
        />
        <Check
          label="Include current interval"
          checked={definition.includeCurrentInterval}
          disabled={definition.isDateStatic}
          onChange={(includeCurrentInterval) => set({ includeCurrentInterval })}
        />
      </div>
    </div>
  );
}

type Dialog = "save" | "rename" | "delete";

function SaveMenu({
  saved,
  dirty,
  onSave,
  onRevert,
  onDialog,
  onNew,
}: {
  saved: CustomReport | undefined;
  dirty: boolean;
  onSave: () => void;
  onRevert: () => void;
  onDialog: (dialog: Dialog) => void;
  onNew: () => void;
}) {
  return (
    <Menu>
      <MenuTrigger render={<Button variant={dirty ? "default" : "ghost"} />}>
        {saved ? (dirty ? "Unsaved changes" : "Saved") : "Save"}
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        {saved ? (
          <>
            <MenuItem disabled={!dirty} onClick={onSave}>
              Save report
            </MenuItem>
            <MenuItem disabled={!dirty} onClick={onRevert}>
              Revert changes
            </MenuItem>
            <MenuItem onClick={() => onDialog("save")}>Save as new report…</MenuItem>
            <MenuItem onClick={() => onDialog("rename")}>Rename…</MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={() => onDialog("delete")}>
              Delete report…
            </MenuItem>
          </>
        ) : (
          <MenuItem onClick={() => onDialog("save")}>Save new report…</MenuItem>
        )}
        <MenuSeparator />
        <MenuItem onClick={onNew}>New report</MenuItem>
      </MenuPopup>
    </Menu>
  );
}

const MONTHS = monthRange(addMonths(currentMonth(), -60), currentMonth())
  .toReversed()
  .map((month) => ({ value: month, label: shortMonth(month) }));

function DateControls({
  definition,
  set,
}: {
  definition: Definition;
  set: (change: Partial<Definition>) => void;
}) {
  return (
    <>
      <Button
        variant={definition.isDateStatic ? "outline" : "secondary"}
        onClick={() => set({ isDateStatic: !definition.isDateStatic })}
      >
        {definition.isDateStatic ? "Static" : "Live"}
      </Button>
      {definition.isDateStatic ? (
        <>
          <Choice
            label="From"
            items={MONTHS}
            value={definition.startDate.slice(0, 7)}
            onChange={(month) => set({ startDate: `${month}-01` })}
          />
          <span className="text-muted-foreground">to</span>
          <Choice
            label="To"
            items={MONTHS}
            value={definition.endDate.slice(0, 7)}
            onChange={(month) => set({ endDate: `${month}-${monthEnd(month)}` })}
          />
        </>
      ) : (
        <Choice
          label="Range"
          items={RANGES}
          value={definition.dateRange}
          onChange={(dateRange) => set({ dateRange })}
        />
      )}
    </>
  );
}

function GraphPicker({
  mode,
  graph,
  onChange,
}: {
  mode: ReportMode;
  graph: GraphType;
  onChange: (graph: GraphType) => void;
}) {
  return (
    <span className="ms-auto flex items-center gap-0.5">
      {GRAPHS[mode].map((each) => (
        <Toggle
          key={each}
          pressed={graph === each}
          onPressedChange={(pressed) => pressed && onChange(each)}
          aria-label={GRAPH_LABELS[each]}
          title={GRAPH_LABELS[each]}
        >
          {GRAPH_ICONS[each]}
        </Toggle>
      ))}
    </span>
  );
}

function ReportResult({
  data,
  definition,
  graph,
  fetching,
}: {
  data: CustomReportResult;
  definition: Definition;
  graph: GraphType;
  fetching: boolean;
}) {
  const total = amountOf(data, definition.balanceType);
  const intervalCount = Math.max(data.intervals.length, 1);
  return (
    <>
      <div className="flex flex-wrap items-end gap-8">
        <Figure label={`${definition.balanceType} · ${rangeLabel(data.start, data.end)}`}>
          <Money amount={total} tone="none" className="font-sans text-2xl" />
        </Figure>
        <Figure label={`Average per ${PER[definition.interval]}`}>
          <Money amount={Math.round(total / intervalCount)} tone="none" className="font-sans" />
        </Figure>
      </div>
      <div className={cn(graph !== "TableGraph" && "h-96")}>
        <CustomGraph
          report={data}
          mode={definition.mode}
          graph={graph}
          groupBy={definition.groupBy}
          balanceType={definition.balanceType}
          fetching={fetching}
        />
      </div>
    </>
  );
}

function DeleteDialog({
  open,
  name,
  placements,
  failed,
  pending,
  onClose,
  onDelete,
}: {
  open: boolean;
  name: string;
  placements: ReadonlyArray<{ id: string; pageName: string; title: string }> | undefined;
  failed: boolean;
  pending: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            {failed
              ? "Could not complete deletion. Review usage again and retry."
              : placements === undefined
                ? "Loading report usage..."
                : `The report and its ${placements.length} linked widgets will be deleted.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {placements !== undefined && placements.length > 0 && (
          <ul className="space-y-1 text-sm">
            {placements.map((placement) => (
              <li key={placement.id}>
                {placement.pageName}: {placement.title}
              </li>
            ))}
          </ul>
        )}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
          <Button
            variant="destructive"
            disabled={placements === undefined || pending || failed}
            onClick={onDelete}
          >
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

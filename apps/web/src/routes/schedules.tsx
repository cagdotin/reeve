import type { DiscoveredSchedule } from "@reeve/contract/catalog";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { Page } from "@/components/page";
import { ScopeNote } from "@/components/scope-note";
import { Facets } from "@/components/facets";
import { AttentionAlerts } from "@/components/insights/attention-alerts";
import { FilterBar } from "@/components/insights/filter-bar";
import { TableEmpty } from "@/components/insights/table";
import { AllFound, DeleteSchedule } from "@/components/schedules/schedule-dialogs";
import { ScheduleEditor, type ScheduleDraft } from "@/components/schedules/schedule-editor";
import { PageAlert } from "@/components/page-alert";
import {
  GroupHeader,
  ScheduleRow,
  SchedulesHeader,
  type ScheduleRequest,
} from "@/components/schedules/schedules-table";
import { Button } from "@reeve/ui/components/button";
import {
  type AccountScope,
  scopedAccount,
  scopeInput,
  useAccountScope,
  useResetOnScope,
  useSetAccountScope,
  validateScopeSearch,
} from "@/lib/account-scope";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import { facetCount, type FacetValue, sameFilters } from "@/lib/facets";
import { nextSort } from "@/lib/insights";
import {
  attentionItems,
  DEFAULT_SORT,
  DESCENDING_FIRST,
  foundKey,
  groupByUrgency,
  matchesSearch,
  newCandidates,
  passesFilters,
  scheduleFilterGroups,
  sortSchedules,
  type Row,
  type ScheduleSort,
} from "@/lib/schedules";
import { usePaneLeave } from "@/components/split-panel";

export const Route = createFileRoute("/schedules")({
  validateSearch: validateScopeSearch,
  component: SchedulesPage,
});

const FORECAST_DAYS = 90;

const dismissedKey = (book: string) => `reeve:${book}:schedules:dismissed`;

const readDismissed = (book: string): ReadonlySet<string> => {
  try {
    const stored = localStorage.getItem(dismissedKey(book));
    return new Set(stored === null ? [] : (JSON.parse(stored) as Array<string>));
  } catch {
    return new Set();
  }
};

const writeDismissed = (book: string, keys: ReadonlySet<string>) => {
  try {
    localStorage.setItem(dismissedKey(book), JSON.stringify([...keys]));
  } catch {
    // Hiding is a convenience: without storage the list simply shows them again.
  }
};

/** The candidates hidden from "find schedules", remembered in this browser. */
const useDismissed = (book: string) => {
  const [dismissed, setDismissed] = useState(() => readDismissed(book));
  const hide = (keys: ReadonlySet<string>) => {
    setDismissed(keys);
    writeDismissed(book, keys);
  };
  return [dismissed, hide] as const;
};

/** A found schedule as the editor's draft. */
const draftOf = (each: DiscoveredSchedule): ScheduleDraft => ({
  ...(each.payee === null ? {} : { payee: each.payee }),
  account: each.accountId,
  amount: each.amount,
  amountOp: each.amountOp,
  date: each.date.start,
  dateOp: each.dateOp,
  frequency: each.date.frequency,
  interval: each.date.interval,
  ...(each.date.patterns === undefined ? {} : { patterns: each.date.patterns }),
});

function SchedulesPage() {
  const { id: book } = useBook();
  const scope = useAccountScope();
  const overview = useQuery({
    ...bookQuery(book, "schedule_activity", { ...scopeInput(scope), days: FORECAST_DAYS }),
    placeholderData: keepPreviousData,
  });
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const leave = usePaneLeave();
  const openDraft = (next: ScheduleDraft | null) => leave(() => setDraft(next));
  const account = scopedAccount(scope);
  return (
    <Page
      width="window"
      title="Schedules"
      query={overview}
      actions={
        <Button
          variant="ghost"
          disabled={overview.data === undefined}
          onClick={() => openDraft(account === undefined ? {} : { account })}
        >
          <PlusIcon />
          New schedule
        </Button>
      }
    >
      {(data) => (
        <LoadedSchedules
          scope={scope}
          rows={data.schedules}
          noAccount={data.noAccount}
          today={data.today}
          draft={draft}
          onDraft={openDraft}
        />
      )}
    </Page>
  );
}

/** The table's filters, shared by the checks above it that set them. */
interface Narrowing {
  readonly query: string;
  readonly setQuery: (query: string) => void;
  readonly filters: FacetValue;
  readonly setFilters: (filters: FacetValue) => void;
}

function LoadedSchedules({
  scope,
  rows,
  noAccount,
  today,
  draft,
  onDraft,
}: {
  scope: AccountScope;
  rows: ReadonlyArray<Row>;
  noAccount: number;
  today: string;
  draft: ScheduleDraft | null;
  onDraft: (draft: ScheduleDraft | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<FacetValue>({});
  const [request, setRequest] = useState<ScheduleRequest | null>(null);
  const [allFound, setAllFound] = useState(false);
  const narrowing = { query, setQuery, filters, setFilters };
  const { id: book } = useBook();
  const leave = usePaneLeave();
  useResetOnScope(scope, () => {
    const { account: _account, ...rest } = filters;
    setFilters(rest);
  });
  const found =
    useQuery({
      ...bookQuery(book, "find_schedules", scopeInput(scope)),
      placeholderData: keepPreviousData,
    }).data ?? [];
  const setScope = useSetAccountScope();
  const [dismissed, hide] = useDismissed(book);
  const candidates = newCandidates(found, rows, dismissed);
  const pick = (each: DiscoveredSchedule) => {
    setAllFound(false);
    onDraft(draftOf(each));
  };
  const hidden = found.filter((each) => dismissed.has(foundKey(each))).length;
  const checks = attentionItems(rows, today);

  return (
    <>
      <AttentionAlerts
        items={checks}
        isActive={(item) => sameFilters(filters, item.filters)}
        onChoose={(item) => {
          setQuery("");
          setFilters(sameFilters(filters, item.filters) ? {} : item.filters);
        }}
      />
      {candidates.length > 0 && (
        <PageAlert
          variant="info"
          title={`${candidates.length} repeating ${candidates.length === 1 ? "transaction has" : "transactions have"} no schedule`}
          action={
            <Button variant="ghost" onClick={() => setAllFound(true)}>
              Review
            </Button>
          }
        />
      )}
      <ScopeNote>
        {(where) =>
          scope === "budgeted" || scope === "offbudget"
            ? `Schedules that post to open ${where}.`
            : `Schedules that post to ${where}.`
        }
      </ScopeNote>
      <ScheduleList
        scope={scope}
        rows={rows}
        today={today}
        narrowing={narrowing}
        onRequest={(next) =>
          leave(() => {
            onDraft(null);
            setRequest(next);
          })
        }
      />
      {scope !== "all" && noAccount > 0 && (
        <div className="flex items-center justify-center gap-3 p-4 text-xs text-muted-foreground">
          {noAccount === 1
            ? "1 schedule has no account, so only All accounts shows it."
            : `${noAccount} schedules have no account, so only All accounts shows them.`}
          <Button variant="outline" onClick={() => setScope("all")}>
            Show all accounts
          </Button>
        </div>
      )}
      {candidates.length === 0 && hidden > 0 && (
        <div className="flex items-center justify-center gap-3 p-4 text-xs text-muted-foreground">
          {hidden === 1
            ? "1 repeating transaction is hidden on this computer."
            : `${hidden} repeating transactions are hidden on this computer.`}
          <Button variant="outline" onClick={() => hide(new Set())}>
            Show them
          </Button>
        </div>
      )}
      <ScheduleEditor
        schedule={request?.kind === "edit" ? request.schedule : null}
        draft={draft}
        open={draft !== null || request?.kind === "edit"}
        onOpenChange={(next) => {
          if (next) return;
          onDraft(null);
          setRequest(null);
        }}
      />
      <DeleteSchedule
        schedule={request?.kind === "delete" ? request.schedule : null}
        onClose={() => setRequest(null)}
      />
      <AllFound
        found={candidates}
        dismissed={hidden}
        open={allFound}
        onOpenChange={setAllFound}
        onPick={pick}
        onDismiss={(each) => hide(new Set([...dismissed, foundKey(each)]))}
        onRestore={() => hide(new Set())}
      />
    </>
  );
}

const emptyMessage = (narrowed: boolean, total: number, scope: AccountScope) => {
  if (narrowed) return "No schedule matches.";
  if (total === 0 && scope !== "all") return "No schedule posts to these accounts.";
  return total === 0
    ? "Schedules track bills and paychecks you expect."
    : "Every schedule is completed. The status filter shows them.";
};

/** The filter bar and the table, in order or in groups by urgency. */
function ScheduleList({
  scope,
  rows,
  today,
  narrowing,
  onRequest,
}: {
  scope: AccountScope;
  rows: ReadonlyArray<Row>;
  today: string;
  narrowing: Narrowing;
  onRequest: (request: ScheduleRequest) => void;
}) {
  const { format } = useBook();
  const { query, setQuery, filters, setFilters } = narrowing;
  const [sort, setSort] = useState<ScheduleSort>(DEFAULT_SORT);
  const filtered = rows.filter(
    (row) => passesFilters(row, filters, today) && matchesSearch(row, query),
  );
  const shown = sortSchedules(filtered, sort);
  const narrowed = query.trim() !== "" || facetCount(filters) > 0;
  const scheduleRow = (row: Row) => (
    <ScheduleRow key={row.id} row={row} today={today} onRequest={onRequest} />
  );
  return (
    <>
      <FilterBar
        testId="schedule-filters"
        search="Search schedules"
        query={query}
        onQuery={setQuery}
        shown={shown.length}
        total={rows.length}
        head={
          <SchedulesHeader
            sort={sort}
            onSort={(key) => setSort(nextSort(sort, key, DESCENDING_FIRST, DEFAULT_SORT))}
          />
        }
      >
        <Facets
          groups={scheduleFilterGroups(rows, today)}
          value={filters}
          onValueChange={setFilters}
        />
      </FilterBar>
      {sort.key === "urgency"
        ? groupByUrgency(shown).map((group) => (
            <div key={group.status}>
              <GroupHeader
                label={group.label}
                count={group.rows.length}
                sum={group.status === "completed" ? "" : sumOf(group.rows, format)}
              />
              {group.rows.map(scheduleRow)}
            </div>
          ))
        : shown.map(scheduleRow)}
      {shown.length === 0 && <TableEmpty>{emptyMessage(narrowed, rows.length, scope)}</TableEmpty>}
    </>
  );
}

/** A group's net, signed only when money comes in. */
const sumOf = (rows: ReadonlyArray<Row>, format: (value: number) => string) => {
  const net = rows.reduce((sum, row) => sum + row.expected, 0);
  return net === 0 ? "" : `${net > 0 ? "+" : ""}${format(Math.abs(net))}`;
};

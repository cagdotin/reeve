import type { PayeeActivity } from "@reeve/contract";
import { today } from "@reeve/contract/rules";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { MergeIcon, PlusIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Page } from "@/components/page";
import { ScopeNote } from "@/components/scope-note";
import { Facets } from "@/components/facets";
import { AttentionAlerts } from "@/components/insights/attention-alerts";
import { FilterBar, RangeChoice, SelectionActions } from "@/components/insights/filter-bar";
import { TableEmpty } from "@/components/insights/table";
import { PayeeDialogs, type PayeeRequest } from "@/components/payees/payee-dialogs";
import { PayeeRow, PayeesHeader } from "@/components/payees/payees-table";
import { SuggestedMerges } from "@/components/payees/suggested-merges";
import { Button } from "@reeve/ui/components/button";
import {
  scopeInput,
  useAccountScope,
  useSetAccountScope,
  validateScopeSearch,
} from "@/lib/account-scope";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import { facetCount, type FacetValue, sameFilters } from "@/lib/facets";
import { nextSort, rangeStart, toggled } from "@/lib/insights";
import {
  attentionItems,
  DEFAULT_MONTHS,
  DEFAULT_SORT,
  DESCENDING_FIRST,
  matchesSearch,
  passesFilters,
  payeeFilterGroups,
  sortPayees,
  type PayeeSort,
} from "@/lib/payees";
import { usePaneLeave } from "@/components/split-panel";

export const Route = createFileRoute("/payees")({
  validateSearch: validateScopeSearch,
  component: PayeesPage,
});

function PayeeFilters({
  months,
  onMonths,
  rows,
  filters,
  onFilters,
  query,
  onQuery,
  selected,
  onRequest,
  shown,
  total,
  head,
}: {
  months: number | null;
  onMonths: (months: number | null) => void;
  rows: ReadonlyArray<PayeeActivity>;
  filters: FacetValue;
  onFilters: (filters: FacetValue) => void;
  query: string;
  onQuery: (query: string) => void;
  selected: ReadonlyArray<PayeeActivity>;
  onRequest: (request: PayeeRequest) => void;
  shown: number;
  total: number;
  head: ReactNode;
}) {
  return (
    <FilterBar
      testId="payee-filters"
      search="Search payees"
      query={query}
      onQuery={onQuery}
      shown={shown}
      total={total}
      range={<RangeChoice months={months} onMonths={onMonths} />}
      head={head}
    >
      <Facets groups={payeeFilterGroups(rows)} value={filters} onValueChange={onFilters} />
      {selected.length > 0 && (
        <SelectionActions
          count={selected.length}
          onDelete={() => onRequest({ kind: "delete", payees: selected })}
        >
          {selected.length > 1 && (
            <Button variant="ghost" onClick={() => onRequest({ kind: "merge", payees: selected })}>
              <MergeIcon />
              Merge…
            </Button>
          )}
        </SelectionActions>
      )}
    </FilterBar>
  );
}

function LoadMonth({
  since,
  loading,
  onLoad,
}: {
  since: string;
  loading: boolean;
  onLoad: () => void;
}) {
  const { formatDay } = useBook();
  return (
    <div className="flex items-center justify-center gap-3 p-4">
      <span className="text-xs text-muted-foreground">Since {formatDay(since)}</span>
      <Button variant="outline" loading={loading} onClick={onLoad}>
        Load one more month
      </Button>
    </div>
  );
}

function PayeesPage() {
  const { id: book } = useBook();
  const [months, setMonths] = useState<number | null>(DEFAULT_MONTHS);
  const [sort, setSort] = useState<PayeeSort>(DEFAULT_SORT);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<FacetValue>({});
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [request, setRequest] = useState<PayeeRequest | null>(null);
  const leave = usePaneLeave();
  const openRequest = (next: PayeeRequest) => leave(() => setRequest(next));
  const since = months === null ? undefined : rangeStart(today(), months);
  const scope = useAccountScope();
  const setScope = useSetAccountScope();
  const overview = useQuery({
    ...bookQuery(book, "payee_activity", {
      ...scopeInput(scope),
      ...(since === undefined ? {} : { since }),
    }),
    placeholderData: keepPreviousData,
  });

  const closeRequest = () => {
    setRequest(null);
    setChosen(new Set());
  };

  return (
    <>
      <Page
        width="window"
        title="Payees"
        query={overview}
        actions={
          <Button
            variant="ghost"
            disabled={overview.data === undefined}
            onClick={() => openRequest({ kind: "create" })}
          >
            <PlusIcon />
            New payee
          </Button>
        }
      >
        {(data) => {
          const { payees: rows, total, earliest } = data;
          const shown = sortPayees(
            rows.filter((row) => passesFilters(row, filters) && matchesSearch(row, query)),
            sort,
          );
          const selected = shown.filter((row) => chosen.has(row.id));
          const narrowed = query.trim() !== "" || facetCount(filters) > 0;
          const hasEarlier = since !== undefined && earliest !== null && earliest < since;
          return (
            <>
              <SuggestedMerges />
              <AttentionAlerts
                items={attentionItems(data.attention)}
                isActive={(item) => sameFilters(filters, item.filters)}
                onChoose={(item) => {
                  const off = sameFilters(filters, item.filters);
                  if (!off) setMonths(null);
                  setQuery("");
                  setFilters(off ? {} : item.filters);
                }}
              />
              <ScopeNote>
                {(where) =>
                  `Payees with a transaction on ${where}. A payee is shared by every account, so renaming, merging or deleting one changes it everywhere.`
                }
              </ScopeNote>
              <PayeeFilters
                months={months}
                onMonths={setMonths}
                rows={rows}
                filters={filters}
                onFilters={setFilters}
                query={query}
                onQuery={setQuery}
                selected={selected}
                onRequest={openRequest}
                shown={shown.length}
                total={total}
                head={
                  <PayeesHeader
                    sort={sort}
                    onSort={(key) => setSort(nextSort(sort, key, DESCENDING_FIRST))}
                  />
                }
              />
              {shown.map((payee) => (
                <PayeeRow
                  key={payee.id}
                  payee={payee}
                  selected={chosen.has(payee.id)}
                  onSelect={() => setChosen(toggled(chosen, payee.id))}
                  onRequest={openRequest}
                />
              ))}
              {shown.length === 0 && (
                <TableEmpty>
                  {narrowed
                    ? "No payee in this range matches."
                    : total === 0
                      ? scope === "all"
                        ? "Payees appear as you enter transactions."
                        : "No payee has a transaction on these accounts."
                      : "No payee has a transaction in this range."}
                </TableEmpty>
              )}
              {hasEarlier && (
                <LoadMonth
                  since={since}
                  loading={overview.isPlaceholderData}
                  onLoad={() => setMonths(months === null ? null : months + 1)}
                />
              )}
            </>
          );
        }}
      </Page>
      <PayeeDialogs
        request={request}
        onRequest={setRequest}
        onClose={closeRequest}
        onCreated={(name) => {
          setScope("all");
          setMonths(null);
          setFilters({});
          setQuery(name);
        }}
      />
    </>
  );
}

import type { ReceiptOverview, ReceiptSummary } from "@reeve/contract/catalog";
import { Facets, FacetSelect } from "@/components/facets";
import { DateSpan, FilterBar, FilterChip, RangeChoice } from "@/components/insights/filter-bar";
import { TableEmpty } from "@/components/insights/table";
import { ReceiptRow, ReceiptsHeader } from "@/components/receipts/receipts-table";
import type { ReceiptView } from "@/components/receipts/use-receipt-view";
import { Button } from "@reeve/ui/components/button";
import { facetCount } from "@/lib/facets";
import {
  emptyTable,
  focusName,
  MISSING_GROUP,
  monthLabel,
  PAGE_SIZE,
  searchesPastRange,
  storeGroup,
  type DeleteTarget,
} from "@/lib/receipt-pages";

/** The sticky filters over the rows, then the rows, why there are none, or a way to more. */
export function ReceiptTableSection({
  overview,
  view,
  rows,
  total,
  loaded,
  loading,
  onDelete,
}: {
  overview: ReceiptOverview;
  view: ReceiptView;
  rows: ReadonlyArray<ReceiptSummary>;
  total: number;
  loaded: boolean;
  loading: boolean;
  onDelete: (target: DeleteTarget) => void;
}) {
  const { state, stores } = view;
  const { query, filters, focus, category, month, sort } = state;
  const narrowed =
    query.trim() !== "" ||
    facetCount(filters) > 0 ||
    focus !== null ||
    category !== null ||
    month !== null;
  const empty = emptyTable(state, narrowed, overview.total > 0);
  const anyWithoutStore = overview.stores.some((store) => store.id === null);
  return (
    <>
      <FilterBar
        testId="receipt-filters"
        search="Search lines, notes, stores"
        query={query}
        onQuery={view.setQuery}
        shown={rows.length}
        total={total}
        range={
          <>
            {view.custom !== null && <DateSpan dates={view.custom} onDates={view.setCustom} />}
            <RangeChoice
              months={view.months}
              onMonths={view.setRange}
              custom={{ active: view.custom !== null, onChoose: view.chooseCustom }}
            />
          </>
        }
        head={<ReceiptsHeader sort={sort} onSort={view.sortBy} />}
      >
        <FacetSelect
          group={storeGroup(overview.storeChoices, anyWithoutStore)}
          value={stores}
          onValueChange={(store) => view.setFilters({ ...filters, store })}
        />
        <Facets groups={[MISSING_GROUP]} value={filters} onValueChange={view.setFilters} />
        {focus !== null && (
          <FilterChip
            label={focusName(focus)}
            clearLabel={`Stop showing ${focusName(focus).toLowerCase()}`}
            onClear={() => view.setFocus(null)}
          />
        )}
        {category !== null && (
          <FilterChip
            label={category.name}
            clearLabel={`Stop showing ${category.name}`}
            onClear={() => view.setCategory(null)}
          />
        )}
        {month !== null && (
          <FilterChip
            label={monthLabel(month)}
            clearLabel="Stop showing one month"
            onClear={() => view.setMonth(null)}
          />
        )}
        {searchesPastRange(state) && (
          <span className="text-xs text-muted-foreground">Searching all time</span>
        )}
      </FilterBar>
      {rows.map((receipt) => (
        <ReceiptRow
          key={receipt.id}
          receipt={receipt}
          onDelete={onDelete}
          onStore={view.toggleStore}
        />
      ))}
      {loaded && rows.length === 0 && (
        <TableEmpty>
          {empty.text}
          {empty.offerAllTime && (
            <Button variant="outline" className="ms-2" onClick={() => view.setRange(null)}>
              Show all time
            </Button>
          )}
        </TableEmpty>
      )}
      {rows.length < total && (
        <div className="flex items-center justify-center gap-3 p-4">
          <span className="text-xs text-muted-foreground tabular-nums">
            {rows.length} of {total}
          </span>
          <Button variant="outline" loading={loading} onClick={() => view.loadMore(PAGE_SIZE)}>
            Load {Math.min(PAGE_SIZE, total - rows.length)} more
          </Button>
        </div>
      )}
    </>
  );
}

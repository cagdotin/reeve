import { requirePurchases } from "@/lib/purchases";
import type { ItemCategory, ProductActivity } from "@reeve/contract/catalog";
import { today } from "@reeve/contract/rules";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ChartColumnIcon,
  FolderTreeIcon,
  MergeIcon,
  PlusIcon,
} from "lucide-react";
import { useState } from "react";
import { Page } from "@/components/page";
import { Facets } from "@/components/facets";
import {
  FilterBar,
  FilterChip,
  RangeChoice,
  SelectionActions,
} from "@/components/insights/filter-bar";
import { TableEmpty } from "@/components/insights/table";
import { ItemCategoriesDialog } from "@/components/products/item-categories-dialog";
import { NewProductDialog } from "@/components/products/new-product-dialog";
import type { CompareTo } from "@/components/products/price-movers";
import { ProductDialogs, type ProductRequest } from "@/components/products/product-dialogs";
import { ProductInsights, type ProductView } from "@/components/products/product-insights";
import { ProductRow, ProductsHeader } from "@/components/products/products-table";
import { UnassignedLines } from "@/components/products/unassigned-lines";
import { Button } from "@reeve/ui/components/button";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { facetCount, type FacetValue } from "@/lib/facets";
import { nextSort, rangeStart, toggled } from "@/lib/insights";
import {
  archiveTargets,
  boughtEarlier,
  CHANGE_SORT,
  DEFAULT_MONTHS,
  DEFAULT_SORT,
  DESCENDING_FIRST,
  productFilterGroups,
  productTable,
  type ProductCheck,
  type ProductSort,
  type ProductTable,
} from "@/lib/products";

const TABS = ["unassigned", "changes"] as const;
type Tab = (typeof TABS)[number];
const isTab = (value: unknown): value is Tab => TABS.includes(value as Tab);

export const Route = createFileRoute("/products/")({
  beforeLoad: requirePurchases,
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } =>
    isTab(search["tab"]) ? { tab: search["tab"] } : {},
  component: ProductsPage,
});

function ProductsActions({
  disabled,
  onCategories,
  onNew,
}: {
  disabled: boolean;
  onCategories: () => void;
  onNew: () => void;
}) {
  return (
    <>
      <Button
        variant="ghost"
        aria-label="Item spending"
        title="Item spending"
        render={<Link to="/reports/items" />}
      >
        <ChartColumnIcon />
        <span className="max-md:hidden">Item spending</span>
      </Button>
      <Button
        variant="ghost"
        aria-label="Item categories"
        title="Item categories"
        disabled={disabled}
        onClick={onCategories}
      >
        <FolderTreeIcon />
        <span className="max-md:hidden">Item categories</span>
      </Button>
      <Button
        variant="ghost"
        aria-label="New product"
        title="New product"
        disabled={disabled}
        onClick={onNew}
      >
        <PlusIcon />
        <span className="max-md:hidden">New product</span>
      </Button>
    </>
  );
}

function ProductsTableSection({
  rows,
  table,
  categories,
  query,
  onQuery,
  filters,
  onFilters,
  sort,
  onSort,
  months,
  onMonths,
  moved,
  ranged,
  onAllProducts,
  chosen,
  onChosen,
  open,
  onOpen,
  onRequest,
}: {
  rows: ReadonlyArray<ProductActivity>;
  table: ProductTable;
  categories: ReadonlyArray<ItemCategory>;
  query: string;
  onQuery: (query: string) => void;
  filters: FacetValue;
  onFilters: (filters: FacetValue) => void;
  sort: ProductSort;
  onSort: (sort: ProductSort) => void;
  months: number | null;
  onMonths: (months: number | null) => void;
  moved: boolean;
  ranged: boolean;
  onAllProducts: () => void;
  chosen: ReadonlySet<string>;
  onChosen: (chosen: ReadonlySet<string>) => void;
  open: ReadonlySet<string>;
  onOpen: (open: ReadonlySet<string>) => void;
  onRequest: (request: ProductRequest) => void;
}) {
  const { id: book } = useBook();
  const update = useBookMutation(book, "update_product");
  const names = new Map(categories.map((each) => [each.id, each.name]));
  const selected = table.rows.map((each) => each.row).filter((row) => chosen.has(row.id));
  const narrowed = query.trim() !== "" || facetCount(filters) > 0 || moved;
  const earlier = !narrowed && ranged ? boughtEarlier(rows) : 0;
  const setArchived = async (archived: boolean) => {
    await Promise.all(
      archiveTargets(selected, archived).map((row) => update.mutateAsync({ id: row.id, archived })),
    );
    onChosen(new Set());
  };
  return (
    <>
      <FilterBar
        testId="product-filters"
        search="Search products"
        query={query}
        onQuery={onQuery}
        shown={table.matched}
        total={rows.length}
        range={<RangeChoice months={months} onMonths={onMonths} />}
        head={
          <ProductsHeader
            sort={sort}
            onSort={(key) => onSort(nextSort(sort, key, DESCENDING_FIRST))}
          />
        }
      >
        <Facets
          groups={productFilterGroups(rows, categories)}
          value={filters}
          onValueChange={onFilters}
        />
        {moved && (
          <FilterChip
            label="Prices that moved"
            clearLabel="Show all products"
            onClear={onAllProducts}
          />
        )}
        {selected.length > 0 && (
          <SelectionActions
            count={selected.length}
            onDelete={() => onRequest({ kind: "delete", products: selected })}
          >
            {selected.length > 1 && (
              <Button
                variant="ghost"
                onClick={() => onRequest({ kind: "merge", products: selected })}
              >
                <MergeIcon />
                Merge…
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => onRequest({ kind: "category", products: selected })}
            >
              <FolderTreeIcon />
              Category…
            </Button>
            {archiveTargets(selected, true).length > 0 && (
              <Button variant="ghost" onClick={() => void setArchived(true)}>
                <ArchiveIcon />
                Archive
              </Button>
            )}
            {archiveTargets(selected, false).length > 0 && (
              <Button variant="ghost" onClick={() => void setArchived(false)}>
                <ArchiveRestoreIcon />
                Unarchive
              </Button>
            )}
          </SelectionActions>
        )}
      </FilterBar>
      {table.rows.map((entry) => (
        <ProductRow
          key={entry.row.id}
          entry={entry}
          categoryName={
            entry.row.itemCategoryId === null ? undefined : names.get(entry.row.itemCategoryId)
          }
          selected={chosen.has(entry.row.id)}
          onSelect={() => onChosen(toggled(chosen, entry.row.id))}
          onFold={() => onOpen(toggled(open, entry.row.id))}
          onRequest={onRequest}
        />
      ))}
      {table.rows.length === 0 && (
        <TableEmpty>
          {narrowed
            ? "No product matches."
            : rows.length === 0
              ? "Products are the things receipts name. Assign one to a receipt line to start its price history."
              : "No product was bought in this range."}
        </TableEmpty>
      )}
      {earlier > 0 && (
        <div className="flex items-center justify-center gap-3 p-4">
          <span className="text-xs text-muted-foreground tabular-nums">
            {earlier} more bought before this range
          </span>
          <Button variant="outline" onClick={() => onMonths(null)}>
            Show all time
          </Button>
        </div>
      )}
    </>
  );
}

function ProductsPage() {
  const { id: book } = useBook();
  const search = Route.useSearch();
  const tab = search.tab ?? null;
  const navigate = useNavigate({ from: Route.fullPath });
  const [months, setMonths] = useState<number | null>(DEFAULT_MONTHS);
  const [sort, setSort] = useState<ProductSort>(tab === "changes" ? CHANGE_SORT : DEFAULT_SORT);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<FacetValue>({});
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [compareTo, setCompareTo] = useState<CompareTo>("average");
  const [namedOnly, setNamedOnly] = useState(false);
  const [request, setRequest] = useState<ProductRequest | null>(null);
  const [managing, setManaging] = useState(false);
  const [creating, setCreating] = useState(false);
  const since = months === null ? undefined : rangeStart(today(), months);
  const overview = useQuery({
    ...bookQuery(book, "product_activity", {
      ...(since === undefined ? {} : { since }),
      compareTo,
    }),
    placeholderData: keepPreviousData,
  });
  const categories = useQuery(bookQuery(book, "list_item_categories", {})).data ?? [];
  const moved = tab === "changes";

  const goTo = (view: ProductView) =>
    void navigate({ search: view === null ? {} : { tab: view }, replace: true });
  const onView = (view: ProductView) => {
    setNamedOnly(false);
    if (view === "changes") {
      setSort(CHANGE_SORT);
      setFilters({});
      setQuery("");
    } else if (sort === CHANGE_SORT) setSort(DEFAULT_SORT);
    goTo(view);
  };
  const onCheck = (check: ProductCheck) => {
    if (check.view !== undefined) {
      const named = check.view === "named";
      const active = tab === "unassigned" && namedOnly === named;
      setNamedOnly(!active && named);
      goTo(active ? null : "unassigned");
      return;
    }
    const next = check.filters ?? {};
    const active = tab !== "unassigned" && JSON.stringify(filters) === JSON.stringify(next);
    setQuery("");
    setFilters(active ? {} : next);
    goTo(null);
  };

  return (
    <>
      <Page
        title="Products"
        query={overview}
        actions={
          <ProductsActions
            disabled={overview.data === undefined}
            onCategories={() => setManaging(true)}
            onNew={() => setCreating(true)}
          />
        }
      >
        {(data) => {
          const rows = data.products;
          const table = productTable(rows, {
            query,
            filters,
            categories,
            sort,
            open,
            ranged: since !== undefined,
            moved,
          });
          return (
            <>
              {rows.length > 0 || data.attention.unassigned > 0 ? (
                <ProductInsights
                  overview={data}
                  rows={rows}
                  since={since}
                  view={tab}
                  namedOnly={namedOnly}
                  query={query}
                  filters={filters}
                  compareTo={compareTo}
                  onCompareTo={setCompareTo}
                  onView={onView}
                  onCheck={onCheck}
                  onProduct={(name) => {
                    setQuery(query === name ? "" : name);
                    if (tab !== null) goTo(null);
                  }}
                  onFilters={(next) => {
                    setFilters(next);
                    if (tab !== null) goTo(null);
                  }}
                />
              ) : null}
              {tab === "unassigned" ? (
                <UnassignedLines
                  namedOnly={namedOnly}
                  onNamedOnly={setNamedOnly}
                  onLeave={() => onView(null)}
                />
              ) : (
                <ProductsTableSection
                  rows={rows}
                  table={table}
                  categories={categories}
                  query={query}
                  onQuery={setQuery}
                  filters={filters}
                  onFilters={setFilters}
                  sort={sort}
                  onSort={setSort}
                  months={months}
                  onMonths={setMonths}
                  moved={moved}
                  ranged={since !== undefined}
                  onAllProducts={() => onView(null)}
                  chosen={chosen}
                  onChosen={setChosen}
                  open={open}
                  onOpen={setOpen}
                  onRequest={setRequest}
                />
              )}
            </>
          );
        }}
      </Page>
      <ItemCategoriesDialog open={managing} onOpenChange={setManaging} />
      <NewProductDialog open={creating} onOpenChange={setCreating} />
      <ProductDialogs
        request={request}
        categories={categories}
        onClose={() => setRequest(null)}
        onDone={() => setChosen(new Set())}
      />
    </>
  );
}

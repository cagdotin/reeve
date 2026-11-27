import { requirePurchases } from "@/lib/purchases";
import type { PricePoint, Product, ProductAlias, ProductSummary } from "@reeve/contract/catalog";
import type { Unit } from "@reeve/contract/receipts";
import { today } from "@reeve/contract/rules";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArchiveIcon, EllipsisIcon, MergeIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Page } from "@/components/page";
import { FilterBar, FilterChip, RangeChoice } from "@/components/insights/filter-bar";
import {
  InsightCard,
  InsightGrid,
  InsightPanel,
  InsightTabs,
} from "@/components/insights/insight-card";
import { STAT_TILE, StatBody, StatStrip } from "@/components/insights/stat-strip";
import { TableEmpty } from "@/components/insights/table";
import { Aliases } from "@/components/products/aliases";
import { CheapestStores } from "@/components/products/cheapest-stores";
import { DeleteDialog } from "@/components/products/delete-dialog";
import { Kinds } from "@/components/products/kinds";
import { MergeDialog } from "@/components/products/merge-dialog";
import { ProductHero } from "@/components/products/product-hero";
import { ProductPanel } from "@/components/products/product-panel";
import { PurchaseRow, PurchasesHeader } from "@/components/products/purchases-table";
import { Button } from "@reeve/ui/components/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@reeve/ui/components/menu";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { nextSort, rangeStart } from "@/lib/insights";
import {
  buyAdvice,
  matchesPurchase,
  parentsOf,
  PURCHASE_DESCENDING,
  PURCHASE_SORT,
  quantityText,
  sortPurchases,
  withKinds,
  type PurchaseSort,
  type StoreLike,
} from "@/lib/products";

export const Route = createFileRoute("/products/$product")({
  beforeLoad: requirePurchases,
  component: ProductRoute,
});

function ProductRoute() {
  const { product } = Route.useParams();
  return <ProductPage key={product} id={product} />;
}

const LINKS = [
  { value: "aliases", label: "Aliases" },
  { value: "kinds", label: "Kinds" },
] as const;

/** All time, kinds included. */
function ProductStats({ summary, unit }: { summary: ProductSummary | undefined; unit: Unit }) {
  const { format, formatDay } = useBook();
  const unmeasured = summary?.unmeasured ?? 0;
  const first = summary?.firstBought ?? null;
  const last = summary?.lastBought ?? null;
  const interval = summary?.intervalDays ?? null;
  return (
    <StatStrip columns="@2xl:grid-cols-4">
      <div
        className={STAT_TILE}
        title="All time, kinds included. Each line's share of what its receipt paid, tax and discounts spread as the Item spending report does, so it can differ from the sum of the lines below."
      >
        <StatBody label="Spent" value={format(summary?.spent ?? 0)} note="All time" />
      </div>
      <div
        className={STAT_TILE}
        title={
          first === null ? undefined : `Receipt lines since ${formatDay(first)}, kinds included.`
        }
      >
        <StatBody
          label="Purchases"
          value={String(summary?.purchases ?? 0)}
          note={first === null ? "None yet" : `Since ${first.slice(0, 4)}`}
        />
      </div>
      <div
        className={STAT_TILE}
        title={
          unmeasured > 0
            ? `${unmeasured} lines cannot be measured in this unit and are left out.`
            : undefined
        }
      >
        <StatBody
          label="Bought"
          value={quantityText(summary?.quantity ?? 0, unit)}
          note={unmeasured > 0 ? `${unmeasured} not measured` : "All time"}
        />
      </div>
      <div
        className={STAT_TILE}
        title="The average days between the days it was bought. It takes three such days to say."
      >
        <StatBody
          label="Bought every"
          value={interval === null ? "–" : `${Math.round(interval)} days`}
          note={last === null ? "Never bought" : `Last ${formatDay(last)}`}
        />
      </div>
    </StatStrip>
  );
}

function PurchasesSection({
  id,
  points,
  ranged,
  loaded,
  unit,
  kinds,
  names,
  months,
  onMonths,
  store,
  storeName,
  onStore,
}: {
  id: string;
  points: ReadonlyArray<PricePoint>;
  ranged: ReadonlyArray<PricePoint>;
  loaded: boolean;
  unit: Unit;
  kinds: boolean;
  names: ReadonlyMap<string, string>;
  months: number | null;
  onMonths: (months: number | null) => void;
  store: string | null | undefined;
  storeName: string | null | undefined;
  onStore: (store: string | null | undefined) => void;
}) {
  const [sort, setSort] = useState<PurchaseSort>(PURCHASE_SORT);
  const [query, setQuery] = useState("");
  const shown = sortPurchases(
    ranged.filter(
      (point) => matchesPurchase(point, query) && (store === undefined || point.payeeId === store),
    ),
    sort,
  );
  return (
    <>
      <FilterBar
        testId="purchase-filters"
        search="Search stores"
        query={query}
        onQuery={setQuery}
        shown={shown.length}
        total={points.length}
        range={<RangeChoice months={months} onMonths={onMonths} />}
        head={
          <PurchasesHeader
            sort={sort}
            kinds={kinds}
            onSort={(key) => setSort(nextSort(sort, key, PURCHASE_DESCENDING))}
          />
        }
      >
        {store !== undefined && (
          <FilterChip
            label={storeName ?? "No store"}
            clearLabel="Show every store"
            onClear={() => onStore(undefined)}
          />
        )}
      </FilterBar>
      {shown.map((point) => (
        <PurchaseRow
          key={point.lineId}
          point={point}
          unit={unit}
          kinds={kinds}
          kind={point.productId === id ? undefined : names.get(point.productId)}
        />
      ))}
      {loaded && shown.length === 0 && (
        <TableEmpty>
          {points.length === 0
            ? "No purchases yet. Assign this product to a receipt line to start its price history."
            : "No purchase matches."}
        </TableEmpty>
      )}
    </>
  );
}

function ProductCards({
  product,
  all,
  stores,
  summary,
  unit,
  best,
  store,
  storeName,
  onStore,
}: {
  product: Product & {
    readonly aliases: ReadonlyArray<ProductAlias>;
    readonly children: ReadonlyArray<Product>;
  };
  all: ReadonlyArray<Product>;
  stores: ReadonlyArray<StoreLike>;
  summary: ProductSummary | undefined;
  unit: Unit;
  best: StoreLike | null;
  store: string | null | undefined;
  storeName: string | null | undefined;
  onStore: (store: string | null | undefined) => void;
}) {
  const { id: book } = useBook();
  const categories = useQuery(bookQuery(book, "list_item_categories", {})).data ?? [];
  const [links, setLinks] = useState<"aliases" | "kinds" | null>(null);
  const under = withKinds(all, product.id);
  const above = parentsOf(all, product.id);
  const candidates = all.filter(
    (each) => !under.has(each.id) && !above.has(each.id) && !each.archived,
  );
  const storeOptions = stores.flatMap((each) =>
    each.payeeId === null ? [] : [{ id: each.payeeId, name: each.payee ?? "" }],
  );
  const parentRow =
    product.parentId === null ? undefined : all.find((each) => each.id === product.parentId);
  const tab = links ?? (product.children.length > 0 ? "kinds" : "aliases");
  return (
    <InsightGrid>
      <CheapestStores
        stores={stores}
        unit={unit}
        best={best}
        activeStore={store === undefined ? undefined : (storeName ?? null)}
        onStore={(next) => onStore(store === next.payeeId ? undefined : next.payeeId)}
      />
      <ProductPanel product={product} categories={categories} parent={parentRow} />
      <InsightCard
        title="Names"
        aside={<InsightTabs label="Show" items={LINKS} value={tab} onChange={setLinks} />}
      >
        {tab === "aliases" ? (
          <Aliases aliases={product.aliases} product={product.id} stores={storeOptions} />
        ) : (
          <Kinds product={product.id} kinds={summary?.kinds ?? []} candidates={candidates} />
        )}
      </InsightCard>
    </InsightGrid>
  );
}

function ProductPage({ id }: { id: string }) {
  const { id: book } = useBook();
  const product = useQuery(bookQuery(book, "get_product", { id }));
  const history = useQuery(bookQuery(book, "product_price_history", { id, includeChildren: true }));
  const stores = useQuery(bookQuery(book, "cheapest_stores", { id })).data ?? [];
  const summary = useQuery(bookQuery(book, "product_summary", { id })).data;
  const all =
    useQuery(bookQuery(book, "list_products", { limit: 500, archived: true })).data?.products ?? [];
  const [months, setMonths] = useState<number | null>(null);
  const [store, setStore] = useState<string | null | undefined>(undefined);
  const points = history.data?.points ?? [];
  const since = months === null ? undefined : rangeStart(today(), months);
  const ranged = points.filter((point) => since === undefined || point.date >= since);
  const advice = buyAdvice(stores, today());
  const names = new Map(all.map((each) => [each.id, each.name]));
  const storeName = stores.find((each) => each.payeeId === store)?.payee;

  return (
    <Page
      title={product.data?.name ?? ""}
      query={{ data: product.data, error: product.error ?? history.error }}
      actions={
        product.data === undefined ? (
          <Button size="icon" variant="ghost" aria-label="Product actions" disabled>
            <EllipsisIcon />
          </Button>
        ) : (
          <ProductMenu
            id={product.data.id}
            name={product.data.name}
            unit={product.data.unit}
            archived={product.data.archived}
          />
        )
      }
    >
      {(data) => {
        const unit = history.data?.unit ?? data.unit;
        return (
          <>
            <InsightPanel>
              <ProductHero
                product={data}
                points={points}
                shownPoints={ranged}
                unit={unit}
                advice={advice}
                summary={summary}
                names={names}
              />
              <ProductStats summary={summary} unit={unit} />
              <ProductCards
                product={data}
                all={all}
                stores={stores}
                summary={summary}
                unit={unit}
                best={advice?.store ?? null}
                store={store}
                storeName={storeName}
                onStore={setStore}
              />
            </InsightPanel>
            <PurchasesSection
              id={id}
              points={points}
              ranged={ranged}
              loaded={history.data !== undefined}
              unit={unit}
              kinds={data.children.length > 0}
              names={names}
              months={months}
              onMonths={setMonths}
              store={store}
              storeName={storeName}
              onStore={setStore}
            />
          </>
        );
      }}
    </Page>
  );
}

function ProductMenu({
  id,
  name,
  unit,
  archived,
}: {
  id: string;
  name: string;
  unit: Parameters<typeof MergeDialog>[0]["products"][number]["unit"];
  archived: boolean;
}) {
  const { id: book } = useBook();
  const update = useBookMutation(book, "update_product");
  const [merging, setMerging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <>
      <Menu>
        <MenuTrigger render={<Button size="icon" variant="ghost" aria-label="Product actions" />}>
          <EllipsisIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={() => setMerging(true)}>
            <MergeIcon />
            Merge into another product…
          </MenuItem>
          <MenuItem onClick={() => update.mutate({ id, archived: !archived })}>
            <ArchiveIcon />
            {archived ? "Unarchive" : "Archive"}
          </MenuItem>
          <MenuSeparator />
          <MenuItem variant="destructive" onClick={() => setDeleting(true)}>
            <Trash2Icon />
            Delete product…
          </MenuItem>
        </MenuPopup>
      </Menu>
      <MergeDialog products={[{ id, name, unit }]} open={merging} onOpenChange={setMerging} />
      <DeleteDialog leaving products={[{ id, name }]} open={deleting} onOpenChange={setDeleting} />
    </>
  );
}

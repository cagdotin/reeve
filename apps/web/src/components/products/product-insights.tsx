import type { ProductActivity, ProductOverview } from "@reeve/contract/catalog";
import { AttentionAlerts } from "@/components/insights/attention-alerts";
import { InsightCard, InsightEmpty, InsightPanel } from "@/components/insights/insight-card";
import { RankedBars } from "@/components/insights/ranked-bars";
import {
  STAT_TILE,
  StatAllClear,
  StatBody,
  StatButton,
  StatStrip,
} from "@/components/insights/stat-strip";
import { useBook } from "@/lib/book";
import { sameFilters, type FacetValue } from "@/lib/facets";
import {
  attentionItems,
  CATEGORY_FILTER,
  topCategories,
  topProducts,
  type ProductCheck,
} from "@/lib/products";
import { PriceMovers, type CompareTo } from "./price-movers";

export type ProductView = "unassigned" | "changes" | null;

function ProductSummary({
  overview,
  view,
  allClear,
  onView,
}: {
  overview: ProductOverview;
  view: ProductView;
  allClear: number | null;
  onView: (view: ProductView) => void;
}) {
  const { format } = useBook();
  const { summary, movers, attention } = overview;
  const moved = movers.dearerCount + movers.cheaperCount;
  const inProducts = summary.spent - summary.unassignedSpent;
  return (
    <StatStrip columns={allClear === null ? "@2xl:grid-cols-4" : "@2xl:grid-cols-5"}>
      <div
        className={STAT_TILE}
        title={
          summary.archivedProducts > 0
            ? `Products bought in the range, ${summary.archivedProducts} of them archived. A product counts once however many lines it has; a parent with only kinds bought is not counted.`
            : "Products bought in the range. A product counts once however many lines it has; a parent with only kinds bought is not counted."
        }
      >
        <StatBody
          label="Products"
          value={String(summary.products)}
          change={summary.previous === null ? null : summary.products - summary.previous.products}
        />
      </div>
      <div
        className={STAT_TILE}
        title={[
          "Every receipt line, with each receipt's tax and discounts spread over its lines.",
          `${format(inProducts)} on products${summary.archivedSpent === 0 ? "" : `, ${format(summary.archivedSpent)} of it on archived ones`}.`,
          `${format(summary.unassignedSpent)} on lines without a product.`,
        ].join("\n")}
      >
        <StatBody
          label="Spent"
          value={format(summary.spent)}
          change={summary.previous === null ? null : summary.spent - summary.previous.spent}
          format={format}
        />
      </div>
      <StatButton
        label={`${moved} price movers`}
        title="Products whose latest price moved 1% or more. Lists them in the table."
        active={view === "changes"}
        disabled={moved === 0}
        onClick={() => onView(view === "changes" ? null : "changes")}
      >
        <StatBody
          label="Price movers"
          value={String(moved)}
          note={`${movers.dearerCount} dearer, ${movers.cheaperCount} cheaper`}
        />
      </StatButton>
      <StatButton
        label={`${attention.unassigned} unassigned lines`}
        title={`Across the book, whatever the range. ${format(summary.unassignedSpent)} of them in this range.`}
        active={view === "unassigned"}
        disabled={attention.unassigned === 0 && view !== "unassigned"}
        onClick={() => onView(view === "unassigned" ? null : "unassigned")}
      >
        <StatBody
          label="Unassigned"
          value={String(attention.unassigned)}
          note={attention.named > 0 ? `${attention.named} exact match` : "No product"}
        />
      </StatButton>
      {allClear !== null && <StatAllClear count={allClear} />}
    </StatStrip>
  );
}

/** Everything above the table, which scrolls away under the filters. */
export function ProductInsights({
  overview,
  rows,
  since,
  view,
  namedOnly,
  query,
  filters,
  compareTo,
  onCompareTo,
  onView,
  onCheck,
  onProduct,
  onFilters,
}: {
  overview: ProductOverview;
  rows: ReadonlyArray<ProductActivity>;
  since: string | undefined;
  view: ProductView;
  namedOnly: boolean;
  query: string;
  filters: FacetValue;
  compareTo: CompareTo;
  onCompareTo: (compareTo: CompareTo) => void;
  onView: (view: ProductView) => void;
  onCheck: (check: ProductCheck) => void;
  onProduct: (name: string) => void;
  onFilters: (filters: FacetValue) => void;
}) {
  const { format, formatDay } = useBook();
  const checks = attentionItems(overview.attention);
  const open = checks.some((item) => item.count > 0);
  const top = topProducts(rows);
  const ranked = topCategories(overview.categories);
  const isActive = (check: ProductCheck) =>
    check.view !== undefined
      ? view === "unassigned" && namedOnly === (check.view === "named")
      : view !== "unassigned" && sameFilters(filters, check.filters ?? {});
  return (
    <InsightPanel>
      <ProductSummary
        overview={overview}
        view={view}
        allClear={open ? null : checks.length}
        onView={onView}
      />
      <AttentionAlerts items={checks} isActive={isActive} onChoose={onCheck} />
      <div className="grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-6">
        <PriceMovers
          movers={overview.movers}
          compareTo={compareTo}
          onCompareTo={onCompareTo}
          query={query}
          onProduct={onProduct}
          className="@2xl:col-span-2 @5xl:col-span-6"
        />
        <div className="grid min-w-0 @5xl:col-span-3">
          <InsightCard title="Top products" aside="by spending">
            {top.length === 0 ? (
              <InsightEmpty>Nothing bought in this range.</InsightEmpty>
            ) : (
              <RankedBars
                bars={top.map((row) => ({
                  id: row.id,
                  label: row.name,
                  value: row.rollup.spent,
                  shown: format(row.rollup.spent),
                  ...(since === undefined ? {} : { previous: row.rollup.previousSpent }),
                  tooltip: (
                    <>
                      {row.rollup.purchases} purchases
                      {row.kinds > 0 && `, kinds included`}
                      {since !== undefined &&
                        `, ${format(row.rollup.previousSpent)} in the period before`}
                      {row.rollup.lastBought !== null &&
                        `, last on ${formatDay(row.rollup.lastBought)}`}
                    </>
                  ),
                  active: query === row.name,
                  onClick: () => onProduct(row.name),
                }))}
              />
            )}
          </InsightCard>
        </div>
        <div className="grid min-w-0 @5xl:col-span-3">
          <InsightCard title="Item categories" aside="by spending">
            {ranked.length === 0 ? (
              <InsightEmpty>Nothing bought in this range.</InsightEmpty>
            ) : (
              <RankedBars
                bars={ranked.map((category) => {
                  const next = CATEGORY_FILTER(category.id);
                  const active = sameFilters(filters, next);
                  return {
                    id: category.id ?? "none",
                    label: category.name,
                    value: category.spent,
                    shown: format(category.spent),
                    ...(since === undefined ? {} : { previous: category.previousSpent }),
                    title:
                      since === undefined
                        ? `${category.lines} lines`
                        : `${category.lines} lines, ${format(category.previousSpent)} in the period before`,
                    active,
                    onClick: () => onFilters(active ? {} : next),
                  };
                })}
              />
            )}
          </InsightCard>
        </div>
      </div>
    </InsightPanel>
  );
}

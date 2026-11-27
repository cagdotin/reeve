import type { PricePoint } from "@reeve/contract/catalog";
import type { Unit } from "@reeve/contract/receipts";
import { lazy, Suspense } from "react";
import { slot, useChartTheme } from "@/components/reports/chart-theme";
import { displayUnit } from "@/lib/receipts";
import { priceSeries } from "@/lib/products";

const PricePlot = lazy(() => import("./price-plot"));

/**
 * A product's price per unit over time, one line per store: each purchase a point, normalised to
 * the product's unit (per kilogram or litre for grams and millilitres). The dashed line is the
 * price to beat.
 */
export function PriceChart({
  points,
  unit,
  best,
  bestPrice,
}: {
  points: ReadonlyArray<PricePoint>;
  unit: Unit;
  /** The store to buy at. */
  best: string | null;
  bestPrice: number | null;
}) {
  const theme = useChartTheme();
  const shown = displayUnit(unit);
  const { stores, rows } = priceSeries(points, unit);
  const lone = stores.length === 1;
  return (
    <div className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1.5">
        <h2 className="text-[13px] font-medium">Price per {shown.label}, by store</h2>
        <ul aria-label="Stores" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {!lone &&
            stores.map((store, index) => (
              <li
                key={store.key}
                className={
                  store.key === best
                    ? "flex items-center gap-1.5 font-medium"
                    : "flex items-center gap-1.5 text-muted-foreground"
                }
              >
                <span
                  aria-hidden
                  className="h-0.5 w-3.5 rounded-full"
                  style={{ backgroundColor: slot(theme, index) }}
                />
                {store.name}
              </li>
            ))}
          {bestPrice !== null && (
            <li className="flex items-center gap-1.5 text-muted-foreground">
              <span
                aria-hidden
                className="w-3.5 border-t-2 border-dashed border-muted-foreground/60"
              />
              Price to beat
            </li>
          )}
        </ul>
      </div>
      <div className="relative h-60 min-w-0 @max-xl:h-48">
        {rows.length === 0 ? (
          <p className="flex h-full items-center justify-center p-6 text-center text-[13px] text-muted-foreground">
            No purchase in this range can be measured per {shown.label}.
          </p>
        ) : (
          <Suspense fallback={null}>
            <PricePlot
              rows={rows}
              stores={stores}
              best={best}
              bestPrice={bestPrice === null ? null : Math.round(bestPrice * shown.factor)}
              shownUnit={shown.label}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
}

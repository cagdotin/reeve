import type { Unit } from "@reeve/contract/receipts";
import { InsightCard, InsightEmpty, INSIGHT_ROW } from "@/components/insights/insight-card";
import { useChartTheme } from "@/components/reports/chart-theme";
import { cn } from "@reeve/ui/lib/utils";
import { useBook } from "@/lib/book";
import { FRESH_DAYS, priceText, type StoreLike } from "@/lib/products";
import { displayUnit } from "@/lib/receipts";
import { daysBetween, today } from "@reeve/contract/rules";

/**
 * Each store's latest price on one baseline with its average as a tick, cheapest first. The kit's
 * ranked bars have one value to a row and this has two. A row narrows the purchases to the store.
 */
export function CheapestStores<Store extends StoreLike>({
  stores,
  unit,
  best,
  activeStore,
  onStore,
}: {
  stores: ReadonlyArray<Store>;
  unit: Unit;
  best: Store | null;
  activeStore: Store["payee"] | undefined;
  onStore: (store: Store) => void;
}) {
  const theme = useChartTheme();
  const { format, formatDay } = useBook();
  const shown = displayUnit(unit);
  const money = (price: number) => format(Math.round(price * shown.factor));
  const most = Math.max(1, ...stores.map((each) => Math.max(each.latest, each.average)));
  return (
    <InsightCard title="Cheapest stores" aside={`latest and average, per ${shown.label}`}>
      {stores.length === 0 ? (
        <InsightEmpty>No purchase has a unit price yet.</InsightEmpty>
      ) : (
        <ol className="grid gap-px">
          {stores.map((store) => {
            const active = activeStore === store.payee && activeStore !== undefined;
            const old = daysBetween(store.latestDate, today()) > FRESH_DAYS;
            return (
              <li key={store.payeeId ?? "none"}>
                <button
                  type="button"
                  aria-pressed={active}
                  aria-label={`${store.payee ?? "No store"}, ${priceText(store.latest, unit, format)}, average ${priceText(store.average, unit, format)}`}
                  title={`Last bought on ${formatDay(store.latestDate)}, ${store.purchases} ${store.purchases === 1 ? "purchase" : "purchases"}${old ? ". An old price: it may have moved." : ""}`}
                  className={cn(
                    INSIGHT_ROW,
                    "grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)_3.25rem_3.25rem]",
                    active && "bg-accent",
                    old && "text-muted-foreground",
                  )}
                  onClick={() => onStore(store)}
                >
                  <span className={cn("truncate", best === store && "font-medium")}>
                    {store.payee ?? "No store"}
                  </span>
                  <span className="relative flex h-full items-center border-s">
                    <span
                      className={cn("h-2.5 min-w-0.5 rounded-e-sm", old && "opacity-50")}
                      style={{
                        width: `${(store.latest / most) * 100}%`,
                        backgroundColor: theme.tick,
                      }}
                    />
                    <span
                      aria-hidden
                      className="absolute h-3.5 w-0.5 rounded-full bg-muted-foreground/50"
                      style={{ left: `${(store.average / most) * 100}%` }}
                    />
                  </span>
                  <span className="text-right font-medium tabular-nums">{money(store.latest)}</span>
                  <span className="text-right text-muted-foreground tabular-nums">
                    {money(store.average)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </InsightCard>
  );
}

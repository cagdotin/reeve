import type { PricePoint, Product, ProductSummary } from "@reeve/contract/catalog";
import type { Unit } from "@reeve/contract/receipts";
import { daysBetween, today } from "@reeve/contract/rules";
import { cn } from "@reeve/ui/lib/utils";
import { useBook } from "@/lib/book";
import {
  latestAt,
  percentFrom,
  priceMove,
  priceText,
  type BuyAdvice,
  type StoreLike,
} from "@/lib/products";
import { displayUnit } from "@/lib/receipts";
import { PriceChange } from "./price-change";
import { PriceChart } from "./price-chart";

function Compared({ label, before, now }: { label: string; before: number | null; now: number }) {
  if (before === null || before === 0) return null;
  const percent = percentFrom(before, now);
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>
        {Math.abs(percent) < 0.05 ? (
          <span className="text-muted-foreground">No change</span>
        ) : (
          <PriceChange percent={percent} />
        )}
      </dd>
    </div>
  );
}

const rhythmText = (summary: ProductSummary | undefined) => {
  const last = summary?.lastBought ?? null;
  if (summary?.intervalDays == null || last === null) return null;
  const ago = daysBetween(last, today());
  return `You buy it about every ${Math.round(summary.intervalDays)} days; last ${ago === 0 ? "today" : `${ago} days ago`}.`;
};

/** What to do next time, as far as the purchases can say. */
function NextTime<Store extends StoreLike>({
  advice,
  unit,
  summary,
  kind,
}: {
  advice: BuyAdvice<Store> | null;
  unit: Unit;
  summary: ProductSummary | undefined;
  /** The kind the price to beat is for, when not the product itself. */
  kind: string | undefined;
}) {
  const { format, formatDay } = useBook();
  if (advice === null) return null;
  const { store, next, older, stale, only } = advice;
  const price = (value: number) => priceText(value, unit, format);
  const name = store.payee ?? "no store";
  const notes = [
    kind === undefined ? null : `That is for ${kind}. Open a kind to compare like with like.`,
    stale ? `Its price is from ${formatDay(store.latestDate)}: nothing recent to go by.` : null,
    next === null || next.latest <= store.latest
      ? null
      : `${Math.round(percentFrom(next.latest, store.latest) * -1)}% less than ${next.payee ?? "no store"} at ${price(next.latest)}`,
    older === null
      ? null
      : `${older.payee ?? "No store"} was ${price(older.latest)} on ${formatDay(older.latestDate)}, too long ago to go by.`,
    rhythmText(summary),
  ].filter((note) => note !== null);
  return (
    <div className="grid gap-1 border-t pt-3">
      <p className="text-xs text-muted-foreground">Next time</p>
      <p className="text-[13px] font-medium">
        {only ? `Only bought at ${name}` : `Buy at ${name}`},{" "}
        <span className="tabular-nums">{price(store.latest)}</span>
      </p>
      <ul className="grid gap-0.5 text-xs text-muted-foreground">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  );
}

/** The latest price and how it moved, what to do next time, and the price over time by store. */
export function ProductHero<Store extends StoreLike>({
  product,
  points,
  shownPoints,
  unit,
  advice,
  summary,
  names,
}: {
  product: Product;
  /** Every purchase, for how the latest price moved. */
  points: ReadonlyArray<PricePoint>;
  /** Those in the range, for the chart. */
  shownPoints: ReadonlyArray<PricePoint>;
  unit: Unit;
  advice: BuyAdvice<Store> | null;
  summary: ProductSummary | undefined;
  names: ReadonlyMap<string, string>;
}) {
  const { format, formatDay } = useBook();
  const move = priceMove(points);
  const shown = displayUnit(unit);
  const kindOf = (id: string | undefined) =>
    id === undefined || id === product.id ? undefined : names.get(id);
  const latestKind = kindOf(move?.latest.productId);
  const bestKind =
    advice === null ? undefined : kindOf(latestAt(points, advice.store.payeeId)?.productId);
  return (
    <section
      aria-label="Price"
      className={cn(
        "grid divide-border overflow-hidden rounded-xl border bg-card",
        "@3xl:grid-cols-[17rem_minmax(0,1fr)] @3xl:divide-x max-@3xl:divide-y",
      )}
    >
      <div className="grid content-start gap-3 p-4">
        {move === null ? (
          <div className="grid gap-1">
            <p className="text-xs text-muted-foreground">Latest price</p>
            <p className="text-[13px]">
              {points.length === 0
                ? "No purchases yet. Assign this product to a receipt line to start its price history."
                : `No purchase can be measured per ${shown.label} yet: give the product a size, or its lines a unit.`}
            </p>
          </div>
        ) : (
          <>
            <div className="grid gap-0.5">
              <p className="text-xs text-muted-foreground">Latest price</p>
              <p className="text-3xl leading-9 font-medium tabular-nums">
                {format(Math.round(move.latest.pricePerBase * shown.factor))}
                <span className="ms-1.5 text-sm font-normal text-muted-foreground">
                  / {shown.label}
                </span>
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {move.latest.payee ?? "No store"} · {formatDay(move.latest.date)}
                {latestKind !== undefined && ` · ${latestKind}`}
              </p>
            </div>
            {move.previous !== null && (
              <dl className="grid gap-1">
                <Compared
                  label="Against the purchase before"
                  before={move.previous}
                  now={move.latest.pricePerBase}
                />
                <Compared
                  label="Against the average before"
                  before={move.average}
                  now={move.latest.pricePerBase}
                />
              </dl>
            )}
          </>
        )}
        <NextTime advice={advice} unit={unit} summary={summary} kind={bestKind} />
      </div>
      {move !== null && (
        <PriceChart
          points={shownPoints}
          unit={unit}
          best={advice === null ? null : (advice.store.payeeId ?? "none")}
          bestPrice={advice?.store.latest ?? null}
        />
      )}
    </section>
  );
}

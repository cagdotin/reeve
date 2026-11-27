import type { ProductMover, ProductOverview } from "@reeve/contract/catalog";
import {
  InsightCard,
  InsightEmpty,
  InsightTabs,
  INSIGHT_ROW,
} from "@/components/insights/insight-card";
import { useChartTheme } from "@/components/reports/chart-theme";
import { cn } from "@reeve/ui/lib/utils";
import { useBook } from "@/lib/book";
import { priceText } from "@/lib/products";
import { displayUnit } from "@/lib/receipts";
import { PriceChange } from "./price-change";

export type CompareTo = "previous" | "average";

const COMPARE = [
  { value: "average", label: "Average before" },
  { value: "previous", label: "Last purchase" },
] as const;

function MoverRow({
  mover,
  most,
  color,
  active,
  onChoose,
}: {
  mover: ProductMover;
  most: number;
  color: string;
  active: boolean;
  onChoose: () => void;
}) {
  const { format, formatDay } = useBook();
  const shown = displayUnit(mover.unit);
  const money = (price: number) => format(Math.round(price * shown.factor));
  return (
    <li>
      <button
        type="button"
        aria-pressed={active}
        title={`${priceText(mover.before, mover.unit, format)} before; ${priceText(mover.latest, mover.unit, format)} at ${mover.payee ?? "no store"} on ${formatDay(mover.date)}`}
        className={cn(
          INSIGHT_ROW,
          "grid grid-cols-[minmax(0,1fr)_auto_2.5rem_3rem]",
          active && "bg-accent",
        )}
        onClick={onChoose}
      >
        <span className="truncate">{mover.name}</span>
        <span className="text-muted-foreground tabular-nums">
          {money(mover.before)} → {money(mover.latest)}
          <span className="ms-1">/ {shown.label}</span>
        </span>
        <span aria-hidden className="flex h-full items-center border-s">
          <span
            className="h-2.5 min-w-0.5 rounded-e-sm"
            style={{
              width: `${(Math.abs(mover.changePct) / most) * 100}%`,
              backgroundColor: color,
            }}
          />
        </span>
        <PriceChange percent={mover.changePct} className="text-right font-medium" />
      </button>
    </li>
  );
}

/** What got dearer and cheaper, per unit: the page's first question. A row narrows the table. */
export function PriceMovers({
  movers,
  compareTo,
  onCompareTo,
  query,
  onProduct,
  className,
}: {
  movers: ProductOverview["movers"];
  compareTo: CompareTo;
  onCompareTo: (compareTo: CompareTo) => void;
  query: string;
  onProduct: (name: string) => void;
  className?: string;
}) {
  const theme = useChartTheme();
  const { dearer, cheaper, dearerCount, cheaperCount } = movers;
  const most = Math.max(1, ...[...dearer, ...cheaper].map((each) => Math.abs(each.changePct)));
  const list = (title: string, rows: ReadonlyArray<ProductMover>, count: number, color: string) => (
    <div className="min-w-0">
      <h3 className="flex h-6 items-center justify-between px-1.5 text-xs text-muted-foreground">
        {title}
        <span className="tabular-nums">{count}</span>
      </h3>
      {rows.length === 0 ? (
        <InsightEmpty>Nothing.</InsightEmpty>
      ) : (
        <ul className="grid gap-px">
          {rows.map((mover) => (
            <MoverRow
              key={mover.id}
              mover={mover}
              most={most}
              color={color}
              active={query === mover.name}
              onChoose={() => onProduct(mover.name)}
            />
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <div className={cn("grid min-w-0", className)}>
      <InsightCard
        title="Price changes"
        aside={
          <InsightTabs
            label="Compare the latest price with"
            items={COMPARE}
            value={compareTo}
            onChange={onCompareTo}
          />
        }
      >
        {dearerCount + cheaperCount === 0 ? (
          <InsightEmpty>
            {compareTo === "average"
              ? "No latest price moved 1% from its average before this range."
              : "No latest price moved 1% from the purchase before it."}
          </InsightEmpty>
        ) : (
          <div className="@container">
            <div className="grid gap-x-5 gap-y-2 @2xl:grid-cols-2">
              {list("Dearer", dearer, dearerCount, theme.out)}
              {list("Cheaper", cheaper, cheaperCount, theme.series[0]!)}
            </div>
          </div>
        )}
      </InsightCard>
    </div>
  );
}

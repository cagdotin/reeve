import type { Unit } from "@reeve/contract/receipts";
import { cn } from "@reeve/ui/lib/utils";
import { useBook } from "@/lib/book";
import { displayUnit } from "@/lib/receipts";

/** A price per one of `unit` as a shelf label reads it: `2.49 / kg`. */
export function UnitPrice({
  price,
  unit,
  className,
}: {
  price: number;
  unit: Unit;
  className?: string | undefined;
}) {
  const { format } = useBook();
  const shown = displayUnit(unit);
  return (
    <span className={cn("tabular-nums", className)}>
      {format(Math.round(price * shown.factor))}
      <span className="ms-1 font-sans text-xs text-muted-foreground">/ {shown.label}</span>
    </span>
  );
}

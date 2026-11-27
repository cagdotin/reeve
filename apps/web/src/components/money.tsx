import { cn } from "@reeve/ui/lib/utils";
import { useBook } from "@/lib/book";

/**
 * An amount in the book's number format, in tabular figures. `tone` colours it: `sign` makes
 * negatives red, `balance` also makes positives green (as Actual's budget balances), `none` neither.
 */
export function Money({
  amount,
  tone = "sign",
  className,
  label,
}: {
  amount: number;
  tone?: "sign" | "balance" | "none";
  className?: string;
  /** What the amount is, for assistive technology, when nothing around it says so. */
  label?: string;
}) {
  const { format } = useBook();
  return (
    <span
      aria-label={label === undefined ? undefined : `${label}: ${format(amount)}`}
      className={cn(
        "tabular-nums",
        tone !== "none" && amount < 0 && "text-destructive-foreground",
        tone === "balance" && amount > 0 && "text-success-foreground",
        tone === "balance" && amount === 0 && "text-muted-foreground",
        className,
      )}
    >
      {format(amount)}
    </span>
  );
}

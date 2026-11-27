import { cn } from "@reeve/ui/lib/utils";
import { signedPercent } from "@/lib/products";

/** How far a price moved: dearer is red, cheaper green. */
export const PriceChange = ({
  percent,
  className,
}: {
  percent: number;
  className?: string | undefined;
}) => (
  <span
    className={cn(
      "tabular-nums",
      percent > 0 ? "text-destructive-foreground" : "text-success-foreground",
      className,
    )}
  >
    {signedPercent(percent)}
  </span>
);

import { cn } from "@reeve/ui/lib/utils";

const TICKS = 16;

/** How full something is, as a row of thin ticks. */
export function Meter({
  percent,
  tone = "positive",
  className,
}: {
  percent: number;
  tone?: "positive" | "negative";
  className?: string;
}) {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * TICKS);
  return (
    <span aria-hidden className={cn("flex h-3 items-stretch gap-[1.5px]", className)}>
      {Array.from({ length: TICKS }, (_, tick) => (
        <span
          key={tick}
          className={cn(
            "w-[1.5px] rounded-full",
            tick >= filled
              ? "bg-foreground/14"
              : tone === "positive"
                ? "bg-success"
                : "bg-destructive",
          )}
        />
      ))}
    </span>
  );
}

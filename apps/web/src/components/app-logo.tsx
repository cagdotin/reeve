import { cn } from "@reeve/ui/lib/utils";
import mark from "../../../../docs/brand/svg/mark.svg?url";

/** The mark with no plate, for where the name sits beside it, drawn in the theme's text color. */
export function AppMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block aspect-632/584 h-3.5 shrink-0 bg-foreground mask-contain mask-center mask-no-repeat",
        className,
      )}
      style={{ maskImage: `url("${mark}")` }}
    />
  );
}

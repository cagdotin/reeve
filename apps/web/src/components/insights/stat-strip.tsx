import { ArrowDownRightIcon, ArrowUpRightIcon, CheckCircle2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { signedChange } from "@/lib/insights";
import { cn } from "@reeve/ui/lib/utils";

/** Each tile folds on its own width, which the number of tiles changes too. */
export const STAT_TILE = "@container/tile flex min-w-0 items-end justify-between gap-3 p-3";

/**
 * A tile's contents: label, value and how it moved, beside its bars. Pass `change` for the arrow
 * and "vs before", or `note` for a line of its own; `change: null` says "All time".
 */
export function StatBody({
  label,
  value,
  change,
  format = String,
  note,
}: {
  label: string;
  value: string;
  change?: number | null;
  format?: (value: number) => string;
  note?: ReactNode;
}) {
  const moved = change === undefined || change === null ? null : signedChange(change, format);
  const Arrow = (change ?? 0) > 0 ? ArrowUpRightIcon : ArrowDownRightIcon;
  return (
    <span className="grid min-w-0 gap-0.5">
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-xl leading-7 font-semibold tracking-[-0.01em] tabular-nums">
        {value}
      </span>
      <span className="flex h-4 items-center gap-0.5 truncate text-xs text-muted-foreground tabular-nums">
        {moved !== null && <Arrow className="size-3 shrink-0" />}
        {note ??
          (change === undefined ? null : change === null ? "All time" : (moved ?? "No change"))}
        {note === undefined && moved !== null && (
          <span className="ms-1 truncate @max-[15rem]/tile:hidden">vs before</span>
        )}
      </span>
    </span>
  );
}

/** The card of tiles across the top of a page; `columns` is the `@2xl:grid-cols-*` class. */
export function StatStrip({ columns, children }: { columns: string; children: ReactNode }) {
  return (
    <section
      aria-label="Summary"
      className={cn(
        "grid grid-cols-2 divide-border overflow-hidden rounded-xl border bg-card @2xl:divide-x",
        columns,
      )}
    >
      {children}
    </section>
  );
}

/** A tile that narrows the page, around a `StatBody`; `label` is its whole accessible name. */
export function StatButton({
  label,
  active,
  disabled,
  title,
  className,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  title?: string;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={title}
      disabled={disabled}
      className={cn(
        STAT_TILE,
        "text-left outline-none enabled:cursor-pointer enabled:hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        className,
        active && "bg-accent",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** The strip's last tile while no check is open, saying how many passed. */
export const StatAllClear = ({ count }: { count: number }) => (
  <div className="col-span-2 flex items-center gap-2 p-3 @2xl:col-span-1">
    <CheckCircle2Icon className="size-5 shrink-0 text-success" />
    <span className="grid min-w-0">
      <span className="text-[13px] font-medium">All clear</span>
      <span className="truncate text-xs text-muted-foreground">{count} checks passed</span>
    </span>
  </div>
);

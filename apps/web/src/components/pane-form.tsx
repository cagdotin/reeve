import type { ReactNode } from "react";
import { cn } from "@reeve/ui/lib/utils";

/**
 * The parts every editor in the pane is laid out from, so a transaction, a rule and a payee read
 * alike: titled sections split by hairlines, labelled fields, read-only facts, and one button bar.
 */
export function PaneSection({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn("grid gap-3 border-t pt-4 first:border-t-0 first:pt-0", className)}
    >
      {(title !== undefined || action !== undefined) && (
        <div className="flex min-h-8 items-center justify-between gap-2">
          {title !== undefined && (
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {title}
            </h3>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** One field with its label above it; the control carries its own accessible name. */
export function PaneField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      <span aria-hidden className="text-xs font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

/** Facts shown and never edited, as term and value rows. */
export function PaneFacts({
  facts,
}: {
  facts: ReadonlyArray<{ readonly term: string; readonly value: ReactNode }>;
}) {
  return (
    <dl className="grid grid-cols-[minmax(6rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-2 text-[13px]">
      {facts.map(({ term, value }) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A long identifier, set small and selectable whole. */
export const Ident = ({ children }: { children: string }) => (
  <span className="font-mono text-xs break-all select-all">{children}</span>
);

/** The pane footer's buttons: what destroys or branches at the start, Cancel and the save at the end. */
export function PaneActions({ start, children }: { start?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      {start}
      <div className="ms-auto flex flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}

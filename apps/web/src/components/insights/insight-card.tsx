import { Children, type ReactNode } from "react";
import { TogglePrimitive as Toggle } from "@reeve/ui/components/toggle";
import { ToggleGroupPrimitive as ToggleGroup } from "@reeve/ui/components/toggle-group";
import { LiquidSegments } from "@/components/liquid-segments";
import { cn } from "@reeve/ui/lib/utils";

/** A row in an insight card that narrows the table below; add `flex` or a grid and `bg-accent`. */
export const INSIGHT_ROW =
  "h-7 w-full cursor-pointer items-center gap-2 rounded-md px-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring";

export function InsightCard({
  title,
  aside,
  children,
}: {
  title: string;
  aside: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="flex min-w-0 flex-col rounded-xl border bg-card p-5 max-md:p-4"
    >
      <header className="mb-2 flex min-h-6 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1.5">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{aside}</span>
      </header>
      {children}
    </section>
  );
}

/** A card's choice of view, as liquid segments. */
export function InsightTabs<T extends string>({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  const active = items.findIndex((each) => each.value === value);
  return (
    <LiquidSegments
      items={items.map((each) => ({ ...each, key: each.value }))}
      active={active}
      render={(props) => (
        <ToggleGroup
          aria-label={label}
          value={[value]}
          onValueChange={(next) => {
            const picked = items.find((each) => each.value === next[0]);
            if (picked) onChange(picked.value);
          }}
          {...props}
        />
      )}
      renderItem={(each, _index, props) => <Toggle key={each.key} value={each.key} {...props} />}
    />
  );
}

export const InsightEmpty = ({ children }: { children: ReactNode }) => (
  <p className="px-1.5 py-2 text-[13px] text-muted-foreground">{children}</p>
);

/** Everything above a table, which scrolls away under its filters. */
export const InsightPanel = ({ children }: { children: ReactNode }) => (
  <div className="grid gap-4">{children}</div>
);

/** The row of cards, which spread over the width as there are fewer; `false` children don't count. */
export function InsightGrid({ children }: { children: ReactNode }) {
  const count = Children.toArray(children).length;
  if (count === 0) return null;
  return (
    <div
      className={cn(
        "grid gap-3",
        count > 1 && "@2xl:grid-cols-2",
        count > 2 && "@5xl:grid-cols-3 @2xl:@max-5xl:[&>*:last-child]:col-span-2",
      )}
    >
      {children}
    </div>
  );
}

import type { ReactNode } from "react";
import { INSIGHT_ROW } from "@/components/insights/insight-card";
import { useChartTheme } from "@/components/reports/chart-theme";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@reeve/ui/components/tooltip";
import { cn } from "@reeve/ui/lib/utils";

export interface RankedBar {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  /** The value as the row shows it. */
  readonly shown: string;
  /** What the accessible name says for the value, when `shown` is not enough. */
  readonly spoken?: string;
  /** The same thing in the period before, marked with a tick. */
  readonly previous?: number;
  readonly title?: string;
  /** A richer hover than `title`, in a tooltip. */
  readonly tooltip?: ReactNode;
  readonly active: boolean;
  readonly onClick: () => void;
}

function BarRow({
  bar,
  most,
  color,
}: {
  bar: RankedBar;
  most: number;
  color?: string | undefined;
}) {
  const previous = bar.previous ?? 0;
  const button = {
    type: "button",
    "aria-pressed": bar.active,
    "aria-label": `${bar.label}, ${bar.spoken ?? bar.shown}`,
    className: cn(
      INSIGHT_ROW,
      "grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto]",
      bar.active && "bg-accent",
    ),
    onClick: bar.onClick,
  } as const;
  const contents = (
    <>
      <span className="truncate">{bar.label}</span>
      <span className="relative flex h-full items-center border-s">
        <span
          className="h-2.5 min-w-0.5 rounded-e-sm"
          style={{ width: `${(bar.value / most) * 100}%`, backgroundColor: color }}
        />
        {previous > 0 && (
          <span
            aria-hidden
            className="absolute h-3.5 w-0.5 rounded-full bg-muted-foreground/50"
            style={{ left: `${(previous / most) * 100}%` }}
          />
        )}
      </span>
      <span className="text-right font-medium tabular-nums">{bar.shown}</span>
    </>
  );
  if (bar.tooltip === undefined)
    return (
      <button {...button} title={bar.title}>
        {contents}
      </button>
    );
  return (
    <Tooltip>
      <TooltipTrigger render={<button {...button} />}>{contents}</TooltipTrigger>
      <TooltipPopup>{bar.tooltip}</TooltipPopup>
    </Tooltip>
  );
}

/** Label, bar on one baseline, value; a row narrows the page to it. */
export function RankedBars({ bars }: { bars: ReadonlyArray<RankedBar> }) {
  const theme = useChartTheme();
  const most = Math.max(1, ...bars.map((bar) => Math.max(bar.value, bar.previous ?? 0)));
  return (
    <ol className="grid gap-px">
      {bars.map((bar) => (
        <li key={bar.id}>
          <BarRow bar={bar} most={most} color={theme.tick} />
        </li>
      ))}
    </ol>
  );
}

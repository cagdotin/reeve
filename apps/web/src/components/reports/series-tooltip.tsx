import type { ReactNode } from "react";
import type { TooltipContentProps } from "recharts";
import { TooltipCard, type TooltipRow } from "./chart-parts";

/** A tooltip of every series in the hovered interval, named by `names`. */
export const seriesTooltip =
  (options: {
    names: Readonly<Record<string, string>>;
    title?: ((label: string) => ReactNode) | undefined;
    mark?: TooltipRow["mark"] | undefined;
  }) =>
  ({ active, payload, label }: TooltipContentProps) => {
    if (!active || payload.length === 0) return null;
    return (
      <TooltipCard
        title={options.title ? options.title(String(label)) : String(label)}
        rows={payload.flatMap((entry) => {
          const key = String(entry.dataKey);
          const name = options.names[key];
          if (name === undefined || typeof entry.value !== "number") return [];
          return [
            {
              key,
              label: name,
              value: entry.value,
              color: (entry.color ?? entry.stroke ?? entry.fill) as string | undefined,
              mark: options.mark ?? "line",
            },
          ];
        })}
      />
    );
  };

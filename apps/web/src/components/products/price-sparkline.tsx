import { useChartTheme } from "@/components/reports/chart-theme";
import { sparkPoints } from "@/lib/products";

const WIDTH = 56;
const HEIGHT = 18;

/** A product's recent prices as a small line, the last one marked. What you paid is red. */
export function PriceSparkline({ prices }: { prices: ReadonlyArray<number> }) {
  const theme = useChartTheme();
  const points = sparkPoints(prices, WIDTH, HEIGHT);
  const last = points.at(-1);
  if (last === undefined) return null;
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      className="shrink-0"
    >
      {points.length > 1 && (
        <polyline
          points={points.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          stroke={theme.tick}
          strokeWidth={1.25}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      <circle cx={last[0]} cy={last[1]} r={1.75} fill={theme.tick} />
    </svg>
  );
}

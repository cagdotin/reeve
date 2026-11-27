import type { ChartTheme } from "./chart-theme";

const compactFormat = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Minor units as an axis tick: 0 / 1,000 below ten thousand, 12K / 1.2M above. */
export const compactMoney = (amount: number) => {
  const units = amount / 100;
  return Math.abs(units) < 10_000
    ? Math.round(units).toLocaleString()
    : compactFormat.format(units);
};

/** The recharts props every value axis shares: recessive ticks, no axis line. */
export const valueAxis = (theme: ChartTheme) => ({
  tickFormatter: (value: number) => compactMoney(value),
  tick: { fill: theme.tick, fontSize: 11 },
  axisLine: false,
  tickLine: false,
  width: 52,
});

export const categoryAxis = (theme: ChartTheme) => ({
  tick: { fill: theme.tick, fontSize: 11 },
  axisLine: { stroke: theme.axis },
  tickLine: false,
  minTickGap: 12,
});

export const gridProps = (theme: ChartTheme) => ({
  stroke: theme.grid,
  vertical: false,
});

import { useTheme } from "@/components/theme-provider";
import { CHART_CHROME, CHART_SERIES } from "./chart-colors";

export interface ChartTheme {
  readonly series: ReadonlyArray<string>;
  readonly grid: string;
  readonly axis: string;
  readonly tick: string;
  readonly ink: string;
  readonly surface: string;
  /** Money leaving: spending and bills are this red, whichever chart draws them. */
  readonly out: string;
}

export const useChartTheme = (): ChartTheme => {
  const { resolvedTheme } = useTheme();
  return { series: CHART_SERIES[resolvedTheme], ...CHART_CHROME[resolvedTheme] };
};

/** The i-th slot. Callers fold anything past the eighth series into "Other" (`foldSeries`). */
export const slot = (theme: ChartTheme, index: number) =>
  theme.series[Math.min(index, theme.series.length - 1)]!;

export const MAX_SERIES = 8;

import { MAX_SERIES } from "./chart-theme";

export interface Series {
  readonly id: string;
  readonly name: string;
  /** The ids it stands for: itself, or every series folded into "Other". */
  readonly members: ReadonlyArray<string>;
}

export const OTHER = "__other__";

/**
 * Keeps the series in their order while there are at most eight; past that, the seven largest
 * keep their own colour and the rest fold into "Other".
 */
export const foldSeries = (
  items: ReadonlyArray<{ readonly id: string; readonly name: string; readonly size: number }>,
  max = MAX_SERIES,
): ReadonlyArray<Series> => {
  if (items.length <= max)
    return items.map((item) => ({ id: item.id, name: item.name, members: [item.id] }));
  const kept = new Set(
    items
      .toSorted((a, b) => b.size - a.size)
      .slice(0, max - 1)
      .map((item) => item.id),
  );
  return [
    ...items
      .filter((item) => kept.has(item.id))
      .map((item) => ({ id: item.id, name: item.name, members: [item.id] })),
    {
      id: OTHER,
      name: "Other",
      members: items.filter((item) => !kept.has(item.id)).map((item) => item.id),
    },
  ];
};

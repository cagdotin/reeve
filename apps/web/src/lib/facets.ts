export interface FacetOption {
  readonly value: string;
  readonly label: string;
  readonly count?: number;
  readonly depth?: number;
  /** Muted text after the label while searching, such as a category's group. */
  readonly hint?: string;
}

export interface FacetGroup {
  readonly id: string;
  readonly label: string;
  readonly options: ReadonlyArray<FacetOption>;
}

/** The chosen options of each group; a group with none does not filter. */
export type FacetValue = Readonly<Record<string, ReadonlyArray<string>>>;

export const facetCount = (value: FacetValue) =>
  Object.values(value).reduce((sum, chosen) => sum + chosen.length, 0);

/** The chosen options of a group, or undefined when it does not filter. */
export const chosen = (value: FacetValue, group: string) => {
  const values = value[group];
  return values === undefined || values.length === 0 ? undefined : values;
};

/** Whether the filters are exactly these, in any order. */
export const sameFilters = (a: FacetValue, b: FacetValue) => {
  const sorted = (value: FacetValue) =>
    JSON.stringify(
      Object.entries(value)
        .filter(([, values]) => values.length > 0)
        .map(([key, values]) => [key, values.toSorted()])
        .toSorted(([x], [y]) => String(x).localeCompare(String(y))),
    );
  return sorted(a) === sorted(b);
};

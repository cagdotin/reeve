export interface PickerItem {
  readonly value: string;
  readonly label: string;
  /** How far to indent it, for nested categories. */
  readonly depth?: number;
}

export interface PickerGroup {
  readonly value: string;
  readonly items: ReadonlyArray<PickerItem>;
}

/** The item whose label is `text`, ignoring case. */
export const findItem = (groups: ReadonlyArray<PickerGroup>, text: string) => {
  const wanted = text.trim().toLowerCase();
  if (wanted === "") return undefined;
  return groups.flatMap((group) => group.items).find((item) => item.label.toLowerCase() === wanted);
};

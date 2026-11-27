import { Trash2Icon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { TableFilterActions, TableSearch, TableToolbar } from "@/components/table-controls";
import { Choice } from "@/components/reports/controls";
import { Button } from "@reeve/ui/components/button";
import { Input } from "@reeve/ui/components/input";
import {
  ALL_TIME,
  CUSTOM_RANGE,
  type CustomDates,
  RANGE_PRESETS,
  rangeItems,
} from "@/lib/insights";

/**
 * The dropdown of ranges; `months` outside the presets is listed too. With `custom` it also offers
 * dates of one's own, for `DateSpan` to take.
 */
export function RangeChoice({
  months,
  onMonths,
  presets = RANGE_PRESETS,
  custom,
}: {
  months: number | null;
  onMonths: (months: number | null) => void;
  presets?: ReadonlyArray<number>;
  custom?: { readonly active: boolean; readonly onChoose: () => void } | undefined;
}) {
  return (
    <Choice
      label="Date range"
      items={[
        ...rangeItems(presets, months),
        ...(custom === undefined ? [] : [{ value: CUSTOM_RANGE, label: "Custom dates" }]),
      ]}
      value={custom?.active ? CUSTOM_RANGE : months === null ? ALL_TIME : String(months)}
      onChange={(value) => {
        if (value === CUSTOM_RANGE) custom?.onChoose();
        else onMonths(value === ALL_TIME ? null : Number(value));
      }}
    />
  );
}

/** The first and last day of a custom range. */
export const DateSpan = ({
  dates,
  onDates,
}: {
  dates: CustomDates;
  onDates: (dates: CustomDates) => void;
}) => (
  <>
    <Input
      type="date"
      aria-label="From"
      className="w-36"
      value={dates.from}
      onChange={(event) => onDates({ ...dates, from: event.target.value })}
    />
    <Input
      type="date"
      aria-label="To"
      className="w-36"
      value={dates.to}
      onChange={(event) => onDates({ ...dates, to: event.target.value })}
    />
  </>
);

/** A filter set from elsewhere on the page, which says what it is and takes itself off. */
export const FilterChip = ({
  label,
  clearLabel,
  onClear,
}: {
  label: string;
  clearLabel: string;
  onClear: () => void;
}) => (
  <Button variant="outline" aria-label={clearLabel} onClick={onClear}>
    {label}
    <XIcon />
  </Button>
);

/** How many rows are selected and what to do with them; `children` go before Delete. */
export const SelectionActions = ({
  count,
  onDelete,
  children,
}: {
  count: number;
  onDelete: () => void;
  children?: ReactNode;
}) => (
  <>
    <span className="ms-2 text-[13px] text-muted-foreground">{count} selected</span>
    {children}
    <Button variant="ghost" className="text-destructive-foreground" onClick={onDelete}>
      <Trash2Icon />
      Delete…
    </Button>
  </>
);

/**
 * The search, filters, count and range, which stick over the rows with the column titles in `head`.
 * `search` names the search input; `children` are the filters and anything after them.
 */
export function FilterBar({
  testId,
  search,
  query,
  onQuery,
  shown,
  total,
  range,
  head,
  children,
}: {
  testId: string;
  search: string;
  query: string;
  onQuery: (query: string) => void;
  shown: number;
  total: number;
  range?: ReactNode;
  head: ReactNode;
  children: ReactNode;
}) {
  return (
    <div data-testid={testId} className="sticky top-(--sticky-top) z-20 bg-background">
      <TableToolbar>
        <TableSearch label={search} value={query} onValueChange={onQuery} />
        <TableFilterActions>
          {children}
          <span className="text-xs text-muted-foreground tabular-nums">
            {shown} of {total}
          </span>
          {range}
        </TableFilterActions>
      </TableToolbar>
      {head}
    </div>
  );
}

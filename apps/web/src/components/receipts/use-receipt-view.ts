import { today } from "@reeve/contract/rules";
import type { ReceiptStage } from "@reeve/contract/receipts";
import type { ReceiptCheck, ReceiptSort } from "@reeve/contract/catalog";
import { useState } from "react";
import type { FacetValue } from "@/lib/facets";
import { customSpan, type CustomDates, nextSort, rangeStart } from "@/lib/insights";
import {
  DEFAULT_MONTHS,
  DEFAULT_SORT,
  DESCENDING_FIRST,
  NO_STORE,
  PAGE_SIZE,
  sameFocus,
  type CategoryFocus,
  type ReceiptFocus,
  type ReceiptListState,
  type ReceiptSortState,
} from "@/lib/receipt-pages";

/** What the receipts page is showing, and every way of changing it. */
export const useReceiptView = () => {
  const [months, setMonthsState] = useState<number | null>(DEFAULT_MONTHS);
  const [custom, setCustomState] = useState<CustomDates | null>(null);
  const [query, setQueryState] = useState("");
  const [filters, setFiltersState] = useState<FacetValue>({});
  const [focus, setFocusState] = useState<ReceiptFocus | null>(null);
  const [category, setCategoryState] = useState<CategoryFocus | null>(null);
  const [month, setMonthState] = useState<string | null>(null);
  const [sort, setSortState] = useState<ReceiptSortState>(DEFAULT_SORT);
  const [limit, setLimit] = useState(PAGE_SIZE);

  // Anything that changes what matches starts the list from its first page again.
  const fresh =
    <A>(set: (value: A) => void) =>
    (value: A) => {
      set(value);
      setLimit(PAGE_SIZE);
    };
  const setFocus = fresh(setFocusState);
  const setQuery = fresh(setQueryState);
  const setFilters = fresh(setFiltersState);
  const setCategory = fresh(setCategoryState);
  const setMonth = fresh(setMonthState);
  const setRange = (next: number | null) => {
    setMonthState(null);
    setCustomState(null);
    fresh(setMonthsState)(next);
  };
  const setCustom = (next: CustomDates) => {
    setMonthState(null);
    fresh(setCustomState)(next);
  };
  const toggleFocus = (next: ReceiptFocus) => setFocus(sameFocus(focus, next) ? null : next);
  const stores = filters["store"] ?? [];

  const preset = months === null ? undefined : rangeStart(today(), months);
  const { since, until } =
    custom === null ? { since: preset, until: undefined } : customSpan(custom);
  const state: ReceiptListState = {
    query,
    filters,
    since,
    until,
    month,
    focus,
    category,
    sort,
    limit,
  };
  return {
    state,
    months,
    custom,
    stores,
    setRange,
    setCustom,
    /** Dates of one's own start from the range on show, so that nothing jumps. */
    chooseCustom: () => setCustom({ from: since ?? "", to: until ?? today() }),
    setQuery,
    setFilters,
    setFocus,
    setCategory,
    setMonth,
    loadMore: (count: number) => setLimit(limit + count),
    sortBy: (key: ReceiptSort) => fresh(setSortState)(nextSort(sort, key, DESCENDING_FIRST)),
    chooseStage: (stage: ReceiptStage) => toggleFocus({ kind: "stage", stage }),
    /** A check counts across the book, so its rows are all time and nothing else narrows them. */
    chooseCheck: (check: ReceiptCheck) => {
      setRange(null);
      setQueryState("");
      setCategoryState(null);
      setFiltersState({});
      toggleFocus({ kind: "check", check });
    },
    chooseUnfinished: () => {
      setRange(null);
      toggleFocus({ kind: "stage", stage: "unfinished" });
    },
    toggleStore: (id: string | null) => {
      const value = id ?? NO_STORE;
      setFilters({ ...filters, store: stores.length === 1 && stores[0] === value ? [] : [value] });
    },
    toggleCategory: (next: CategoryFocus) =>
      setCategory(category?.id === next.id && category.name === next.name ? null : next),
    toggleMonth: (next: string) => setMonth(month === next ? null : next),
  };
};

export type ReceiptView = ReturnType<typeof useReceiptView>;

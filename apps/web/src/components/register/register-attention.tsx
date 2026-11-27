import { useBook } from "@/lib/book";
import type { FacetValue } from "@/lib/facets";
import { today } from "@reeve/contract/rules";
import type { Account } from "@reeve/contract";
import {
  type Activity,
  attentionItems,
  type AttentionItem,
  type Check,
  isOnly,
  toggleOnly,
  type ViewName,
} from "@/lib/register";

/** The page's checks, and what picking one does to the table below. */
export function useAttention(
  activity: Activity | undefined,
  {
    view,
    account,
    table,
  }: {
    view: ViewName | null;
    account: Account | undefined;
    table: {
      readonly filters: FacetValue;
      readonly check: Check | undefined;
      readonly onFilters: (filters: FacetValue) => void;
      readonly onCheck: (check: Check | undefined) => void;
    };
  },
) {
  const { formatDay } = useBook();
  const { filters, check, onFilters, onCheck } = table;
  const items =
    activity === undefined
      ? []
      : attentionItems(activity.attention, { view, account, today: today(), formatDay });
  const anyOpen = items.some((item) => item.count > 0);
  return {
    items,
    anyOpen,
    allClear: !anyOpen && items.length > 0 ? items.map((item) => item.done).join("\n") : null,
    isActive: (item: AttentionItem) =>
      item.action.kind === "check"
        ? check === item.action.check
        : item.action.kind === "status" && isOnly(filters, "status", item.action.status),
    choose: (item: AttentionItem) => {
      const { action } = item;
      if (action.kind === "check") onCheck(check === action.check ? undefined : action.check);
      else if (action.kind === "status") onFilters(toggleOnly(filters, "status", action.status));
    },
  };
}

import type { AccountScope } from "@reeve/contract/catalog";
import { createContext } from "react";

/** Where a widget's content leads: its full report or its records. */
export interface WidgetTarget {
  readonly to: string;
  readonly search?: Record<string, unknown> | undefined;
  readonly params?: Record<string, string> | undefined;
  readonly label: string;
}

/** The account scope of the operational page a widget sits on; none on a dashboard. */
export const WidgetHostContext = createContext<AccountScope | undefined>(undefined);

/** The target of the widget being rendered; its loaded content links there. */
export const WidgetTargetContext = createContext<WidgetTarget | null>(null);

export interface WidgetQueryResult<T> {
  readonly data: T | undefined;
  readonly error: Error | null;
}

/**
 * What a widget shows for its query. Data kept from an earlier load stays on screen when a refresh
 * fails, with that failure beside it; only a widget with nothing to show reports a failed load.
 */
export type WidgetState<T> =
  | { readonly state: "loading" }
  | { readonly state: "failed"; readonly error: Error }
  | { readonly state: "empty" | "ready"; readonly data: T; readonly refreshError: Error | null };

export const widgetState = <T>(
  query: WidgetQueryResult<T>,
  isEmpty: (data: T) => boolean = () => false,
): WidgetState<T> => {
  if (query.data === undefined)
    return query.error === null ? { state: "loading" } : { state: "failed", error: query.error };
  return {
    state: isEmpty(query.data) ? "empty" : "ready",
    data: query.data,
    refreshError: query.error,
  };
};

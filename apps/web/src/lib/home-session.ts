import { useSyncExternalStore } from "react";
import type { Destination, Tab } from "./nav.ts";

export interface Place {
  readonly to: string;
  readonly search: Record<string, unknown>;
}

/**
 * The page of each resuming tab this window showed last, per book, until it reloads. A launch or reload
 * starts empty, so Home opens the book's default dashboard (docs/rules/reports.md).
 */
const places = new Map<string, Place>();
const listeners = new Set<() => void>();
let version = 0;
const keyOf = (book: string, tab: Tab) => `${book}\n${tab.to}`;

export const rememberPlace = (book: string, tab: Tab, place: Place) => {
  const key = keyOf(book, tab);
  const known = places.get(key);
  if (known?.to === place.to && JSON.stringify(known.search) === JSON.stringify(place.search))
    return;
  places.set(key, place);
  version++;
  for (const listener of listeners) listener();
};

/** Where a tab's link goes now: the page of it shown last, else its own page. */
export const tabPlace = (book: string, tab: Tab): Place =>
  (tab.resumes === true ? places.get(keyOf(book, tab)) : undefined) ?? { to: tab.to, search: {} };

/** Where a destination's link goes: its first tab's place, else its own page. */
export const destinationPlace = (book: string, destination: Destination): Place => {
  const first = destination.tabs[0];
  return first?.to === destination.to ? tabPlace(book, first) : { to: destination.to, search: {} };
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Re-renders when a remembered place changes, so links follow it. */
export const usePlaces = () => useSyncExternalStore(subscribe, () => version);

/** The dashboard asked for, else the book's default; `missing` says an asked one is gone. */
export const chooseDashboard = <T extends { readonly id: string; readonly isDefault: boolean }>(
  dashboards: ReadonlyArray<T>,
  asked: string | undefined,
): { readonly dashboard: T | undefined; readonly missing: boolean } => {
  const found = dashboards.find((each) => each.id === asked);
  return {
    dashboard: found ?? dashboards.find((each) => each.isDefault) ?? dashboards[0],
    missing: asked !== undefined && found === undefined,
  };
};

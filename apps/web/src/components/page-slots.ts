import { createContext, useContext } from "react";

export interface Slots {
  readonly title: HTMLElement | null;
  readonly actions: HTMLElement | null;
  readonly context: HTMLElement | null;
  readonly layer: HTMLElement | null;
}

export const SlotsContext = createContext<Slots>({
  title: null,
  actions: null,
  context: null,
  layer: null,
});

/** Where a destination with a sidebar of its own puts it. */
export const useSidebarLayerSlot = () => useContext(SlotsContext).layer;

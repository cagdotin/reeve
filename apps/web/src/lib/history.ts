import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/**
 * Whether the window's history can go back or forward. History only says where it is, so how far
 * forward it reaches is tracked here: a new page cuts off whatever lay ahead.
 */
export function useHistoryPosition() {
  const router = useRouter();
  const index = useRouterState({ select: (state) => state.location.state.__TSR_index ?? 0 });
  const [furthest, setFurthest] = useState(index);
  useEffect(
    () =>
      router.history.subscribe(({ action }) => {
        if (action.type === "PUSH") setFurthest(router.history.location.state.__TSR_index ?? 0);
      }),
    [router],
  );
  return { canGoBack: index > 0, canGoForward: index < furthest };
}

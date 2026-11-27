import { useRouter } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/** How long a restore waits for the page to grow tall enough, as its queries arrive. */
const PATIENCE = 4000;

/**
 * Where the page was scrolled to in each history entry this window showed, until it reloads. A book
 * switch reloads the document, so no entry keeps another book's position.
 */
const positions = new Map<string, number>();

const isPop = (type: string) => type === "BACK" || type === "FORWARD" || type === "GO";

/** Moves `scroller` to `top` as soon as the page is tall enough, until the person scrolls first. */
const restore = (scroller: HTMLElement, top: number, done: () => void) => {
  const started = performance.now();
  let frame = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    for (const event of INPUTS) scroller.removeEventListener(event, stop);
    done();
  };
  const attempt = () => {
    scroller.scrollTop = top;
    if (Math.abs(scroller.scrollTop - top) <= 1 || performance.now() - started > PATIENCE) stop();
    else frame = requestAnimationFrame(attempt);
  };
  for (const event of INPUTS) scroller.addEventListener(event, stop, { passive: true });
  frame = requestAnimationFrame(attempt);
  return stop;
};
const INPUTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/**
 * The page's one scroller follows history: Back and Forward return it to where that entry was, and
 * a new page starts at the top. `place` names what counts as a new page.
 */
export function useScrollMemory(page: RefObject<HTMLElement | null>, place: string) {
  const router = useRouter();
  const popped = useRef<number | undefined>(undefined);
  const restoring = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    const scroller = page.current;
    if (scroller === null) return;
    const record = () => {
      if (popped.current === undefined && restoring.current === undefined)
        positions.set(router.history.location.state.__TSR_key ?? "", scroller.scrollTop);
    };
    scroller.addEventListener("scroll", record, { passive: true });
    const stopHistory = router.history.subscribe(({ location, action }) => {
      restoring.current?.();
      popped.current = isPop(action.type)
        ? positions.get(location.state.__TSR_key ?? "")
        : undefined;
    });
    const stopRendered = router.subscribe("onRendered", () => {
      const top = popped.current;
      if (top === undefined) return;
      popped.current = undefined;
      restoring.current = restore(scroller, top, () => (restoring.current = undefined));
    });
    return () => {
      restoring.current?.();
      scroller.removeEventListener("scroll", record);
      stopHistory();
      stopRendered();
    };
  }, [router, page]);

  useLayoutEffect(() => {
    if (popped.current === undefined && restoring.current === undefined)
      page.current?.scrollTo({ top: 0, left: 0 });
  }, [page, place]);
}

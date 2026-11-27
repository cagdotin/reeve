import { m, useReducedMotion, useSpring, useTransform } from "motion/react";
import { type ReactElement, type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@reeve/ui/lib/utils";

interface Rect {
  readonly x: number;
  readonly w: number;
}

const FAST = { stiffness: 520, damping: 34, mass: 0.8 } as const;
const SLOW = { stiffness: 230, damping: 24 } as const;
const SEGMENT =
  "inline-flex h-7 items-center justify-center whitespace-nowrap rounded-md px-3 text-[13px] font-medium";

/** What each segment renders, a link or a button, with these on it. */
export interface SegmentProps {
  readonly "data-segment": true;
  readonly className: string;
  readonly children: string;
}

/**
 * After devl's Liquid Segments (https://devl.dev/components/liquid-segments): the pill is a blob that
 * stretches as it slides, and the words under it invert.
 */
export function LiquidSegments<Item extends { readonly key: string; readonly label: string }>({
  items,
  active,
  renderItem,
  className,
  render,
}: {
  items: ReadonlyArray<Item>;
  /** The chosen item's index, or -1. */
  active: number;
  renderItem: (item: Item, index: number, props: SegmentProps) => ReactElement;
  className?: string;
  /** The track's element with its own props, such as a toggle group; a div by default. */
  render?: (props: {
    ref: (node: HTMLDivElement | null) => void;
    className: string;
    children: ReactNode;
  }) => ReactElement;
}) {
  const reduce = useReducedMotion();
  const filter = `segments-goo-${useId().replace(/:/g, "")}`;
  const [track, setTrack] = useState<HTMLDivElement | null>(null);
  const [rects, setRects] = useState<ReadonlyArray<Rect>>([]);
  const [trackWidth, setTrackWidth] = useState(0);
  const leadX = useSpring(0, FAST);
  const leadW = useSpring(0, FAST);
  const trailX = useSpring(0, SLOW);
  const trailW = useSpring(0, SLOW);
  const placed = useRef(false);
  const target = rects[active];

  // react-doctor-disable-next-line react-doctor/no-derived-state-effect -- it measures the DOM, which render cannot read.
  useLayoutEffect(() => {
    if (track === null) return;
    const nodes = [...track.querySelectorAll<HTMLElement>("[data-segment]")];
    const measure = () => {
      setRects(nodes.map((node) => ({ x: node.offsetLeft, w: node.offsetWidth })));
      setTrackWidth(track.offsetWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [track, items.length]);

  useLayoutEffect(() => {
    if (target === undefined || target.w === 0) return;
    const springs = [
      [leadX, target.x],
      [leadW, target.w],
      [trailX, target.x + target.w * 0.1],
      [trailW, target.w * 0.8],
    ] as const;
    for (const [spring, to] of springs) {
      if (reduce === true || !placed.current) spring.jump(to);
      else spring.set(to);
    }
    placed.current = true;
  }, [target, reduce, leadX, leadW, trailX, trailW]);

  const clipPath = useTransform([leadX, leadW, trailX, trailW], ([lx, lw, tx, tw]: number[]) => {
    const left = Math.min(lx ?? 0, tx ?? 0);
    const right = Math.max((lx ?? 0) + (lw ?? 0), (tx ?? 0) + (tw ?? 0));
    return `inset(2px ${Math.max(trackWidth - right, 0)}px 2px ${left}px round calc(var(--radius) * 0.8))`;
  });

  const children = (
    <>
      <svg aria-hidden className="absolute size-0">
        <filter
          id={filter}
          colorInterpolationFilters="sRGB"
          x="-20%"
          y="-50%"
          width="140%"
          height="200%"
        >
          <feGaussianBlur in="SourceGraphic" result="blur" stdDeviation="4" />
          <feColorMatrix
            in="blur"
            result="goo"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8"
          />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </svg>
      {target !== undefined && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0.5 left-0 -z-10 w-full"
          style={{ filter: `url(#${filter})` }}
        >
          <m.span
            className="absolute inset-y-px left-0 rounded-md bg-primary"
            style={{ x: trailX, width: trailW }}
          />
          <m.span
            className="absolute inset-y-0 left-0 rounded-md bg-primary"
            style={{ x: leadX, width: leadW }}
          />
        </span>
      )}
      {items.map((item, index) =>
        renderItem(item, index, {
          "data-segment": true,
          className: cn(
            SEGMENT,
            "cursor-pointer text-muted-foreground outline-none transition-colors duration-200 ease-fey hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          ),
          children: item.label,
        }),
      )}
      {target !== undefined && (
        <m.span
          aria-hidden
          className="pointer-events-none absolute inset-0 flex p-0.5 text-primary-foreground"
          style={{ clipPath }}
        >
          {items.map((item) => (
            <span key={item.key} className={SEGMENT}>
              {item.label}
            </span>
          ))}
        </m.span>
      )}
    </>
  );
  const props = {
    ref: setTrack,
    className: cn("relative isolate inline-flex rounded-lg bg-muted p-0.5 select-none", className),
    children,
  };
  return render ? render(props) : <div {...props} />;
}

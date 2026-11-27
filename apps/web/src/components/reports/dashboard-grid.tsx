import type { Widget } from "@reeve/contract/catalog";
import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@reeve/ui/lib/utils";
import {
  boxOf,
  changedBoxes,
  COLUMNS,
  compact,
  nudge,
  placeBox,
  readingOrder,
  swapWithNeighbour,
  type Box,
  type Direction,
} from "./grid-layout";
import { specOf } from "./widgets";

const ROW = 100;
const GAP = 12;
/** Below this width the grid becomes one column, as Actual's mobile layout. */
const NARROW = 720;

interface Drag {
  readonly id: string;
  readonly kind: "move" | "resize";
  readonly startX: number;
  readonly startY: number;
  readonly origin: Box;
  readonly dx: number;
  readonly dy: number;
  readonly preview: ReadonlyArray<Box>;
}

const ARROWS: Partial<Record<string, Direction>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/** What a card in edit mode offers to arrange it; the card renders the controls with its name. */
export interface Arrange {
  /** Starts a pointer drag; absent on a narrow screen, which has one column. */
  readonly drag: ((event: PointerEvent<HTMLElement>) => void) | undefined;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  /** Moves the card one place in the one-column order; present on a narrow screen. */
  readonly step: ((direction: "up" | "down") => void) | undefined;
  readonly first: boolean;
  readonly last: boolean;
}

const useWidth = () => {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((element: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!element) return;
    observer.current = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.current.observe(element);
  }, []);
  return { ref, width };
};

/**
 * The dashboard's 12-column grid of 100px rows. In edit mode a card's handle drags it, its corner
 * resizes it and the arrow keys on its handle do both; the boxes it lands on move down and the
 * layout floats up, as Actual's. A narrow screen shows one column in reading order, which the
 * cards' Move up and Move down change.
 */
export function DashboardGrid({
  widgets,
  editing,
  onLayout,
  renderCard,
}: {
  widgets: ReadonlyArray<Widget>;
  editing: boolean;
  onLayout: (changes: ReadonlyArray<Box>) => void;
  renderCard: (widget: Widget, arrange: Arrange | undefined) => ReactNode;
}) {
  const { ref, width } = useWidth();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [pending, setPending] = useState<{
    readonly of: ReadonlyArray<Widget>;
    readonly layout: ReadonlyArray<Box>;
  } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const layout = pending?.of === widgets ? pending.layout : compact(widgets.map(boxOf));
  const column = (width - GAP * (COLUMNS - 1)) / COLUMNS;
  const narrow = width > 0 && width < NARROW;
  const shown = drag?.preview ?? layout;
  const order = readingOrder(layout);

  const commit = (next: ReadonlyArray<Box>) => {
    const changes = changedBoxes(widgets.map(boxOf), next);
    if (changes.length === 0) return;
    setPending({ of: widgets, layout: next });
    onLayout(changes);
  };

  const describe = (id: string, next: ReadonlyArray<Box>) => {
    const box = next.find((each) => each.id === id);
    if (box === undefined) return;
    setAnnouncement(
      narrow
        ? `Position ${readingOrder(next).indexOf(box) + 1} of ${next.length}`
        : `Row ${box.y + 1}, column ${box.x + 1}, ${box.w} columns wide, ${box.h} rows tall`,
    );
  };

  const arrangeBy = (id: string, next: ReadonlyArray<Box>) => {
    describe(id, next);
    commit(next);
  };

  const arrange = (widget: Widget): Arrange | undefined => {
    if (!editing) return undefined;
    const index = order.findIndex((box) => box.id === widget.id);
    const min = specOf(widget.type)?.min ?? { w: 3, h: 2 };
    return {
      drag: narrow ? undefined : begin(widget, "move"),
      onKeyDown: (event) => {
        const direction = ARROWS[event.key];
        if (direction === undefined) return;
        event.preventDefault();
        if (narrow) {
          if (direction === "up" || direction === "down")
            arrangeBy(widget.id, swapWithNeighbour(layout, widget.id, direction));
          return;
        }
        arrangeBy(
          widget.id,
          nudge(layout, widget.id, event.shiftKey ? "resize" : "move", direction, min),
        );
      },
      step: narrow
        ? (direction) => arrangeBy(widget.id, swapWithNeighbour(layout, widget.id, direction))
        : undefined,
      first: index === 0,
      last: index === order.length - 1,
    };
  };

  const live = (
    <div aria-live="polite" className="sr-only">
      {announcement}
    </div>
  );

  const begin = (widget: Widget, kind: Drag["kind"]) => (event: PointerEvent<HTMLElement>) => {
    if (!editing || narrow || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = layout.find((box) => box.id === widget.id);
    if (!origin) return;
    setDrag({
      id: widget.id,
      kind,
      startX: event.clientX,
      startY: event.clientY,
      origin,
      dx: 0,
      dy: 0,
      preview: layout,
    });
  };

  const move = (event: PointerEvent<HTMLElement>) => {
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const { origin } = drag;
    const widget = widgets.find((each) => each.id === drag.id);
    const min = specOf(widget?.type ?? "")?.min ?? { w: 3, h: 2 };
    const next: Box =
      drag.kind === "move"
        ? {
            ...origin,
            x: Math.min(
              Math.max(Math.round(origin.x + dx / (column + GAP)), 0),
              COLUMNS - origin.w,
            ),
            y: Math.max(Math.round(origin.y + dy / (ROW + GAP)), 0),
          }
        : {
            ...origin,
            w: Math.min(
              Math.max(Math.round(origin.w + dx / (column + GAP)), min.w),
              COLUMNS - origin.x,
            ),
            h: Math.max(Math.round(origin.h + dy / (ROW + GAP)), min.h),
          };
    setDrag({ ...drag, dx, dy, preview: placeBox(layout, next) });
  };

  const end = () => {
    if (!drag) return;
    setDrag(null);
    commit(drag.preview);
  };

  const rows = Math.max(0, ...shown.map((box) => box.y + box.h));
  const place = (box: Box) => ({
    left: box.x * (column + GAP),
    top: box.y * (ROW + GAP),
    width: box.w * column + (box.w - 1) * GAP,
    height: box.h * ROW + (box.h - 1) * GAP,
  });
  const cards = narrow
    ? order.flatMap((box) => widgets.filter((each) => each.id === box.id))
    : widgets;

  // One tree for both layouts, so a card keeps its state, such as a pane it opened, when the
  // dashboard crosses NARROW.
  return (
    <div
      ref={ref}
      className={cn(
        narrow ? "grid grid-cols-[minmax(0,1fr)] gap-3" : "relative",
        drag && "cursor-grabbing select-none",
      )}
      style={narrow ? undefined : { height: rows * (ROW + GAP) - GAP }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={() => setDrag(null)}
    >
      {live}
      {width > 0 &&
        cards.map((widget) => {
          const box = shown.find((each) => each.id === widget.id) ?? boxOf(widget);
          const dragging = drag?.id === widget.id;
          const origin = dragging ? place(drag.origin) : null;
          return (
            <div key={widget.id} style={narrow ? { height: place(box).height } : undefined}>
              {dragging && (
                <div
                  aria-hidden
                  className="absolute rounded-xl border-2 border-dashed border-ring/50 bg-accent/40"
                  style={place(box)}
                />
              )}
              <div
                className={cn(
                  narrow ? "h-full" : "absolute",
                  !narrow &&
                    !dragging &&
                    "transition-[left,top,width,height] duration-200 ease-out",
                  dragging && "z-10 opacity-90 shadow-lg",
                )}
                style={
                  narrow
                    ? undefined
                    : dragging && origin
                      ? drag.kind === "move"
                        ? { ...origin, left: origin.left + drag.dx, top: origin.top + drag.dy }
                        : {
                            ...origin,
                            width: Math.max(origin.width + drag.dx, column),
                            height: Math.max(origin.height + drag.dy, ROW),
                          }
                      : place(box)
                }
              >
                {renderCard(widget, arrange(widget))}
                {editing && !narrow && (
                  <span
                    role="presentation"
                    title="Resize"
                    className="absolute right-0.5 bottom-0.5 size-4 cursor-se-resize touch-none rounded-br-lg border-r-2 border-b-2 border-muted-foreground/40 hover:border-foreground/60"
                    onPointerDown={begin(widget, "resize")}
                  />
                )}
              </div>
            </div>
          );
        })}
    </div>
  );
}

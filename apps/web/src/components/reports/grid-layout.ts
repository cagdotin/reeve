import type { Widget } from "@reeve/contract/catalog";

export const COLUMNS = 12;

export interface Box {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const boxOf = (widget: Widget): Box => ({
  id: widget.id,
  x: widget.x,
  y: widget.y,
  w: widget.width,
  h: widget.height,
});

const collides = (a: Box, b: Box) =>
  a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Reading order, which is also the one-column order on a narrow screen. */
const byPosition = (a: Box, b: Box) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1);

export const readingOrder = (layout: ReadonlyArray<Box>) => layout.toSorted(byPosition);

/**
 * The layout with one box moved or resized, as react-grid-layout lays out Actual's dashboard: the
 * boxes it lands on are pushed down, then every box floats up as far as it can.
 */
export const placeBox = (layout: ReadonlyArray<Box>, moved: Box): ReadonlyArray<Box> => {
  const placed: Array<Box> = [moved];
  for (const box of layout.filter((each) => each.id !== moved.id).toSorted(byPosition)) {
    let y = box.y;
    while (placed.some((other) => collides({ ...box, y }, other))) y += 1;
    placed.push({ ...box, y });
  }
  return compact(placed);
};

/** Every box floated up as far as it goes, in reading order. */
export const compact = (layout: ReadonlyArray<Box>): ReadonlyArray<Box> => {
  const done: Array<Box> = [];
  for (const box of layout.toSorted(byPosition)) {
    let y = box.y;
    while (y > 0 && !done.some((other) => collides({ ...box, y: y - 1 }, other))) y -= 1;
    done.push({ ...box, y });
  }
  return done;
};

/** The boxes whose place or size differs between two layouts. */
export const changedBoxes = (before: ReadonlyArray<Box>, after: ReadonlyArray<Box>) =>
  after.filter((box) => {
    const old = before.find((each) => each.id === box.id);
    return (
      old === undefined || old.x !== box.x || old.y !== box.y || old.w !== box.w || old.h !== box.h
    );
  });

export type Direction = "up" | "down" | "left" | "right";

const STEPS: Record<Direction, { readonly dx: number; readonly dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

const sameBox = (a: Box, b: Box) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/**
 * The layout after one keyboard step on a box: the shortest move or resize in that direction that
 * changes the layout, or the layout itself when nothing does. A move of one row often changes
 * nothing, because the box floats back up, so the step grows until it lands somewhere new.
 */
export const nudge = (
  layout: ReadonlyArray<Box>,
  id: string,
  kind: "move" | "resize",
  direction: Direction,
  min: { readonly w: number; readonly h: number },
): ReadonlyArray<Box> => {
  const box = layout.find((each) => each.id === id);
  if (box === undefined) return layout;
  const { dx, dy } = STEPS[direction];
  const reach = Math.max(COLUMNS, ...layout.map((each) => each.y + each.h));
  for (let step = 1; step <= reach; step += 1) {
    const next: Box =
      kind === "move"
        ? {
            ...box,
            x: Math.min(Math.max(box.x + dx * step, 0), COLUMNS - box.w),
            y: Math.max(box.y + dy * step, 0),
          }
        : {
            ...box,
            w: Math.min(Math.max(box.w + dx * step, min.w), COLUMNS - box.x),
            h: Math.max(box.h + dy * step, min.h),
          };
    if (sameBox(next, box)) return layout;
    const placed = placeBox(layout, next);
    if (changedBoxes(layout, placed).length > 0) return placed;
  }
  return layout;
};

/**
 * The layout with a box exchanging places with its neighbour in reading order, which moves it one
 * card up or down in the narrow one-column view. Boxes of different sizes push others down.
 */
export const swapWithNeighbour = (
  layout: ReadonlyArray<Box>,
  id: string,
  direction: "up" | "down",
): ReadonlyArray<Box> => {
  const order = readingOrder(layout);
  const index = order.findIndex((each) => each.id === id);
  const box = order[index];
  const other = order[index + (direction === "up" ? -1 : 1)];
  if (box === undefined || other === undefined) return layout;
  const to = (from: Box, place: Box): Box => ({
    ...from,
    x: Math.min(place.x, COLUMNS - from.w),
    y: place.y,
  });
  return placeBox(
    layout.map((each) => (each.id === other.id ? to(other, box) : each)),
    to(box, other),
  );
};

import { describe, expect, it } from "vitest";
import { nudge, readingOrder, swapWithNeighbour, type Box } from "./grid-layout";

const box = (id: string, x: number, y: number, w: number, h: number): Box => ({ id, x, y, w, h });
const min = { w: 3, h: 2 };
const ids = (layout: ReadonlyArray<Box>) => readingOrder(layout).map((each) => each.id);
const overlaps = (layout: ReadonlyArray<Box>) =>
  layout.some((a) =>
    layout.some(
      (b) =>
        a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h,
    ),
  );

const stacked = [box("a", 0, 0, 12, 2), box("b", 0, 2, 12, 2)];
const square = [
  box("a", 0, 0, 6, 3),
  box("b", 6, 0, 6, 3),
  box("c", 0, 3, 6, 3),
  box("d", 6, 3, 6, 3),
];

describe("nudge", () => {
  it("moves a box above the one it passes", () => {
    expect(nudge(stacked, "b", "move", "up", min)).toEqual([
      box("b", 0, 0, 12, 2),
      box("a", 0, 2, 12, 2),
    ]);
  });

  it("moves a box down past the next one, though one row would float back", () => {
    expect(ids(nudge(stacked, "a", "move", "down", min))).toEqual(["b", "a"]);
  });

  it("leaves the layout alone at an edge", () => {
    expect(nudge(stacked, "a", "move", "up", min)).toBe(stacked);
    expect(nudge(square, "b", "move", "right", min)).toBe(square);
  });

  it("moves a box sideways by one column", () => {
    const layout = [box("a", 0, 0, 4, 2)];
    expect(nudge(layout, "a", "move", "right", min)).toEqual([box("a", 1, 0, 4, 2)]);
  });

  it("resizes by one cell and pushes what it grows into", () => {
    expect(nudge(stacked, "a", "resize", "down", min)).toEqual([
      box("a", 0, 0, 12, 3),
      box("b", 0, 3, 12, 2),
    ]);
    expect(nudge([box("a", 0, 0, 4, 2)], "a", "resize", "right", min)).toEqual([
      box("a", 0, 0, 5, 2),
    ]);
  });

  it("stops at the widget's minimum size and at the grid's edge", () => {
    const smallest = [box("a", 0, 0, 3, 2)];
    expect(nudge(smallest, "a", "resize", "left", min)).toBe(smallest);
    expect(nudge(smallest, "a", "resize", "up", min)).toBe(smallest);
    const widest = [box("a", 0, 0, 12, 2)];
    expect(nudge(widest, "a", "resize", "right", min)).toBe(widest);
  });
});

describe("swapWithNeighbour", () => {
  it("exchanges a box with the one before it in reading order", () => {
    const moved = swapWithNeighbour(square, "d", "up");
    expect(ids(moved)).toEqual(["a", "b", "d", "c"]);
    expect(moved).toContainEqual(box("d", 0, 3, 6, 3));
    expect(moved).toContainEqual(box("c", 6, 3, 6, 3));
  });

  it("exchanges a box with the one after it in reading order", () => {
    expect(ids(swapWithNeighbour(square, "b", "down"))).toEqual(["a", "c", "b", "d"]);
  });

  it("leaves the first box first and the last box last", () => {
    expect(swapWithNeighbour(square, "a", "up")).toBe(square);
    expect(swapWithNeighbour(square, "d", "down")).toBe(square);
  });

  it("moves a wider box earlier without overlapping the others", () => {
    const layout = [box("a", 0, 0, 6, 3), box("b", 6, 0, 6, 3), box("c", 0, 3, 12, 3)];
    const moved = swapWithNeighbour(layout, "c", "up");
    expect(overlaps(moved)).toBe(false);
    expect(ids(moved).indexOf("c")).toBeLessThan(2);
  });
});

describe("readingOrder", () => {
  it("orders by row, then column, then id", () => {
    expect(ids([box("b", 0, 0, 6, 2), box("a", 0, 0, 6, 2), box("c", 6, 0, 6, 2)])).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

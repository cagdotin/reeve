import type { Category, CategoryGroup } from "@reeve/contract";
import { describe, expect, it } from "vitest";
import { resolveDrop, type Target } from "./drop.ts";

const category = (id: string, groupId: string, parentId: string | null = null): Category => ({
  id,
  name: id,
  groupId,
  parentId,
  isIncome: groupId === "income",
  hidden: false,
  sortOrder: 0,
  notes: null,
  description: null,
});

const group = (id: string, categories: Array<Category>): CategoryGroup => ({
  id,
  name: id,
  isIncome: id === "income",
  hidden: false,
  sortOrder: 0,
  notes: null,
  description: null,
  categories,
});

/** Usual: food, health > medical > dentist, bills. Savings: rainy. Income: salary. */
const groups = [
  group("usual", [
    category("food", "usual"),
    category("health", "usual"),
    category("medical", "usual", "health"),
    category("dentist", "usual", "medical"),
    category("bills", "usual"),
  ]),
  group("savings", [category("rainy", "savings")]),
  group("income", [category("salary", "income")]),
];

const row = (id: string, groupId: string, expanded = false): Target => ({
  kind: "category",
  id,
  groupId,
  expanded,
});
const header = (id: string): Target => ({ kind: "group", id });
const drag = (id: string, target: Target, fraction: number, maxDepth = 3) =>
  resolveDrop(groups, { kind: "category", id }, target, fraction, maxDepth);
const dragGroup = (id: string, target: Target, fraction: number) =>
  resolveDrop(groups, { kind: "group", id }, target, fraction, 3);

describe("resolveDrop for groups", () => {
  it("places a group before or after another of its kind", () => {
    expect(dragGroup("savings", header("usual"), 0.2)).toMatchObject({
      before: "usual",
      mark: { row: "section:usual", edge: "before" },
    });
    expect(dragGroup("usual", row("rainy", "savings"), 0.5)).toMatchObject({
      before: null,
      mark: { row: "section:savings", edge: "after" },
    });
  });

  it("ignores drops that move nothing or cross into income", () => {
    expect(dragGroup("usual", header("savings"), 0.2)).toBeNull();
    expect(dragGroup("usual", row("food", "usual"), 0.5)).toBeNull();
    expect(dragGroup("usual", header("income"), 0.8)).toBeNull();
  });
});

describe("resolveDrop for categories", () => {
  it("reorders among siblings by the top and bottom thirds", () => {
    expect(drag("bills", row("food", "usual"), 0.1)).toMatchObject({
      parent: null,
      before: "food",
      mark: { row: "category:food", edge: "before", level: 0 },
    });
    expect(drag("food", row("bills", "usual"), 0.9)).toMatchObject({ parent: null, before: null });
    expect(drag("food", row("health", "usual"), 0.9)).toMatchObject({
      parent: null,
      before: "bills",
    });
  });

  it("nests under the row dropped on in the middle, last", () => {
    expect(drag("food", row("medical", "usual"), 0.5)).toMatchObject({
      groupId: "usual",
      parent: "medical",
      before: null,
      mark: { edge: "inside", level: 2 },
    });
  });

  it("puts a drop below an expanded parent first among its subcategories", () => {
    expect(drag("food", row("health", "usual", true), 0.9)).toMatchObject({
      parent: "health",
      before: "medical",
      mark: { row: "category:health", edge: "after", level: 1 },
    });
  });

  it("moves a category out of its parent and into another group", () => {
    expect(drag("dentist", row("food", "usual"), 0.1)).toMatchObject({
      parent: null,
      before: "food",
    });
    expect(drag("medical", header("savings"), 0.5)).toMatchObject({
      groupId: "savings",
      parent: null,
      before: "rainy",
      mark: { row: "group:savings", edge: "inside" },
    });
    expect(drag("medical", row("rainy", "savings"), 0.5)).toMatchObject({
      groupId: "savings",
      parent: "rainy",
    });
  });

  it("refuses drops into its own subtree, past the depth, across kinds or in place", () => {
    expect(drag("health", row("dentist", "usual"), 0.5)).toBeNull();
    expect(drag("medical", row("food", "usual"), 0.5, 2)).toBeNull();
    expect(drag("health", row("bills", "usual"), 0.5)).toBeNull();
    expect(drag("food", row("salary", "income"), 0.5)).toBeNull();
    expect(drag("food", row("health", "usual"), 0.1)).toBeNull();
    expect(drag("health", row("food", "usual"), 0.9)).toBeNull();
    expect(drag("food", header("usual"), 0.5)).toBeNull();
  });
});

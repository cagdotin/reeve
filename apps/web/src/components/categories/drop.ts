import type { CategoryGroup } from "@reeve/contract";
import { categoryLevels, categorySubtree } from "@reeve/contract/rules";

/** What the budget lets you drag: a group, or a category with its subcategories. */
export type Dragged =
  | { readonly kind: "group"; readonly id: string }
  | { readonly kind: "category"; readonly id: string };

/** A row you can drop on: a group's header, or a category's row in a group. */
export type Target =
  | { readonly kind: "group"; readonly id: string }
  | {
      readonly kind: "category";
      readonly id: string;
      readonly groupId: string;
      /** Whether its subcategories show right beneath it. */
      readonly expanded: boolean;
    };

/** Where the drop shows: the row (`<kind>:<id>`, `section:<group id>` for a whole group) and its edge. */
export interface DropMark {
  readonly row: string;
  readonly edge: "before" | "after" | "inside";
  /** The level the category lands on, for where the line starts. */
  readonly level: number;
}

/** A drop as the operation it runs (`move_category_group` or `move_category`), with its mark. */
export type Drop =
  | {
      readonly kind: "group";
      readonly id: string;
      readonly before: string | null;
      readonly mark: DropMark;
    }
  | {
      readonly kind: "category";
      readonly id: string;
      readonly groupId: string;
      readonly parent: string | null;
      readonly before: string | null;
      readonly mark: DropMark;
    };

const nextOf = (ids: ReadonlyArray<string>, id: string) => ids[ids.indexOf(id) + 1] ?? null;

const groupDrop = (
  groups: ReadonlyArray<CategoryGroup>,
  id: string,
  target: Target,
  fraction: number,
): Drop | null => {
  const moving = groups.find((group) => group.id === id);
  const overId = target.kind === "group" ? target.id : target.groupId;
  const over = groups.find((group) => group.id === overId);
  if (!moving || !over || over.id === id || over.isIncome !== moving.isIncome) return null;
  const siblings = groups.filter((group) => group.isIncome === moving.isIncome).map((g) => g.id);
  const rest = siblings.filter((each) => each !== id);
  const edge = target.kind === "group" && fraction < 0.5 ? "before" : "after";
  const before = edge === "before" ? over.id : nextOf(rest, over.id);
  if (before === nextOf(siblings, id)) return null;
  return { kind: "group", id, before, mark: { row: `section:${over.id}`, edge, level: 0 } };
};

const categoryDrop = (
  groups: ReadonlyArray<CategoryGroup>,
  id: string,
  target: Target,
  fraction: number,
  maxDepth: number,
): Drop | null => {
  const home = groups.find((group) => group.categories.some((each) => each.id === id));
  const groupId = target.kind === "group" ? target.id : target.groupId;
  const group = groups.find((each) => each.id === groupId);
  if (!home || !group || group.isIncome !== home.isIncome) return null;
  const moving = home.categories.find((each) => each.id === id)!;
  const homeLevels = categoryLevels(home.categories);
  const subtree = categorySubtree(home.categories, id);
  const base = homeLevels.get(id) ?? 0;
  const height = 1 + Math.max(0, ...[...subtree].map((each) => (homeLevels.get(each) ?? 0) - base));
  const children = (parent: string | null) =>
    group.categories.filter((each) => each.parentId === parent && each.id !== id).map((c) => c.id);

  const place = (
    parent: string | null,
    before: string | null,
    edge: DropMark["edge"],
    level: number,
  ): Drop | null => {
    if (level + height > maxDepth) return null;
    if (group.id === home.id && parent === moving.parentId) {
      const siblings = home.categories.filter((each) => each.parentId === parent).map((c) => c.id);
      if (before === nextOf(siblings, id)) return null;
    }
    const row = target.kind === "group" ? `group:${group.id}` : `category:${target.id}`;
    return { kind: "category", id, groupId: group.id, parent, before, mark: { row, edge, level } };
  };

  if (target.kind === "group") return place(null, children(null)[0] ?? null, "inside", 0);
  const over = group.categories.find((each) => each.id === target.id);
  if (!over || subtree.has(over.id)) return null;
  const level = categoryLevels(group.categories).get(over.id) ?? 0;
  if (fraction < 1 / 3) return place(over.parentId, over.id, "before", level);
  if (fraction < 2 / 3) return place(over.id, null, "inside", level + 1);
  if (target.expanded) return place(over.id, children(over.id)[0] ?? null, "after", level + 1);
  return place(over.parentId, nextOf(children(over.parentId), over.id), "after", level);
};

/**
 * What dropping `dragged` on `target` does, `fraction` of the way down the target's row: the top
 * third places it before the row, the middle third nests it under the row (last), the bottom
 * third places it after the row (or first under it when its subcategories show). Groups only
 * reorder, before or after the group dropped on. Null when the drop breaks a rule or moves nothing.
 */
export const resolveDrop = (
  groups: ReadonlyArray<CategoryGroup>,
  dragged: Dragged,
  target: Target,
  fraction: number,
  maxDepth: number,
): Drop | null =>
  dragged.kind === "group"
    ? groupDrop(groups, dragged.id, target, fraction)
    : categoryDrop(groups, dragged.id, target, fraction, maxDepth);

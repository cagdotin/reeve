import type { Category, CategoryGroup } from "@reeve/contract";
import { categoryLevels, hiddenCategories } from "@reeve/contract/rules";
import type { collapsedGroups } from "@/lib/prefs";

/** The ids a collapse preference holds; none when it is unset or unreadable. */
export const readCollapsed = (pref: typeof collapsedGroups): ReadonlySet<string> => {
  try {
    const value: unknown = JSON.parse(pref.get() ?? "[]");
    return new Set(Array.isArray(value) ? value.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
};

/** A category as the budget shows it: how deep it sits and whether it has subcategories. */
export interface TreeRow {
  readonly category: Category;
  readonly level: number;
  readonly hasChildren: boolean;
  readonly collapsed: boolean;
}

/** A group's categories to show, in tree order, without hidden ones or collapsed subtrees. */
export const treeRows = (
  group: CategoryGroup,
  showHidden: boolean,
  collapsed: ReadonlySet<string>,
): Array<TreeRow> => {
  const hidden = hiddenCategories(group.categories);
  const visible = group.categories.filter((category) => showHidden || !hidden.has(category.id));
  const levels = categoryLevels(group.categories);
  const parents = new Set(visible.map((category) => category.parentId));
  const skipped = new Set<string>();
  const rows: Array<TreeRow> = [];
  for (const category of visible) {
    const parent = category.parentId;
    if (parent !== null && (skipped.has(parent) || collapsed.has(parent))) {
      skipped.add(category.id);
      continue;
    }
    rows.push({
      category,
      level: levels.get(category.id) ?? 0,
      hasChildren: parents.has(category.id),
      collapsed: collapsed.has(category.id),
    });
  }
  return rows;
};

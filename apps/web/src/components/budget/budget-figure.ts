import type { Category, CategoryGroup } from "@reeve/contract";
import type { FigureScope } from "@/components/figure-records";

/**
 * A budget figure: a category's spent or received total, its subcategories included, or a group's.
 * `categories` lists every category it covers, for the register.
 */
export interface BudgetFigure extends FigureScope {
  readonly of: { readonly kind: "category" | "group"; readonly id: string };
  readonly income: boolean;
}

/** Every category a category's total covers: itself and each subcategory under it. */
const subtree = (group: CategoryGroup, id: string) => {
  const ids = [id];
  for (let at = 0; at < ids.length; at++)
    for (const each of group.categories) if (each.parentId === ids[at]) ids.push(each.id);
  return ids;
};

export const categoryFigure = (
  group: CategoryGroup,
  category: Category,
  month: string,
  income: boolean,
): BudgetFigure => ({
  name: category.name,
  month,
  income,
  of: { kind: "category", id: category.id },
  categories: subtree(group, category.id),
});

export const groupFigure = (
  group: CategoryGroup,
  month: string,
  income: boolean,
): BudgetFigure => ({
  name: group.name,
  month,
  income,
  of: { kind: "group", id: group.id },
  categories: group.categories.map((each) => each.id),
});

import type { CategoryGroup } from "@reeve/contract";
import { categoryLevels } from "@reeve/contract/rules";

/** A category as a picker option: its name, how deep it sits, and its group's name. */
export interface CategoryOption {
  readonly value: string;
  readonly label: string;
  readonly depth: number;
  readonly group: string;
}

export const categoryOptions = (groups: ReadonlyArray<CategoryGroup>): Array<CategoryOption> =>
  groups.flatMap((group) => {
    const levels = categoryLevels(group.categories);
    return group.categories.map((category) => ({
      value: category.id,
      label: category.name,
      depth: levels.get(category.id) ?? 0,
      group: group.name,
    }));
  });

/** The indentation of an option or row `depth` levels down. */
export const indentStyle = (depth: number | undefined, step = 0.875) =>
  depth ? { paddingInlineStart: `${depth * step}rem` } : undefined;

type RuleEntries = {
  readonly conditions: ReadonlyArray<object>;
  readonly actions: ReadonlyArray<object>;
};

const named = (rule: RuleEntries, field: "category" | "category_group") =>
  new Set(
    [...rule.conditions, ...rule.actions].flatMap((entry) => {
      if (!("field" in entry) || entry.field !== field || !("value" in entry)) return [];
      return Array.isArray(entry.value) ? (entry.value as ReadonlyArray<unknown>) : [entry.value];
    }),
  );

/** How many rules name each category, in a condition or an action; a rule counts once. */
export const ruleCounts = (rules: ReadonlyArray<RuleEntries>): ReadonlyMap<unknown, number> => {
  const counts = new Map<unknown, number>();
  for (const rule of rules)
    for (const id of named(rule, "category")) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
};

/** How many rules name a group, or any category in it; a rule counts once. */
export const groupRuleCount = (rules: ReadonlyArray<RuleEntries>, group: CategoryGroup) => {
  const members = new Set(group.categories.map((category) => category.id));
  return rules.filter(
    (rule) =>
      named(rule, "category_group").has(group.id) ||
      [...named(rule, "category")].some((id) => members.has(id as string)),
  ).length;
};

import type { CategoryGroup } from "@reeve/contract";
import { useState } from "react";
import { readCollapsed } from "@/components/budget/tree";
import { toggled } from "@/lib/insights";
import { collapsedCategories, collapsedGroups } from "@/lib/prefs";

/** Which of the budget's groups and parent categories are folded, remembered across visits. */
export function useFolding(groups: ReadonlyArray<CategoryGroup>) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed(collapsedGroups));
  const [collapsedRows, setCollapsedRows] = useState(() => readCollapsed(collapsedCategories));
  const showGroups = (next: ReadonlySet<string>) => {
    setCollapsed(next);
    collapsedGroups.set(JSON.stringify([...next]));
  };
  const showRows = (next: ReadonlySet<string>) => {
    setCollapsedRows(next);
    collapsedCategories.set(JSON.stringify([...next]));
  };
  const parents = groups.flatMap((group) =>
    group.categories.flatMap((category) => category.parentId ?? []),
  );
  return {
    collapsed,
    collapsedRows,
    toggleGroup: (id: string) => showGroups(toggled(collapsed, id)),
    toggleRow: (id: string) => showRows(toggled(collapsedRows, id)),
    anyFolded:
      groups.some((group) => collapsed.has(group.id)) ||
      parents.some((id) => collapsedRows.has(id)),
    collapseAll: () => {
      showGroups(new Set(groups.map((group) => group.id)));
      showRows(new Set(parents));
    },
    expandAll: () => {
      showGroups(new Set());
      showRows(new Set());
    },
  };
}

export type Folding = ReturnType<typeof useFolding>;

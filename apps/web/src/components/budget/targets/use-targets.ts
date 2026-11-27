import type { CategoryTargets } from "@reeve/contract/catalog";
import { useQuery } from "@tanstack/react-query";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";

/** A category's saved targets, from the book's one list of them; undefined when it has none. */
export const useCategoryTargets = (category: string): CategoryTargets | undefined => {
  const { id: book } = useBook();
  const list = useQuery(bookQuery(book, "list_targets", {}));
  return list.data?.find((each) => each.category === category);
};

/** Whether the category has anything the target editor shows. */
export const hasTargets = (targets: CategoryTargets | undefined): targets is CategoryTargets =>
  targets !== undefined && targets.targets.length + targets.leftovers.length > 0;

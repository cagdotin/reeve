import type { templates } from "@reeve/contract/catalog";
import { notFound } from "../book.ts";
import type { DomainHandlers } from "../handler.ts";
import { categoryRow, listCategories } from "../ledger/categories.ts";
import { applyTemplates, checkTemplates, cleanupTemplates } from "./apply.ts";
import {
  getCategoryTargets,
  listTargets,
  previewCategoryTargets,
  setCategoryTargets,
} from "./targets.ts";

/** Budget targets: #template, #goal and #cleanup lines in category notes (docs/rules/budget.md). */
export const templateHandlers = {
  list_targets: (book) => listTargets(book),
  get_category_targets: (book, input) => getCategoryTargets(book, input.category),
  set_category_targets: (book, input) => setCategoryTargets(book, input),
  preview_category_targets: (book, input) => previewCategoryTargets(book, input),
  apply_templates: (book, input) => applyTemplates(book, { month: input.month, force: false }),
  overwrite_templates: (book, input) => applyTemplates(book, { month: input.month, force: true }),
  apply_category_templates: (book, input) =>
    applyTemplates(book, {
      month: input.month,
      force: true,
      categories: [categoryRow(book.db, input.category).id],
    }),
  apply_group_templates: (book, input) => {
    const group =
      listCategories(book).find((row) => row.id === input.group) ??
      notFound("category group", input.group);
    return applyTemplates(book, {
      month: input.month,
      force: true,
      categories: group.categories.map((category) => category.id),
    });
  },
  cleanup_templates: (book, input) => cleanupTemplates(book, input),
  check_templates: (book) => {
    const problems = checkTemplates(book);
    return { ok: problems.length === 0, problems };
  },
} satisfies DomainHandlers<typeof templates>;

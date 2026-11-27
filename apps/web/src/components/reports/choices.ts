import { useQuery } from "@tanstack/react-query";
import type { Names } from "@/components/rules/rule-model";
import type { Choices } from "@/components/rules/rule-editor";
import { bookQuery } from "@/lib/api";
import { categoryOptions } from "@/lib/categories";

/** The book's accounts, categories, groups and payees, as names and as picker options. */
export const useChoices = (book: string) => {
  const accounts = useQuery(bookQuery(book, "list_accounts", { closed: true })).data ?? [];
  const groups = useQuery(bookQuery(book, "list_categories", {})).data ?? [];
  const payees = useQuery(bookQuery(book, "list_payees", {})).data ?? [];
  const categories = groups.flatMap((group) => group.categories);
  const names: Names = {
    accounts: new Map(accounts.map((each) => [each.id, each.name])),
    categories: new Map(categories.map((each) => [each.id, each.name])),
    groups: new Map(groups.map((each) => [each.id, each.name])),
    payees: new Map(payees.map((each) => [each.id, each.name])),
  };
  const choices: Choices = {
    accounts: accounts.map((each) => ({ value: each.id, label: each.name })),
    categories: categoryOptions(groups),
    groups: groups.map((each) => ({ value: each.id, label: each.name })),
    payees: payees.map((each) => ({ value: each.id, label: each.name })),
  };
  return { names, choices, accounts, groups, categories };
};

/** The first month with a transaction, for "All time" and the month pickers. */
export const useEarliestMonth = (book: string): string | undefined =>
  useQuery({
    ...bookQuery(book, "run_custom_report", {
      dateRange: "All time",
      mode: "total",
      groupBy: "Account",
    }),
    select: (report) => report.start.slice(0, 7),
    staleTime: 60_000,
  }).data;

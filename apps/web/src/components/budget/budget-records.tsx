import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { BudgetFigure } from "@/components/budget/budget-figure";
import { FigureRecordsPane } from "@/components/figure-records";
import { Money } from "@/components/money";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import { monthLabel } from "@/lib/months";

/** The transactions behind a budget cell's spent or received figure. */
export function BudgetRecords({ figure, onClose }: { figure: BudgetFigure; onClose: () => void }) {
  const { id: book } = useBook();
  const records = useQuery({
    ...bookQuery(book, "budget_transactions", {
      [figure.of.kind]: figure.of.id,
      month: figure.month,
    }),
    placeholderData: keepPreviousData,
  });
  const { name, of, income, categories } = figure;
  const scope =
    of.kind === "group"
      ? `the ${name} group`
      : categories.length > 1
        ? `${name} and its subcategories`
        : name;
  return (
    <FigureRecordsPane
      figure={figure}
      records={records}
      inRegister
      onClose={onClose}
      summary={(total) => (
        <>
          {income ? `Received in ${scope}` : `Spent from ${scope}`} in {monthLabel(figure.month)}:{" "}
          <Money amount={total} tone="none" className="text-foreground" />. A split counts only its
          lines in {of.kind === "group" ? "the group" : name}, and a transfer off the budget counts
          when it names the category.
        </>
      )}
    />
  );
}

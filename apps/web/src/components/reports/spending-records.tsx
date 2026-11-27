import type { AccountScope, ReportCondition } from "@reeve/contract/catalog";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FigureRecordsPane } from "@/components/figure-records";
import { Money } from "@/components/money";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import { monthLabel } from "@/lib/months";

/** One expense category's figure in one month of the Spending report. */
export interface SpendingFigure {
  readonly category: { readonly id: string; readonly name: string };
  readonly month: string;
}

/** The transactions behind a Spending report cell, under the report's filters. */
export function SpendingRecords({
  figure,
  conditions,
  conditionsOp,
  scope,
  onClose,
}: {
  figure: SpendingFigure;
  conditions: ReadonlyArray<ReportCondition>;
  conditionsOp: "and" | "or";
  scope: AccountScope;
  onClose: () => void;
}) {
  const { id: book } = useBook();
  const records = useQuery({
    ...bookQuery(book, "spending_transactions", {
      category: figure.category.id,
      month: figure.month,
      conditions: [...conditions],
      conditionsOp,
      scope,
    }),
    placeholderData: keepPreviousData,
  });
  const { name } = figure.category;
  return (
    <FigureRecordsPane
      figure={{ name, month: figure.month, categories: [figure.category.id] }}
      records={records}
      inRegister={conditions.length === 0}
      onClose={onClose}
      summary={(total) => (
        <>
          Spent on {name} in {monthLabel(figure.month)}:{" "}
          <Money amount={total} tone="none" className="text-foreground" />, from budget accounts
          {conditions.length > 0 ? " under the report's filters" : ""}. A split counts only its
          lines in {name}, and a transfer off the budget counts when it names the category.
        </>
      )}
    />
  );
}

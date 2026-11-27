import type { CategoryGroup } from "@reeve/contract";
import type { Receipt, ReceiptPayment } from "@reeve/contract/catalog";
import { PageAlert } from "@/components/page-alert";
import { useQuery } from "@tanstack/react-query";
import { CircleCheckIcon, SplitIcon } from "lucide-react";
import { Money } from "@/components/money";
import { slot, useChartTheme } from "@/components/reports/chart-theme";
import { Button } from "@reeve/ui/components/button";
import { Spinner } from "@reeve/ui/components/spinner";
import { toastManager } from "@reeve/ui/components/toast";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { BudgetCategorySelect } from "./line-selects";

/** The lines without a budget category, to give one here; applying needs every line to have one. */
export function CategoriesStep({
  receipt,
  groups,
}: {
  receipt: Receipt;
  groups: ReadonlyArray<CategoryGroup>;
}) {
  const unresolved = receipt.lines.filter((line) => line.effectiveBudgetCategoryId === null);
  if (receipt.lines.length === 0)
    return <p className="text-xs text-muted-foreground">No lines to categorize yet.</p>;
  if (unresolved.length === 0)
    return (
      <p className="text-xs text-muted-foreground">
        {receipt.lines.length === 1
          ? "Its line has a budget category."
          : `All ${receipt.lines.length} lines have a budget category.`}
      </p>
    );
  return (
    <div className="grid gap-1">
      {unresolved.map((line) => (
        <UnresolvedLine key={line.id} line={line} groups={groups} />
      ))}
    </div>
  );
}

function UnresolvedLine({
  line,
  groups,
}: {
  line: Receipt["lines"][number];
  groups: ReadonlyArray<CategoryGroup>;
}) {
  const { id: book } = useBook();
  const update = useBookMutation(book, "update_receipt_line");
  return (
    <div className="flex items-center gap-2 text-[13px]">
      <span className="min-w-0 flex-1 truncate">{line.text}</span>
      <BudgetCategorySelect
        groups={groups}
        value={line.budgetCategoryId}
        effective={line.effectiveBudgetCategory}
        className="w-44 border-input bg-background"
        onChange={(budgetCategoryId) => update.mutate({ id: line.id, budgetCategoryId })}
      />
    </div>
  );
}

/**
 * What applying the receipt writes on each transaction that pays it: one split line per budget
 * category. Lines without a budget category block it.
 */
export function ApplyPanel({ receipt }: { receipt: Receipt }) {
  const unresolved = receipt.lines.filter((line) => line.effectiveBudgetCategoryId === null);
  return (
    <div className="grid gap-2">
      {receipt.payments.length === 0 && receipt.total === 0 && (
        <p className="text-xs text-muted-foreground">No transaction to split.</p>
      )}
      {receipt.payments.length === 0 && receipt.total !== 0 && (
        <p className="text-xs text-muted-foreground">
          Link the transaction that paid it, then apply the receipt to split it by budget category.
        </p>
      )}
      {receipt.payments.map((payment) => (
        <Preview
          key={payment.transactionId}
          receipt={receipt.id}
          payment={payment}
          several={receipt.payments.length > 1}
          automatic={receipt.autoApplied}
          ready={unresolved.length === 0 && receipt.lines.length > 0}
        />
      ))}
    </div>
  );
}

/** The split's shares of the whole as one bar, a colour for each category. */
function SplitBar({ amounts }: { amounts: ReadonlyArray<number> }) {
  const theme = useChartTheme();
  if (amounts.length < 2 || amounts.some((amount) => amount <= 0)) return null;
  return (
    <span aria-hidden className="flex h-2 gap-px overflow-hidden rounded-full">
      {amounts.map((amount, index) => (
        <span
          // oxlint-disable-next-line react/no-array-index-key -- the slots are positional.
          key={index}
          style={{ flexGrow: amount, backgroundColor: slot(theme, index) }}
        />
      ))}
    </span>
  );
}

function Preview({
  receipt,
  payment,
  several,
  automatic,
  ready,
}: {
  receipt: string;
  payment: ReceiptPayment;
  several: boolean;
  /** The autoApplyReceipts setting applied it. */
  automatic: boolean;
  /** Every line has a budget category; otherwise the engine refuses, and only Apply asks it. */
  ready: boolean;
}) {
  const { id: book, formatDay, format } = useBook();
  const preview = useQuery({
    ...bookQuery(book, "receipt_split_preview", {
      id: receipt,
      transaction: payment.transactionId,
    }),
    retry: false,
    enabled: ready,
  });
  const apply = useBookMutation(book, "apply_receipt_to_transaction");
  const data = preview.data;
  const theme = useChartTheme();
  const shaded = data !== undefined && data.splits.length > 1;

  return (
    <div className="grid gap-2 text-[13px]">
      {several && (
        <span className="text-xs text-muted-foreground">
          {payment.payee ?? "No payee"} · {formatDay(payment.date)}
        </span>
      )}
      {ready && preview.isPending && <Spinner className="mx-auto" />}
      {[preview.error, ready ? null : apply.error].map(
        (error) =>
          error !== null && <PageAlert key={error.message} variant="error" title={error.message} />,
      )}
      {!ready && (
        <Button
          variant="outline"
          className="justify-self-start"
          loading={apply.isPending}
          onClick={() => apply.mutate({ id: receipt, transaction: payment.transactionId })}
        >
          <SplitIcon />
          Apply to transaction
        </Button>
      )}
      {data !== undefined && (
        <>
          <SplitBar amounts={data.splits.map((split) => -split.amount)} />
          <ul className="grid gap-1">
            {data.splits.map((split, index) => (
              <li key={split.categoryId ?? "uncategorized"} className="flex items-center gap-2">
                {shaded && (
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: slot(theme, index) }}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{split.category}</span>
                <Money amount={-split.amount} tone="none" />
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted-foreground">
            {data.spread
              ? "What the receipt does not cover (a tip, a fee) is spread over its categories, so the splits add up to the bank's amount."
              : data.remainder !== null
                ? `${format(Math.abs(data.remainder.amount))} is on no receipt and stays on its current category.`
                : "Tax and discounts are spread over the categories in proportion to their lines."}
          </p>
          {data.applied ? (
            <span className="flex items-center gap-1.5 text-xs text-success-foreground">
              <CircleCheckIcon className="size-3.5" />
              {automatic
                ? "Applied automatically: the transaction carries this split."
                : "The transaction carries this split."}
            </span>
          ) : (
            <Button
              className="justify-self-start"
              loading={apply.isPending}
              onClick={() =>
                apply.mutate(
                  { id: receipt, transaction: payment.transactionId },
                  {
                    onSuccess: () =>
                      toastManager.add({ type: "success", title: "Split the transaction" }),
                  },
                )
              }
            >
              <SplitIcon />
              Apply to transaction
            </Button>
          )}
        </>
      )}
    </div>
  );
}

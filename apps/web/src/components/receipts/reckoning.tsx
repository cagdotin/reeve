import type { Receipt, ReceiptStatus } from "@reeve/contract/catalog";
import { PageAlert } from "@/components/page-alert";
import { CircleCheckIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Money } from "@/components/money";
import { Button } from "@reeve/ui/components/button";
import { cn } from "@reeve/ui/lib/utils";
import { useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { Adjustments } from "./adjustments";

function Row({
  label,
  strong = false,
  rule = false,
  children,
}: {
  label: string;
  strong?: boolean;
  rule?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex items-baseline gap-3 py-0.5", rule && "mt-0.5 border-t pt-1")}>
      <dt className={cn("flex-1 text-xs", strong ? "text-foreground" : "text-muted-foreground")}>
        {label}
      </dt>
      <dd className={cn("tabular-nums", strong && "font-medium")}>{children}</dd>
    </div>
  );
}

/**
 * Does it add up: lines and adjustments against the total, then against what was paid, computed
 * from the lines as they are being typed. The adjustments are edited beside it.
 */
export function Reckoning({ receipt, status }: { receipt: Receipt; status: ReceiptStatus }) {
  const { id: book, format } = useBook();
  const adjust = useBookMutation(book, "add_receipt_adjustment");
  const warnings = receipt.warnings.filter((each) => each.code === "line_total_mismatch");
  return (
    <div className="grid gap-x-6 gap-y-3 @3xl:grid-cols-[minmax(0,1fr)_16rem]">
      <Adjustments receipt={receipt} />
      <div className="grid content-start gap-2 text-[13px]">
        <dl>
          <Row label="Lines">
            <Money amount={status.itemsTotal} tone="none" />
          </Row>
          <Row label="Adjustments">
            <Money amount={status.adjustmentsTotal} tone="none" />
          </Row>
          <Row label="Comes to" rule strong>
            <Money amount={status.expectedTotal} tone="none" />
          </Row>
          <Row label="Total paid" strong>
            <Money amount={receipt.total} tone="none" />
          </Row>
          <Row label="Payments linked" rule>
            <Money amount={status.paidAmount} tone="none" />
          </Row>
        </dl>
        {status.balanced ? (
          <p className="flex items-start gap-1.5 text-xs text-success-foreground">
            <CircleCheckIcon className="mt-px size-3.5 shrink-0" />
            The lines and adjustments add up to the total.
          </p>
        ) : (
          <PageAlert
            variant="warning"
            title={`${format(Math.abs(status.difference))} ${status.difference > 0 ? "missing from" : "more than"} the total.`}
            action={
              <Button
                variant="ghost"
                loading={adjust.isPending}
                onClick={() =>
                  adjust.mutate({
                    receipt: receipt.id,
                    kind: "rounding",
                    amount: status.difference,
                    description: "Difference",
                  })
                }
              >
                Balance with an adjustment
              </Button>
            }
          />
        )}
        <p className="text-xs text-muted-foreground">
          {status.matched
            ? "Fully paid by its transactions."
            : receipt.total === 0
              ? "Nothing to match."
              : "Not fully matched yet."}
        </p>
      </div>
      {warnings.map((warning) => (
        <PageAlert
          key={warning.lineId ?? warning.message}
          variant="warning"
          title={warning.message}
        />
      ))}
    </div>
  );
}

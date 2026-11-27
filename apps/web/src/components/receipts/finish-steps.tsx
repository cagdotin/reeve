import type { CategoryGroup } from "@reeve/contract";
import type { Receipt, ReceiptStatus } from "@reeve/contract/catalog";
import { receiptStage } from "@reeve/contract/receipts";
import { CheckCircle2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@reeve/ui/lib/utils";
import { ApplyPanel, CategoriesStep } from "./apply-panel";
import { Payments } from "./payments";
import { Reckoning } from "./reckoning";

function Step({
  id,
  number,
  title,
  done,
  current,
  last = false,
  children,
}: {
  id: string;
  number: number;
  title: string;
  done: boolean;
  current: boolean;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <li id={id} className="grid scroll-mt-3 grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3">
      <div className="flex flex-col items-center">
        {done ? (
          <CheckCircle2Icon aria-label="Done" className="size-5 shrink-0 text-success" />
        ) : (
          <span
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] tabular-nums",
              current ? "border-ring font-medium" : "text-muted-foreground",
            )}
          >
            {number}
          </span>
        )}
        {!last && <span aria-hidden className="mt-1 w-px flex-1 bg-border" />}
      </div>
      <section aria-label={title} className={cn("grid min-w-0 gap-2", !last && "pb-5")}>
        <h3 className="flex h-5 items-center text-[13px] font-medium">{title}</h3>
        {children}
      </section>
    </li>
  );
}

/** What finishing the receipt takes, as the steps it is: adds up, paid, categorized, applied. */
export function FinishSteps({
  receipt,
  status,
  groups,
}: {
  receipt: Receipt;
  status: ReceiptStatus;
  groups: ReadonlyArray<CategoryGroup>;
}) {
  const stage = receiptStage(status);
  return (
    <ol aria-label="Finishing this receipt" className="rounded-xl border bg-card p-3">
      <Step
        id="reckoning"
        number={1}
        title="Does it add up"
        done={status.balanced}
        current={stage === "balance"}
      >
        <Reckoning receipt={receipt} status={status} />
      </Step>
      <Step
        id="payment"
        number={2}
        title="Tied to its payment"
        done={status.matched}
        current={stage === "match"}
      >
        <Payments receipt={receipt} />
      </Step>
      <Step
        id="categories"
        number={3}
        title="Every line categorized"
        done={status.categorized}
        current={stage === "categorize"}
      >
        <CategoriesStep receipt={receipt} groups={groups} />
      </Step>
      <Step
        id="apply"
        number={4}
        title="Applied to the transaction"
        done={status.applied}
        current={stage === "apply"}
        last
      >
        <ApplyPanel receipt={receipt} />
      </Step>
    </ol>
  );
}

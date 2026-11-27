import type { Receipt, ReceiptStatus } from "@reeve/contract/catalog";
import { CheckCircle2Icon, CircleDotIcon, CircleIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Money } from "@/components/money";
import { Button } from "@reeve/ui/components/button";
import { cn } from "@reeve/ui/lib/utils";
import { useBook } from "@/lib/book";
import { nextStep, STEPS, type NextStep } from "@/lib/receipt-pages";

/** Where each step's work is on the page. */
const TARGET: Record<NextStep["stage"], string> = {
  balance: "reckoning",
  match: "payment",
  categorize: "categories",
  apply: "apply",
  finished: "apply",
};

const ACTION: Partial<Record<NextStep["stage"], string>> = {
  balance: "See what's off",
  match: "Find the payment",
  categorize: "See the lines",
  apply: "Review the split",
};

const goToStep = (id: string) =>
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });

/**
 * What the receipt is and what's left of it, following the typing through `status`: the next step
 * in words and a way to it, the four steps, and below it the header's fields.
 */
export function ReceiptSummary({
  receipt,
  status,
  children,
}: {
  receipt: Receipt;
  status: ReceiptStatus;
  children: ReactNode;
}) {
  const { format, formatDay } = useBook();
  const next = nextStep(status, receipt.total, format);
  const nothingToPay = receipt.total === 0 && next.stage === "match";
  const action = status.lineCount === 0 || nothingToPay ? undefined : ACTION[next.stage];
  const finished = next.stage === "finished";
  return (
    <section aria-label="Summary" className="grid gap-3 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="grid min-w-0 gap-0.5">
          <h2
            className={cn(
              "flex items-center gap-1.5 text-xl leading-7 font-medium tabular-nums",
              next.stage === "balance" && status.lineCount > 0 && "text-warning-foreground",
            )}
          >
            {finished && <CheckCircle2Icon className="size-5 shrink-0 text-success" />}
            {next.label}
          </h2>
          <p className="text-[13px] text-muted-foreground">{next.detail}</p>
        </div>
        <div className="flex items-start gap-4 @max-md:w-full @max-md:flex-row-reverse @max-md:justify-between">
          {action !== undefined && (
            <Button variant="outline" onClick={() => goToStep(TARGET[next.stage])}>
              {action}
            </Button>
          )}
          <div className="grid gap-0.5 @md:justify-items-end">
            <Money amount={receipt.total} tone="none" className="text-xl leading-7 font-medium" />
            <span className="truncate text-xs text-muted-foreground">
              {receipt.payee ?? "No store"} · {formatDay(receipt.date)}
            </span>
          </div>
        </div>
      </div>
      <ol aria-label="Steps" className="grid grid-cols-2 gap-1 @2xl:grid-cols-4">
        {STEPS.map((step) => {
          const done = status[step.flag];
          const current = next.stage === step.stage;
          const Mark = done ? CheckCircle2Icon : current ? CircleDotIcon : CircleIcon;
          return (
            <li key={step.stage}>
              <Button
                variant="outline"
                className={cn(
                  "w-full justify-start gap-1.5 font-normal",
                  !done && !current && "text-muted-foreground",
                  current && "border-ring",
                )}
                onClick={() => goToStep(TARGET[step.stage])}
              >
                <Mark
                  className={cn(
                    "size-3.5 shrink-0 opacity-100",
                    done ? "text-success" : "text-muted-foreground",
                  )}
                />
                <span className="truncate">{done ? step.done : step.open}</span>
              </Button>
            </li>
          );
        })}
      </ol>
      {children}
    </section>
  );
}

import { MATCH_WINDOW } from "@reeve/contract/receipts";
import { useQuery } from "@tanstack/react-query";
import { LinkIcon, PlusIcon } from "lucide-react";
import { Money } from "@/components/money";
import { Button } from "@reeve/ui/components/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@reeve/ui/components/dialog";
import { Spinner } from "@reeve/ui/components/spinner";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { shiftDay } from "@/lib/receipts";
import type { ReceiptSource } from "./new-receipt-dialog";
import { StatusBadges } from "./status-badges";

/**
 * Links a register transaction to a receipt that is not fully paid yet, dated near it (the
 * matching window, seen from the transaction), closest amount first; or starts a new one from it.
 */
export function AttachReceiptDialog({
  source,
  onOpenChange,
  onCreate,
}: {
  source: ReceiptSource | null;
  onOpenChange: (open: boolean) => void;
  onCreate: (source: ReceiptSource) => void;
}) {
  return (
    <Dialog open={source !== null} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg">
        {source !== null && (
          <Candidates
            source={source}
            onDone={() => onOpenChange(false)}
            onCreate={() => onCreate(source)}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function Candidates({
  source,
  onDone,
  onCreate,
}: {
  source: ReceiptSource;
  onDone: () => void;
  onCreate: () => void;
}) {
  const { id: book, formatDay, format } = useBook();
  const link = useBookMutation(book, "link_receipt_payment");
  const receipts = useQuery(
    bookQuery(book, "list_receipts", {
      unmatched: true,
      from: shiftDay(source.date, -MATCH_WINDOW.after),
      to: shiftDay(source.date, MATCH_WINDOW.before),
      limit: 50,
    }),
  );
  const paid = -source.amount;
  const near = (receipts.data?.receipts ?? []).toSorted(
    (a, b) =>
      Math.abs(a.total - a.status.paidAmount - paid) -
      Math.abs(b.total - b.status.paidAmount - paid),
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Attach a receipt</DialogTitle>
        <DialogDescription>
          {source.payee ?? "No payee"} · {formatDay(source.date)} · {format(paid)}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="grid gap-1.5">
        {receipts.isPending && <Spinner className="mx-auto" />}
        {receipts.isSuccess && near.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No unpaid receipt dated near this transaction.
          </p>
        )}
        {near.map((receipt) => (
          <div
            key={receipt.id}
            className="flex items-center gap-3 rounded-lg border px-3 py-2 text-[13px]"
          >
            <div className="grid min-w-0 flex-1 gap-1">
              <span className="truncate">
                {receipt.payee ?? "No store"}{" "}
                <span className="text-muted-foreground">· {formatDay(receipt.date)}</span>
              </span>
              <StatusBadges status={receipt.status} />
            </div>
            <Money amount={receipt.total} tone="none" />
            <Button
              variant={receipt.total === paid ? "default" : "outline"}
              loading={link.isPending && link.variables?.receipt === receipt.id}
              onClick={() =>
                link.mutate(
                  { receipt: receipt.id, transaction: source.transactionId },
                  { onSuccess: onDone },
                )
              }
            >
              <LinkIcon />
              Link
            </Button>
          </div>
        ))}
      </DialogPanel>
      <DialogFooter>
        <Button
          variant="outline"
          onClick={() => {
            onDone();
            onCreate();
          }}
        >
          <PlusIcon />
          New receipt from this transaction
        </Button>
      </DialogFooter>
    </>
  );
}

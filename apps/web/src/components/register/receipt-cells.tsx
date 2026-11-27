import { FEATURES } from "@reeve/contract/features";
import type { RegisterRow } from "@reeve/contract";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { EllipsisIcon, PaperclipIcon, ReceiptIcon } from "lucide-react";
import { Button } from "@reeve/ui/components/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@reeve/ui/components/menu";
import { cn } from "@reeve/ui/lib/utils";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import type { ReceiptSource } from "@/components/receipts/new-receipt-dialog";

export interface RowReceipts {
  readonly receiptIds: ReadonlyArray<string>;
  readonly applied: boolean;
}

/** Which of the register's transactions have receipts, from the receipts module (docs/rules/purchases.md). */
export const useRowReceipts = (account: string | undefined): ReadonlyMap<string, RowReceipts> => {
  const { id: book } = useBook();
  const marks = useQuery({
    ...bookQuery(book, "transactions_with_receipts", account === undefined ? {} : { account }),
    enabled: FEATURES.purchases,
  }).data;
  return new Map((marks ?? []).map((each) => [each.transactionId, each]));
};

/** A receipt icon on a row with receipts, filled once the receipt's split is applied. */
export function ReceiptMark({ receipts }: { receipts: RowReceipts | undefined }) {
  const first = receipts?.receiptIds[0];
  if (first === undefined) return <span className="w-5 shrink-0" />;
  const label = receipts!.applied ? "Receipt, applied" : "Receipt, not applied yet";
  return (
    <Link
      to="/receipts/$receipt"
      params={{ receipt: first }}
      aria-label={label}
      title={label}
      className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <ReceiptIcon
        className={cn("size-3.5", receipts!.applied && "fill-success/25 text-success-foreground")}
      />
    </Link>
  );
}

/** A row's menu: attach a receipt, or open the ones it has. */
export function RowMenu({
  row,
  receipts,
  onAttach,
}: {
  row: RegisterRow;
  receipts: RowReceipts | undefined;
  onAttach: (source: ReceiptSource) => void;
}) {
  const navigate = useNavigate();
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Transaction actions"
            className="shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
          />
        }
      >
        <EllipsisIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem
          onClick={() =>
            onAttach({
              transactionId: row.transactionId,
              date: row.date,
              payee: row.payee,
              amount: row.amount,
            })
          }
        >
          <PaperclipIcon />
          Attach receipt…
        </MenuItem>
        {receipts?.receiptIds.map((id, index) => (
          <MenuItem
            key={id}
            onClick={() => void navigate({ to: "/receipts/$receipt", params: { receipt: id } })}
          >
            <ReceiptIcon />
            Open receipt{receipts.receiptIds.length > 1 ? ` ${index + 1}` : ""}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

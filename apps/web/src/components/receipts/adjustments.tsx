import type { AdjustmentKind, Receipt } from "@reeve/contract/catalog";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { AmountInput } from "@/components/amount-input";
import { Button } from "@reeve/ui/components/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@reeve/ui/components/select";
import { useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { CellInput } from "./cell-input";
import { CELL_SELECT } from "./line-selects";

const KINDS: ReadonlyArray<{ value: AdjustmentKind; label: string }> = [
  { value: "tax", label: "Tax" },
  { value: "discount", label: "Discount" },
  { value: "coupon", label: "Coupon" },
  { value: "tip", label: "Tip" },
  { value: "deposit", label: "Deposit" },
  { value: "fee", label: "Fee" },
  { value: "rounding", label: "Rounding" },
  { value: "other", label: "Other" },
];

/** Tax, discounts and the rest, each a kind, a signed amount and what the receipt calls it. */
export function Adjustments({ receipt }: { receipt: Receipt }) {
  const { id: book } = useBook();
  const add = useBookMutation(book, "add_receipt_adjustment");
  const update = useBookMutation(book, "update_receipt_adjustment");
  const remove = useBookMutation(book, "delete_receipt_adjustment");
  return (
    <div className="min-w-0">
      <div className="flex h-7 items-center gap-2 text-xs text-muted-foreground">
        <span className="flex-1">Adjustments</span>
        <Button
          variant="ghost"
          onClick={() => add.mutate({ receipt: receipt.id, kind: "tax", amount: 0 })}
        >
          <PlusIcon />
          Add
        </Button>
      </div>
      {receipt.adjustments.map((adjustment) => (
        <div
          key={adjustment.id}
          className="group/adj flex items-center gap-1 border-b py-0.5 last-of-type:border-b-0"
        >
          <Select
            items={KINDS}
            value={adjustment.kind}
            onValueChange={(kind) => kind !== null && update.mutate({ id: adjustment.id, kind })}
          >
            <SelectTrigger aria-label="Kind" className={`${CELL_SELECT} w-24 shrink-0`}>
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {KINDS.map((kind) => (
                <SelectItem key={kind.value} value={kind.value}>
                  {kind.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <div className="min-w-0 flex-1">
            <CellInput
              label="Description"
              placeholder="As printed"
              value={adjustment.description ?? ""}
              onCommit={(text) =>
                update.mutate({
                  id: adjustment.id,
                  description: text.trim() === "" ? null : text.trim(),
                })
              }
            />
          </div>
          <div className="w-22 shrink-0">
            <AmountInput
              label="Amount"
              value={adjustment.amount}
              onCommit={(amount) => update.mutate({ id: adjustment.id, amount })}
            />
          </div>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Delete adjustment"
            className="text-muted-foreground opacity-40 group-hover/adj:opacity-100"
            onClick={() => remove.mutate({ id: adjustment.id })}
          >
            <Trash2Icon />
          </Button>
        </div>
      ))}
      {receipt.adjustments.length === 0 && (
        <p className="py-1 text-xs text-muted-foreground">
          Tax, discounts, coupons, tips, deposits and fees: signed, so a discount is negative.
        </p>
      )}
    </div>
  );
}

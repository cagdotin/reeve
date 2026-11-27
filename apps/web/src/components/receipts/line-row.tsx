import type { CategoryGroup } from "@reeve/contract";
import type { ItemCategory, ReceiptLine } from "@reeve/contract/catalog";
import { lineAmount, lineMismatch } from "@reeve/contract/receipts";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  EllipsisVerticalIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@reeve/ui/components/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@reeve/ui/components/menu";
import { cn } from "@reeve/ui/lib/utils";
import { type Input, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { formatPrice, parsePrice, parseQuantity } from "@/lib/receipts";
import { CellInput } from "./cell-input";
import { BudgetCategorySelect, ItemCategorySelect, UnitSelect } from "./line-selects";
import { ProductPicker } from "./product-picker";

type LineChange = Omit<Input<"update_receipt_line">, "book" | "id">;

/** What is typed but not saved yet, so the totals follow the typing. */
interface Live {
  readonly quantity?: number;
  readonly unitPrice?: number | null;
  readonly lineTotal?: number;
}

/** What a line's total comes to with what is typed: a typed total, else quantity × price. */
const liveTotal = (line: ReceiptLine, live: Live): number => {
  if (live.lineTotal !== undefined) return live.lineTotal;
  if (live.quantity === undefined && live.unitPrice === undefined) return line.lineTotal;
  const price = live.unitPrice === undefined ? line.unitPrice : live.unitPrice;
  return price === null ? line.lineTotal : lineAmount(live.quantity ?? line.quantity, price);
};

/**
 * One receipt line, edited in place: what is printed (text, code, quantity, unit, price, total) on
 * the first row, what it is (product, item category, budget category) on the second.
 */
export function LineRow({
  line,
  payeeId,
  groups,
  itemCategories,
  onLiveTotal,
  onMove,
  onDelete,
  first,
  last,
}: {
  line: ReceiptLine;
  payeeId: string | null;
  groups: ReadonlyArray<CategoryGroup>;
  itemCategories: ReadonlyArray<ItemCategory>;
  /** The total with what is being typed, or null when nothing is. */
  onLiveTotal: (id: string, total: number | null) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
  first: boolean;
  last: boolean;
}) {
  const { id: book, format, parse, money } = useBook();
  const update = useBookMutation(book, "update_receipt_line");
  const [live, setLive] = useState<Live>({});

  const typing = (change: Live) => {
    const next = { ...live, ...change };
    setLive(next);
    onLiveTotal(line.id, liveTotal(line, next));
  };
  const settle = () => {
    setLive({});
    onLiveTotal(line.id, null);
  };
  const save = (change: LineChange) =>
    update.mutate({ id: line.id, ...change }, { onSettled: settle });

  const total = liveTotal(line, live);
  const mismatch = lineMismatch({
    quantity: live.quantity ?? line.quantity,
    unitPrice: live.unitPrice === undefined ? line.unitPrice : live.unitPrice,
    lineTotal: total,
  });

  return (
    <fieldset
      aria-label={line.text === "" ? "Line" : line.text}
      className="group/line min-w-0 border-b px-1.5 py-1 hover:bg-muted/30"
    >
      <div className="flex items-center gap-1 max-md:flex-wrap">
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Line actions"
                className="shrink-0 text-muted-foreground opacity-40 group-hover/line:opacity-100 max-md:opacity-100"
              />
            }
          >
            <EllipsisVerticalIcon />
          </MenuTrigger>
          <MenuPopup align="start">
            <MenuItem disabled={first} onClick={() => onMove(-1)}>
              <ArrowUpIcon />
              Move up
            </MenuItem>
            <MenuItem disabled={last} onClick={() => onMove(1)}>
              <ArrowDownIcon />
              Move down
            </MenuItem>
            <MenuItem variant="destructive" onClick={onDelete}>
              <Trash2Icon />
              Delete line
            </MenuItem>
          </MenuPopup>
        </Menu>
        <div className="min-w-0 flex-1 max-md:basis-32">
          <CellInput
            label="Text"
            placeholder="As printed"
            value={line.text}
            onCommit={(text) => save({ text })}
          />
        </div>
        <div className="w-24 shrink-0">
          <CellInput
            label="Code"
            placeholder="Code"
            mono
            className="text-xs"
            value={line.code ?? ""}
            onCommit={(code) => save({ code: code.trim() === "" ? null : code.trim() })}
          />
        </div>
        <span aria-hidden className="hidden basis-full max-md:block" />
        <div className="w-16 shrink-0 max-md:w-auto max-md:min-w-0 max-md:flex-1">
          <CellInput
            label="Quantity"
            align="right"
            mono
            value={String(line.quantity)}
            onDraft={(text) => {
              if (text === null) return settle();
              const quantity = parseQuantity(text);
              if (quantity !== null) typing({ quantity });
            }}
            onCommit={(text) => {
              const quantity = parseQuantity(text);
              if (quantity === null) settle();
              else save({ quantity });
            }}
          />
        </div>
        <div className="w-18 shrink-0 max-md:w-auto max-md:min-w-0 max-md:flex-1">
          <UnitSelect value={line.unit} onChange={(unit) => save({ unit })} />
        </div>
        <div className="w-22 shrink-0 max-md:w-auto max-md:min-w-0 max-md:flex-1">
          <CellInput
            label="Unit price"
            placeholder="Price"
            align="right"
            mono
            value={line.unitPrice === null ? "" : formatPrice(line.unitPrice, format)}
            onDraft={(text) => {
              if (text === null) return settle();
              const unitPrice = parsePrice(text, money);
              if (text.trim() === "" || unitPrice !== null) typing({ unitPrice });
            }}
            onCommit={(text) => {
              const unitPrice = parsePrice(text, money);
              if (text.trim() !== "" && unitPrice === null) settle();
              else save({ unitPrice });
            }}
          />
        </div>
        <div className="relative w-24 shrink-0 max-md:w-auto max-md:min-w-0 max-md:flex-[1.3]">
          <CellInput
            label="Line total"
            align="right"
            mono
            className={cn(mismatch !== null && "pe-6")}
            value={format(total)}
            onDraft={(text) => {
              if (text === null) return settle();
              const lineTotal = parse(text);
              if (lineTotal !== null) typing({ lineTotal });
            }}
            onCommit={(text) => {
              const lineTotal = parse(text);
              if (lineTotal === null) settle();
              else save({ lineTotal });
            }}
          />
          {mismatch !== null && (
            <TriangleAlertIcon
              className="pointer-events-none absolute end-1.5 top-1.5 size-4 text-warning"
              aria-label={`Differs from quantity × price by ${format(mismatch)}`}
            >
              <title>Differs from quantity × price by {format(mismatch)}</title>
            </TriangleAlertIcon>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1 ps-7 pe-0.5 max-md:grid-cols-2 max-md:ps-0 max-md:[&>:last-child]:col-span-2">
        <ProductPicker line={line} payeeId={payeeId} />
        <ItemCategorySelect
          categories={itemCategories}
          value={line.itemCategoryId}
          effective={line.effectiveItemCategoryId}
          onChange={(itemCategoryId) => save({ itemCategoryId })}
        />
        <BudgetCategorySelect
          groups={groups}
          value={line.budgetCategoryId}
          effective={line.effectiveBudgetCategory}
          onChange={(budgetCategoryId) => save({ budgetCategoryId })}
        />
      </div>
    </fieldset>
  );
}

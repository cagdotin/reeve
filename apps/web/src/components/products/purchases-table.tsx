import type { PricePoint } from "@reeve/contract/catalog";
import type { Unit } from "@reeve/contract/receipts";
import { Link, useNavigate } from "@tanstack/react-router";
import { ReceiptTextIcon, UnlinkIcon } from "lucide-react";
import { RowMenu, SortHeader, TABLE_HEAD, TABLE_ROW } from "@/components/insights/table";
import { Money } from "@/components/money";
import { MenuItem } from "@reeve/ui/components/menu";
import { cn } from "@reeve/ui/lib/utils";
import { useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import type { PurchaseSort, PurchaseSortKey } from "@/lib/products";
import { UNIT_LABELS } from "@/lib/receipts";
import { UnitPrice } from "./unit-price";

const DATE = "w-22 shrink-0 tabular-nums";
const STORE = "min-w-0 flex-1 truncate";
const KIND = "w-40 shrink-0 truncate @max-3xl:hidden";
const QUANTITY = "flex w-18 shrink-0 justify-end tabular-nums @max-lg:hidden";
const PAID = "flex w-20 shrink-0 justify-end tabular-nums @max-lg:hidden";
const PER = "flex w-24 shrink-0 justify-end truncate";
const OPTIONS = "flex w-6 shrink-0 justify-center";

export function PurchasesHeader({
  sort,
  onSort,
  kinds,
}: {
  sort: PurchaseSort;
  onSort: (key: PurchaseSortKey) => void;
  kinds: boolean;
}) {
  const shared = { sort, onSort };
  return (
    <div className={TABLE_HEAD}>
      <span className={DATE}>
        <SortHeader {...shared} column="date" label="Date" />
      </span>
      <span className={STORE}>
        <SortHeader {...shared} column="store" label="Store" />
      </span>
      {kinds && <span className={KIND}>Kind</span>}
      <span className={QUANTITY}>
        <SortHeader {...shared} end column="quantity" label="Qty" title="Quantity" />
      </span>
      <span className={PAID}>
        <SortHeader
          {...shared}
          end
          column="paid"
          label="Paid"
          title="The line's total, before the receipt's tax and discounts"
        />
      </span>
      <span className={PER}>
        <SortHeader {...shared} end column="per" label="Per unit" />
      </span>
      <span className={OPTIONS} />
    </div>
  );
}

export function PurchaseRow({
  point,
  unit,
  kind,
  kinds,
}: {
  point: PricePoint;
  unit: Unit;
  /** The kind it is, when not the product itself. */
  kind: string | undefined;
  kinds: boolean;
}) {
  const { id: book, formatDay } = useBook();
  const navigate = useNavigate();
  const assign = useBookMutation(book, "assign_line_product");
  return (
    <div className={cn(TABLE_ROW, "h-9")}>
      <Link
        to="/receipts/$receipt"
        params={{ receipt: point.receiptId }}
        aria-label={`Receipt of ${formatDay(point.date)}`}
        className={cn(DATE, "outline-none hover:underline focus-visible:underline")}
      >
        {formatDay(point.date)}
      </Link>
      <span className={STORE} title={point.payee ?? undefined}>
        {point.payee ?? "No store"}
      </span>
      {kinds && <span className={cn(KIND, "text-muted-foreground")}>{kind}</span>}
      <span className={cn(QUANTITY, "text-muted-foreground")}>
        {point.quantity}
        {point.unit === null ? "" : ` ${UNIT_LABELS[point.unit]}`}
      </span>
      <span className={PAID}>
        <Money amount={point.lineTotal} tone="none" />
      </span>
      <span className={PER}>
        {point.pricePerBase === null ? (
          <span
            className="text-muted-foreground"
            title="This line cannot be measured in the product's unit: give the product a size, or the line a unit."
          >
            No price
          </span>
        ) : (
          <UnitPrice price={point.pricePerBase} unit={unit} />
        )}
      </span>
      <span className={OPTIONS}>
        <RowMenu label={`Purchase of ${formatDay(point.date)} options`}>
          <MenuItem
            onClick={() =>
              void navigate({
                to: "/receipts/$receipt",
                params: { receipt: point.receiptId },
              })
            }
          >
            <ReceiptTextIcon />
            Open receipt
          </MenuItem>
          <MenuItem onClick={() => assign.mutate({ line: point.lineId, productId: null })}>
            <UnlinkIcon />
            Not this product
          </MenuItem>
        </RowMenu>
      </span>
    </div>
  );
}

import type { ReceiptSort, ReceiptSummary } from "@reeve/contract/catalog";
import { Link, useNavigate } from "@tanstack/react-router";
import { CheckIcon, ImageIcon, ReceiptIcon, StoreIcon, Trash2Icon } from "lucide-react";
import { Money } from "@/components/money";
import { RowMenu, SortHeader, TABLE_HEAD, TABLE_ROW } from "@/components/insights/table";
import { ReceiptProgress } from "@/components/receipts/receipt-progress";
import { MenuItem, MenuSeparator } from "@reeve/ui/components/menu";
import { cn } from "@reeve/ui/lib/utils";
import { useBook } from "@/lib/book";
import {
  deleteTargetOf,
  nextStep,
  type DeleteTarget,
  type ReceiptSortState,
} from "@/lib/receipt-pages";

/** The columns, shared by the header and every row, folding on the width the page has. */
const DATE = "w-22 shrink-0 tabular-nums @max-md:hidden";
const STORE = "min-w-0 flex-1";
const NEXT = "flex w-36 shrink-0 items-center gap-1 truncate @max-3xl:hidden";
const PROGRESS = "flex w-14 shrink-0 items-center";
const LINES = "flex w-12 shrink-0 justify-end tabular-nums @max-2xl:hidden";
const TOTAL = "flex w-22 shrink-0 justify-end tabular-nums";
const PHOTO = "flex w-5 shrink-0 justify-center @max-2xl:hidden";
const OPTIONS = "relative z-10 flex w-6 shrink-0 justify-center";

export function ReceiptsHeader({
  sort,
  onSort,
}: {
  sort: ReceiptSortState;
  onSort: (key: ReceiptSort) => void;
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
      <span className={NEXT}>What's left</span>
      <span className={PROGRESS}>
        <SortHeader
          {...shared}
          column="progress"
          label="Steps"
          title="How far each receipt has come"
        />
      </span>
      <span className={LINES}>
        <SortHeader {...shared} end column="lines" label="Lines" />
      </span>
      <span className={TOTAL}>
        <SortHeader {...shared} end column="total" label="Total" />
      </span>
      <span className={PHOTO} />
      <span className={OPTIONS} />
    </div>
  );
}

export function ReceiptRow({
  receipt,
  onDelete,
  onStore,
}: {
  receipt: ReceiptSummary;
  onDelete: (target: DeleteTarget) => void;
  onStore: (id: string) => void;
}) {
  const { format, formatDay } = useBook();
  const navigate = useNavigate();
  const next = nextStep(receipt.status, receipt.total, format);
  const finished = next.stage === "finished";
  const open = () => navigate({ to: "/receipts/$receipt", params: { receipt: receipt.id } });
  return (
    <div className={cn(TABLE_ROW, "relative h-9 @max-md:h-11")}>
      <span className={DATE}>{formatDay(receipt.date)}</span>
      <span className={cn(STORE, "flex items-baseline gap-2 @max-md:grid @max-md:gap-0")}>
        <Link
          to="/receipts/$receipt"
          params={{ receipt: receipt.id }}
          className="truncate outline-none after:absolute after:inset-0 hover:underline focus-visible:underline"
        >
          {receipt.payee ?? <span className="text-muted-foreground">No store</span>}
        </Link>
        <span className="text-xs text-muted-foreground tabular-nums @md:hidden">
          {formatDay(receipt.date)}
        </span>
        {receipt.notes !== null && (
          <span className="min-w-0 truncate text-xs text-muted-foreground @max-3xl:hidden">
            {receipt.notes}
          </span>
        )}
      </span>
      <span
        title={next.detail}
        className={cn(
          NEXT,
          finished && "text-muted-foreground",
          next.stage === "balance" && receipt.status.lineCount > 0 && "text-warning-foreground",
        )}
      >
        {finished && <CheckIcon className="size-3.5 shrink-0 text-success" />}
        <span className="truncate">{next.label}</span>
      </span>
      <span className={PROGRESS}>
        <ReceiptProgress status={receipt.status} />
      </span>
      <span className={cn(LINES, "text-muted-foreground")}>{receipt.status.lineCount}</span>
      <span className={TOTAL}>
        <Money amount={receipt.total} tone="none" />
      </span>
      <span className={PHOTO}>
        {receipt.photoCount > 0 && (
          <ImageIcon
            className="size-3.5 text-muted-foreground"
            aria-label={
              receipt.photoCount === 1 ? "Has a photo" : `Has ${receipt.photoCount} photos`
            }
          />
        )}
      </span>
      <span className={OPTIONS}>
        <RowMenu label={`Options for ${receipt.payee ?? "no store"}, ${formatDay(receipt.date)}`}>
          <MenuItem onClick={() => void open()}>
            <ReceiptIcon />
            Open receipt
          </MenuItem>
          {receipt.payeeId !== null && (
            <MenuItem onClick={() => onStore(receipt.payeeId!)}>
              <StoreIcon />
              Only this store
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem variant="destructive" onClick={() => onDelete(deleteTargetOf(receipt))}>
            <Trash2Icon />
            Delete…
          </MenuItem>
        </RowMenu>
      </span>
    </div>
  );
}

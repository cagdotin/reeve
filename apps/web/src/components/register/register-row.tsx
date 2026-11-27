import { TableHeader, TableRow } from "@/components/insights/table";
import { FEATURES } from "@reeve/contract/features";
import type { RegisterRow } from "@reeve/contract";
import { CheckIcon, CircleIcon, LockIcon } from "lucide-react";
import { Money } from "@/components/money";
import { counterpartText } from "@/components/register/entry";
import { ReceiptMark, RowMenu, type RowReceipts } from "@/components/register/receipt-cells";
import type { ReceiptSource } from "@/components/receipts/new-receipt-dialog";
import { Checkbox } from "@reeve/ui/components/checkbox";
import {
  PreviewCard,
  PreviewCardPopup,
  PreviewCardTrigger,
} from "@reeve/ui/components/preview-card";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@reeve/ui/components/tooltip";
import { cn } from "@reeve/ui/lib/utils";
import { useBook } from "@/lib/book";

/**
 * The columns, shared by the header and every row. Notes take what width is left, so the category and
 * the amounts keep to the right. They fold on the width the page has: notes first, then payment and
 * deposit become one amount, then the account, the running balance, the receipt mark and the category.
 * A folded value is still in the transaction's panel.
 */
const COLUMN = {
  date: "w-22 shrink-0",
  account: "w-28 shrink-0 @max-5xl:hidden",
  payee: "w-56 min-w-0 shrink @max-5xl:flex-1",
  notes: "min-w-0 flex-1 @max-5xl:hidden",
  category: "w-44 min-w-0 shrink-0 @max-xl:hidden",
  payment: "w-22 shrink-0 text-right @max-3xl:hidden",
  deposit: "w-22 shrink-0 text-right @max-3xl:hidden",
  amount: "hidden w-22 shrink-0 text-right @max-3xl:block",
  balance: "w-26 shrink-0 text-right @max-2xl:hidden",
  cleared: "w-6 shrink-0",
  receipt: "w-5 shrink-0 @max-xl:hidden",
  menu: "w-6 shrink-0",
};

const HELP = {
  payment: ["Money that left this account: spending, or a transfer out."],
  deposit: ["Money that came into this account: income, a refund, or a transfer in."],
  amount: ["What the transaction moved in this account. Negative left it, positive came in."],
  balance: [
    "The account's balance after this transaction, oldest first.",
    "It shows while the table lists one account in date order, with no filter.",
  ],
  cleared: [
    "A tick: the bank shows this transaction. A ring: it does not yet. Click to switch.",
    "A lock: reconciled, checked against a statement, so it can no longer change by a click.",
  ],
} as const;

/** A column's name that explains it in a card on hover or focus. */
function ColumnHelp({
  label,
  body,
  icon = false,
}: {
  label: string;
  body: ReadonlyArray<string>;
  icon?: boolean;
}) {
  return (
    <PreviewCard>
      <PreviewCardTrigger
        delay={200}
        render={
          <button
            type="button"
            aria-label={`About ${label}`}
            className="inline-flex cursor-help items-center gap-1 rounded-sm underline decoration-dotted decoration-muted-foreground/40 underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        {icon ? <CheckIcon className="size-3.5" /> : label}
      </PreviewCardTrigger>
      <PreviewCardPopup align="end" className="w-64 flex-col gap-1.5 text-[13px]">
        <p className="font-medium">{label}</p>
        {body.map((paragraph) => (
          <p key={paragraph} className="text-muted-foreground">
            {paragraph}
          </p>
        ))}
      </PreviewCardPopup>
    </PreviewCard>
  );
}

export function RegisterHeader({
  multiAccount,
  showBalance,
  allSelected,
  onSelectAll,
}: {
  multiAccount: boolean;
  showBalance: boolean;
  allSelected: boolean;
  onSelectAll: (checked: boolean) => void;
}) {
  return (
    <TableHeader>
      <Checkbox aria-label="Select all" checked={allSelected} onCheckedChange={onSelectAll} />
      <span className={COLUMN.date}>Date</span>
      {multiAccount && <span className={COLUMN.account}>Account</span>}
      <span className={COLUMN.payee}>Payee</span>
      <span className={COLUMN.notes}>Notes</span>
      <span className={COLUMN.category}>Category</span>
      <span className={COLUMN.payment}>
        <ColumnHelp label="Payment" body={HELP.payment} />
      </span>
      <span className={COLUMN.deposit}>
        <ColumnHelp label="Deposit" body={HELP.deposit} />
      </span>
      <span className={COLUMN.amount}>
        <ColumnHelp label="Amount" body={HELP.amount} />
      </span>
      {showBalance && (
        <span className={COLUMN.balance}>
          <ColumnHelp label="Balance" body={HELP.balance} />
        </span>
      )}
      <span className={cn(COLUMN.cleared, "flex justify-center")}>
        <ColumnHelp label="Cleared" body={HELP.cleared} icon />
      </span>
      {FEATURES.purchases && (
        <>
          <span className={COLUMN.receipt} />
          <span className={COLUMN.menu} />
        </>
      )}
    </TableHeader>
  );
}

export function RegisterRowView({
  row,
  multiAccount,
  showBalance,
  selected,
  selecting,
  receipts,
  onAttach,
  onSelect,
  open,
  onEdit,
  onToggleCleared,
  onOpenAccount,
}: {
  row: RegisterRow;
  multiAccount: boolean;
  showBalance: boolean;
  selected: boolean;
  /** Something is selected, so every row shows its checkbox. */
  selecting: boolean;
  receipts: RowReceipts | undefined;
  onAttach: (source: ReceiptSource) => void;
  onSelect: () => void;
  /** Its panel is open. */
  open: boolean;
  onEdit: () => void;
  onToggleCleared: () => void;
  onOpenAccount: () => void;
}) {
  const { formatDay, format } = useBook();
  return (
    <TableRow
      onOpen={onEdit}
      className={cn(
        selected && "bg-accent/60 hover:bg-accent/70",
        open && "bg-accent hover:bg-accent",
      )}
    >
      <Checkbox
        aria-label="Select"
        checked={selected}
        onCheckedChange={onSelect}
        className={cn(
          !selecting && "opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100",
        )}
      />
      <button
        type="button"
        onClick={onEdit}
        className={cn(COLUMN.date, "cursor-pointer text-left text-muted-foreground tabular-nums")}
      >
        {formatDay(row.date)}
      </button>
      {multiAccount && (
        <button
          type="button"
          onClick={onOpenAccount}
          className={cn(
            COLUMN.account,
            "cursor-pointer truncate text-left text-muted-foreground hover:underline",
          )}
        >
          {row.accountName}
        </button>
      )}
      <button
        type="button"
        onClick={onEdit}
        className={cn(COLUMN.payee, "cursor-pointer truncate text-left")}
      >
        {row.payee ?? <span className="text-muted-foreground">—</span>}
      </button>
      <button
        type="button"
        onClick={onEdit}
        aria-label={row.notes ? undefined : "Notes"}
        className={cn(COLUMN.notes, "cursor-pointer truncate text-left text-muted-foreground")}
      >
        {row.notes}
      </button>
      <CounterpartCell row={row} onEdit={onEdit} />
      <span className={COLUMN.payment}>
        {row.amount < 0 && <Money amount={-row.amount} tone="none" />}
      </span>
      <span className={COLUMN.deposit}>
        {row.amount > 0 && <Money amount={row.amount} tone="none" />}
      </span>
      <span className={cn(COLUMN.amount, "tabular-nums")}>{format(row.amount)}</span>
      {showBalance && (
        <span className={cn(COLUMN.balance, "text-muted-foreground")}>
          {row.balance !== null && <Money amount={row.balance} />}
        </span>
      )}
      <ClearedButton row={row} onToggle={onToggleCleared} />
      {FEATURES.purchases && (
        <>
          <span className={cn(COLUMN.receipt, "flex")}>
            <ReceiptMark receipts={receipts} />
          </span>
          <RowMenu row={row} receipts={receipts} onAttach={onAttach} />
        </>
      )}
    </TableRow>
  );
}

function CounterpartCell({ row, onEdit }: { row: RegisterRow; onEdit: () => void }) {
  const text = counterpartText(row);
  return (
    <button
      type="button"
      onClick={onEdit}
      className={cn(
        COLUMN.category,
        "cursor-pointer truncate text-left",
        text === null && "text-warning-foreground",
        row.counterpart.kind === "transfer" && "text-muted-foreground italic",
      )}
      title={
        row.splits.length > 0
          ? row.splits.map((line) => `${line.name}: ${line.amount / 100}`).join("\n")
          : undefined
      }
    >
      {text ?? "Categorize"}
    </button>
  );
}

const CLEARED_TIPS = {
  Reconciled: "Reconciled: checked against a statement",
  Cleared: "Cleared: the bank shows it. Click to unclear",
  "Not cleared": "Not cleared yet. Click when the bank shows it",
} as const;

/** A quiet mark: a faint ring to clear, a tick once cleared, a lock once reconciled. */
function ClearedButton({ row, onToggle }: { row: RegisterRow; onToggle: () => void }) {
  const state = row.reconciled ? "Reconciled" : row.cleared ? "Cleared" : "Not cleared";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={row.reconciled ? undefined : onToggle}
            aria-label={state}
            aria-disabled={row.reconciled || undefined}
            className={cn(
              COLUMN.cleared,
              "flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
              row.reconciled
                ? "cursor-default"
                : "cursor-pointer hover:bg-accent hover:text-foreground",
            )}
          />
        }
      >
        {row.reconciled ? (
          <LockIcon className="size-3.5" />
        ) : row.cleared ? (
          <CheckIcon className="size-3.5" />
        ) : (
          <CircleIcon className="size-3.5 text-muted-foreground/40" />
        )}
      </TooltipTrigger>
      <TooltipPopup>{CLEARED_TIPS[state]}</TooltipPopup>
    </Tooltip>
  );
}

import type { RegisterRow } from "@reeve/contract";
import { CircleCheckIcon, LockIcon } from "lucide-react";
import { Fragment } from "react";
import { counterpartText } from "@/components/register/entry";
import { cn } from "@reeve/ui/lib/utils";
import { useBook } from "@/lib/book";

/** Rows by day, newest first as the register gives them. */
const byDay = (rows: ReadonlyArray<RegisterRow>) => {
  const days: Array<{ day: string; rows: Array<RegisterRow> }> = [];
  for (const row of rows) {
    const last = days.at(-1);
    if (last?.day === row.date) last.rows.push(row);
    else days.push({ day: row.date, rows: [row] });
  }
  return days;
};

/**
 * Register rows as a phone shows them, under a header for each day: the payee, what it is
 * (category, transfer or split) and the amount, as Actual's mobile transaction list.
 */
export function TransactionList({
  rows,
  multiAccount,
  onOpen,
}: {
  rows: ReadonlyArray<RegisterRow>;
  /** Name each row's account, for a list of several accounts. */
  multiAccount: boolean;
  onOpen?: (row: RegisterRow) => void;
}) {
  const { formatDay } = useBook();
  return (
    <ul aria-label="Transactions" className="flex flex-col">
      {byDay(rows).map(({ day, rows: dayRows }) => (
        <Fragment key={day}>
          <li className="sticky top-(--sticky-top) z-10 border-b bg-background px-4 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm">
            {formatDay(day)}
          </li>
          {dayRows.map((row) => (
            <li key={row.postingId} className="border-b">
              <TransactionItem row={row} multiAccount={multiAccount} onOpen={onOpen} />
            </li>
          ))}
        </Fragment>
      ))}
    </ul>
  );
}

function TransactionItem({
  row,
  multiAccount,
  onOpen,
}: {
  row: RegisterRow;
  multiAccount: boolean;
  onOpen: ((row: RegisterRow) => void) | undefined;
}) {
  const { format } = useBook();
  const what = counterpartText(row);
  const detail = [multiAccount ? row.accountName : null, row.notes].filter(Boolean).join(" · ");
  const title = row.payee ?? (row.counterpart.kind === "transfer" ? what : "No payee");
  const content = (
    <>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[15px]">{title}</span>
        <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          {title !== what && (
            <span className={cn("truncate", what === null && "text-warning-foreground")}>
              {what ?? "Uncategorized"}
            </span>
          )}
          {detail !== "" && (
            <span className="truncate">
              {title === what ? "" : "· "}
              {detail}
            </span>
          )}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <span
          className={cn("text-[15px] tabular-nums", row.amount > 0 && "text-success-foreground")}
        >
          {format(row.amount)}
        </span>
        {row.reconciled ? (
          <LockIcon aria-label="Reconciled" className="size-3.5 text-success-foreground" />
        ) : row.cleared ? (
          <CircleCheckIcon aria-label="Cleared" className="size-3.5 text-success-foreground" />
        ) : (
          <span className="size-3.5" />
        )}
      </span>
    </>
  );
  const className = "flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left";
  if (onOpen === undefined) return <div className={className}>{content}</div>;
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      className={cn(
        className,
        "cursor-pointer outline-none active:bg-muted/60 focus-visible:bg-muted/60",
      )}
    >
      {content}
    </button>
  );
}

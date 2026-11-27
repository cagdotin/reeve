import type { FigureRecords, RegisterRow } from "@reeve/contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@reeve/ui/components/button";
import { cn } from "@reeve/ui/lib/utils";
import { QueryBody } from "@/components/page";
import { useDeleteTransactions } from "@/components/register/delete-transactions";
import { updateInput, type EntryValue } from "@/components/register/entry";
import { EntryEditor } from "@/components/register/entry-editor";
import { FlowBar } from "@/components/reports/recent-transactions";
import { SplitPanel, usePaneLeave } from "@/components/split-panel";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { monthLabel } from "@/lib/months";

/** What a figure covers: a name, a month, and the categories the register can filter to. */
export interface FigureScope {
  readonly name: string;
  readonly month: string;
  readonly categories: ReadonlyArray<string>;
}

/**
 * The transactions behind a category's figure for a month, in the frame's pane. `summary` says what
 * the figure covers. A row opens its editor in the same pane, with a way back to the list.
 * `inRegister` offers the budget register filtered to the categories and month, for when it lists
 * the same transactions.
 */
export function FigureRecordsPane({
  figure,
  records,
  summary,
  inRegister,
  onClose,
}: {
  figure: FigureScope;
  records: UseQueryResult<FigureRecords>;
  summary: (total: number) => ReactNode;
  inRegister: boolean;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const leave = usePaneLeave();
  const row = records.data?.rows.find((each) => each.row.postingId === open)?.row;
  const label = `${figure.name} · ${monthLabel(figure.month)}`;

  if (open !== null && row !== undefined)
    return (
      <SplitPanel
        title={label}
        actions={
          <Button
            variant="ghost"
            aria-label="Back to transactions"
            onClick={() => leave(() => setOpen(null))}
          >
            <ArrowLeftIcon />
            Transactions
          </Button>
        }
        onClose={onClose}
      >
        <RecordEditor key={row.postingId} row={row} onDone={() => setOpen(null)} />
      </SplitPanel>
    );

  return (
    <SplitPanel title={label} onClose={onClose}>
      <QueryBody query={records}>
        {(data) => (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{summary(data.total)}</p>
            {data.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No transactions.</p>
            ) : (
              <ul aria-label="Transactions" className="-mx-4 border-y">
                {data.rows.map(({ counted, row: each }) => (
                  <li key={each.postingId} className="border-b last:border-b-0">
                    <RecordRow
                      row={each}
                      counted={counted}
                      onOpen={() => leave(() => setOpen(each.postingId))}
                    />
                  </li>
                ))}
              </ul>
            )}
            {inRegister && (
              <Button
                variant="outline"
                className="self-start"
                render={
                  <Link
                    to="/accounts/$account"
                    params={{ account: "budgeted" }}
                    search={{ categories: [...figure.categories], month: figure.month }}
                  />
                }
              >
                Open in register
              </Button>
            )}
          </div>
        )}
      </QueryBody>
    </SplitPanel>
  );
}

const counterpartName = (row: RegisterRow) => {
  const other = row.counterpart;
  if (other.kind === "transfer") return `Transfer: ${other.name}`;
  if (other.kind === "split") return row.splits.map((line) => line.name).join(", ");
  if (other.kind === "uncategorized") return "Uncategorized";
  return other.name;
};

function RecordRow({
  row,
  counted,
  onOpen,
}: {
  row: RegisterRow;
  counted: number;
  onOpen: () => void;
}) {
  const { format, formatDay } = useBook();
  const partial = counted !== row.amount;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 py-1.5 text-left text-[13px] outline-none hover:bg-row-hover focus-visible:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <FlowBar
        tone={row.counterpart.kind === "transfer" ? "transfer" : counted > 0 ? "in" : "out"}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{row.payee ?? row.accountName}</span>
        <span className="truncate text-xs text-muted-foreground">
          {formatDay(row.date)} · {row.accountName} · {counterpartName(row)}
        </span>
      </span>
      <span className="flex flex-col items-end tabular-nums">
        <span className={cn(counted > 0 && "text-success-foreground")}>{format(counted)}</span>
        {partial && (
          <span className="text-xs text-muted-foreground">of {format(row.amount)} split</span>
        )}
      </span>
    </button>
  );
}

function RecordEditor({ row, onDone }: { row: RegisterRow; onDone: () => void }) {
  const { id: book } = useBook();
  const accounts = useQuery(bookQuery(book, "list_accounts", { closed: true }));
  const categories = useQuery(bookQuery(book, "list_categories", {}));
  const payees = useQuery(bookQuery(book, "list_payees", {}));
  const update = useBookMutation(book, "update_transaction", { quiet: true });
  const remove = useDeleteTransactions(book);
  if (accounts.data === undefined || categories.data === undefined || payees.data === undefined)
    return null;
  return (
    <>
      <EntryEditor
        row={row}
        account={row.accountId}
        accounts={accounts.data}
        groups={categories.data}
        payees={payees.data}
        onSave={(value: EntryValue) => update.mutateAsync(updateInput(row, value))}
        onDone={onDone}
        onDelete={() => void remove.request([row.transactionId], onDone)}
      />
      {remove.dialog}
    </>
  );
}

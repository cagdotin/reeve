import { FEATURES } from "@reeve/contract/features";
import type { Account, RegisterRow } from "@reeve/contract";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { TableEmpty } from "@/components/insights/table";
import { useDeleteTransactions } from "@/components/register/delete-transactions";
import { EntryPanel } from "@/components/register/entry-panel";
import { TableToolbar } from "@/components/table-controls";
import { usePaneLeave } from "@/components/split-panel";
import { Checkbox } from "@reeve/ui/components/checkbox";
import { useRowReceipts } from "@/components/register/receipt-cells";
import { RegisterHeader, RegisterRowView } from "@/components/register/register-row";
import { SelectionBar, SelectionPane } from "@/components/register/selection-bar";
import { AttachReceiptDialog } from "@/components/receipts/attach-receipt-dialog";
import { NewReceiptDialog, type ReceiptSource } from "@/components/receipts/new-receipt-dialog";
import { Button } from "@reeve/ui/components/button";
import { useResetOnScope } from "@/lib/account-scope";
import { useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { useHotkeys } from "@/lib/hotkeys";
import { cn } from "@reeve/ui/lib/utils";
import { monthLabel } from "@/lib/months";
import {
  editedRow,
  type Editing,
  type Selection,
  selectRows,
  toggleRows,
  toggleSelected,
  withMonths,
} from "@/lib/register";

/**
 * The register on a computer: one scroll with the balances, which scroll away, and the filters and
 * column headers, which stick over the rows. A transaction opens in the frame's panel.
 */
export function Register({
  rows,
  total,
  editing,
  onEditing,
  account,
  multiAccount,
  accounts,
  canAdd,
  scope,
  context,
  filters,
  empty,
  onMonth,
  onMore,
  categories,
  payees,
}: {
  rows: ReadonlyArray<RegisterRow>;
  total: number;
  editing: Editing | null;
  onEditing: (editing: Editing | null) => void;
  account: string | undefined;
  multiAccount: boolean;
  accounts: ReadonlyArray<Account>;
  canAdd: boolean;
  scope: string;
  context: ReactNode;
  filters: ReactNode;
  empty: string;
  onMonth: (month: string) => void;
  onMore: () => void;
  categories: Parameters<typeof EntryPanel>[0]["groups"];
  payees: Parameters<typeof EntryPanel>[0]["payees"];
}) {
  const { id: book } = useBook();
  const navigate = useNavigate();
  const [selected, setSelectedState] = useState<Selection>(new Map());
  useResetOnScope(scope, () => setSelectedState(new Map()));
  const receipts = useRowReceipts(account);
  const [attaching, setAttaching] = useState<ReceiptSource | null>(null);
  const [receiptFrom, setReceiptFrom] = useState<ReceiptSource | undefined>(undefined);

  const update = useBookMutation(book, "update_transaction", { quiet: true });
  const remove = useDeleteTransactions(book);
  const leave = usePaneLeave();
  // The selection's pane has nothing left to act on once nothing is selected.
  const setSelected = (next: Selection) => {
    if (next.size > 0 || editing?.kind !== "selection") setSelectedState(next);
    else
      leave(() => {
        setSelectedState(next);
        onEditing(null);
      });
  };
  const open = (next: Editing) => leave(() => onEditing(next));
  const close = () => onEditing(null);
  const clearSelection = () => setSelected(new Map());
  // A selected row stands for the whole selection, so what is set in the pane goes on every row.
  const openRow = (row: RegisterRow) =>
    open(
      selected.size > 1 && selected.has(row.transactionId)
        ? { kind: "selection" }
        : { kind: "row", row },
    );

  useHotkeys({
    n: () => canAdd && open({ kind: "new" }),
    ...(selected.size > 0 && editing?.kind !== "selection" && { escape: clearSelection }),
  });

  const edited = editedRow(editing, rows);

  const ids = [...selected.keys()];
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.transactionId));
  const showBalance = !multiAccount && rows.some((row) => row.balance !== null);

  return (
    <>
      {context}
      <div data-testid="register-filters" className="sticky top-(--sticky-top) z-20 bg-background">
        <TableToolbar>
          {selected.size > 0 ? (
            <SelectionBar
              ids={ids}
              account={account}
              onCategorize={() => open({ kind: "selection" })}
              onClear={clearSelection}
            />
          ) : (
            filters
          )}
        </TableToolbar>
        <RegisterHeader
          multiAccount={multiAccount}
          showBalance={showBalance}
          allSelected={allSelected}
          onSelectAll={(checked) => setSelected(checked ? selectRows(rows) : new Map())}
        />
      </div>
      <EntryPanel
        editing={editing}
        rows={rows}
        account={account}
        accounts={accounts}
        groups={categories}
        payees={payees}
        onEditing={onEditing}
        onDelete={(row) => void remove.request([row.transactionId], close)}
      />
      {withMonths(rows).map((line) => {
        if (line.kind === "month") {
          const inMonth = line.rows.filter((row) => selected.has(row.transactionId)).length;
          return (
            <div
              key={line.month}
              className="group/month flex h-8 items-end gap-2 border-b px-3 pb-1.5 text-xs text-muted-foreground"
            >
              <Checkbox
                aria-label={`Select ${monthLabel(line.month)}`}
                checked={inMonth > 0 && inMonth === line.rows.length}
                indeterminate={inMonth > 0 && inMonth < line.rows.length}
                onCheckedChange={() => setSelected(toggleRows(selected, line.rows))}
                className={cn(
                  selected.size === 0 &&
                    "opacity-0 group-hover/month:opacity-100 focus-visible:opacity-100",
                )}
              />
              <button
                type="button"
                title={`Show only ${monthLabel(line.month)}`}
                className="cursor-pointer rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onMonth(line.month)}
              >
                {monthLabel(line.month)}
              </button>
            </div>
          );
        }
        const { row } = line;
        return (
          <RegisterRowView
            key={row.postingId}
            row={row}
            multiAccount={multiAccount}
            showBalance={showBalance}
            selected={selected.has(row.transactionId)}
            selecting={selected.size > 0}
            receipts={receipts.get(row.transactionId)}
            onAttach={setAttaching}
            onSelect={() => setSelected(toggleSelected(selected, row))}
            open={edited?.postingId === row.postingId}
            onEdit={() => openRow(row)}
            onToggleCleared={() =>
              update.mutate({
                id: row.transactionId,
                account: row.accountId,
                cleared: !row.cleared,
              })
            }
            onOpenAccount={() =>
              void navigate({
                to: "/accounts/$account",
                params: { account: row.accountId },
              })
            }
          />
        );
      })}
      {rows.length < total && (
        <div className="flex justify-center p-3">
          <Button variant="outline" onClick={onMore}>
            Load more ({total - rows.length} more)
          </Button>
        </div>
      )}
      {rows.length === 0 && (
        <TableEmpty>
          {empty}{" "}
          {canAdd && (
            <Button variant="link" onClick={() => open({ kind: "new" })}>
              Add one
            </Button>
          )}
        </TableEmpty>
      )}
      {FEATURES.purchases && (
        <>
          <AttachReceiptDialog
            source={attaching}
            onOpenChange={(open) => !open && setAttaching(null)}
            onCreate={setReceiptFrom}
          />
          <NewReceiptDialog
            open={receiptFrom !== undefined}
            onOpenChange={(open) => !open && setReceiptFrom(undefined)}
            source={receiptFrom}
          />
        </>
      )}
      {remove.dialog}
      {editing?.kind === "selection" && selected.size > 0 && (
        <SelectionPane
          selection={selected}
          groups={categories}
          onSaved={() => setSelected(new Map())}
          onClose={close}
        />
      )}
    </>
  );
}

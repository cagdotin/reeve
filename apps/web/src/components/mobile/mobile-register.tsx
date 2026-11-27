import type { Account, CategoryGroup, Payee, RegisterRow } from "@reeve/contract";
import { PlusIcon } from "lucide-react";
import type { ReactNode } from "react";
import { TableEmpty } from "@/components/insights/table";
import { TableToolbar } from "@/components/table-controls";
import { usePaneLeave } from "@/components/split-panel";
import { TransactionList } from "@/components/mobile/transaction-list";
import { useDeleteTransactions } from "@/components/register/delete-transactions";
import { EntryPanel } from "@/components/register/entry-panel";
import type { Editing } from "@/lib/register";
import { Button } from "@reeve/ui/components/button";
import { useBook } from "@/lib/book";

/**
 * The register on a phone: transactions as a list by day, each opening a form in a sheet, and a
 * button to add one, as Actual's mobile account page.
 */
export function MobileRegister({
  rows,
  total,
  editing,
  onEditing,
  account,
  multiAccount,
  accounts,
  canAdd,
  context,
  filters,
  empty,
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
  context: ReactNode;
  filters: ReactNode;
  empty: string;
  onMore: () => void;
  categories: ReadonlyArray<CategoryGroup>;
  payees: ReadonlyArray<Payee>;
}) {
  const { id: book } = useBook();
  const remove = useDeleteTransactions(book);
  const leave = usePaneLeave();
  const open = (next: Editing) => leave(() => onEditing(next));
  const close = () => onEditing(null);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {context}
      <TableToolbar>{filters}</TableToolbar>
      <TransactionList
        rows={rows}
        multiAccount={multiAccount}
        onOpen={(each) => open({ kind: "row", row: each })}
      />
      {rows.length < total && (
        <div className="flex justify-center p-3">
          <Button variant="outline" onClick={onMore}>
            Load more ({total - rows.length} more)
          </Button>
        </div>
      )}
      {rows.length === 0 && <TableEmpty>{empty}</TableEmpty>}
      <div className="h-20" />
      {canAdd && (
        <Button
          size="icon"
          aria-label="Add transaction"
          className="fixed end-4 bottom-16 z-20 size-12 shadow-lg [&_svg]:size-6!"
          onClick={() => open({ kind: "new" })}
        >
          <PlusIcon />
        </Button>
      )}
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
      {remove.dialog}
    </div>
  );
}

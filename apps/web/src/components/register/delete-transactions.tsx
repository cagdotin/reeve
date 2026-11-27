import type { Transaction } from "@reeve/contract";
import { addDays } from "@reeve/contract/rules";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@reeve/ui/components/alert-dialog";
import { Button } from "@reeve/ui/components/button";
import { bookQuery, run, showError, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";

interface BankGap {
  readonly name: string;
  readonly bank: string;
  readonly total: number;
}

interface HandEnteredCopy {
  readonly keep: string;
  readonly drop: string;
  readonly payee: string | null;
  readonly date: string;
}

interface Pending {
  readonly ids: ReadonlyArray<string>;
  readonly reconciled: number;
  readonly fromBank: number;
  readonly gaps: ReadonlyArray<BankGap>;
  readonly copy: HandEnteredCopy | null;
  readonly onDone: (() => void) | undefined;
}

interface BankPosting {
  readonly transaction: Transaction;
  readonly account: string;
  readonly amount: number;
}

const COPY_DAYS = 7;

const daysApart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b));

/**
 * Deletes transactions, asking first when any has a reconciled posting, on either side of a
 * transfer, or came from a linked bank. Render `dialog` once beside what calls `request`.
 */
export const useDeleteTransactions = (book: string) => {
  const { format, formatDay } = useBook();
  const queryClient = useQueryClient();
  const remove = useBookMutation(book, "delete_transactions");
  const merge = useBookMutation(book, "merge_transactions");
  const [pending, setPending] = useState<Pending | null>(null);
  const [open, setOpen] = useState(false);

  const findHandEnteredCopy = async (
    line: BankPosting,
    selected: ReadonlyArray<Transaction>,
  ): Promise<HandEnteredCopy | null> => {
    const sameLine = (transaction: Transaction) =>
      transaction.id !== line.transaction.id &&
      transaction.postings.some(
        (posting) =>
          posting.accountId === line.account &&
          posting.amount === line.amount &&
          posting.importedId === null,
      );
    const copyOf = (transaction: Transaction): HandEnteredCopy => ({
      keep: transaction.id,
      drop: line.transaction.id,
      payee: transaction.payee,
      date: transaction.date,
    });
    if (selected.length === 2) {
      const other = selected.find(sameLine);
      return other === undefined ? null : copyOf(other);
    }
    const nearby = await run("list_transactions", {
      book,
      account: line.account,
      from: addDays(line.transaction.date, -COPY_DAYS),
      to: addDays(line.transaction.date, COPY_DAYS),
    });
    const candidates = await Promise.all(
      nearby.rows
        .filter((row) => row.amount === line.amount && row.transactionId !== line.transaction.id)
        .map((row) => run("get_transaction", { book, id: row.transactionId })),
    );
    const copy = candidates
      .filter(sameLine)
      .toSorted(
        (a, b) =>
          daysApart(a.date, line.transaction.date) - daysApart(b.date, line.transaction.date),
      )[0];
    return copy === undefined ? null : copyOf(copy);
  };

  const inspect = async (ids: ReadonlyArray<string>, onDone: (() => void) | undefined) => {
    const [transactions, status] = await Promise.all([
      Promise.all(ids.map((id) => run("get_transaction", { book, id }))),
      queryClient.fetchQuery(bookQuery(book, "bank_status", {})),
    ]);
    const links = new Map(status.links.map((link) => [link.account, link]));
    const lines: Array<BankPosting> = transactions.flatMap((transaction) =>
      transaction.postings
        .filter((posting) => posting.importedId !== null && links.has(posting.accountId))
        .map((posting) => ({
          transaction,
          account: posting.accountId,
          amount: posting.amount,
        })),
    );
    const gaps = [...Map.groupBy(lines, (line) => line.account)].map(([account, each]) => ({
      name: links.get(account)!.accountName,
      bank: links.get(account)!.bank,
      total: each.reduce((sum, line) => sum + line.amount, 0),
    }));
    const fromBank = new Set(lines.map((line) => line.transaction.id)).size;
    const reconciled = transactions.filter((each) =>
      each.postings.some((posting) => posting.reconciled),
    ).length;
    const copy =
      fromBank === 1 && lines.length === 1
        ? await findHandEnteredCopy(lines[0]!, transactions)
        : null;
    return { ids, reconciled, fromBank, gaps, copy, onDone };
  };

  const request = async (ids: ReadonlyArray<string>, onDone?: () => void) => {
    const found = await inspect(ids, onDone).catch((error: Error) => {
      showError(error);
      return null;
    });
    if (found === null) return;
    if (found.reconciled > 0 || found.fromBank > 0) {
      setPending(found);
      setOpen(true);
    } else remove.mutate({ ids: [...ids] }, onDone === undefined ? {} : { onSuccess: onDone });
  };

  const settle = () => {
    setOpen(false);
    pending?.onDone?.();
  };

  const confirm = () => {
    if (pending === null) return;
    remove.mutate(
      {
        ids: [...pending.ids],
        ...(pending.reconciled > 0 ? { confirmReconciled: true } : {}),
      },
      { onSuccess: settle },
    );
  };

  const mergeCopy = ({ keep, drop }: HandEnteredCopy) =>
    merge.mutate({ keep, drop }, { onSuccess: settle });

  const dialog = (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogPopup>
        {pending !== null && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{title(pending)}</AlertDialogTitle>
              {pending.fromBank > 0 && (
                <AlertDialogDescription>
                  {pending.ids.length === 1
                    ? `It came from ${pending.gaps[0]!.bank}, so deleting it does not undo the payment.`
                    : `${pending.fromBank} of the ${pending.ids.length} came from the bank, so deleting does not undo ${pending.fromBank === 1 ? "that payment" : "those payments"}.`}{" "}
                  {pending.gaps
                    .map((gap) => `${gap.name} will be ${format(-gap.total)} off the bank.`)
                    .join(" ")}
                </AlertDialogDescription>
              )}
              {pending.copy !== null && (
                <AlertDialogDescription>
                  It looks like {pending.copy.payee ?? "a transaction"} on{" "}
                  {formatDay(pending.copy.date)}, entered by hand. Merge them to keep yours with the
                  bank's line.
                </AlertDialogDescription>
              )}
              {pending.fromBank > 0 && (
                <AlertDialogDescription>
                  If {pending.fromBank === 1 ? "it is" : "they are"} in the wrong place, change the
                  category or make a transfer instead. Left out… in Settings → Banks brings a
                  deleted line back.
                </AlertDialogDescription>
              )}
              {pending.reconciled > 0 && (
                <AlertDialogDescription>
                  {pending.reconciled === 1
                    ? "One of these transactions is"
                    : `${pending.reconciled} of these transactions are`}{" "}
                  reconciled. Deleting changes a balance you already agreed with your statement.
                </AlertDialogDescription>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
              {pending.copy !== null && (
                <Button variant="outline" onClick={() => mergeCopy(pending.copy!)}>
                  Merge
                </Button>
              )}
              <Button variant="destructive" onClick={confirm}>
                Delete anyway
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogPopup>
    </AlertDialog>
  );

  return { request, dialog };
};

const title = ({ ids, reconciled, fromBank }: Pending) => {
  if (fromBank > 0)
    return ids.length === 1
      ? "Delete a transaction from the bank?"
      : `Delete ${ids.length} transactions?`;
  return `Delete ${reconciled === 1 ? "a reconciled transaction" : "reconciled transactions"}?`;
};

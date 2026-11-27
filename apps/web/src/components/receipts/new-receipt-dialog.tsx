import { today } from "@reeve/contract/rules";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Button } from "@reeve/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@reeve/ui/components/dialog";
import { Field, FieldLabel } from "@reeve/ui/components/field";
import { Input } from "@reeve/ui/components/input";
import { useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { StorePicker } from "./store-picker";

/** A transaction a new receipt starts from and is linked to. */
export interface ReceiptSource {
  readonly transactionId: string;
  readonly date: string;
  readonly payee: string | null;
  /** The register amount: negative for a payment. */
  readonly amount: number;
}

/** The store, day and total of a new receipt; the editor opens on it for the rest. */
export function NewReceiptDialog({
  open,
  onOpenChange,
  source,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source?: ReceiptSource | undefined;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        {open && <NewReceiptForm source={source} onDone={() => onOpenChange(false)} />}
      </DialogPopup>
    </Dialog>
  );
}

function NewReceiptForm({
  source,
  onDone,
}: {
  source: ReceiptSource | undefined;
  onDone: () => void;
}) {
  const { id: book, parse, format } = useBook();
  const create = useBookMutation(book, "create_receipt");
  const navigate = useNavigate();
  const [store, setStore] = useState(source?.payee ?? "");
  const [date, setDate] = useState(source?.date ?? today());
  const [total, setTotal] = useState(source === undefined ? "" : format(-source.amount));
  const parsed = parse(total);
  // A receipt's total is never zero, so a typed 0 is as wrong as a typed word.
  const amount = parsed === 0 ? null : parsed;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (amount === null) return;
    create.mutate(
      {
        date,
        total: amount,
        ...(store.trim() === "" ? {} : { payee: store.trim() }),
        ...(source === undefined ? {} : { payments: [{ transactionId: source.transactionId }] }),
      },
      {
        onSuccess: ({ receipt }) => {
          onDone();
          void navigate({ to: "/receipts/$receipt", params: { receipt: receipt.id } });
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle>New receipt</DialogTitle>
        <DialogDescription>
          {source === undefined
            ? "Start with the store, the day and what you paid; add the lines next."
            : "It starts from the transaction and pays it."}
        </DialogDescription>
      </DialogHeader>
      <DialogPanel className="grid gap-4">
        <Field>
          <FieldLabel>Store</FieldLabel>
          <StorePicker value={store} onChange={setStore} autoFocus className="w-full" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel>Date</FieldLabel>
            <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </Field>
          <Field>
            <FieldLabel>Total paid</FieldLabel>
            <Input
              inputMode="decimal"
              placeholder="0.00"
              value={total}
              aria-invalid={(total !== "" && amount === null) || undefined}
              onChange={(event) => setTotal(event.target.value)}
            />
          </Field>
        </div>
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" type="button" />}>Cancel</DialogClose>
        <Button type="submit" disabled={amount === null} loading={create.isPending}>
          Create receipt
        </Button>
      </DialogFooter>
    </form>
  );
}

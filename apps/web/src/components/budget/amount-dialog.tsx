import type { CategoryGroup } from "@reeve/contract";
import { useState, type FormEvent, type ReactNode } from "react";
import { CategorySelect } from "@/components/category-select";
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
import { useBook } from "@/lib/book";

export interface AmountRequest {
  readonly title: string;
  readonly description?: ReactNode;
  readonly submit: string;
  /** Prefilled amount, positive. */
  readonly amount?: number;
  /** Ask for a category too. */
  readonly category?: {
    readonly label: string;
    readonly toBudget?: boolean;
    readonly exclude?: string;
  };
  /** Ask for no amount: the whole of it is meant. */
  readonly noAmount?: boolean;
  readonly onSubmit: (value: { amount: number; category: string | null }) => void;
}

/** A small form for the budget's money moves: an amount, and a category when the move needs one. */
export function AmountDialog({
  request,
  groups,
  onClose,
}: {
  request: AmountRequest | null;
  groups: ReadonlyArray<CategoryGroup>;
  onClose: () => void;
}) {
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-sm">
        {request && (
          <AmountForm key={request.title} request={request} groups={groups} onClose={onClose} />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function AmountForm({
  request,
  groups,
  onClose,
}: {
  request: AmountRequest;
  groups: ReadonlyArray<CategoryGroup>;
  onClose: () => void;
}) {
  const { format, parse } = useBook();
  const [text, setText] = useState(request.amount === undefined ? "" : format(request.amount));
  const [category, setCategory] = useState<string | null>(null);
  const amount = request.noAmount ? 0 : parse(text);
  const ready =
    (request.noAmount || (amount !== null && amount > 0)) &&
    (request.category === undefined || category !== null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    request.onSubmit({ amount: amount ?? 0, category });
    onClose();
  };

  return (
    <form onSubmit={submit} className="contents">
      <DialogHeader>
        <DialogTitle>{request.title}</DialogTitle>
        {request.description && <DialogDescription>{request.description}</DialogDescription>}
      </DialogHeader>
      <DialogPanel className="grid gap-4">
        {!request.noAmount && (
          <Field>
            <FieldLabel>Amount</FieldLabel>
            <Input
              autoFocus
              inputMode="decimal"
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-invalid={(text !== "" && amount === null) || undefined}
            />
          </Field>
        )}
        {request.category && (
          <Field>
            <FieldLabel>{request.category.label}</FieldLabel>
            <CategorySelect
              groups={groups}
              value={category}
              onChange={setCategory}
              toBudget={request.category.toBudget === true}
              {...(request.category.exclude === undefined
                ? {}
                : { exclude: request.category.exclude })}
            />
          </Field>
        )}
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" type="button" />}>Cancel</DialogClose>
        <Button type="submit" disabled={!ready}>
          {request.submit}
        </Button>
      </DialogFooter>
    </form>
  );
}

import { UNITS, type Unit } from "@reeve/contract/receipts";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { ChoiceSelect } from "@/components/choice-select";
import { Button } from "@reeve/ui/components/button";
import {
  Dialog,
  DialogClose,
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
import { UNIT_LABELS } from "@/lib/receipts";

const UNIT_ITEMS = UNITS.map((unit) => ({ value: unit, label: UNIT_LABELS[unit] }));

/** A new product's name and the unit its prices are compared in; its page opens next. */
export function NewProductDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { id: book } = useBook();
  const create = useBookMutation(book, "create_product");
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<Unit>("piece");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === "") return;
    create.mutate(
      { name: name.trim(), unit },
      {
        onSuccess: (product) => {
          onOpenChange(false);
          setName("");
          void navigate({ to: "/products/$product", params: { product: product.id } });
        },
      },
    );
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-sm">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>New product</DialogTitle>
          </DialogHeader>
          <DialogPanel className="grid gap-4">
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel>Compare prices per</FieldLabel>
              <ChoiceSelect items={UNIT_ITEMS} value={unit} onChange={setUnit} />
            </Field>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" type="button" />}>Cancel</DialogClose>
            <Button type="submit" disabled={name.trim() === ""} loading={create.isPending}>
              Create product
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

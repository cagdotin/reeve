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
import { ChoiceSelect } from "@/components/choice-select";
import { useAppMutation } from "@/lib/api";

const TYPES = [
  { value: "envelope", label: "Envelope: budget the money you have" },
  { value: "tracking", label: "Tracking: plan income and spending" },
] as const;

export function BookDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const create = useAppMutation("create_book");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [budgetType, setBudgetType] = useState<"envelope" | "tracking">("envelope");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === "") return;
    create.mutate(
      { name: name.trim(), currency: currency.trim().toUpperCase() || "USD", budgetType },
      {
        onSuccess: (book) => {
          onOpenChange(false);
          onCreated(book.id);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>New book</DialogTitle>
            <DialogDescription>
              A book is one budget with its own accounts, in its own file.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="grid gap-4">
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel>Currency</FieldLabel>
              <Input value={currency} onChange={(event) => setCurrency(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel>Budget</FieldLabel>
              <ChoiceSelect items={TYPES} value={budgetType} onChange={setBudgetType} />
            </Field>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" type="button" />}>Cancel</DialogClose>
            <Button type="submit" disabled={name.trim() === ""} loading={create.isPending}>
              Create book
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

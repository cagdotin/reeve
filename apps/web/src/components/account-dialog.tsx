import { today } from "@reeve/contract/rules";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Button } from "@reeve/ui/components/button";
import { Checkbox } from "@reeve/ui/components/checkbox";
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
import { Label } from "@reeve/ui/components/label";
import { ChoiceSelect } from "@/components/choice-select";
import { useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";

const TYPES = [
  { value: "asset", label: "Asset: checking, savings, cash, investments" },
  { value: "liability", label: "Liability: credit card, loan, mortgage" },
] as const;

export function AccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { id: book, parse } = useBook();
  const create = useBookMutation(book, "create_account");
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [type, setType] = useState<"asset" | "liability">("asset");
  const [offBudget, setOffBudget] = useState(false);
  const [balance, setBalance] = useState("");
  const amount = balance.trim() === "" ? 0 : parse(balance);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === "" || amount === null) return;
    create.mutate(
      {
        name: name.trim(),
        type,
        onBudget: !offBudget,
        balance: amount,
        date: today(),
      },
      {
        onSuccess: (account) => {
          onOpenChange(false);
          setName("");
          setBalance("");
          void navigate({ to: "/accounts/$account", params: { account: account.id } });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Add account</DialogTitle>
            <DialogDescription>
              A starting balance is booked against opening balances; on a budget account it becomes
              money to budget.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="grid gap-4">
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel>Type</FieldLabel>
              <ChoiceSelect items={TYPES} value={type} onChange={setType} />
            </Field>
            <Field>
              <FieldLabel>Balance today</FieldLabel>
              <Input
                inputMode="decimal"
                placeholder={type === "liability" ? "-1,200.00 owed" : "0.00"}
                value={balance}
                aria-invalid={amount === null || undefined}
                onChange={(event) => setBalance(event.target.value)}
              />
            </Field>
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox checked={offBudget} onCheckedChange={setOffBudget} />
              Off budget: track its balance without budgeting it (investments, loans)
            </Label>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" type="button" />}>Cancel</DialogClose>
            <Button
              type="submit"
              disabled={name.trim() === "" || amount === null}
              loading={create.isPending}
            >
              Add account
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

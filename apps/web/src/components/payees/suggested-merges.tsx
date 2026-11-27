import type { Payee } from "@reeve/contract";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { PageAlert } from "@/components/page-alert";
import { Picker } from "@/components/picker";
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
import { Label } from "@reeve/ui/components/label";
import { Radio, RadioGroup } from "@reeve/ui/components/radio-group";
import { scopeInput, useAccountScope } from "@/lib/account-scope";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

/** Payees that look like one, offered for a merge in one click (docs/rules/bank.md). */
export function SuggestedMerges() {
  const { id: book } = useBook();
  const scope = useAccountScope();
  const groups =
    useQuery(bookQuery(book, "suggest_payee_merges", scopeInput(scope))).data?.groups ?? [];
  const everyone = useQuery(bookQuery(book, "list_payees", {})).data ?? [];
  const [open, setOpen] = useState(false);
  if (groups.length === 0 && !open) return null;
  return (
    <>
      {groups.length > 0 && (
        <PageAlert
          variant="info"
          title={`${plural(groups.length, "group")} of payees look like one`}
          action={
            <Button variant="ghost" onClick={() => setOpen(true)}>
              Review
            </Button>
          }
        >
          Merge each in one click, and later imports follow.
        </PageAlert>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Payees that look like one</DialogTitle>
            <DialogDescription>
              Their names start alike once numbers and punctuation are left out. Merging moves the
              transactions and rules to the payee you keep, and later imports under the other names
              land there too. Keep apart what is not one shop.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="grid grid-cols-1 gap-3">
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing left to review.</p>
            ) : (
              groups.map((group) => (
                <SuggestedGroup
                  key={group.map((payee) => payee.id).join(" ")}
                  group={group}
                  everyone={everyone}
                />
              ))
            )}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Done</DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}

/**
 * Where a group goes: into the payee anywhere in the book that has the typed name, or else into
 * the kept payee, renamed.
 */
const mergeTarget = (
  included: ReadonlyArray<Payee>,
  kept: Payee,
  everyone: ReadonlyArray<Payee>,
  text: string,
) => {
  const name = text.trim();
  const existing = everyone.find((payee) => payee.name.toLowerCase() === name.toLowerCase());
  const target = existing ?? kept;
  return {
    target,
    merge: included.filter((payee) => payee.id !== target.id).map((payee) => payee.id),
    rename: existing === undefined && name !== "" ? name : null,
    outside: existing !== undefined && !included.some((payee) => payee.id === existing.id),
  };
};

function SuggestedGroup({
  group,
  everyone,
}: {
  group: ReadonlyArray<Payee>;
  everyone: ReadonlyArray<Payee>;
}) {
  const { id: book } = useBook();
  const merge = useBookMutation(book, "merge_payees");
  const apart = useBookMutation(book, "keep_payees_apart");
  const [chosen, setKept] = useState<string | null>(null);
  const kept = group.find((payee) => payee.id === (chosen ?? group[0]!.id))!;
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? kept.name;
  const included = group.filter((payee) => payee.id === kept.id || !left.has(payee.id));
  const plan = mergeTarget(included, kept, everyone, text);
  const toggle = (id: string, isIncluded: boolean) => {
    const next = new Set(left);
    if (isIncluded) next.delete(id);
    else next.add(id);
    setLeft(next);
  };
  const keep = (id: string) => {
    setKept(id);
    setTyped(null);
  };

  return (
    <section
      aria-label={`Payees like ${kept.name}`}
      className="grid grid-cols-1 gap-2 rounded-lg border p-3"
    >
      <RadioGroup
        aria-label={`Payee to keep of ${kept.name}'s group`}
        value={kept.id}
        onValueChange={keep}
      >
        {group.map((payee) => (
          <div key={payee.id} className="flex items-center gap-2">
            <Checkbox
              aria-label={`Include ${payee.name}`}
              checked={payee.id === kept.id || !left.has(payee.id)}
              disabled={payee.id === kept.id}
              onCheckedChange={(checked) => toggle(payee.id, checked === true)}
            />
            <Label className="flex min-w-0 flex-1 items-center gap-2 font-normal">
              <Radio value={payee.id} aria-label={`Keep ${payee.name}`} />
              <span className="min-w-0 flex-1 truncate">{payee.name}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {plural(payee.transactionCount, "transaction")}
              </span>
            </Label>
          </div>
        ))}
      </RadioGroup>
      <div className="grid gap-1">
        <Picker
          label="Merge into"
          placeholder="A payee, or a new name"
          value={text}
          onChange={setTyped}
          groups={[
            {
              value: "",
              items: everyone.map((payee) => ({ value: payee.id, label: payee.name })),
            },
          ]}
        />
        <p className="text-xs text-muted-foreground">
          {plan.outside
            ? `All of them join ${plan.target.name}, a payee you already have.`
            : plan.rename !== null && plan.rename !== kept.name
              ? `${kept.name} is renamed ${plan.rename}.`
              : "Pick any payee, or type a new name."}
        </p>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="ghost"
          loading={apart.isPending}
          onClick={() => apart.mutate({ payees: group.map((payee) => payee.id) })}
        >
          Keep apart
        </Button>
        <Button
          variant="outline"
          disabled={plan.merge.length === 0 || text.trim() === ""}
          loading={merge.isPending}
          onClick={() =>
            merge.mutate({
              target: plan.target.id,
              merge: plan.merge,
              ...(plan.rename === null || plan.rename === plan.target.name
                ? {}
                : { name: plan.rename }),
              renameImports: true,
            })
          }
          className="max-w-full"
        >
          <span className="truncate">Merge into {plan.rename ?? plan.target.name}</span>
        </Button>
      </div>
    </section>
  );
}

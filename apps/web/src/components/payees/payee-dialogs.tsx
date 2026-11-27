import type { PayeeActivity } from "@reeve/contract";
import type { Rule } from "@reeve/contract/catalog";
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent, useId } from "react";
import { PaneActions } from "@/components/pane-form";
import { PaneFooter, SplitPanel, usePaneLeave, usePaneTask } from "@/components/split-panel";
import { Picker } from "@/components/picker";
import { useChoices } from "@/components/reports/choices";
import { PayeeRules } from "@/components/rules/related-rules";
import { RuleEditor } from "@/components/rules/rule-editor";
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
import { Label } from "@reeve/ui/components/label";
import { Radio, RadioGroup } from "@reeve/ui/components/radio-group";
import { Switch } from "@reeve/ui/components/switch";
import { Textarea } from "@reeve/ui/components/textarea";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { draftForPayee } from "@/lib/rules";

export type PayeeRequest =
  | { readonly kind: "create" }
  | { readonly kind: "edit"; readonly payee: PayeeActivity }
  | { readonly kind: "rule"; readonly rule: Partial<Rule>; readonly back: PayeeActivity }
  | { readonly kind: "merge"; readonly payees: ReadonlyArray<PayeeActivity> }
  | { readonly kind: "delete"; readonly payees: ReadonlyArray<PayeeActivity> };

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

/**
 * How many transactions name each payee across the book. Under an account scope a row counts only
 * that scope's, but a rename, merge or delete reaches every account.
 */
const useBookCounts = () => {
  const { id: book } = useBook();
  const payees = useQuery(bookQuery(book, "list_payees", {})).data;
  const counts = new Map(payees?.map((each) => [each.id, each.transactionCount]));
  return {
    payees: payees ?? [],
    count: (payee: PayeeActivity) => counts.get(payee.id) ?? payee.transactionCount,
  };
};

/** `onCreated` hears the name of a payee just made. */
export function PayeeDialogs({
  request,
  onRequest,
  onClose,
  onCreated,
}: {
  request: PayeeRequest | null;
  onRequest: (request: PayeeRequest) => void;
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const leave = usePaneLeave();
  const { payees } = useBookCounts();
  if (request === null) return null;
  if (request.kind === "rule")
    return (
      <PayeeRulePane
        rule={request.rule}
        onBack={() => onRequest({ kind: "edit", payee: request.back })}
      />
    );
  if (request.kind === "create" || request.kind === "edit") {
    const opened = request.kind === "edit" ? request.payee : null;
    // Saving a rule from the panel may have just turned learning off.
    const learns = payees.find((each) => each.id === opened?.id)?.learnCategories;
    const payee =
      opened === null || learns === undefined ? opened : { ...opened, learnCategories: learns };
    const openRule = (rule: Partial<Rule>) =>
      payee !== null && leave(() => onRequest({ kind: "rule", rule, back: payee }));
    return (
      <SplitPanel title={payee === null ? "New payee" : `Edit ${payee.name}`} onClose={onClose}>
        <div className="grid gap-6">
          <PayeeForm
            // A rule that names the payee can turn its learning off from another pane.
            key={payee === null ? "new" : `${payee.id}:${payee.learnCategories}`}
            payee={payee}
            onDone={onClose}
            onCreated={onCreated}
          />
          {payee !== null && (
            <PayeeRules
              payee={payee.id}
              learns={payee.learnCategories}
              onOpen={openRule}
              onAdd={() => openRule(draftForPayee(payee.id, null))}
            />
          )}
        </div>
      </SplitPanel>
    );
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-md">
        {request.kind === "merge" ? (
          <MergeForm payees={request.payees} onDone={onClose} />
        ) : (
          <DeleteForm payees={request.payees} onDone={onClose} />
        )}
      </DialogPopup>
    </Dialog>
  );
}

function PayeeRulePane({ rule, onBack }: { rule: Partial<Rule>; onBack: () => void }) {
  const { id: book } = useBook();
  const { names, choices } = useChoices(book);
  const rules = useQuery(bookQuery(book, "list_rules", {})).data;
  return (
    <RuleEditor
      rule={rule}
      open
      onOpenChange={(open) => !open && onBack()}
      choices={choices}
      names={names}
      rules={rules ?? []}
    />
  );
}

/** Whether a rename or merge also sends what later imports call the payee to the one kept. */
function FollowImports({
  id,
  checked,
  onChange,
  name,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  name: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="grid gap-1">
        <Label htmlFor={id}>Send later imports to {name || "it"}</Label>
        <p className="text-xs text-muted-foreground">
          Lines from the bank or a file that came in under the old names land on {name || "it"} too,
          through a rename rule.
        </p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

interface PayeeFields {
  readonly name: string;
  readonly description: string;
  readonly learn: boolean;
}

const payeeFields = (payee: PayeeActivity | null): PayeeFields => ({
  name: payee?.name ?? "",
  description: payee?.description ?? "",
  learn: payee?.learnCategories ?? true,
});

/** Creates the payee or saves it; with `merging`, an edited payee named as another merges into it. */
function useSavePayee(payee: PayeeActivity | null, onCreated: (name: string) => void) {
  const { id: book } = useBook();
  const create = useBookMutation(book, "create_payee", { quiet: true });
  const update = useBookMutation(book, "update_payee", { quiet: true });
  const merge = useBookMutation(book, "merge_payees", { quiet: true });
  const pending = create.isPending || update.isPending || merge.isPending;
  const save = async (
    { name, description, learn }: PayeeFields,
    taken: { id: string; name: string } | undefined,
    merging: boolean,
    renameImports: boolean,
  ) => {
    if (name === "") throw new Error("A payee needs a name.");
    if (payee !== null && taken !== undefined && merging)
      return merge.mutateAsync({ target: taken.id, merge: [payee.id], renameImports });
    if (payee !== null && taken !== undefined)
      throw new Error(`Merging into ${taken.name} takes its own button in the form.`);
    if (taken !== undefined) throw new Error(`There is already a payee named ${taken.name}.`);
    if (payee !== null)
      return update.mutateAsync({
        id: payee.id,
        name,
        description,
        learnCategories: learn,
        ...(name === payee.name ? {} : { renameImports }),
      });
    await create.mutateAsync({ name, description });
    onCreated(name);
  };
  return { save, pending };
}

function NameHint({
  payee,
  taken,
  transactions,
}: {
  payee: PayeeActivity | null;
  taken: { name: string } | undefined;
  transactions: number;
}) {
  if (taken !== undefined)
    return (
      <output className="text-xs text-muted-foreground">
        {payee === null
          ? `There is already a payee named ${taken.name}.`
          : `There is already a payee named ${taken.name}. Merging moves ${payee.name}'s ${plural(transactions, "transaction")} on every account, and its rules, there.`}
      </output>
    );
  if (payee === null) return null;
  return (
    <p className="text-xs text-muted-foreground">
      A payee is shared by every account: its name and description change on all{" "}
      {plural(transactions, "transaction")} that name it.
    </p>
  );
}

function PayeeForm({
  payee,
  onDone,
  onCreated,
}: {
  payee: PayeeActivity | null;
  onDone: () => void;
  onCreated: (name: string) => void;
}) {
  const { payees, count } = useBookCounts();
  const { save, pending } = useSavePayee(payee, onCreated);
  const [name, setName] = useState(payee?.name ?? "");
  const [description, setDescription] = useState(payee?.description ?? "");
  const [learn, setLearn] = useState(payee?.learnCategories ?? true);
  const [follow, setFollow] = useState(true);
  const trimmed = name.trim();
  const renaming = payee !== null && trimmed !== "" && trimmed !== payee.name;
  const taken = payees.find(
    (each) => each.id !== payee?.id && each.name.toLowerCase() === trimmed.toLowerCase(),
  );
  const formId = useId();
  const task = usePaneTask({
    dirty: JSON.stringify({ name, description, learn }) !== JSON.stringify(payeeFields(payee)),
    save: () => save({ name: trimmed, description, learn }, taken, false, follow),
    done: onDone,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    task.submit(() => save({ name: trimmed, description, learn }, taken, true, follow));
  };

  return (
    <form id={formId} onSubmit={submit} className="grid gap-4">
      <div className="grid gap-4">
        <Field>
          <FieldLabel>Name</FieldLabel>
          <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
          <NameHint payee={payee} taken={taken} transactions={payee === null ? 0 : count(payee)} />
        </Field>
        {renaming && (
          <FollowImports
            id="payee-follow"
            checked={follow}
            onChange={setFollow}
            name={taken?.name ?? trimmed}
          />
        )}
        <Field>
          <FieldLabel>Description</FieldLabel>
          <Textarea
            aria-label="Description"
            placeholder="Who this is, for you and your agents"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        {payee !== null && (
          <div className="flex items-start justify-between gap-4">
            <div className="grid gap-1">
              <Label htmlFor="payee-learn">Keep its category rule up to date</Label>
              <p className="text-xs text-muted-foreground">
                When 3 of its last 5 transactions share a category, reeve makes or updates its rule.
                Off, the rule stays as it is and keeps applying.
              </p>
            </div>
            <Switch id="payee-learn" checked={learn} onCheckedChange={setLearn} />
          </div>
        )}
      </div>
      <PaneFooter>
        <PaneActions>
          <Button variant="ghost" type="button" onClick={task.cancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            disabled={trimmed === "" || (payee === null && taken !== undefined)}
            loading={pending || task.saving}
          >
            {payee === null ? "Create" : taken !== undefined ? `Merge into ${taken.name}` : "Save"}
          </Button>
        </PaneActions>
      </PaneFooter>
    </form>
  );
}

/** Several payees: choose which stays. One payee: name any other to merge it into. */
function MergeForm({
  payees,
  onDone,
}: {
  payees: ReadonlyArray<PayeeActivity>;
  onDone: () => void;
}) {
  const { id: book } = useBook();
  const { payees: all, count } = useBookCounts();
  const merge = useBookMutation(book, "merge_payees");
  const ranked = payees.toSorted((a, b) => count(b) - count(a));
  const [kept, setKept] = useState(ranked[0]?.id ?? "");
  const [named, setNamed] = useState("");
  const [follow, setFollow] = useState(true);
  const single = payees.length === 1 ? payees[0] : undefined;
  const target =
    single === undefined
      ? kept
      : all.find(
          (each) => each.id !== single.id && each.name.toLowerCase() === named.trim().toLowerCase(),
        )?.id;
  const moved = payees.reduce((sum, each) => sum + (each.id === target ? 0 : count(each)), 0);

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {single === undefined ? `Merge ${payees.length} payees` : `Merge ${single.name}`}
        </DialogTitle>
        <DialogDescription>
          {plural(moved, "transaction")} on every account, and any rules naming the others, move to
          the payee you keep. The others are deleted.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        {single === undefined ? (
          <RadioGroup aria-label="Payee to keep" value={kept} onValueChange={setKept}>
            {ranked.map((payee) => (
              <Label key={payee.id} className="flex items-center gap-2 font-normal">
                <Radio value={payee.id} />
                <span className="min-w-0 flex-1 truncate">{payee.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {plural(count(payee), "transaction")}
                </span>
              </Label>
            ))}
          </RadioGroup>
        ) : (
          <Picker
            autoFocus
            label="Merge into"
            placeholder="Merge into…"
            value={named}
            onChange={setNamed}
            groups={[
              {
                value: "",
                items: all
                  .filter((each) => each.id !== single.id)
                  .map((each) => ({ value: each.id, label: each.name })),
              },
            ]}
          />
        )}
        <div className="mt-4">
          <FollowImports
            id="merge-follow"
            checked={follow}
            onChange={setFollow}
            name={all.find((each) => each.id === target)?.name ?? ""}
          />
        </div>
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button
          variant="destructive"
          disabled={target === undefined}
          loading={merge.isPending}
          onClick={() =>
            target !== undefined &&
            merge.mutate(
              {
                target,
                merge: payees.map((each) => each.id).filter((id) => id !== target),
                renameImports: follow,
              },
              { onSuccess: onDone },
            )
          }
        >
          Merge
        </Button>
      </DialogFooter>
    </>
  );
}

function DeleteForm({
  payees,
  onDone,
}: {
  payees: ReadonlyArray<PayeeActivity>;
  onDone: () => void;
}) {
  const { id: book } = useBook();
  const remove = useBookMutation(book, "delete_payees");
  const { count } = useBookCounts();
  const blocked = payees.filter((each) => each.scheduled);
  const transactions = payees.reduce((sum, each) => sum + count(each), 0);
  const rules = payees.reduce((sum, each) => sum + each.ruleCount, 0);
  const [only] = payees;
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Delete {payees.length === 1 ? only?.name : `${payees.length} payees`}?
        </DialogTitle>
        <DialogDescription>
          {blocked.length > 0
            ? `${blocked.map((each) => each.name).join(", ")} ${blocked.length === 1 ? "is" : "are"} used by a schedule. Change the schedule first.`
            : `${plural(transactions, "transaction")} on every account will have no payee.${
                rules > 0
                  ? ` ${plural(rules, "rule")} naming ${payees.length === 1 ? "it" : "them"} will be deleted, or lose ${payees.length === 1 ? "it" : "them"} from a list of payees.`
                  : ""
              } You can undo this.`}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button
          variant="destructive"
          disabled={blocked.length > 0}
          loading={remove.isPending}
          onClick={() =>
            remove.mutate({ ids: payees.map((each) => each.id) }, { onSuccess: onDone })
          }
        >
          Delete
        </Button>
      </DialogFooter>
    </>
  );
}

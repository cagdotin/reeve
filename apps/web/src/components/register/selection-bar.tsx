import { ArrowLeftRightIcon, CheckIcon, MergeIcon, TagIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { CategorySelect } from "@/components/category-select";
import { useDeleteTransactions } from "@/components/register/delete-transactions";
import { PaneFooter, SplitPanel, usePaneTask } from "@/components/split-panel";
import { Button } from "@reeve/ui/components/button";
import { useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { type Selection, selectionInput } from "@/lib/register";

/** What can be done to the selected transactions. */
export function SelectionBar({
  ids,
  account,
  onCategorize,
  onClear,
}: {
  ids: ReadonlyArray<string>;
  account: string | undefined;
  onCategorize: () => void;
  onClear: () => void;
}) {
  const { id: book } = useBook();
  const remove = useDeleteTransactions(book);
  const bulk = useBookMutation(book, "update_transactions");
  const merge = useBookMutation(book, "merge_transactions");
  const makeTransfer = useBookMutation(book, "make_transfer");
  return (
    <>
      <span className="px-2 text-[13px] font-medium">{ids.length} selected</span>
      <Button variant="ghost" onClick={onCategorize}>
        <TagIcon />
        Categorize
      </Button>
      {account !== undefined && (
        <Button
          variant="ghost"
          onClick={() => bulk.mutate({ ids: [...ids], account, cleared: true })}
        >
          Mark cleared
        </Button>
      )}
      {ids.length === 2 && (
        <Button
          variant="ghost"
          title="Keep the first selected, merging the second into it"
          onClick={() => merge.mutate({ keep: ids[0]!, drop: ids[1]! }, { onSuccess: onClear })}
        >
          <MergeIcon />
          Merge
        </Button>
      )}
      {ids.length === 2 && account === undefined && (
        <Button
          variant="ghost"
          title="Join two sides of one movement between accounts into one transfer"
          onClick={() =>
            makeTransfer.mutate({ from: ids[0]!, to: ids[1]! }, { onSuccess: onClear })
          }
        >
          <ArrowLeftRightIcon />
          Make transfer
        </Button>
      )}
      <Button
        variant="ghost"
        className="text-destructive-foreground"
        onClick={() => void remove.request(ids, onClear)}
      >
        <Trash2Icon />
        Delete
      </Button>
      <Button variant="ghost" className="ms-auto" onClick={onClear}>
        Clear selection
      </Button>
      {remove.dialog}
    </>
  );
}

/** Sets one category on every selected transaction in one write, so one undo. */
export function SelectionPane({
  selection,
  groups,
  onSaved,
  onClose,
}: {
  selection: Selection;
  groups: Parameters<typeof CategorySelect>[0]["groups"];
  onSaved: () => void;
  onClose: () => void;
}) {
  const count = selection.size;
  return (
    <SplitPanel
      title={`Categorize ${count} ${count === 1 ? "transaction" : "transactions"}`}
      onClose={onClose}
    >
      <SelectionCategory selection={selection} groups={groups} onSaved={onSaved} />
    </SplitPanel>
  );
}

function SelectionCategory({
  selection,
  groups,
  onSaved,
}: {
  selection: Selection;
  groups: Parameters<typeof CategorySelect>[0]["groups"];
  onSaved: () => void;
}) {
  const { id: book } = useBook();
  const bulk = useBookMutation(book, "update_transactions", { quiet: true });
  const [category, setCategory] = useState<string | null>(null);
  const task = usePaneTask({
    dirty: category !== null,
    save: () => bulk.mutateAsync({ ...selectionInput(selection), category }),
    done: onSaved,
  });
  return (
    <>
      <CategorySelect groups={groups} value={category} onChange={setCategory} income />
      <PaneFooter>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={task.cancel}>
            Cancel
          </Button>
          <Button disabled={category === null} loading={task.saving} onClick={() => task.submit()}>
            <CheckIcon />
            Save
          </Button>
        </div>
      </PaneFooter>
    </>
  );
}

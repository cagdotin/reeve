import type { DiscoveredSchedule } from "@reeve/contract/catalog";
import { PlusIcon, XIcon } from "lucide-react";
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
import { useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { displayName, foundKey, type Row } from "@/lib/schedules";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** What deleting does: the schedule and its rule go, its transactions stay. */
export function DeleteSchedule({
  schedule,
  onClose,
}: {
  schedule: Row | null;
  onClose: () => void;
}) {
  const { id: book } = useBook();
  const remove = useBookMutation(book, "delete_schedule");
  return (
    <Dialog open={schedule !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-md">
        {schedule !== null && (
          <>
            <DialogHeader>
              <DialogTitle>Delete {displayName(schedule)}?</DialogTitle>
              <DialogDescription>
                The schedule and the rule behind it are deleted, so new transactions stop being
                linked to it
                {schedule.categoryId === null && schedule.notes === null
                  ? "."
                  : " or getting its category and notes."}{" "}
                {schedule.linkedTransactions === 0
                  ? "No transaction is linked to it."
                  : `${plural(schedule.linkedTransactions, "linked transaction")} stay in your accounts as they are.`}{" "}
                To keep its history without its coming dates, complete it instead. You can undo
                this.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
              <Button
                variant="destructive"
                loading={remove.isPending}
                onClick={() => remove.mutate({ id: schedule.id }, { onSuccess: onClose })}
              >
                Delete
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogPopup>
    </Dialog>
  );
}

/** Repeating transactions with no schedule yet; picking one opens the editor filled in. */
export function AllFound({
  found,
  dismissed,
  open,
  onOpenChange,
  onPick,
  onDismiss,
  onRestore,
}: {
  found: ReadonlyArray<DiscoveredSchedule>;
  /** How many this browser hides. */
  dismissed: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (found: DiscoveredSchedule) => void;
  onDismiss: (found: DiscoveredSchedule) => void;
  onRestore: () => void;
}) {
  const { format } = useBook();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Found in your history</DialogTitle>
          <DialogDescription>
            Transactions that repeat, with no schedule yet. Pick one to make it a schedule.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {found.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted-foreground">
              Nothing new repeats.
            </p>
          ) : (
            <div className="divide-y rounded-lg border">
              {found.map((each) => (
                <div key={foundKey(each)} className="flex items-center hover:bg-muted/40">
                  <button
                    type="button"
                    aria-label={`Make a schedule for ${each.payee ?? "no payee"}, ${format(Math.abs(each.amount))}`}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2 text-left text-[13px]"
                    onClick={() => onPick(each)}
                  >
                    <PlusIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{each.payee ?? "No payee"}</span>
                    <span className="w-32 truncate text-muted-foreground max-md:hidden">
                      {each.account}
                    </span>
                    <span className="w-48 truncate text-muted-foreground max-md:hidden">
                      {each.description}
                    </span>
                    <span className="w-24 text-right tabular-nums">
                      {each.amount > 0 ? "+" : ""}
                      {format(Math.abs(each.amount))}
                    </span>
                  </button>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Hide ${each.payee ?? "no payee"}`}
                    title="Not a schedule. Hides it on this computer."
                    className="me-2 text-muted-foreground"
                    onClick={() => onDismiss(each)}
                  >
                    <XIcon />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogPanel>
        <DialogFooter>
          {dismissed > 0 && (
            <Button variant="ghost" onClick={onRestore}>
              Show {dismissed} hidden
            </Button>
          )}
          <DialogClose render={<Button variant="ghost" />}>Close</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

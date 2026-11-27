import { useNavigate } from "@tanstack/react-router";
import { Button } from "@reeve/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@reeve/ui/components/dialog";
import { useLeavingMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { deleteConsequences, type DeleteTarget } from "@/lib/receipt-pages";

/** Says what deleting does before it does it; `leave` goes back to the list from the receipt. */
export function DeleteReceiptDialog({
  target,
  leave = false,
  onClose,
}: {
  target: DeleteTarget | null;
  leave?: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-md">
        {target !== null && <DeleteForm target={target} leave={leave} onDone={onClose} />}
      </DialogPopup>
    </Dialog>
  );
}

function DeleteForm({
  target,
  leave,
  onDone,
}: {
  target: DeleteTarget;
  leave: boolean;
  onDone: () => void;
}) {
  const { id: book, formatDay } = useBook();
  const navigate = useNavigate();
  const remove = useLeavingMutation(book, "delete_receipt", async () => {
    if (leave) await navigate({ to: "/receipts" });
  });
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          Delete the receipt from {target.payee ?? "no store"}, {formatDay(target.date)}?
        </DialogTitle>
        <DialogDescription render={<div className="grid gap-2" />}>
          {deleteConsequences(target).map((each) => (
            <p key={each}>{each}</p>
          ))}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
        <Button
          variant="destructive"
          loading={remove.isPending}
          onClick={() => remove.mutate({ id: target.id }, { onSuccess: onDone })}
        >
          Delete receipt
        </Button>
      </DialogFooter>
    </>
  );
}

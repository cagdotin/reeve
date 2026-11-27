import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
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
import { bookQuery, showError, useBookMutation, useLeavingMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { deleteConsequences, deleteFacts } from "@/lib/products";

export interface DeleteSource {
  readonly id: string;
  readonly name: string;
}

/** Asks before deleting products, saying what becomes of their lines, aliases and kinds. */
export function DeleteDialog({
  products,
  open,
  leaving = false,
  onOpenChange,
}: {
  products: ReadonlyArray<DeleteSource>;
  open: boolean;
  /** The page shows this product, so it leaves first. */
  leaving?: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {
    id: book,
    book: { settings },
  } = useBook();
  const navigate = useNavigate();
  const aliases = useQuery({ ...bookQuery(book, "list_aliases", {}), enabled: open }).data ?? [];
  const everything = useQuery({ ...bookQuery(book, "product_activity", {}), enabled: open }).data;
  const categories =
    useQuery({ ...bookQuery(book, "list_item_categories", {}), enabled: open }).data ?? [];
  const stay = useBookMutation(book, "delete_product");
  const leave = useLeavingMutation(book, "delete_product", () => navigate({ to: "/products" }));
  const [pending, setPending] = useState(false);
  const ids = new Set(products.map((each) => each.id));
  const [only] = products;
  const consequences =
    everything === undefined
      ? []
      : deleteConsequences({
          ...deleteFacts(
            everything.products,
            products.map((each) => each.id),
            new Map(categories.map((each) => [each.id, each.name])),
          ),
          aliases: aliases.filter((alias) => ids.has(alias.productId)).length,
          autoApply: settings.autoApplyReceipts,
        });
  const remove = async () => {
    setPending(true);
    try {
      if (leaving && only !== undefined) await leave.mutateAsync({ id: only.id });
      else await Promise.all(products.map((product) => stay.mutateAsync({ id: product.id })));
      onOpenChange(false);
    } catch (error) {
      showError(error as Error);
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Delete {products.length === 1 ? only?.name : `${products.length} products`}?
          </DialogTitle>
          <DialogDescription>
            {products.length > 1 && "Each is its own step to undo. "}
            To keep the history but stop offering {products.length === 1 ? "it" : "them"}, archive{" "}
            {products.length === 1 ? "it" : "them"} instead.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <ul className="grid list-disc gap-1.5 ps-4 text-[13px]">
            {consequences.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            loading={pending}
            disabled={everything === undefined}
            onClick={() => void remove()}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

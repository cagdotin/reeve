import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { Unit } from "@reeve/contract/receipts";
import { useState } from "react";
import { ChoiceSelect } from "@/components/choice-select";
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
import { bookQuery, useLeavingMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { mergeClash, withKinds } from "@/lib/products";
import { UNIT_LABELS } from "@/lib/receipts";

export interface MergeSource {
  readonly id: string;
  readonly name: string;
  readonly unit: Unit;
}

/**
 * Merges products into another: their lines, aliases and kinds move there. One product picks any
 * other, not one under it; several pick which of them stays, or any other.
 */
export function MergeDialog({
  products,
  open,
  onOpenChange,
}: {
  products: ReadonlyArray<MergeSource>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { id: book } = useBook();
  const navigate = useNavigate();
  const list = useQuery({
    ...bookQuery(book, "list_products", { limit: 500 }),
    enabled: open,
  });
  const merge = useLeavingMutation(book, "merge_products", ({ target }) =>
    navigate({ to: "/products/$product", params: { product: target } }),
  );
  const [target, setTarget] = useState<string | null>(null);
  const all = list.data?.products ?? [];
  const blocked = new Set(
    products.length === 1 && products[0] !== undefined ? withKinds(all, products[0].id) : [],
  );
  const selected = new Set(products.map((each) => each.id));
  const items = [
    ...(products.length > 1 ? products.map((each) => ({ value: each.id, label: each.name })) : []),
    ...all
      .filter((each) => !selected.has(each.id) && !blocked.has(each.id))
      .map((each) => ({ value: each.id, label: each.name })),
  ];
  const others = products.filter((each) => each.id !== target);
  const names = others.map((each) => each.name).join(", ");
  const chosen = all.find((each) => each.id === target);
  const clash =
    chosen !== undefined &&
    mergeClash(
      others.map((each) => each.unit),
      chosen.unit,
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            Merge {products.length === 1 ? products[0]?.name : `${products.length} products`}
          </DialogTitle>
          <DialogDescription>
            {products.length === 1
              ? `Its purchases, aliases and the products under it move to the product you pick, and ${names} is deleted.`
              : "Their purchases, aliases and the products under them move to the one you pick, and the others are deleted."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="grid gap-2">
          <ChoiceSelect
            items={items}
            value={target}
            onChange={setTarget}
            placeholder="Merge into…"
          />
          {clash && (
            <p className="text-xs text-muted-foreground">
              {chosen.name} compares prices per {UNIT_LABELS[chosen.unit]}, a different kind of
              unit. Lines it cannot measure keep their amounts but have no unit price.
            </p>
          )}
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            disabled={target === null}
            loading={merge.isPending}
            onClick={() =>
              target !== null &&
              merge.mutate(
                { target, merge: others.map((each) => each.id) },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            Merge
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

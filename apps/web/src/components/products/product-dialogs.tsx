import type { ItemCategory, ProductActivity } from "@reeve/contract/catalog";
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
import { showError, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { itemCategoryItems } from "@/lib/receipts";
import { DeleteDialog } from "./delete-dialog";
import { MergeDialog } from "./merge-dialog";

const NONE = "none";

export interface ProductRequest {
  readonly kind: "merge" | "delete" | "category";
  readonly products: ReadonlyArray<ProductActivity>;
}

/** What a row's menu or the selection asks of its products. */
export function ProductDialogs({
  request,
  categories,
  onClose,
  onDone,
}: {
  request: ProductRequest | null;
  categories: ReadonlyArray<ItemCategory>;
  /** Called for a cancel as well; the selection stays until `onDone`. */
  onClose: () => void;
  onDone: () => void;
}) {
  const close = (open: boolean) => {
    if (!open) onClose();
  };
  if (request === null) return null;
  if (request.kind === "merge")
    return <MergeDialog products={request.products} open onOpenChange={close} />;
  if (request.kind === "delete")
    return <DeleteDialog products={request.products} open onOpenChange={close} />;
  return (
    <CategoryDialog
      products={request.products}
      categories={categories}
      onOpenChange={close}
      onDone={onDone}
    />
  );
}

function CategoryDialog({
  products,
  categories,
  onOpenChange,
  onDone,
}: {
  products: ReadonlyArray<ProductActivity>;
  categories: ReadonlyArray<ItemCategory>;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const { id: book } = useBook();
  const update = useBookMutation(book, "update_product");
  const [category, setCategory] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const apply = async () => {
    setPending(true);
    try {
      await Promise.all(
        products.map((product) =>
          update.mutateAsync({
            id: product.id,
            itemCategoryId: category === NONE ? null : category,
          }),
        ),
      );
      onDone();
      onOpenChange(false);
    } catch (error) {
      showError(error as Error);
    } finally {
      setPending(false);
    }
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            Item category of{" "}
            {products.length === 1 ? products[0]?.name : `${products.length} products`}
          </DialogTitle>
          <DialogDescription>
            Their kinds and lines without one of their own take it too.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <ChoiceSelect
            items={[{ value: NONE, label: "None" }, ...itemCategoryItems(categories)]}
            value={category}
            onChange={setCategory}
            placeholder="Item category…"
          />
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button disabled={category === null} loading={pending} onClick={() => void apply()}>
            Set
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

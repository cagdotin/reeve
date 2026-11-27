import type { ItemCategory, Product } from "@reeve/contract/catalog";
import { Link } from "@tanstack/react-router";
import { PencilIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { InsightCard } from "@/components/insights/insight-card";
import { Button } from "@reeve/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@reeve/ui/components/dialog";
import { displayUnit, UNIT_LABELS } from "@/lib/receipts";
import { ProductForm } from "./product-form";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-2 px-1.5 py-1 text-[13px]">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  );
}

const None = () => <span className="text-muted-foreground">None</span>;

/** The product's fields at a glance, edited in a dialog so they do not lead the page. */
export function ProductPanel({
  product,
  categories,
  parent,
}: {
  product: Product;
  categories: ReadonlyArray<ItemCategory>;
  parent: { readonly id: string; readonly name: string } | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const name = (id: string | null) => categories.find((each) => each.id === id)?.name;
  const category = name(product.effectiveItemCategoryId);
  const inherited = product.itemCategoryId === null && category !== undefined;
  return (
    <>
      <InsightCard
        title="Details"
        aside={
          <Button variant="ghost" onClick={() => setEditing(true)}>
            <PencilIcon />
            Edit…
          </Button>
        }
      >
        <dl className="grid">
          <Fact label="Item category">
            {category ?? <None />}
            {inherited && (
              <span className="ms-1 text-xs text-muted-foreground">from its parent</span>
            )}
          </Fact>
          <Fact label="A kind of">
            {parent === undefined ? (
              <None />
            ) : (
              <Link
                to="/products/$product"
                params={{ product: parent.id }}
                className="hover:underline"
              >
                {parent.name}
              </Link>
            )}
          </Fact>
          <Fact label="Prices per">{displayUnit(product.unit).label}</Fact>
          <Fact label="One piece holds">
            {product.size === null || product.sizeUnit === null ? (
              <None />
            ) : (
              `${product.size} ${UNIT_LABELS[product.sizeUnit]}`
            )}
          </Fact>
          <Fact label="Notes">
            <span title={product.notes ?? undefined}>{product.notes ?? <None />}</span>
          </Fact>
          {product.archived && <Fact label="Status">Archived</Fact>}
        </dl>
      </InsightCard>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit {product.name}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <ProductForm product={product} itemCategories={categories} />
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Done</DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}

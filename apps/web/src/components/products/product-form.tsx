import type { ItemCategory, Product } from "@reeve/contract/catalog";
import { UNITS, type Unit } from "@reeve/contract/receipts";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ChoiceSelect } from "@/components/choice-select";
import { CellInput } from "@/components/receipts/cell-input";
import { UnitSelect } from "@/components/receipts/line-selects";
import { Input } from "@reeve/ui/components/input";
import { type Input as OperationInput, bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { withKinds } from "@/lib/products";
import { itemCategoryItems, parseQuantity, UNIT_LABELS } from "@/lib/receipts";

const NONE = "none";
const UNIT_ITEMS = UNITS.map((unit) => ({ value: unit, label: UNIT_LABELS[unit] }));

type ProductChange = Omit<OperationInput<"update_product">, "book" | "id">;

/** A product's name, generic parent, item category, unit and size; each saves as it changes. */
export function ProductForm({
  product,
  itemCategories,
}: {
  product: Product;
  itemCategories: ReadonlyArray<ItemCategory>;
}) {
  const { id: book } = useBook();
  const update = useBookMutation(book, "update_product");
  const others = useQuery(bookQuery(book, "list_products", { limit: 500 })).data?.products ?? [];
  const save = (change: ProductChange) => update.mutate({ id: product.id, ...change });
  const under = withKinds(others, product.id);
  const parents = others
    .filter((each) => !under.has(each.id))
    .map((each) => ({ value: each.id, label: each.name }));

  return (
    <section className="grid gap-3 sm:grid-cols-2">
      <Labelled label="Name">
        <CellInput
          label="Name"
          className="border-input"
          value={product.name}
          onCommit={(name) => name.trim() !== "" && save({ name: name.trim() })}
        />
      </Labelled>
      <Labelled label="A kind of">
        <ChoiceSelect
          items={[{ value: NONE, label: "Nothing more generic" }, ...parents]}
          value={product.parentId ?? NONE}
          onChange={(parentId) => save({ parentId: parentId === NONE ? null : parentId })}
        />
      </Labelled>
      <Labelled label="Item category">
        <ChoiceSelect
          items={[{ value: NONE, label: "None" }, ...itemCategoryItems(itemCategories)]}
          value={product.itemCategoryId ?? NONE}
          onChange={(id) => save({ itemCategoryId: id === NONE ? null : id })}
        />
      </Labelled>
      <Labelled label="Compare prices per">
        <ChoiceSelect
          items={UNIT_ITEMS}
          value={product.unit}
          onChange={(unit: Unit) => save({ unit })}
        />
      </Labelled>
      <Labelled label="One piece holds">
        <div className="flex gap-1.5">
          <Input
            inputMode="decimal"
            aria-label="Size"
            placeholder="Size"
            className="w-24"
            key={String(product.size)}
            defaultValue={product.size ?? ""}
            onBlur={(event) => {
              const size = parseQuantity(event.target.value);
              if (size !== product.size) save({ size });
            }}
          />
          <UnitSelect
            className="w-24 border-input"
            value={product.sizeUnit}
            onChange={(sizeUnit) => save({ sizeUnit })}
          />
        </div>
      </Labelled>
      <Labelled label="Notes">
        <CellInput
          label="Notes"
          className="border-input"
          value={product.notes ?? ""}
          onCommit={(notes) => save({ notes: notes.trim() === "" ? null : notes.trim() })}
        />
      </Labelled>
    </section>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

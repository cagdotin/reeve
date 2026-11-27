import type { CategoryGroup } from "@reeve/contract";
import type { ItemCategory, Receipt } from "@reeve/contract/catalog";
import { lineAmount } from "@reeve/contract/receipts";
import { PlusIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@reeve/ui/components/button";
import { Input } from "@reeve/ui/components/input";
import { useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { parsePrice, parseQuantity } from "@/lib/receipts";
import { LineRow } from "./line-row";

/** The receipt's lines in order, each edited in place, and a row to add more. */
export function LinesTable({
  receipt,
  groups,
  itemCategories,
  onLiveTotal,
}: {
  receipt: Receipt;
  groups: ReadonlyArray<CategoryGroup>;
  itemCategories: ReadonlyArray<ItemCategory>;
  onLiveTotal: (id: string, total: number | null) => void;
}) {
  const { id: book } = useBook();
  const reorder = useBookMutation(book, "reorder_receipt_lines");
  const remove = useBookMutation(book, "delete_receipt_lines");
  const ids = receipt.lines.map((line) => line.id);

  const move = (index: number, direction: -1 | 1) => {
    const next = [...ids];
    const [moved] = next.splice(index, 1);
    next.splice(index + direction, 0, moved!);
    reorder.mutate({ receipt: receipt.id, ids: next });
  };

  return (
    <section aria-label="Lines" className="overflow-hidden rounded-xl border bg-card">
      <div className="flex h-8 items-center max-md:hidden gap-1 border-b bg-muted/40 px-1.5 text-xs text-muted-foreground">
        <span className="w-6 shrink-0" />
        <span className="min-w-0 flex-1 px-1.5">Line</span>
        <span className="w-24 shrink-0 px-1.5">Code</span>
        <span className="w-16 shrink-0 px-1.5 text-right">Qty</span>
        <span className="w-18 shrink-0 px-1.5">Unit</span>
        <span className="w-22 shrink-0 px-1.5 text-right">Price</span>
        <span className="w-24 shrink-0 px-1.5 text-right">Total</span>
      </div>
      {receipt.lines.map((line, index) => (
        <LineRow
          key={line.id}
          line={line}
          payeeId={receipt.payeeId}
          groups={groups}
          itemCategories={itemCategories}
          onLiveTotal={onLiveTotal}
          first={index === 0}
          last={index === receipt.lines.length - 1}
          onMove={(direction) => move(index, direction)}
          onDelete={() => remove.mutate({ receipt: receipt.id, ids: [line.id] })}
        />
      ))}
      {receipt.lines.length === 0 && (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">
          No lines yet. Type them as the receipt prints them.
        </p>
      )}
      <NewLine receipt={receipt.id} />
    </section>
  );
}

/** A row to type a new line into; Enter adds it and stays for the next one. */
function NewLine({ receipt }: { receipt: string }) {
  const { id: book, parse, money, format } = useBook();
  const add = useBookMutation(book, "add_receipt_lines");
  const [text, setText] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [total, setTotal] = useState("");
  const qty = parseQuantity(quantity) ?? 1;
  const unitPrice = parsePrice(price, money);
  const typedTotal = total.trim() === "" ? null : parse(total);
  const computed = unitPrice === null ? null : lineAmount(qty, unitPrice);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim() === "" || (typedTotal === null && computed === null)) return;
    add.mutate(
      {
        receipt,
        lines: [
          {
            text: text.trim(),
            quantity: qty,
            ...(unitPrice === null ? {} : { unitPrice }),
            ...(typedTotal === null ? {} : { lineTotal: typedTotal }),
          },
        ],
      },
      {
        onSuccess: () => {
          setText("");
          setQuantity("1");
          setPrice("");
          setTotal("");
        },
      },
    );
  };

  return (
    <form
      onSubmit={submit}
      className="flex items-center gap-1 bg-muted/20 px-1.5 py-1.5 max-md:flex-wrap"
    >
      <PlusIcon className="mx-1 size-4 shrink-0 text-muted-foreground" />
      <Input
        aria-label="New line text"
        placeholder="Add a line…"
        className="min-w-0 flex-1 max-md:basis-[calc(100%-2.5rem)]"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <Input
        aria-label="New line quantity"
        inputMode="decimal"
        className="w-16 shrink-0 max-md:w-auto max-md:min-w-0 max-md:flex-1 max-md:basis-16 [&_input]:text-right"
        value={quantity}
        onChange={(event) => setQuantity(event.target.value)}
      />
      <Input
        aria-label="New line unit price"
        inputMode="decimal"
        placeholder="Price"
        className="w-22 shrink-0 max-md:w-auto max-md:min-w-0 max-md:flex-1 max-md:basis-16 [&_input]:text-right"
        value={price}
        onChange={(event) => setPrice(event.target.value)}
      />
      <Input
        aria-label="New line total"
        inputMode="decimal"
        placeholder={computed === null ? "Total" : format(computed)}
        className="w-24 shrink-0 max-md:w-auto max-md:min-w-0 max-md:flex-1 max-md:basis-16 [&_input]:text-right"
        value={total}
        onChange={(event) => setTotal(event.target.value)}
      />
      <Button
        type="submit"
        variant="outline"
        disabled={text.trim() === "" || (typedTotal === null && computed === null)}
        loading={add.isPending}
      >
        Add
      </Button>
    </form>
  );
}

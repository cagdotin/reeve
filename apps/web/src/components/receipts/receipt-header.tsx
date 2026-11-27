import type { Receipt } from "@reeve/contract/catalog";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { AmountInput } from "@/components/amount-input";
import { Input } from "@reeve/ui/components/input";
import { cn } from "@reeve/ui/lib/utils";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { CellInput } from "./cell-input";
import { StorePicker } from "./store-picker";

/** The receipt's store, day, time, total paid and notes; each saves as it is left. */
export function ReceiptHeader({ receipt }: { receipt: Receipt }) {
  const { id: book } = useBook();
  const update = useBookMutation(book, "update_receipt");
  const payees = useQuery(bookQuery(book, "list_payees", {})).data ?? [];
  const [store, setStore] = useState<string | null>(null);

  const saveStore = (text: string) => {
    setStore(null);
    const name = text.trim();
    if (name === (receipt.payee ?? "")) return;
    update.mutate({ id: receipt.id, payee: name === "" ? null : name });
  };

  return (
    <div className="grid grid-cols-2 gap-2 border-t pt-3 @2xl:grid-cols-[minmax(0,2fr)_9rem_6rem_8rem]">
      <Labelled label="Store" className="col-span-2 @2xl:col-span-1">
        {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- saves when focus leaves the picker. */}
        <div
          onBlur={(event) => {
            if (store !== null && !event.currentTarget.contains(event.relatedTarget as Node | null))
              saveStore(store);
          }}
        >
          <StorePicker
            value={store ?? receipt.payee ?? ""}
            onChange={(text) => {
              setStore(text);
              const picked = payees.find((each) => each.name === text);
              if (picked !== undefined && picked.id !== receipt.payeeId) saveStore(text);
            }}
            className="w-full"
          />
        </div>
      </Labelled>
      <Labelled label="Date">
        <Input
          type="date"
          aria-label="Date"
          value={receipt.date}
          onChange={(event) =>
            event.target.value !== "" && update.mutate({ id: receipt.id, date: event.target.value })
          }
        />
      </Labelled>
      <Labelled label="Time">
        <Input
          type="time"
          aria-label="Time"
          defaultValue={receipt.time ?? ""}
          key={receipt.time ?? ""}
          onBlur={(event) => {
            const time = event.target.value === "" ? null : event.target.value;
            if (time !== receipt.time) update.mutate({ id: receipt.id, time });
          }}
        />
      </Labelled>
      <Labelled label="Total paid">
        <AmountInput
          label="Total paid"
          className="h-8 border-input"
          value={receipt.total}
          onCommit={(total) => update.mutate({ id: receipt.id, total })}
        />
      </Labelled>
      <div className="col-span-2 @2xl:col-span-4">
        <Labelled label="Notes">
          <CellInput
            label="Notes"
            placeholder="Notes"
            className="border-input"
            value={receipt.notes ?? ""}
            onCommit={(text) =>
              update.mutate({ id: receipt.id, notes: text.trim() === "" ? null : text.trim() })
            }
          />
        </Labelled>
      </div>
    </div>
  );
}

function Labelled({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid min-w-0 gap-1", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

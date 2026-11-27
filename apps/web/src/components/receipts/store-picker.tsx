import { useQuery } from "@tanstack/react-query";
import { Picker } from "@/components/picker";
import type { PickerGroup } from "@/components/picker-items";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";

/** The store as a payee name: picking one names it, typing a new name creates the payee on save. */
export function StorePicker({
  value,
  onChange,
  autoFocus,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const { id: book } = useBook();
  const payees = useQuery(bookQuery(book, "list_payees", {})).data ?? [];
  const groups: Array<PickerGroup> = [
    {
      value: "",
      items: payees
        .toSorted((a, b) => Number(b.favorite) - Number(a.favorite))
        .map((each) => ({ value: each.id, label: each.name })),
    },
  ];
  return (
    <Picker
      groups={groups}
      value={value}
      onChange={onChange}
      label="Store"
      placeholder="Store"
      autoFocus={autoFocus ?? false}
      className={className}
    />
  );
}

import type { CategoryGroup } from "@reeve/contract";
import type { ItemCategory } from "@reeve/contract/catalog";
import { UNITS, type Unit } from "@reeve/contract/receipts";
import { FolderTreeIcon, TagIcon } from "lucide-react";
import { ChoiceItems } from "@/components/choice-select";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@reeve/ui/components/select";
import { cn } from "@reeve/ui/lib/utils";
import { categoryOptions } from "@/lib/categories";
import { itemCategoryItems, UNIT_LABELS } from "@/lib/receipts";

/** A select that reads as a quiet cell until hovered, for the lines table. */
export const CELL_SELECT =
  "h-7 min-h-7 sm:min-h-7 min-w-0 gap-1 border-transparent bg-transparent px-1.5 text-xs shadow-none not-dark:bg-transparent hover:border-input dark:bg-transparent before:hidden *:data-[slot=select-icon]:opacity-0 hover:*:data-[slot=select-icon]:opacity-100 focus-visible:*:data-[slot=select-icon]:opacity-100 data-popup-open:*:data-[slot=select-icon]:opacity-100";

const NONE = "none";

export function UnitSelect({
  value,
  onChange,
  className,
}: {
  value: Unit | null;
  onChange: (value: Unit | null) => void;
  className?: string | undefined;
}) {
  const items = [
    { value: NONE, label: "—" },
    ...UNITS.map((unit) => ({ value: unit, label: UNIT_LABELS[unit] })),
  ];
  return (
    <Select
      items={items}
      value={value ?? NONE}
      onValueChange={(next) => onChange(next === NONE || next === null ? null : (next as Unit))}
    >
      <SelectTrigger aria-label="Unit" className={cn(CELL_SELECT, className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/** The line's own item category, or the product's (shown muted) when it has none. */
export function ItemCategorySelect({
  categories,
  value,
  effective,
  onChange,
}: {
  categories: ReadonlyArray<ItemCategory>;
  value: string | null;
  effective: string | null;
  onChange: (value: string | null) => void;
}) {
  const items = itemCategoryItems(categories);
  const name = (id: string | null) => categories.find((each) => each.id === id)?.name;
  const inherited = value === null ? name(effective) : undefined;
  return (
    <Select
      items={[{ value: NONE, label: "None" }, ...items]}
      value={value ?? NONE}
      onValueChange={(next) => onChange(next === NONE || next === null ? null : next)}
    >
      <SelectTrigger aria-label="Item category" className={CELL_SELECT}>
        <FolderTreeIcon className="size-3.5 opacity-60" />
        <SelectValue>
          {() =>
            value !== null ? (
              name(value)
            ) : (
              <span className="text-muted-foreground">{inherited ?? "Item category…"}</span>
            )
          }
        </SelectValue>
      </SelectTrigger>
      <SelectPopup>
        <SelectItem value={NONE}>
          {effective === null ? "None" : `From the product (${name(effective) ?? "…"})`}
        </SelectItem>
        <SelectSeparator />
        <ChoiceItems items={items} />
      </SelectPopup>
    </Select>
  );
}

/**
 * The line's budget category override; without one it shows the category it inherits from its
 * item category, muted, or a warning when it resolves to none.
 */
export function BudgetCategorySelect({
  groups,
  value,
  effective,
  onChange,
  inheritLabel = "Inherit from the item category",
  placeholder = "Budget category…",
  className,
}: {
  groups: ReadonlyArray<CategoryGroup>;
  value: string | null;
  /** The name of the category it resolves to. */
  effective: string | null;
  onChange: (value: string | null) => void;
  inheritLabel?: string;
  placeholder?: string;
  className?: string | undefined;
}) {
  const options = categoryOptions(groups.filter((group) => !group.isIncome));
  return (
    <Select
      items={[{ value: NONE, label: "Inherit" }, ...options]}
      value={value ?? NONE}
      onValueChange={(next) => onChange(next === NONE || next === null ? null : next)}
    >
      <SelectTrigger aria-label="Budget category" className={cn(CELL_SELECT, className)}>
        <TagIcon className="size-3.5 opacity-60" />
        <SelectValue>
          {() =>
            value !== null ? (
              effective
            ) : effective !== null ? (
              <span className="text-muted-foreground">{effective}</span>
            ) : (
              <span className="text-warning-foreground">{placeholder}</span>
            )
          }
        </SelectValue>
      </SelectTrigger>
      <SelectPopup>
        <SelectItem value={NONE}>{inheritLabel}</SelectItem>
        <SelectSeparator />
        <ChoiceItems items={options} />
      </SelectPopup>
    </Select>
  );
}

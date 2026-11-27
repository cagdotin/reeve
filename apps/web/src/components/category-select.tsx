import type { CategoryGroup } from "@reeve/contract";
import { ChoicePicker } from "@/components/picker";
import { categoryOptions } from "@/lib/categories";

export const TO_BUDGET = "to-budget";

/** Picks a category from the budget's groups; `toBudget` offers To Budget first. */
export function CategorySelect({
  groups,
  value,
  onChange,
  toBudget = false,
  income = false,
  exclude,
  placeholder = "Choose a category",
  label = "Category",
  className,
}: {
  groups: ReadonlyArray<CategoryGroup>;
  value: string | null;
  onChange: (value: string | null) => void;
  toBudget?: boolean;
  /** Offer income categories too. */
  income?: boolean;
  exclude?: string;
  placeholder?: string;
  /** Its accessible name. */
  label?: string;
  className?: string;
}) {
  const options = categoryOptions(groups.filter((group) => income || !group.isIncome)).filter(
    (option) => option.value !== exclude,
  );
  const items = [...(toBudget ? [{ value: TO_BUDGET, label: "To Budget" }] : []), ...options];
  return (
    <ChoicePicker
      label={label}
      items={items}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      {...(className === undefined ? {} : { className })}
    />
  );
}

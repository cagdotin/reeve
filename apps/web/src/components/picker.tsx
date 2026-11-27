import {
  Autocomplete,
  AutocompleteCollection,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from "@reeve/ui/components/autocomplete";
import { useState } from "react";
import type { ChoiceItem } from "@/components/choice-select";
import { findItem, type PickerGroup, type PickerItem } from "@/components/picker-items";
import { indentStyle } from "@/lib/categories";

/**
 * A text field with grouped suggestions, as the register's payee and category cells: typing
 * filters, Enter or a click takes the highlighted suggestion, and Escape leaves the text as it is.
 * The text is the value; callers map
 * it back to an item with `findItem`.
 */
export function Picker({
  groups,
  value,
  onChange,
  placeholder,
  label,
  autoFocus = false,
  className,
}: {
  groups: ReadonlyArray<PickerGroup>;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  autoFocus?: boolean;
  className?: string | undefined;
}) {
  return (
    <Autocomplete
      items={groups as Array<PickerGroup>}
      value={value}
      onValueChange={(next, details) => {
        // Base UI clears the text on Escape; in reeve, Escape belongs to whatever holds the field.
        if (details.reason !== "escape-key") onChange(next);
      }}
      itemToStringValue={(item: unknown) => (item as PickerItem).label}
      autoHighlight
      openOnInputClick
    >
      <AutocompleteInput
        aria-label={label}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={className}
      />
      <AutocompletePopup className="min-w-56">
        <AutocompleteEmpty>No matches</AutocompleteEmpty>
        <AutocompleteList>
          {(group: PickerGroup) => (
            <AutocompleteGroup key={group.value} items={group.items as Array<PickerItem>}>
              {group.value !== "" && <AutocompleteGroupLabel>{group.value}</AutocompleteGroupLabel>}
              <AutocompleteCollection>
                {(item: PickerItem) => (
                  <AutocompleteItem key={item.value} value={item}>
                    <span className="truncate" style={indentStyle(item.depth)}>
                      {item.label}
                    </span>
                  </AutocompleteItem>
                )}
              </AutocompleteCollection>
            </AutocompleteGroup>
          )}
        </AutocompleteList>
      </AutocompletePopup>
    </Autocomplete>
  );
}

const groupsOf = (items: ReadonlyArray<ChoiceItem<string>>) => {
  const groups: Array<{ value: string; items: Array<PickerItem> }> = [];
  for (const item of items) {
    const group = item.group ?? "";
    const last = groups.at(-1);
    if (last?.value === group) last.items.push(item);
    else groups.push({ value: group, items: [item] });
  }
  return groups;
};

/**
 * `Picker` over a list of values rather than free text: a typed name that matches one picks it, an
 * emptied field picks nothing, and leaving the field shows the picked value's name again.
 */
export function ChoicePicker<T extends string>({
  items,
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  items: ReadonlyArray<ChoiceItem<T>>;
  value: T | null;
  onChange: (value: T | null) => void;
  placeholder?: string;
  label: string;
  className?: string;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const groups = groupsOf(items);
  const picked = items.find((item) => item.value === value)?.label ?? "";
  return (
    <div className={className} onBlur={() => setTyped(null)}>
      <Picker
        groups={groups}
        value={typed ?? picked}
        onChange={(text) => {
          setTyped(text);
          if (text.trim() === "") onChange(null);
          const match = findItem(groups, text);
          if (match !== undefined) onChange(match.value as T);
        }}
        label={label}
        {...(placeholder === undefined ? {} : { placeholder })}
      />
    </div>
  );
}

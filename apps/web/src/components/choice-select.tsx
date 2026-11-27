import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxValue,
} from "@reeve/ui/components/combobox";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@reeve/ui/components/select";
import { indentStyle } from "@/lib/categories";

export interface ChoiceItem<T extends string> {
  readonly value: T;
  readonly label: string;
  /** How far to indent it, for a tree such as nested categories. */
  readonly depth?: number;
  /** The heading it shows under; consecutive items with one group share it. */
  readonly group?: string;
}

interface Section<T extends string> {
  readonly group: string | undefined;
  readonly items: Array<ChoiceItem<T>>;
}

const sectionsOf = <T extends string>(items: ReadonlyArray<ChoiceItem<T>>) => {
  const sections: Array<Section<T>> = [];
  for (const item of items) {
    const last = sections.at(-1);
    if (last !== undefined && last.group === item.group) last.items.push(item);
    else sections.push({ group: item.group, items: [item] });
  }
  return sections;
};

/** Select items under their group headings, indented by depth. */
export function ChoiceItems<T extends string>({ items }: { items: ReadonlyArray<ChoiceItem<T>> }) {
  const sections = sectionsOf(items);
  const render = (item: ChoiceItem<T>) => (
    <SelectItem key={item.value} value={item.value}>
      <span className="truncate" style={indentStyle(item.depth)}>
        {item.label}
      </span>
    </SelectItem>
  );
  return sections.map((section) =>
    section.group === undefined ? (
      section.items.map(render)
    ) : (
      <SelectGroup key={section.items[0]!.value}>
        <SelectGroupLabel>{section.group}</SelectGroupLabel>
        {section.items.map(render)}
      </SelectGroup>
    ),
  );
}

/** A select over a fixed list of labelled values. */
export function ChoiceSelect<T extends string>({
  items,
  value,
  onChange,
  placeholder,
  className,
  label,
}: {
  items: ReadonlyArray<ChoiceItem<T>>;
  value: T | null;
  onChange: (value: T) => void;
  placeholder?: string;
  /** Its accessible name, when no visible label is tied to it. */
  label?: string;
  className?: string;
}) {
  return (
    <Select items={items} value={value} onValueChange={(next) => next !== null && onChange(next)}>
      <SelectTrigger className={className} aria-label={label}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectPopup>
        <ChoiceItems items={items} />
      </SelectPopup>
    </Select>
  );
}

/** The filtered list of a choice combobox, under group headings and indented by depth. */
function ChoicePopup<T extends string>() {
  return (
    <ComboboxPopup className="min-w-56">
      <ComboboxEmpty>No matches</ComboboxEmpty>
      <ComboboxList>
        {(section: Section<T>) => (
          <ComboboxGroup key={section.group ?? section.items[0]!.value} items={section.items}>
            {section.group !== undefined && (
              <ComboboxGroupLabel>{section.group}</ComboboxGroupLabel>
            )}
            <ComboboxCollection>
              {(item: ChoiceItem<T>) => (
                <ComboboxItem key={item.value} value={item}>
                  <span className="truncate" style={indentStyle(item.depth)}>
                    {item.label}
                  </span>
                </ComboboxItem>
              )}
            </ComboboxCollection>
          </ComboboxGroup>
        )}
      </ComboboxList>
    </ComboboxPopup>
  );
}

const itemProps = {
  itemToStringLabel: (item: ChoiceItem<string>) => item.label,
  itemToStringValue: (item: ChoiceItem<string>) => item.value,
  isItemEqualToValue: (item: ChoiceItem<string>, selected: ChoiceItem<string>) =>
    item.value === selected.value,
  autoHighlight: true,
  openOnInputClick: true,
};

/** A field that filters a list of labelled values as it is typed and keeps several, each a chip. */
export function ChoicesCombobox<T extends string>({
  items,
  value,
  onChange,
  placeholder,
  label,
}: {
  items: ReadonlyArray<ChoiceItem<T>>;
  value: ReadonlyArray<T>;
  onChange: (value: Array<T>) => void;
  placeholder?: string;
  label: string;
}) {
  const chosen = new Set<string>(value);
  return (
    <Combobox<ChoiceItem<T>, true>
      {...itemProps}
      multiple
      items={sectionsOf(items)}
      value={items.filter((item) => chosen.has(item.value))}
      onValueChange={(next) => onChange(next.map((item) => item.value))}
    >
      <ComboboxChips>
        <ComboboxValue>
          {(selected: Array<ChoiceItem<T>>) => (
            <>
              {selected.map((item) => (
                <ComboboxChip key={item.value}>{item.label}</ComboboxChip>
              ))}
              <ComboboxChipsInput
                aria-label={label}
                placeholder={selected.length === 0 ? placeholder : undefined}
              />
            </>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ChoicePopup<T> />
    </Combobox>
  );
}

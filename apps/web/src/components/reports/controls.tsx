import type { ReportCondition, RuleField, RuleOp } from "@reeve/contract/catalog";
import { currentMonth, monthRange } from "@reeve/contract/rules";
import { CalendarRangeIcon, FilterIcon, PlusIcon, XIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Choices } from "@/components/rules/rule-editor";
import {
  CONDITION_FIELDS,
  describeCondition,
  emptyValue,
  kindOf,
  OP_LABELS,
  opsFor,
  type Names,
} from "@/components/rules/rule-model";
import { ValueInput } from "@/components/rules/value-input";
import { Button } from "@reeve/ui/components/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@reeve/ui/components/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "@reeve/ui/components/popover";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@reeve/ui/components/select";
import { ToggleGroup, ToggleGroupItem } from "@reeve/ui/components/toggle-group";
import { cn } from "@reeve/ui/lib/utils";
import { useBook } from "@/lib/book";
import { keyOf } from "@/lib/keys";
import {
  FRAME_PRESETS,
  MODE_LABELS,
  resolveFrame,
  shortMonth,
  type ConditionsOp,
  type TimeFrame,
} from "./meta";

/** A small select of labelled values. */
export function Choice<T extends string>({
  items,
  value,
  onChange,
  className,
  label,
}: {
  items: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  value: T;
  onChange: (value: T) => void;
  className?: string | undefined;
  label?: string | undefined;
}) {
  return (
    <Select items={items} value={value} onValueChange={(next) => next !== null && onChange(next)}>
      <SelectTrigger className={cn("w-auto min-w-28", className)} aria-label={label}>
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

/** Several of a list; nothing picked reads as `none`. */
export function MultiChoice({
  items,
  value,
  onChange,
  label,
  none,
  className,
}: {
  items: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  value: ReadonlyArray<string>;
  onChange: (value: ReadonlyArray<string>) => void;
  label: string;
  none: string;
  className?: string | undefined;
}) {
  return (
    <Select multiple items={items} value={[...value]} onValueChange={(next) => onChange(next)}>
      <SelectTrigger className={cn("w-auto max-w-72 min-w-36", className)} aria-label={label}>
        <SelectValue>
          {(selected: Array<string>) =>
            selected.length === 0
              ? none
              : selected.length > 2
                ? `${selected.length} selected`
                : selected
                    .map((id) => items.find((item) => item.value === id)?.label ?? id)
                    .join(", ")
          }
        </SelectValue>
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

/** One of a few options, as a row of toggles. */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: ReadonlyArray<{ readonly value: T; readonly label: ReactNode }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <ToggleGroup
      variant="outline"
      aria-label={label}
      value={[value]}
      onValueChange={(next: Array<unknown>) => {
        const picked = next[0];
        if (typeof picked === "string") onChange(picked as T);
      }}
    >
      {items.map((item) => (
        <ToggleGroupItem key={item.value} value={item.value} className="px-2.5">
          {item.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/**
 * Actual's report dates: live or static, the first and last month, and quick ranges. Picking months
 * makes the range static, as Actual's.
 */
export function TimeFramePicker({
  frame,
  onChange,
  earliest,
  latest = currentMonth(),
}: {
  frame: TimeFrame;
  onChange: (frame: TimeFrame) => void;
  earliest: string | undefined;
  /** The last month offered when the range ends earlier; this month by default. */
  latest?: string | undefined;
}) {
  const range = resolveFrame(frame);
  const first = earliest !== undefined && earliest < range.start ? earliest : range.start;
  const last = range.end > latest ? range.end : latest;
  const months = monthRange(first, last)
    .toReversed()
    .map((month) => ({ value: month, label: shortMonth(month) }));
  const isLive = frame.mode !== "static";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button
        variant={isLive ? "secondary" : "outline"}
        title={isLive ? "The range moves with time" : "The range stays as picked"}
        onClick={() =>
          onChange(
            isLive
              ? { start: range.start, end: range.end, mode: "static" }
              : { start: range.start, end: range.end, mode: "sliding-window" },
          )
        }
      >
        {isLive ? MODE_LABELS[frame.mode] : "Static"}
      </Button>
      <Choice
        label="First month"
        items={months}
        value={range.start}
        onChange={(start) =>
          onChange({ start, end: start > range.end ? start : range.end, mode: "static" })
        }
      />
      <span className="text-muted-foreground">to</span>
      <Choice
        label="Last month"
        items={months}
        value={range.end}
        onChange={(end) =>
          onChange({ start: end < range.start ? end : range.start, end, mode: "static" })
        }
      />
      <Menu>
        <MenuTrigger render={<Button variant="ghost" />}>
          <CalendarRangeIcon />
          Ranges
        </MenuTrigger>
        <MenuPopup align="start">
          {FRAME_PRESETS.map((preset) => (
            <MenuItem
              key={preset.label}
              onClick={() => onChange(preset.frame(earliest ?? range.start))}
            >
              {preset.label}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
    </div>
  );
}

const optionsFor = (field: string, choices: Choices) =>
  field === "account"
    ? choices.accounts
    : field === "category"
      ? choices.categories
      : field === "category_group"
        ? choices.groups
        : field === "payee"
          ? choices.payees
          : [];

const FIELDS = CONDITION_FIELDS.map((each) => ({ value: each.field, label: each.label }));

/** Edits one condition: its field, operator and value. */
function ConditionForm({
  initial,
  choices,
  onApply,
  onCancel,
}: {
  initial: ReportCondition;
  choices: Choices;
  onApply: (condition: ReportCondition) => void;
  onCancel: () => void;
}) {
  const [condition, setCondition] = useState(initial);
  const field = condition.field as RuleField;
  return (
    <div className="grid w-80 gap-2">
      <div className="grid grid-cols-2 gap-2">
        <Choice
          label="Field"
          className="w-full"
          items={FIELDS}
          value={field}
          onChange={(next: RuleField) => {
            const op = opsFor(next).includes(condition.op) ? condition.op : "is";
            setCondition({ field: next, op, value: emptyValue(kindOf(next), op) });
          }}
        />
        <Choice
          label="Operator"
          className="w-full"
          items={opsFor(field).map((op) => ({ value: op, label: OP_LABELS[op] }))}
          value={condition.op}
          onChange={(op: RuleOp) =>
            setCondition({ ...condition, op, value: emptyValue(kindOf(field), op) })
          }
        />
      </div>
      <ValueInput
        key={`${field}:${condition.op}`}
        field={field}
        op={condition.op}
        value={condition.value}
        onChange={(value) => setCondition({ ...condition, value })}
        options={optionsFor(field, choices)}
      />
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onApply(condition)}>Apply</Button>
      </div>
    </div>
  );
}

const blank = (): ReportCondition => ({ field: "category", op: "is", value: null });

/** The filter button; it adds a condition. */
export function FilterButton({
  choices,
  onAdd,
}: {
  choices: Choices;
  onAdd: (condition: ReportCondition) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" />}>
        <FilterIcon />
        Filter
      </PopoverTrigger>
      <PopoverPopup align="start">
        {open && (
          <ConditionForm
            initial={blank()}
            choices={choices}
            onCancel={() => setOpen(false)}
            onApply={(condition) => {
              onAdd(condition);
              setOpen(false);
            }}
          />
        )}
      </PopoverPopup>
    </Popover>
  );
}

function ConditionChip({
  condition,
  names,
  choices,
  onChange,
  onRemove,
}: {
  condition: ReportCondition;
  names: Names;
  choices: Choices;
  onChange: (condition: ReportCondition) => void;
  onRemove: () => void;
}) {
  const { format } = useBook();
  const [open, setOpen] = useState(false);
  return (
    <span className="inline-flex h-8 items-center overflow-hidden rounded-lg border border-input bg-popover text-sm shadow-xs/5 dark:bg-input/32">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="h-full cursor-pointer px-2 hover:bg-accent">
          {describeCondition(
            { field: condition.field, op: condition.op, value: condition.value },
            names,
            format,
          )}
        </PopoverTrigger>
        <PopoverPopup align="start">
          {open && (
            <ConditionForm
              initial={condition}
              choices={choices}
              onCancel={() => setOpen(false)}
              onApply={(next) => {
                onChange(next);
                setOpen(false);
              }}
            />
          )}
        </PopoverPopup>
      </Popover>
      <button
        type="button"
        aria-label="Remove filter"
        className="flex h-full cursor-pointer items-center border-l border-input px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={onRemove}
      >
        <XIcon className="size-3.5" />
      </button>
    </span>
  );
}

/** The applied conditions, each editable, joined by all or any. */
export function AppliedFilters({
  conditions,
  conditionsOp,
  onChange,
  names,
  choices,
}: {
  conditions: ReadonlyArray<ReportCondition>;
  conditionsOp: ConditionsOp;
  onChange: (conditions: ReadonlyArray<ReportCondition>, op: ConditionsOp) => void;
  names: Names;
  choices: Choices;
}) {
  if (conditions.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {conditions.length > 1 && (
        <Choice
          label="Match"
          className="min-w-0"
          items={[
            { value: "and", label: "All of" },
            { value: "or", label: "Any of" },
          ]}
          value={conditionsOp}
          onChange={(op) => onChange(conditions, op)}
        />
      )}
      {conditions.map((condition, index) => (
        <ConditionChip
          key={keyOf(condition)}
          condition={condition}
          names={names}
          choices={choices}
          onChange={(next) =>
            onChange(
              conditions.map((each, at) => (at === index ? next : each)),
              conditionsOp,
            )
          }
          onRemove={() =>
            onChange(
              conditions.filter((_, at) => at !== index),
              conditionsOp,
            )
          }
        />
      ))}
    </div>
  );
}

/** An editor for a list of conditions inline, for dialogs (summary divisor, formula queries). */
export function ConditionsEditor({
  conditions,
  conditionsOp,
  onChange,
  names,
  choices,
}: {
  conditions: ReadonlyArray<ReportCondition>;
  conditionsOp: ConditionsOp;
  onChange: (conditions: ReadonlyArray<ReportCondition>, op: ConditionsOp) => void;
  names: Names;
  choices: Choices;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <AppliedFilters
        conditions={conditions}
        conditionsOp={conditionsOp}
        onChange={onChange}
        names={names}
        choices={choices}
      />
      <Popover open={adding} onOpenChange={setAdding}>
        <PopoverTrigger render={<Button variant="outline" />}>
          <PlusIcon />
          Condition
        </PopoverTrigger>
        <PopoverPopup align="start">
          {adding && (
            <ConditionForm
              initial={blank()}
              choices={choices}
              onCancel={() => setAdding(false)}
              onApply={(condition) => {
                onChange([...conditions, condition], conditionsOp);
                setAdding(false);
              }}
            />
          )}
        </PopoverPopup>
      </Popover>
    </div>
  );
}

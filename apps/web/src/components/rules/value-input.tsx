import type { RuleOp } from "@reeve/contract/catalog";
import { useState } from "react";
import { Input } from "@reeve/ui/components/input";
import { ChoicesCombobox, ChoiceSelect } from "@/components/choice-select";
import { ChoicePicker } from "@/components/picker";
import { useBook } from "@/lib/book";
import { kindOf, valueShape } from "./rule-model";

export interface Option {
  readonly value: string;
  readonly label: string;
  readonly depth?: number;
  readonly group?: string;
}

/** An amount typed in the book's format; the value stays the last one that parsed. */
function AmountField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { format, parse } = useBook();
  const [text, setText] = useState(() => format(value));
  return (
    <Input
      inputMode="decimal"
      aria-label="Amount"
      className="tabular-nums"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const amount = parse(event.target.value);
        if (amount !== null) onChange(amount);
      }}
    />
  );
}

/** The value editor of a condition or a set action, by its field's kind and the operator. */
export function ValueInput({
  field,
  op,
  value,
  onChange,
  options,
  label = "Value",
}: {
  field: string;
  op: RuleOp;
  value: unknown;
  onChange: (value: unknown) => void;
  /** The ids an id field may name, with their names. */
  options: ReadonlyArray<Option>;
  /** The accessible name of the editor, when it is one field. */
  label?: string;
}) {
  const kind = kindOf(field);
  const shape = valueShape(op);
  if (shape === "none") return null;
  if (kind === "id")
    return (
      <IdValue
        many={shape === "many"}
        label={label}
        value={value}
        onChange={onChange}
        options={options}
      />
    );
  if (kind === "boolean")
    return (
      <ChoiceSelect
        items={BOOLEANS}
        label={label}
        value={String(value !== false)}
        onChange={(next) => onChange(next === "true")}
      />
    );
  if (kind === "amount" && shape === "range")
    return <RangeInput value={value} onChange={onChange} />;
  if (kind === "amount")
    return <AmountField value={typeof value === "number" ? value : 0} onChange={onChange} />;
  if (kind === "date" && typeof value === "object" && value !== null && "frequency" in value)
    return <Input readOnly aria-label={label} value={`Repeats ${String(value.frequency)}`} />;
  if (kind === "date" && typeof value !== "object")
    return <DateInput value={value} onChange={onChange} />;
  if (shape === "many") return <TextsInput value={value} onChange={onChange} />;
  return <TextInput label={label} value={value} onChange={onChange} />;
}

function TextInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  return (
    <Input
      aria-label={label}
      value={typeof value === "string" ? value : value === null ? "" : JSON.stringify(value)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

const BOOLEANS = [
  { value: "true", label: "true" },
  { value: "false", label: "false" },
];

function IdValue({
  many,
  label,
  value,
  onChange,
  options,
}: {
  many: boolean;
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  options: ReadonlyArray<Option>;
}) {
  if (many) return <IdsInput label={label} value={value} onChange={onChange} options={options} />;
  return (
    <ChoicePicker
      label={label}
      placeholder="Nothing"
      items={options}
      value={typeof value === "string" ? value : null}
      onChange={onChange}
    />
  );
}

function IdsInput({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  options: ReadonlyArray<Option>;
}) {
  return (
    <ChoicesCombobox
      label={label}
      placeholder="Choose…"
      items={options}
      value={Array.isArray(value) ? (value as Array<string>) : []}
      onChange={onChange}
    />
  );
}

function RangeInput({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  const range =
    typeof value === "object" && value !== null && "num1" in value
      ? (value as { num1: number; num2: number })
      : { num1: 0, num2: 0 };
  return (
    <div className="flex items-center gap-1">
      <AmountField value={range.num1} onChange={(num1) => onChange({ ...range, num1 })} />
      <span className="text-xs text-muted-foreground">and</span>
      <AmountField value={range.num2} onChange={(num2) => onChange({ ...range, num2 })} />
    </div>
  );
}

function DateInput({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  return (
    <Input
      type="date"
      aria-label="Date"
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** A list of texts typed separated by commas. */
function TextsInput({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  return (
    <Input
      aria-label="Values, separated by commas"
      placeholder="One, another"
      value={Array.isArray(value) ? value.join(", ") : ""}
      onChange={(event) =>
        onChange(
          event.target.value
            .split(",")
            .map((each) => each.trim())
            .filter((each) => each !== ""),
        )
      }
    />
  );
}

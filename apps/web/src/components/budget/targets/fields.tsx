import type {
  ByTarget,
  PercentageTarget,
  ScheduleTarget,
  Target,
  TargetAdjustment,
  TargetCap,
} from "@reeve/contract/targets";
import { useState, type ReactNode } from "react";
import { ChoiceSelect, type ChoiceItem } from "@/components/choice-select";
import { Field, FieldDescription, FieldLabel } from "@reeve/ui/components/field";
import { Input } from "@reeve/ui/components/input";
import { Label } from "@reeve/ui/components/label";
import { Radio, RadioGroup } from "@reeve/ui/components/radio-group";
import { Switch } from "@reeve/ui/components/switch";
import { cn } from "@reeve/ui/lib/utils";
import { useBook } from "@/lib/book";
import { firstOfMonth, type EditorContext } from "@/components/budget/targets/model";

/** Money typed as text (arithmetic allowed), kept as cents; an unreadable draft keeps the last value. */
export function MoneyField({
  label,
  value,
  onChange,
  description,
  className,
}: {
  label: string;
  value: number;
  onChange: (cents: number) => void;
  description?: ReactNode;
  className?: string;
}) {
  const { format, parse } = useBook();
  const [text, setText] = useState(() => format(value));
  const bad = parse(text) === null || (parse(text) ?? 0) < 0;
  return (
    <Field className={className}>
      <FieldLabel>{label}</FieldLabel>
      <Input
        inputMode="decimal"
        value={text}
        aria-invalid={bad || undefined}
        className="tabular-nums"
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          setText(event.target.value);
          const cents = parse(event.target.value);
          if (cents !== null && cents >= 0) onChange(cents);
        }}
        onBlur={() => !bad && setText(format(value))}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}

/** A whole number, at least `min`. */
export function CountField({
  label,
  value,
  onChange,
  min = 1,
  description,
  className,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  description?: ReactNode;
  className?: string;
}) {
  const [text, setText] = useState(() => String(value));
  const parsed = Number(text);
  const bad = text.trim() === "" || !Number.isInteger(parsed) || parsed < min;
  return (
    <Field className={className}>
      <FieldLabel>{label}</FieldLabel>
      <Input
        inputMode="numeric"
        value={text}
        aria-invalid={bad || undefined}
        onChange={(event) => {
          setText(event.target.value);
          const next = Number(event.target.value);
          if (event.target.value.trim() !== "" && Number.isInteger(next) && next >= min)
            onChange(next);
        }}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}

function PercentField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(() => String(value));
  const bad = text.trim() === "" || !Number.isFinite(Number(text));
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        inputMode="decimal"
        value={text}
        aria-invalid={bad || undefined}
        onChange={(event) => {
          setText(event.target.value);
          const next = Number(event.target.value);
          if (event.target.value.trim() !== "" && Number.isFinite(next)) onChange(next);
        }}
      />
    </Field>
  );
}

function MonthField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (month: string) => void;
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        type="month"
        value={value}
        onChange={(event) => event.target.value && onChange(event.target.value)}
      />
    </Field>
  );
}

function DayField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (day: string) => void;
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        type="date"
        value={value}
        onChange={(event) => event.target.value && onChange(event.target.value)}
      />
    </Field>
  );
}

function SelectField<T extends string>({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: ReadonlyArray<ChoiceItem<T>>;
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-base/4.5 font-medium sm:text-sm/4">{label}</span>
      <ChoiceSelect items={items} value={value} onChange={onChange} label={label} />
    </div>
  );
}

/** A switch with its label and an optional line under it. */
export function SwitchRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Label className="flex items-start justify-between gap-3 font-normal">
      <span className="flex flex-col gap-0.5">
        <span className="text-sm">{label}</span>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </Label>
  );
}

/** Radio choices with a label each and, under the checked one, its own fields. */
export function Choices<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string; children?: ReactNode }>;
}) {
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      onValueChange={(next) => onChange(next as T)}
      className="gap-2"
    >
      {options.map((option) => (
        <div
          key={option.value}
          className={cn(
            "rounded-lg border px-3 py-2.5 transition-colors",
            value === option.value ? "border-primary/40 bg-primary/4" : "bg-background",
          )}
        >
          <Label className="flex items-center gap-2.5 font-normal">
            <Radio value={option.value} />
            <span className="text-sm">{option.label}</span>
          </Label>
          {value === option.value && option.children && (
            <div className="mt-2.5 grid gap-3 ps-7">{option.children}</div>
          )}
        </div>
      ))}
    </RadioGroup>
  );
}

const GRID = "grid gap-3 sm:grid-cols-2";

// ---------------------------------------------------------------------------------------------
// The balance cap shared by fixed amounts, top-ups and remainders
// ---------------------------------------------------------------------------------------------

const CAP_PERIODS: ReadonlyArray<ChoiceItem<TargetCap["period"]>> = [
  { value: "monthly", label: "A month" },
  { value: "weekly", label: "A week" },
  { value: "daily", label: "A day" },
];

function CapFields({
  cap,
  onChange,
  amountLabel,
  context,
}: {
  cap: TargetCap;
  onChange: (cap: TargetCap) => void;
  amountLabel: string;
  context: EditorContext;
}) {
  return (
    <div className="grid gap-3">
      <div className={GRID}>
        <MoneyField
          label={amountLabel}
          value={cap.amount}
          onChange={(amount) => onChange({ ...cap, amount })}
        />
        <SelectField
          label="Per"
          items={CAP_PERIODS}
          value={cap.period}
          onChange={(period) =>
            onChange({
              ...cap,
              period,
              start: period === "weekly" ? (cap.start ?? firstOfMonth(context.month)) : null,
            })
          }
        />
      </div>
      {cap.period === "weekly" && (
        <DayField
          label="Weeks start on"
          value={cap.start ?? firstOfMonth(context.month)}
          onChange={(start) => onChange({ ...cap, start })}
        />
      )}
      <SwitchRow
        label="Keep anything above this"
        description="Otherwise, money above it goes back to To Budget."
        checked={cap.hold}
        onChange={(hold) => onChange({ ...cap, hold })}
      />
    </div>
  );
}

function OptionalCap({
  cap,
  onChange,
  context,
}: {
  cap: TargetCap | null;
  onChange: (cap: TargetCap | null) => void;
  context: EditorContext;
}) {
  return (
    <div className="grid gap-3">
      <SwitchRow
        label="Stop when the balance reaches an amount"
        checked={cap !== null}
        onChange={(on) =>
          onChange(on ? { amount: 50_000, period: "monthly", start: null, hold: false } : null)
        }
      />
      {cap && (
        <CapFields
          cap={cap}
          onChange={onChange}
          amountLabel="Stop at a balance of"
          context={context}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Each kind
// ---------------------------------------------------------------------------------------------

type Unit = "day" | "week" | "month" | "year";
const UNITS: ReadonlyArray<ChoiceItem<Unit>> = [
  { value: "month", label: "Months" },
  { value: "week", label: "Weeks" },
  { value: "day", label: "Days" },
  { value: "year", label: "Years" },
];

/** The same amount, every month (`simple`) or every so many days, weeks, months or years. */
function FixedFields({
  target,
  onChange,
  context,
}: {
  target: Extract<Target, { type: "simple" | "periodic" }>;
  onChange: (target: Target) => void;
  context: EditorContext;
}) {
  const amount = target.type === "simple" ? (target.monthly ?? 0) : target.amount;
  const unit: Unit = target.type === "simple" ? "month" : target.period;
  const every = target.type === "simple" ? 1 : target.every;
  const cadence = (next: { amount?: number; unit?: Unit; every?: number }): Target => {
    const nextUnit = next.unit ?? unit;
    const nextEvery = next.every ?? every;
    const nextAmount = next.amount ?? amount;
    if (nextUnit === "month" && nextEvery === 1)
      return { type: "simple", priority: target.priority, monthly: nextAmount, cap: target.cap };
    return {
      type: "periodic",
      priority: target.priority,
      amount: nextAmount,
      period: nextUnit,
      every: nextEvery,
      starting: target.type === "periodic" ? target.starting : firstOfMonth(context.month),
      cap: target.cap,
    };
  };
  return (
    <div className="grid gap-3">
      <MoneyField
        label="Amount"
        value={amount}
        onChange={(cents) => onChange(cadence({ amount: cents }))}
      />
      <div className={GRID}>
        <CountField
          label="Every"
          value={every}
          onChange={(count) => onChange(cadence({ every: count }))}
        />
        <SelectField
          label="Repeats in"
          items={UNITS}
          value={unit}
          onChange={(next) => onChange(cadence({ unit: next }))}
        />
      </div>
      {target.type === "periodic" && (
        <DayField
          label="Starting on"
          value={target.starting}
          onChange={(starting) => onChange({ ...target, starting })}
        />
      )}
      <OptionalCap
        cap={target.cap}
        onChange={(cap) => onChange({ ...target, cap })}
        context={context}
      />
    </div>
  );
}

type Repeat = "once" | "month" | "year";
const REPEATS: ReadonlyArray<ChoiceItem<Repeat>> = [
  { value: "once", label: "Just once" },
  { value: "year", label: "Yearly" },
  { value: "month", label: "Monthly" },
];

function SaveByFields({
  target,
  onChange,
}: {
  target: ByTarget;
  onChange: (target: Target) => void;
}) {
  const repeat: Repeat = target.repeat?.unit ?? "once";
  return (
    <div className="grid gap-3">
      <div className={GRID}>
        <MoneyField
          label="How much"
          value={target.amount}
          onChange={(amount) => onChange({ ...target, amount })}
        />
        <MonthField
          label="Needed by"
          value={target.month}
          onChange={(month) => onChange({ ...target, month })}
        />
      </div>
      <div className={GRID}>
        <SelectField
          label="Repeats"
          items={REPEATS}
          value={repeat}
          onChange={(next) =>
            onChange({
              ...target,
              repeat: next === "once" ? null : { unit: next, every: target.repeat?.every ?? 1 },
            })
          }
        />
        {target.repeat && (
          <CountField
            key={target.repeat.unit}
            label={target.repeat.unit === "year" ? "Years apart" : "Months apart"}
            value={target.repeat.every}
            onChange={(every) =>
              target.repeat && onChange({ ...target, repeat: { ...target.repeat, every } })
            }
          />
        )}
      </div>
      <SwitchRow
        label="I'll start spending it before then"
        description="For a holiday or a bill paid in parts: saving and spending overlap."
        checked={target.spendFrom !== null}
        onChange={(on) => onChange({ ...target, spendFrom: on ? target.month : null })}
      />
      {target.spendFrom !== null && (
        <MonthField
          label="Spending starts in"
          value={target.spendFrom}
          onChange={(spendFrom) => onChange({ ...target, spendFrom })}
        />
      )}
    </div>
  );
}

function AdjustmentFields({
  adjustment,
  onChange,
}: {
  adjustment: TargetAdjustment | null;
  onChange: (adjustment: TargetAdjustment | null) => void;
}) {
  type Direction = "none" | "up" | "down";
  const direction: Direction =
    adjustment === null || adjustment.by === 0 ? "none" : adjustment.by > 0 ? "up" : "down";
  const size = Math.abs(adjustment?.by ?? 0);
  const unit = adjustment?.unit ?? "percent";
  const set = (next: { direction?: Direction; size?: number; unit?: "percent" | "fixed" }) => {
    const d = next.direction ?? direction;
    if (d === "none") return onChange(null);
    const nextUnit = next.unit ?? unit;
    const magnitude = next.size ?? (size > 0 ? size : nextUnit === "percent" ? 10 : 1_000);
    onChange({ by: d === "up" ? magnitude : -magnitude, unit: nextUnit });
  };
  return (
    <div className="grid gap-3">
      <SelectField
        label="Change the amount"
        items={[
          { value: "none", label: "No change" },
          { value: "up", label: "Add a bit" },
          { value: "down", label: "Take a bit off" },
        ]}
        value={direction}
        onChange={(next) => set({ direction: next })}
      />
      {direction !== "none" && (
        <div className={GRID}>
          <SelectField
            label="By"
            items={[
              { value: "percent", label: "A percent" },
              { value: "fixed", label: "An amount" },
            ]}
            value={unit}
            onChange={(next) => set({ unit: next, size: next === "percent" ? 10 : 1_000 })}
          />
          {unit === "percent" ? (
            <PercentField
              key="percent"
              label="Percent"
              value={size}
              onChange={(value) => set({ size: value })}
            />
          ) : (
            <MoneyField
              key="fixed"
              label="Amount"
              value={size}
              onChange={(value) => set({ size: value })}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ScheduleFields({
  target,
  onChange,
  context,
}: {
  target: ScheduleTarget;
  onChange: (target: Target) => void;
  context: EditorContext;
}) {
  const names = context.schedules
    .filter((schedule) => !schedule.completed || schedule.name === target.schedule)
    .map((schedule) => ({ value: schedule.name, label: schedule.name }));
  return (
    <div className="grid gap-3">
      {names.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You have no schedules yet. Add your bills on the Schedules page first.
        </p>
      ) : (
        <SelectField
          label="Which bill"
          items={names}
          value={target.schedule || null}
          onChange={(schedule) => onChange({ ...target, schedule })}
        />
      )}
      <Choices
        label="How to budget it"
        value={target.full ? "full" : "spread"}
        onChange={(next) => onChange({ ...target, full: next === "full" })}
        options={[
          { value: "spread", label: "Save a bit each month until it's due" },
          { value: "full", label: "Budget the whole bill in the month it's due" },
        ]}
      />
      <AdjustmentFields
        adjustment={target.adjustment}
        onChange={(adjustment) => onChange({ ...target, adjustment })}
      />
    </div>
  );
}

function PercentageFields({
  target,
  onChange,
  context,
}: {
  target: PercentageTarget;
  onChange: (target: Target) => void;
  context: EditorContext;
}) {
  const sources: Array<ChoiceItem<string>> = [
    { value: "all income", label: "All income" },
    { value: "available funds", label: "Money available to budget" },
    ...context.incomes.map((income) => ({
      value: income.id,
      label: income.name,
      group: "Income categories",
    })),
  ];
  const known = sources.some((source) => source.value === target.of);
  return (
    <div className="grid gap-3">
      <div className={GRID}>
        <PercentField
          label="Percent"
          value={target.percent}
          onChange={(percent) => onChange({ ...target, percent })}
        />
        <SelectField
          label="Of"
          items={known ? sources : [...sources, { value: target.of, label: target.of }]}
          value={target.of}
          onChange={(of) => onChange({ ...target, of })}
        />
      </div>
      <SwitchRow
        label="Use last month's income"
        description="So you budget money you already have."
        checked={target.previous}
        onChange={(previous) => onChange({ ...target, previous })}
      />
    </div>
  );
}

function HistoryFields({
  target,
  onChange,
}: {
  target: Extract<Target, { type: "average" | "copy" }>;
  onChange: (target: Target) => void;
}) {
  const months = target.type === "average" ? target.months : target.monthsAgo;
  return (
    <Choices
      label="Based on"
      value={target.type}
      onChange={(next) =>
        onChange(
          next === "average"
            ? { type: "average", priority: target.priority, months, adjustment: null }
            : { type: "copy", priority: target.priority, monthsAgo: months },
        )
      }
      options={[
        {
          value: "average",
          label: "What I spent on average",
          children: target.type === "average" && (
            <>
              <CountField
                label="Over the last how many months"
                value={target.months}
                onChange={(count) => onChange({ ...target, months: count })}
              />
              <AdjustmentFields
                adjustment={target.adjustment}
                onChange={(adjustment) => onChange({ ...target, adjustment })}
              />
            </>
          ),
        },
        {
          value: "copy",
          label: "What I budgeted before",
          children: target.type === "copy" && (
            <CountField
              label="How many months ago"
              value={target.monthsAgo}
              onChange={(monthsAgo) => onChange({ ...target, monthsAgo })}
            />
          ),
        },
      ]}
    />
  );
}

/** The fields of one target, by the kind it shows as. */
export function TargetFields({
  target,
  onChange,
  context,
}: {
  target: Target;
  onChange: (target: Target) => void;
  context: EditorContext;
}) {
  switch (target.type) {
    case "simple":
      if (target.monthly === null && target.cap !== null)
        return (
          <CapFields
            cap={target.cap}
            amountLabel="Keep it topped up to"
            onChange={(cap) => onChange({ ...target, cap })}
            context={context}
          />
        );
      return <FixedFields target={target} onChange={onChange} context={context} />;
    case "periodic":
      return <FixedFields target={target} onChange={onChange} context={context} />;
    case "by":
      return <SaveByFields target={target} onChange={onChange} />;
    case "goal":
      return (
        <MoneyField
          label="Balance to reach"
          value={target.amount}
          onChange={(amount) => onChange({ ...target, amount })}
          description="Nothing is budgeted for you. The balance turns green once it gets there."
        />
      );
    case "schedule":
      return <ScheduleFields target={target} onChange={onChange} context={context} />;
    case "percentage":
      return <PercentageFields target={target} onChange={onChange} context={context} />;
    case "average":
    case "copy":
      return <HistoryFields target={target} onChange={onChange} />;
    case "remainder":
      return (
        <div className="grid gap-3">
          <CountField
            label="Share"
            value={target.weight}
            onChange={(weight) => onChange({ ...target, weight })}
            description="When several categories take what is left, a bigger share gets more of it."
          />
          <OptionalCap
            cap={target.cap}
            onChange={(cap) => onChange({ ...target, cap })}
            context={context}
          />
        </div>
      );
  }
}

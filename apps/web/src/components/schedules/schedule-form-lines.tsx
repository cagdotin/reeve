import { today } from "@reeve/contract/rules";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { format as formatDate, parseISO } from "date-fns";
import { PlusIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { CategorySelect } from "@/components/category-select";
import { Choice } from "@/components/reports/controls";
import { Button } from "@reeve/ui/components/button";
import { Input } from "@reeve/ui/components/input";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import { timesPerYear } from "@/lib/schedules";
import {
  withPattern,
  type Pattern,
  type ReadFields,
  type ScheduleFields,
  type SetFields,
} from "./schedule-form";

const FREQUENCIES = [
  { value: "daily", label: "days" },
  { value: "weekly", label: "weeks" },
  { value: "monthly", label: "months" },
  { value: "yearly", label: "years" },
] as const;

const FREQUENCY_ONE = {
  daily: "day",
  weekly: "week",
  monthly: "month",
  yearly: "year",
} as const;

const AMOUNT_OPS = [
  { value: "is", label: "exactly" },
  { value: "isapprox", label: "about" },
  { value: "isbetween", label: "between" },
] as const;

const DAY_TYPES = [
  { value: "day", label: "day of the month" },
  { value: "MO", label: "Monday" },
  { value: "TU", label: "Tuesday" },
  { value: "WE", label: "Wednesday" },
  { value: "TH", label: "Thursday" },
  { value: "FR", label: "Friday" },
  { value: "SA", label: "Saturday" },
  { value: "SU", label: "Sunday" },
] as const;

const ordinal = (value: number) => {
  const tens = value % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][value % 10] ?? "th");
  return `${value}${suffix}`;
};

const LAST = "-1";
const DAY_VALUES = [
  ...Array.from({ length: 31 }, (_, index) => ({
    value: String(index + 1),
    label: ordinal(index + 1),
  })),
  { value: LAST, label: "last" },
];
const WEEK_VALUES = [
  ...Array.from({ length: 5 }, (_, index) => ({
    value: String(index + 1),
    label: ordinal(index + 1),
  })),
  { value: LAST, label: "last" },
];

const WEEKENDS = [
  { value: "stay", label: "stays where it falls" },
  { value: "before", label: "moves to the Friday before" },
  { value: "after", label: "moves to the Monday after" },
] as const;

const END_MODES = [
  { value: "never", label: "never" },
  { value: "after_n_occurrences", label: "after" },
  { value: "on_date", label: "on" },
] as const;

const DATE_OPS = [
  { value: "isapprox", label: "within two days" },
  { value: "is", label: "on the day" },
] as const;

const REPEATS = [
  { value: "once", label: "Once, on" },
  { value: "repeats", label: "Every" },
] as const;

const DIRECTIONS = [
  { value: "out", label: "Pay" },
  { value: "in", label: "Receive" },
] as const;

const NO_ACCOUNT = "none";

/** One line of the sentence; it wraps, with its words and controls on one baseline. */
const Line = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm">{children}</div>
);

const Word = ({ children }: { children: ReactNode }) => (
  <span className="text-muted-foreground">{children}</span>
);

const SMALL_SELECT = "min-w-0";

function PatternRow({
  pattern,
  onChange,
  onRemove,
}: {
  pattern: Pattern;
  onChange: (pattern: Pattern) => void;
  onRemove: () => void;
}) {
  const isDay = pattern.type === "day";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Word>the</Word>
      <Choice
        label="Which"
        className={SMALL_SELECT}
        items={isDay ? DAY_VALUES : WEEK_VALUES}
        value={String(pattern.value)}
        onChange={(value) => onChange({ ...pattern, value: Number(value) })}
      />
      <Choice
        label="Kind of day"
        className={SMALL_SELECT}
        items={DAY_TYPES}
        value={pattern.type}
        onChange={(type) =>
          onChange({
            type,
            value: type !== "day" && pattern.value > 5 ? 1 : pattern.value,
          })
        }
      />
      <Button type="button" size="icon" variant="ghost" aria-label="Remove day" onClick={onRemove}>
        <XIcon />
      </Button>
    </div>
  );
}

interface LineProps {
  readonly fields: ScheduleFields;
  readonly read: ReadFields;
  readonly set: SetFields;
}

/** Pay or receive, how much, and who. */
export function AmountLine({ fields, read, set }: LineProps) {
  return (
    <Line>
      <Choice
        label="Direction"
        className={SMALL_SELECT}
        items={DIRECTIONS}
        value={fields.outflow ? "out" : "in"}
        onChange={(value) => set({ outflow: value === "out" })}
      />
      <Choice
        label="Amount type"
        className={SMALL_SELECT}
        items={AMOUNT_OPS}
        value={fields.amountOp}
        onChange={(amountOp) => set({ amountOp })}
      />
      <Input
        inputMode="decimal"
        aria-label="Amount"
        className="w-24 tabular-nums"
        value={fields.amountText}
        onChange={(event) => set({ amountText: event.target.value })}
        aria-invalid={read.magnitude === null || undefined}
      />
      {fields.amountOp === "isbetween" && (
        <>
          <Word>and</Word>
          <Input
            inputMode="decimal"
            aria-label="Amount to"
            className="w-24 tabular-nums"
            value={fields.amountToText}
            onChange={(event) => set({ amountToText: event.target.value })}
            aria-invalid={read.magnitudeTo === null || undefined}
          />
        </>
      )}
      <Word>{fields.outflow ? "to" : "from"}</Word>
      <Input
        aria-label="Payee"
        placeholder="payee"
        className="min-w-32 flex-1"
        value={fields.payee}
        onChange={(event) => set({ payee: event.target.value })}
      />
    </Line>
  );
}

/** The account it moves through, and its category. */
export function AccountLine({ fields, set }: Omit<LineProps, "read">) {
  const { id: book } = useBook();
  const accounts = useQuery(bookQuery(book, "list_accounts", {})).data ?? [];
  const groups = useQuery(bookQuery(book, "list_categories", {})).data ?? [];
  return (
    <Line>
      <Word>{fields.outflow ? "from" : "into"}</Word>
      <Choice
        label="Account"
        className="min-w-36"
        items={[
          { value: NO_ACCOUNT, label: "no account yet" },
          ...accounts.map((each) => ({ value: each.id, label: each.name })),
        ]}
        value={fields.account ?? NO_ACCOUNT}
        onChange={(value) => set({ account: value === NO_ACCOUNT ? null : value })}
      />
      <Word>as</Word>
      <CategorySelect
        groups={groups}
        value={fields.category}
        onChange={(category) => set({ category })}
        income
        placeholder="no category"
        className="w-44"
      />
      {fields.category !== null && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Clear category"
          onClick={() => set({ category: null })}
        >
          <XIcon />
        </Button>
      )}
    </Line>
  );
}

/** Once on a day, or every so often from one. */
export function RepeatLine({ fields, read, set }: LineProps) {
  return (
    <Line>
      <Choice
        label="Repeats"
        className={SMALL_SELECT}
        items={REPEATS}
        value={fields.repeats ? "repeats" : "once"}
        onChange={(value) => set({ repeats: value === "repeats" })}
      />
      {fields.repeats && (
        <>
          <Input
            inputMode="numeric"
            aria-label="Interval"
            className="w-12 text-center tabular-nums"
            value={fields.interval}
            onChange={(event) => set({ interval: event.target.value })}
          />
          <Choice
            label="Frequency"
            className={SMALL_SELECT}
            items={
              read.interval === 1
                ? FREQUENCIES.map((each) => ({
                    value: each.value,
                    label: FREQUENCY_ONE[each.value],
                  }))
                : FREQUENCIES
            }
            value={fields.frequency}
            onChange={(frequency) => set({ frequency })}
          />
          <Word>from</Word>
        </>
      )}
      <Input
        type="date"
        aria-label={fields.repeats ? "Starting" : "Date"}
        className="w-40"
        value={fields.date}
        onChange={(event) => set({ date: event.target.value })}
        aria-invalid={fields.date === "" || undefined}
      />
    </Line>
  );
}

/** The specific days of a monthly schedule. */
export function PatternList({ fields, set }: Omit<LineProps, "read">) {
  const { patterns } = fields;
  return (
    <div className="grid gap-1.5 text-sm">
      {patterns.map((entry) => (
        <PatternRow
          key={entry.id}
          pattern={entry.pattern}
          onChange={(pattern) =>
            set({
              patterns: patterns.map((each) =>
                each.id === entry.id ? { id: each.id, pattern } : each,
              ),
            })
          }
          onRemove={() => set({ patterns: patterns.filter((each) => each.id !== entry.id) })}
        />
      ))}
      <div>
        <Button
          type="button"
          variant="ghost"
          onClick={() => set({ patterns: withPattern(patterns, { type: "day", value: 1 }) })}
        >
          <PlusIcon />
          {patterns.length === 0 ? "On specific days" : "Another day"}
        </Button>
      </div>
    </div>
  );
}

/** What a weekend does to a date, and when the repeating stops. */
export function WeekendAndEndLines({ fields, set }: Omit<LineProps, "read">) {
  const { endMode } = fields;
  return (
    <>
      <Line>
        <Word>On a weekend it</Word>
        <Choice
          label="Weekends"
          className={SMALL_SELECT}
          items={WEEKENDS}
          value={fields.weekend}
          onChange={(weekend) => set({ weekend })}
        />
      </Line>
      <Line>
        <Word>It ends</Word>
        <Choice
          label="Ends"
          className={SMALL_SELECT}
          items={END_MODES}
          value={endMode}
          onChange={(next) => set({ endMode: next })}
        />
        {endMode === "after_n_occurrences" && (
          <>
            <Input
              inputMode="numeric"
              aria-label="Times"
              className="w-14 text-center tabular-nums"
              value={fields.endOccurrences}
              onChange={(event) => set({ endOccurrences: event.target.value })}
            />
            <Word>times</Word>
          </>
        )}
        {endMode === "on_date" && (
          <Input
            type="date"
            aria-label="End date"
            className="w-40"
            value={fields.endDate}
            onChange={(event) => set({ endDate: event.target.value })}
            aria-invalid={fields.endDate === "" || undefined}
          />
        )}
      </Line>
    </>
  );
}

/** How near its date a transaction may land. */
export function DateMatchLine({ fields, set }: Omit<LineProps, "read">) {
  return (
    <Line>
      <Word>A transaction counts for a date when it lands</Word>
      <Choice
        label="Date match"
        className={SMALL_SELECT}
        items={DATE_OPS}
        value={fields.dateOp}
        onChange={(dateOp) => set({ dateOp })}
      />
    </Line>
  );
}

/** Its next dates and, for anything not already monthly, what it costs a month. */
function RecurrencePreview({ fields, read }: Omit<LineProps, "set">) {
  const { id: book, format, formatDay } = useBook();
  const { date, frequency, endMode, endDate } = fields;
  const preview = useQuery({
    ...bookQuery(book, "preview_recurrence", {
      start: date === "" ? today() : date,
      frequency,
      interval: read.interval,
      ...(read.patterns.length > 0 ? { patterns: read.patterns } : {}),
      skipWeekend: read.skipWeekend,
      ...read.weekendFields,
      ...(endMode === "on_date" && endDate === "" ? {} : read.endFields),
      count: 5,
    }),
    enabled: date !== "",
    placeholderData: keepPreviousData,
  });
  const showCost =
    frequency !== "monthly" && read.magnitude !== null && read.magnitudeTo !== null && date !== "";
  return (
    <>
      <p className="flex flex-wrap justify-between gap-x-3">
        <span className="font-medium">{preview.data?.description}</span>
        {showCost && (
          <span className="text-muted-foreground tabular-nums">
            {format(
              Math.round(
                (Math.round((read.magnitude! + read.magnitudeTo!) / 2) *
                  timesPerYear({
                    frequency,
                    interval: read.interval,
                    start: date,
                    patterns: read.patterns,
                  })) /
                  12,
              ),
            )}{" "}
            a month
          </span>
        )}
      </p>
      <ul className="flex flex-wrap gap-1.5" aria-label="Next dates">
        {(preview.data?.dates ?? []).map((each) => (
          <li
            key={each}
            title={formatDay(each)}
            className="rounded-md border bg-background px-1.5 py-0.5 tabular-nums"
          >
            {formatDate(parseISO(each), "EEE, MMM d")}
          </li>
        ))}
        {preview.data?.dates.length === 0 && (
          <li className="text-muted-foreground">No more dates: it has ended.</li>
        )}
      </ul>
    </>
  );
}

function OneOffPreview({ date }: { date: string }) {
  const { formatDay } = useBook();
  return (
    <p>
      <span className="font-medium">Once, on {formatDay(date)}.</span>{" "}
      {date < today() && (
        <span className="text-muted-foreground">
          That has passed, so it shows as missed until a transaction is linked.
        </span>
      )}
    </p>
  );
}

/** What the sentence above it comes to. */
export function DatesPreview({ fields, read }: Omit<LineProps, "set">) {
  return (
    <div className="grid gap-1.5 rounded-lg bg-muted/50 p-3 text-xs" aria-live="polite">
      {fields.repeats ? (
        <RecurrencePreview fields={fields} read={read} />
      ) : (
        fields.date !== "" && <OneOffPreview date={fields.date} />
      )}
    </div>
  );
}

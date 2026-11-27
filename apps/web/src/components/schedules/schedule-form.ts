import type { Recurrence, Schedule } from "@reeve/contract/catalog";
import { today } from "@reeve/contract/rules";
import { amountIsOutflow } from "@/lib/schedules";

export type Frequency = Recurrence["frequency"];
export type Pattern = NonNullable<Recurrence["patterns"]>[number];
export type AmountOp = "is" | "isapprox" | "isbetween";
export type Weekend = "stay" | "before" | "after";

/** A draft for a new schedule, as "find schedules" or the register's row prefill it. */
export interface ScheduleDraft {
  readonly name?: string;
  readonly payee?: string | null;
  readonly account?: string | null;
  readonly amount?: number;
  readonly amountOp?: "is" | "isapprox";
  readonly date?: string;
  readonly dateOp?: "is" | "isapprox";
  readonly frequency?: Frequency | null;
  readonly interval?: number;
  readonly patterns?: ReadonlyArray<Pattern>;
}

/** A day pattern in the form, with an id that outlives its neighbours being removed. */
export interface PatternEntry {
  readonly id: number;
  readonly pattern: Pattern;
}

const asEntries = (patterns: ReadonlyArray<Pattern>): ReadonlyArray<PatternEntry> =>
  patterns.map((pattern, index) => ({ id: index + 1, pattern }));

export const withPattern = (
  entries: ReadonlyArray<PatternEntry>,
  pattern: Pattern,
): ReadonlyArray<PatternEntry> => [
  ...entries,
  { id: Math.max(0, ...entries.map((entry) => entry.id)) + 1, pattern },
];

/** The form's starting values, from the schedule being edited or else the draft. */
export function initialFields(
  schedule: Schedule | null,
  draft: ScheduleDraft,
  format: (amount: number) => string,
) {
  const recurrence = schedule !== null && typeof schedule.date === "object" ? schedule.date : null;
  const stored = schedule?.amount ?? null;
  const first =
    stored === null
      ? (draft.amount ?? 0)
      : stored.op === "isbetween"
        ? stored.value.num1
        : stored.value;
  const second = stored?.op === "isbetween" ? stored.value.num2 : first;
  return {
    name: schedule?.name ?? draft.name ?? "",
    payee: schedule?.payee ?? draft.payee ?? "",
    account: (schedule === null ? (draft.account ?? null) : schedule.accountId) as string | null,
    amountText: format(Math.abs(first)),
    amountToText: format(Math.abs(second)),
    outflow: amountIsOutflow(stored ?? { op: "is", value: first }),
    amountOp: (stored?.op ?? draft.amountOp ?? "is") as AmountOp,
    category: schedule?.categoryId ?? null,
    notes: schedule?.notes ?? "",
    date:
      recurrence?.start ??
      (typeof schedule?.date === "string" ? schedule.date : (draft.date ?? today())),
    dateOp: schedule?.dateOp ?? draft.dateOp ?? "isapprox",
    repeats: recurrence !== null || (schedule === null && draft.frequency !== null),
    frequency: (recurrence?.frequency ?? draft.frequency ?? "monthly") as Frequency,
    interval: String(recurrence?.interval ?? draft.interval ?? 1),
    patterns: asEntries(recurrence?.patterns ?? draft.patterns ?? []),
    weekend: (recurrence?.skipWeekend === true
      ? (recurrence.weekendSolveMode ?? "after")
      : "stay") as Weekend,
    endMode: recurrence?.endMode ?? "never",
    endOccurrences: String(recurrence?.endOccurrences ?? 12),
    endDate: recurrence?.endDate ?? "",
    posts: schedule?.postsTransaction ?? false,
  };
}

export type ScheduleFields = ReturnType<typeof initialFields>;
export type SetFields = (change: Partial<ScheduleFields>) => void;

/** What the typed text means: the amounts, or null when unreadable, and the recurrence's fields. */
export function readFields(fields: ScheduleFields, parse: (text: string) => number | null) {
  const magnitude = parse(fields.amountText);
  const magnitudeTo = fields.amountOp === "isbetween" ? parse(fields.amountToText) : magnitude;
  const skipWeekend = fields.weekend !== "stay";
  const { endMode, endDate } = fields;
  return {
    magnitude,
    magnitudeTo,
    interval: Math.max(1, Math.round(Number(fields.interval)) || 1),
    patterns: fields.frequency === "monthly" ? fields.patterns.map((entry) => entry.pattern) : [],
    skipWeekend,
    weekendFields: fields.weekend === "stay" ? {} : { weekendSolveMode: fields.weekend },
    endFields: {
      endMode,
      ...(endMode === "after_n_occurrences"
        ? { endOccurrences: Math.max(1, Math.round(Number(fields.endOccurrences)) || 1) }
        : {}),
      ...(endMode === "on_date" && endDate !== "" ? { endDate } : {}),
    },
    invalid:
      magnitude === null ||
      magnitudeTo === null ||
      fields.date === "" ||
      (fields.repeats && endMode === "on_date" && endDate === ""),
  };
}

export type ReadFields = ReturnType<typeof readFields>;

/** The body to create or update with; null while an amount is unreadable. */
export function saveBody(fields: ScheduleFields, read: ReadFields) {
  const { magnitude, magnitudeTo } = read;
  if (magnitude === null || magnitudeTo === null) return null;
  const sign = fields.outflow ? -1 : 1;
  return {
    name: fields.name.trim() === "" ? null : fields.name.trim(),
    payee: fields.payee.trim() === "" ? null : fields.payee.trim(),
    account: fields.account,
    amount: sign * magnitude,
    amountOp: fields.amountOp,
    ...(fields.amountOp === "isbetween" ? { amountTo: sign * magnitudeTo } : {}),
    date: fields.date,
    dateOp: fields.dateOp,
    frequency: fields.repeats ? fields.frequency : null,
    interval: read.interval,
    patterns: read.patterns,
    skipWeekend: read.skipWeekend,
    ...read.weekendFields,
    ...read.endFields,
    postsTransaction: fields.posts,
    category: fields.category,
    notes: fields.notes.trim() === "" ? null : fields.notes.trim(),
  };
}

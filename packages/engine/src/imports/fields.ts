/**
 * What Actual's import dialog does to parsed rows, ported from its `utils.ts`: reading dates and
 * amounts, mapping CSV columns to fields, and guessing the mapping and the date order.
 */
import type { ImportDateFormat, ImportMapping } from "./types.ts";
import * as d from "date-fns";

export const DATE_FORMATS: ReadonlyArray<ImportDateFormat> = [
  "yyyy mm dd",
  "yy mm dd",
  "mm dd yyyy",
  "mm dd yy",
  "dd mm yyyy",
  "dd mm yy",
];

const MAX_SAFE_NUMBER = 2 ** 51 - 1;

/** A number from text as banks write it, whatever its separators; null when there is none. */
export const looselyParseAmount = (text: string): number | null => {
  const safe = (value: number) =>
    Number.isNaN(value) || Math.abs(value * 100) > MAX_SAFE_NUMBER ? null : value;
  const digits = (value: string) => value.replace(/[^0-9-]/g, "");
  let amount = text.trim();
  if (amount.startsWith("(") && amount.endsWith(")"))
    amount = amount.replace(/−/g, "").replace("(", "-").replace(")", "");
  else amount = amount.replace(/−/g, "-");
  // A decimal marker followed by 1-2 or 4-9 places: three places may be a thousands group.
  const m = amount.match(/[.,](\d{4,9}|\d{1,2})[^\d.,]*$/);
  if (m === null || m.index === undefined) return safe(parseFloat(digits(amount)));
  return safe(
    parseFloat(`${digits(amount.slice(0, m.index))}.${digits(amount.slice(m.index + 1))}`),
  );
};

export const amountToInteger = (amount: number): number => Math.round(amount * 100);

/** A day from text in the given order, month names allowed; null when it is no valid day. */
export const parseDate = (value: unknown, order: ImportDateFormat): string | null => {
  if (typeof value !== "string") return null;
  const pad = (v: string | undefined) => (v !== undefined && v.length === 1 ? `0${v}` : v);
  const groups = (a: number, b: number) => (text: string) => {
    const parts = text
      .replace(/\bjan(\.|uary)?\b/i, "01")
      .replace(/\bfeb(\.|ruary)?\b/i, "02")
      .replace(/\bmar(\.|ch)?\b/i, "03")
      .replace(/\bapr(\.|il)?\b/i, "04")
      .replace(/\bmay\.?\b/i, "05")
      .replace(/\bjun(\.|e)?\b/i, "06")
      .replace(/\bjul(\.|y)?\b/i, "07")
      .replace(/\baug(\.|ust)?\b/i, "08")
      .replace(/\bsep(\.|t\.?|tember)?\b/i, "09")
      .replace(/\boct(\.|ober)?\b/i, "10")
      .replace(/\bnov(\.|ember)?\b/i, "11")
      .replace(/\bdec(\.|ember)?\b/i, "12")
      .replace(/^[^\d]+/, "")
      .replace(/[^\d]+$/, "")
      .split(/[^\d]+/);
    if (parts.length >= 3) return parts.slice(0, 3);
    const all = text.replace(/[^\d]/g, "");
    return [all.slice(0, a), all.slice(a, a + b), all.slice(a + b)];
  };
  const yearFirst = groups(4, 2);
  const twoDigits = groups(2, 2);
  let year: string | undefined;
  let month: string | undefined;
  let day: string | undefined;
  switch (order) {
    case "dd mm yyyy":
      [day, month, year] = twoDigits(value);
      break;
    case "dd mm yy": {
      const parts = twoDigits(value);
      [day, month, year] = [parts[0], parts[1], `20${parts[2]}`];
      break;
    }
    case "yyyy mm dd":
      [year, month, day] = yearFirst(value);
      break;
    case "yy mm dd": {
      const parts = twoDigits(value);
      [year, month, day] = [`20${parts[0]}`, parts[1], parts[2]];
      break;
    }
    case "mm dd yy": {
      const parts = twoDigits(value);
      [month, day, year] = [parts[0], parts[1], `20${parts[2]}`];
      break;
    }
    case "mm dd yyyy":
      [month, day, year] = twoDigits(value);
      break;
  }
  const parsed = `${year}-${pad(month)}-${pad(day)}`;
  return d.isValid(d.parseISO(parsed)) ? parsed : null;
};

/** A parsed file row: CSV cells by column, or the fields of an OFX, QIF or CAMT transaction. */
export type RawRow = Record<string, unknown>;

export const EMPTY_MAPPING: ImportMapping = {
  date: null,
  payee: null,
  notes: null,
  amount: null,
  inflow: null,
  outflow: null,
  inOut: null,
  category: null,
};

/** The row's fields as the mapping names them; an unmapped field reads the column of its name. */
export const applyFieldMappings = (row: RawRow, mapping: ImportMapping): RawRow => {
  const result: RawRow = {};
  for (const [field, target] of Object.entries(mapping))
    result[field === "payee" ? "payee_name" : field] = row[target ?? field];
  return result;
};

/** Guesses which columns hold which fields from the first row, as Actual's dialog does. */
export const initialMapping = (rows: ReadonlyArray<RawRow>): ImportMapping => {
  const first = rows[0];
  if (first === undefined) return EMPTY_MAPPING;
  const fields = Object.entries(first);
  const key = (entry: [string, unknown] | undefined) => (entry === undefined ? null : entry[0]);
  const named = (part: string) => fields.find(([name]) => name.toLowerCase().includes(part));
  const date = key(
    named("date") ?? fields.find(([, value]) => /^\d+[-/]\d+[-/]\d+$/.test(String(value))),
  );
  const amount = key(
    named("amount") ?? fields.find(([, value]) => /^-?[.,\d]+$/.test(String(value))),
  );
  const category = key(named("category"));
  const payee = key(
    named("payee") ??
      fields.find(([name]) => name !== date && name !== amount && name !== category),
  );
  const notes = key(
    named("notes") ??
      fields.find(
        ([name]) => name !== date && name !== amount && name !== category && name !== payee,
      ),
  );
  const inOut = key(
    fields.find(([name]) => name !== date && name !== amount && name !== payee && name !== notes),
  );
  return { ...EMPTY_MAPPING, date, amount, payee, notes, inOut, category };
};

/** The first date order that reads the first row's date; `mm dd yyyy` when none does. */
export const initialDateFormat = (
  rows: ReadonlyArray<RawRow>,
  dateField: string | null,
): ImportDateFormat => {
  const first = rows[0];
  if (first === undefined || dateField === null) return "yyyy mm dd";
  const date = first[dateField];
  const found =
    date == null ? undefined : DATE_FORMATS.find((format) => parseDate(date, format) !== null);
  return found ?? "mm dd yyyy";
};

const parseAmount = (amount: unknown, mapper: (parsed: number) => number): number | null => {
  if (amount == null) return null;
  const parsed =
    typeof amount === "string"
      ? looselyParseAmount(amount)
      : typeof amount === "number"
        ? amount
        : null;
  return parsed === null ? null : mapper(parsed);
};

export interface AmountOptions {
  /** Separate inflow and outflow columns. */
  readonly splitMode: boolean;
  /** A column says whether the amount goes in or out. */
  readonly inOutMode: boolean;
  readonly outValue: string;
  readonly flipAmount: boolean;
  readonly multiplier: number;
}

/** The row's signed amount (as a decimal number) from its amount, inflow/outflow or in/out fields. */
export const parseAmountFields = (row: RawRow, options: AmountOptions): number => {
  const value = { outflow: 0, inflow: 0 };
  if (options.splitMode && !options.inOutMode) {
    // An outflow wins; the inflow counts only without one.
    value.outflow = parseAmount(row["outflow"], (n) => -Math.abs(n)) || 0;
    value.inflow = value.outflow ? 0 : parseAmount(row["inflow"], (n) => Math.abs(n)) || 0;
  } else {
    const amount = parseAmount(row["amount"], (n) => n) || 0;
    if (amount >= 0) value.inflow = amount;
    else value.outflow = amount;
  }
  if (options.inOutMode) {
    const amount = value.outflow || value.inflow;
    if (row["inOut"] === options.outValue) {
      value.outflow = -Math.abs(amount);
      value.inflow = 0;
    } else {
      value.inflow = Math.abs(amount);
      value.outflow = 0;
    }
  }
  if (options.flipAmount) {
    const inflow = value.inflow;
    value.inflow = Math.abs(value.outflow);
    value.outflow = -Math.abs(inflow);
  }
  const multiplier = options.multiplier || 1;
  return value.outflow * multiplier || value.inflow * multiplier;
};

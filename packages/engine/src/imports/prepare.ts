/** A bank file and the import dialog's options, turned into transactions to import. */
import type { ImportDateFormat, ImportFileType, ImportMapping } from "./types.ts";
import { and, isNull, or, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { invalid, type Book } from "../book.ts";
import * as t from "../db/schema.ts";
import {
  amountToInteger,
  applyFieldMappings,
  initialDateFormat,
  initialMapping,
  parseAmountFields,
  parseDate,
  type RawRow,
} from "./fields.ts";
import { fileTypeOf, parseFile, type FileContent } from "./parse/file.ts";
import { payeeFromText } from "./payee-text.ts";

/** The file fields of preview_import and import_transactions. */
export interface FileInput {
  readonly path?: string;
  readonly content?: string;
  readonly fileName?: string;
  readonly fileType?: ImportFileType;
  readonly encoding?: string;
  readonly delimiter?: string;
  readonly hasHeaderRow?: boolean;
  readonly skipStartLines?: number;
  readonly skipEndLines?: number;
  readonly dateField?: string;
  readonly payeeField?: string;
  readonly notesField?: string;
  readonly amountField?: string;
  readonly inflowField?: string;
  readonly outflowField?: string;
  readonly categoryField?: string;
  readonly inOutField?: string;
  readonly outValue?: string;
  readonly dateFormat?: ImportDateFormat;
  readonly flipAmount?: boolean;
  readonly multiplier?: number;
  readonly importNotes?: boolean;
  readonly fallbackMissingPayeeToMemo?: boolean;
  readonly swapPayeeAndMemo?: boolean;
  readonly startDate?: string;
  readonly cleared?: boolean;
  readonly derivePayees?: boolean;
}

/** A transaction to import, as a file row gives it or a caller sends it. */
export interface PreparedRow {
  readonly index: number;
  readonly date: string;
  readonly amount: number;
  readonly payee: string | null;
  readonly importedPayee: string | null;
  readonly notes: string | null;
  readonly category: string | null;
  readonly categoryName: string | null;
  readonly importedId: string | null;
  readonly cleared: boolean;
  readonly skip?: boolean;
  readonly forceAdd?: boolean;
}

export interface Prepared {
  readonly fileType: ImportFileType;
  readonly columns: Array<string>;
  readonly mapping: ImportMapping | null;
  readonly dateFormat: ImportDateFormat | null;
  readonly rows: Array<PreparedRow>;
  readonly errors: Array<{ readonly index: number; readonly message: string }>;
}

export const hasFile = (input: FileInput) =>
  input.path !== undefined || input.content !== undefined;

const readContent = (input: FileInput): { content: FileContent; name: string } => {
  if (input.path !== undefined) {
    const file = resolve(input.path);
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(file);
    } catch {
      return invalid(`Cannot read the file ${file}`);
    }
    return { content: { bytes }, name: input.fileName ?? file };
  }
  if (input.content !== undefined)
    return { content: { text: input.content }, name: input.fileName ?? "" };
  return invalid("Give the file's path or its content");
};

const text = (value: unknown): string | null =>
  typeof value === "string" ? value : typeof value === "number" ? String(value) : null;

const nonEmpty = (value: unknown): string | null => {
  const found = text(value);
  return found === null || found === "" ? null : found;
};

/** The book's category with exactly this name, as Actual's dialog finds one. */
const categoryNamed = (book: Book) => {
  const categories = book.db
    .select({ id: t.accounts.id, name: t.accounts.name })
    .from(t.accounts)
    .where(
      and(
        or(eq(t.accounts.type, "expense"), eq(t.accounts.type, "income")),
        isNull(t.accounts.system),
      ),
    )
    .orderBy(t.accounts.sortOrder)
    .all();
  return (name: string | null) =>
    name === null ? null : (categories.find((category) => category.name === name)?.id ?? null);
};

/** The payee derived from a file's text, or null when the text already is one. */
const derivedPayee = (filed: string | null): string | null => {
  const trimmed = filed?.trim();
  if (!trimmed) return null;
  const payee = payeeFromText(trimmed, null);
  return payee === trimmed ? null : payee;
};

const mappingOf = (input: FileInput, rows: ReadonlyArray<RawRow>): ImportMapping => {
  const guessed = initialMapping(rows);
  const split = input.inflowField !== undefined || input.outflowField !== undefined;
  return {
    date: input.dateField ?? guessed.date,
    payee: input.payeeField ?? guessed.payee,
    notes: input.notesField ?? guessed.notes,
    amount: input.amountField ?? (split ? null : guessed.amount),
    inflow: input.inflowField ?? null,
    outflow: input.outflowField ?? null,
    inOut: input.inOutField ?? guessed.inOut,
    category: input.categoryField ?? guessed.category,
  };
};

/** Reads the file and applies the import options, newest first as Actual's dialog lists them. */
export const prepareFile = (book: Book, input: FileInput): Prepared => {
  const { content, name } = readContent(input);
  const fileType = input.fileType ?? fileTypeOf(name) ?? invalid("Invalid file type");
  const raw = parseFile(fileType, content, {
    hasHeaderRow: input.hasHeaderRow ?? true,
    delimiter: input.delimiter ?? (name.toLowerCase().endsWith(".tsv") ? "\t" : ","),
    ...(input.encoding !== undefined && { encoding: input.encoding }),
    ...(input.skipStartLines !== undefined && { skipStartLines: input.skipStartLines }),
    ...(input.skipEndLines !== undefined && { skipEndLines: input.skipEndLines }),
    fallbackMissingPayeeToMemo: input.fallbackMissingPayeeToMemo ?? true,
    swapPayeeAndMemo: input.swapPayeeAndMemo ?? false,
    importNotes: input.importNotes ?? true,
  });

  const isCsv = fileType === "csv";
  const preParsed = fileType === "ofx" || fileType === "camt";
  const mapping = isCsv ? mappingOf(input, raw) : null;
  const dateFormat = isCsv
    ? (input.dateFormat ?? initialDateFormat(raw, mapping!.date))
    : fileType === "qif"
      ? (input.dateFormat ?? initialDateFormat(raw, "date"))
      : null;
  const splitMode = mapping !== null && (mapping.inflow !== null || mapping.outflow !== null);
  const amountOptions = {
    splitMode,
    inOutMode: isCsv && input.outValue !== undefined,
    outValue: input.outValue ?? "",
    flipAmount: input.flipAmount ?? false,
    multiplier: input.multiplier ?? 1,
  };
  const findCategory = categoryNamed(book);
  const importNotes = input.importNotes ?? true;
  const derivePayees = input.derivePayees ?? true;

  const rows: Array<PreparedRow> = [];
  const errors: Array<{ index: number; message: string }> = [];
  raw.forEach((row, index) => {
    const mapped = mapping === null ? row : applyFieldMappings(row, mapping);
    const date = preParsed ? text(mapped["date"]) : parseDate(mapped["date"], dateFormat!);
    if (date === null) {
      // Actual keeps a row it cannot date in a start-date filter, to fail on it.
      errors.push({
        index,
        message: `Unable to parse date ${text(mapped["date"]) || "(empty)"} with given date format`,
      });
      return;
    }
    if (input.startDate !== undefined && date < input.startDate) return;
    const categoryName = nonEmpty(mapped["category"]);
    const filed = text(mapped["payee_name"]);
    const derived = derivePayees ? derivedPayee(filed) : null;
    rows.push({
      index,
      date,
      amount: amountToInteger(parseAmountFields(mapped, amountOptions)),
      payee: derived ?? filed,
      importedPayee: derived ?? text(mapped["imported_payee"]),
      notes: importNotes ? (nonEmpty(mapped["notes"]) ?? (derived === null ? null : filed)) : null,
      category: findCategory(categoryName),
      categoryName,
      importedId: nonEmpty(mapped["imported_id"]),
      cleared: input.cleared ?? true,
    });
  });
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date === b.date ? 0 : -1));
  return {
    fileType,
    columns: isCsv && raw[0] !== undefined ? Object.keys(raw[0]) : [],
    mapping,
    dateFormat,
    rows,
    errors,
  };
};

/** Reading a bank file into rows, ported from Actual's `parse-file.ts`. */
import type { ImportFileType } from "../types.ts";
import { parse as csv2json } from "csv-parse/sync";
import { invalid } from "../../book.ts";
import { looselyParseAmount, type RawRow } from "../fields.ts";
import { decodeXmlBytes, xmlCamt2json } from "./camt.ts";
import { decodeOfxBytes, ofx2json, parseOfxAmount } from "./ofx.ts";
import { qif2json } from "./qif.ts";

export interface ParseOptions {
  readonly hasHeaderRow?: boolean;
  readonly delimiter?: string;
  readonly encoding?: string;
  readonly skipStartLines?: number;
  readonly skipEndLines?: number;
  readonly fallbackMissingPayeeToMemo?: boolean;
  readonly swapPayeeAndMemo?: boolean;
  readonly importNotes?: boolean;
}

/** A file's text, or its bytes to decode as its type says. */
export type FileContent = { readonly text: string } | { readonly bytes: Uint8Array };

/** The file type a name's extension says, as Actual's dialog tells it; undefined for others. */
export const fileTypeOf = (name: string): ImportFileType | undefined => {
  const extension = name.match(/\.([^.]*)$/)?.[1]?.toLowerCase();
  switch (extension) {
    case "csv":
    case "tsv":
      return "csv";
    case "ofx":
    case "qfx":
      return "ofx";
    case "qif":
      return "qif";
    case "xml":
      return "camt";
    default:
      return undefined;
  }
};

const failed = (message: string): never => invalid(`Failed parsing: ${message}`);

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** CSV bytes as text: the encoding given, else UTF-16 by its byte order mark, else UTF-8. */
export const decodeCsvBytes = (bytes: Uint8Array, encoding = "auto"): string => {
  if (encoding !== "auto") return new TextDecoder(encoding).decode(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
};

const textOf = (content: FileContent, decode: (bytes: Uint8Array) => string) =>
  "text" in content ? content.text : decode(content.bytes);

const parseCsv = (content: FileContent, options: ParseOptions): Array<RawRow> => {
  let text: string;
  try {
    text = textOf(content, (bytes) => decodeCsvBytes(bytes, options.encoding));
  } catch (error) {
    return failed(errorMessage(error));
  }
  const skipStart = Math.max(0, options.skipStartLines ?? 0);
  const skipEnd = Math.max(0, options.skipEndLines ?? 0);
  if (skipStart > 0 || skipEnd > 0) {
    const lines = text.split(/\r?\n/);
    if (skipStart + skipEnd >= lines.length)
      invalid("Cannot skip more lines than exist in the file");
    text = lines.slice(skipStart, skipEnd > 0 ? lines.length - skipEnd : lines.length).join("\r\n");
  }
  try {
    const rows = csv2json(text, {
      columns: options.hasHeaderRow ?? true,
      bom: true,
      delimiter: options.delimiter || ",",
      quote: '"',
      trim: true,
      relax_column_count: true,
      skip_empty_lines: true,
    }) as Array<Record<string, string> | Array<string>>;
    // Without a header, the columns are named by their index.
    return rows.map((row) => (Array.isArray(row) ? Object.fromEntries(row.entries()) : row));
  } catch (error) {
    return failed(errorMessage(error));
  }
};

/** The payee and the notes of a file transaction after the swap, fallback and notes options. */
const payeeAndNotes = (
  payee: string | null | undefined,
  memo: string | null | undefined,
  swap: boolean,
  fallback: boolean,
  importNotes: boolean,
) => {
  const payeeSource = swap ? memo : payee;
  const memoSource = swap ? payee : memo;
  const fallbackUsed = !payeeSource && fallback;
  const name = payeeSource || (fallbackUsed ? memoSource : null) || null;
  return {
    payee_name: name,
    imported_payee: name,
    notes: importNotes && !fallbackUsed ? memoSource || null : null,
  };
};

const parseQif = (content: FileContent, options: ParseOptions): Array<RawRow> => {
  let data: ReturnType<typeof qif2json>;
  try {
    data = qif2json(textOf(content, (bytes) => new TextDecoder("utf-8").decode(bytes)));
  } catch {
    return invalid("Failed parsing: doesn't look like a valid QIF file.");
  }
  const swap = options.swapPayeeAndMemo === true;
  return data.transactions
    .map((trans) => ({
      amount: trans.amount != null ? looselyParseAmount(trans.amount) : null,
      date: trans.date,
      ...payeeAndNotes(trans.payee, trans.memo, swap, swap, options.importNotes ?? true),
      category: trans.subcategory || trans.category || null,
    }))
    .filter((trans) => trans.date != null && trans.amount != null);
};

const parseOfx = (content: FileContent, options: ParseOptions): Array<RawRow> => {
  let data: ReturnType<typeof ofx2json>;
  try {
    data = ofx2json(textOf(content, decodeOfxBytes));
  } catch (error) {
    return invalid(`Failed importing file: ${errorMessage(error)}`);
  }
  return data.transactions.map((trans) => {
    const amount = parseOfxAmount(trans.amount);
    if (amount === null) invalid(`Invalid amount format: ${trans.amount}`);
    return {
      amount: amount || 0,
      imported_id: trans.fitId ?? null,
      date: trans.date,
      ...payeeAndNotes(
        trans.name,
        trans.memo,
        options.swapPayeeAndMemo === true,
        options.fallbackMissingPayeeToMemo ?? true,
        options.importNotes ?? true,
      ),
    };
  });
};

const parseCamt = (content: FileContent, options: ParseOptions): Array<RawRow> => {
  let data: ReturnType<typeof xmlCamt2json>;
  try {
    data = xmlCamt2json(textOf(content, decodeXmlBytes));
  } catch (error) {
    return invalid(`Failed importing file: ${errorMessage(error)}`);
  }
  const swap = options.swapPayeeAndMemo === true;
  return data.map((trans) => ({
    ...trans,
    ...payeeAndNotes(trans.payee_name, trans.notes, swap, swap, options.importNotes ?? true),
  }));
};

/** The rows of a bank file: CSV cells by column, or each transaction's fields for the others. */
export const parseFile = (
  type: ImportFileType,
  content: FileContent,
  options: ParseOptions = {},
): Array<RawRow> => {
  switch (type) {
    case "csv":
      return parseCsv(content, options);
    case "qif":
      return parseQif(content, options);
    case "ofx":
      return parseOfx(content, options);
    case "camt":
      return parseCamt(content, options);
  }
};

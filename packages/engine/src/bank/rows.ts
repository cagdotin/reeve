/** Turns a provider's statement lines and balances into what the import takes. */
import { dayToInt } from "@reeve/contract/rules";
import { createHash } from "node:crypto";
import type { RowToImport } from "../imports/reconcile.ts";
import type { ProviderBalance, ProviderTransaction } from "./client.ts";
import { payeeFromText, type BankOfLine } from "../imports/payee-text.ts";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * SEPA clearing metadata at the start of a remittance line, as Actual strips it. A list of known
 * prefixes, since a merchant's name may start with letters and a plus too.
 */
const SEPA_PREFIX =
  /^(?:EREF|KREF|MREF|CRED|DBTR|CDTR|SVWZ|SVCL|PURP|RTRN|REJT|REFE|SDVA|INDA|NTAV|ULTC|ULTD|ULTB|ABWA|ABWE|IBAN|BIC|COAM|OAMT|REMI|SQTP|ROC)\+/;

/** Cents from a decimal string, by its digits: `parseFloat("19.99") * 100` is 1998.9999999999998. */
export const parseCents = (text: string): number | null => {
  const match = /^([+-]?)(\d+)(?:\.(\d{1,2})0*)?$/.exec(text.trim());
  if (match === null) return null;
  const cents = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return match[1] === "-" ? -cents : cents;
};

const signed = (line: ProviderTransaction, cents: number) => {
  if (line.credit_debit_indicator === "DBIT") return -Math.abs(cents);
  if (line.credit_debit_indicator === "CRDT") return Math.abs(cents);
  return cents;
};

const counterparty = (line: ProviderTransaction) => {
  const creditor = line.creditor?.name?.trim() || null;
  const debtor = line.debtor?.name?.trim() || null;
  if (line.credit_debit_indicator === "CRDT") return debtor;
  if (line.credit_debit_indicator === "DBIT") return creditor;
  return creditor ?? debtor;
};

const fieldsOf = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

/** An account number as rules and suggestions compare it: no spaces, upper case; null for none. */
export const normalAccountNumber = (text: string | null | undefined): string | null => {
  const normal = text?.replace(/\s+/g, "").toUpperCase() ?? "";
  return normal === "" ? null : normal;
};

const accountNumberOf = (account: unknown): string | null => {
  const fields = fieldsOf(account);
  const number = fields?.["iban"] ?? fieldsOf(fields?.["other"])?.["identification"];
  return typeof number === "string" ? normalAccountNumber(number) : null;
};

/**
 * The other party's account number on a line as the bank sent it: the debtor's for money in, the
 * creditor's for money out. An IBAN, or a BBAN in `other`.
 */
export const counterpartyAccount = (line: Readonly<Record<string, unknown>>): string | null => {
  const creditor = accountNumberOf(line["creditor_account"]);
  const debtor = accountNumberOf(line["debtor_account"]);
  if (line["credit_debit_indicator"] === "CRDT") return debtor;
  if (line["credit_debit_indicator"] === "DBIT") return creditor;
  return creditor ?? debtor;
};

export type MappedLine =
  | { readonly kind: "row"; readonly row: Omit<RowToImport, "index"> }
  | { readonly kind: "unreadable" }
  | { readonly kind: "other_currency" };

/** `#` would start a tag in reeve's notes, and a bank's text means none. */
const escapeTags = (text: string) => text.replaceAll("#", "##");

export interface LineContext {
  readonly bank: BankOfLine;
  readonly currency: string | null;
}

export const mapLine = (line: ProviderTransaction, context: LineContext): MappedLine => {
  const date = line.booking_date || line.value_date || line.transaction_date || "";
  const cents = parseCents(line.transaction_amount.amount);
  if (!DAY.test(date) || cents === null) return { kind: "unreadable" };
  if (context.currency !== null && line.transaction_amount.currency !== context.currency)
    return { kind: "other_currency" };

  const remittance = (line.remittance_information ?? [])
    .map((text) => text.replace(SEPA_PREFIX, "").trim())
    .filter((text) => text !== "");
  const named = counterparty(line);
  // Revolut sends the description first and the other party second, with no party fields.
  const revolut = context.bank.name.toLowerCase().includes("revolut");
  const text = revolut && remittance.length > 1 ? remittance[1]! : remittance.join(" ");
  const payee = named ?? (text === "" ? null : payeeFromText(text, context.bank));
  const notes =
    revolut && named === null && remittance.length > 1 ? remittance[0]! : remittance.join(" ");
  return {
    kind: "row",
    row: {
      date,
      amount: signed(line, cents),
      payee,
      importedPayee: payee,
      notes: notes === "" ? null : escapeTags(notes),
      cleared: true,
    },
  };
};

const contentOf = (line: ProviderTransaction, date: string) =>
  JSON.stringify([
    date,
    line.transaction_amount.amount,
    line.transaction_amount.currency,
    line.credit_debit_indicator ?? "",
    line.creditor?.name ?? "",
    line.debtor?.name ?? "",
    line.remittance_information ?? [],
  ]);

const digest = (content: string, length: number) =>
  createHash("sha256").update(content).digest("hex").slice(0, length);

const bookingContent = (line: ProviderTransaction) =>
  contentOf(line, line.booking_date ?? line.value_date ?? line.transaction_date ?? "");

/** Actual's `deriveTransactionId`, which takes the purchase's own day first. */
const derivedBase = (line: ProviderTransaction) => {
  const date = line.transaction_date || line.value_date || line.booking_date || "";
  return `derived-${digest(contentOf(line, date), 32)}`;
};

/**
 * Each importable line's id: its entry reference, which unlike transaction_id stays stable. Some
 * banks share one reference across a booking's lines (Erste's quarterly closing), so those take a
 * content digest too. A line with no reference takes its content's digest, numbered in the bank's
 * order, because identical lines in one fetch are separate purchases.
 */
export const lineIds = (lines: ReadonlyArray<ProviderTransaction>): Array<string> => {
  const contents = new Map<string, Set<string>>();
  for (const line of lines) {
    if (!line.entry_reference) continue;
    const seen = contents.get(line.entry_reference) ?? new Set();
    contents.set(line.entry_reference, seen.add(bookingContent(line)));
  }
  const repeats = new Map<string, number>();
  return lines.map((line) => {
    const reference = line.entry_reference || null;
    if (reference === null) {
      const base = derivedBase(line);
      const count = repeats.get(base) ?? 0;
      repeats.set(base, count + 1);
      return count === 0 ? base : `${base}-${count}`;
    }
    if (contents.get(reference)!.size === 1) return reference;
    return `${reference}:${digest(bookingContent(line), 16)}`;
  });
};

/** Balance types that count only what is booked, so they should equal the cleared balance. */
const BOOKED_TYPES = ["CLBD", "ITBD", "OPBD", "PRCD"];

export const isBookedBalance = (type: string | null) =>
  type !== null && BOOKED_TYPES.includes(type);

export const pickBalance = (
  balances: ReadonlyArray<ProviderBalance>,
  currency: string | null,
): { readonly amount: number; readonly type: string } | null => {
  const usable = balances.filter(
    (balance) => currency === null || balance.balance_amount.currency === currency,
  );
  const chosen =
    BOOKED_TYPES.map((type) => usable.find((balance) => balance.balance_type === type)).find(
      (balance) => balance !== undefined,
    ) ?? usable[0];
  if (chosen === undefined) return null;
  const amount = parseCents(chosen.balance_amount.amount);
  return amount === null ? null : { amount, type: chosen.balance_type };
};

export const lineDay = (row: Omit<RowToImport, "index">) => dayToInt(row.date);

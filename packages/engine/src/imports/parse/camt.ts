/** CAMT.053 (and .052/.054) bank statements, ported from Actual's `xmlcamt2json.ts`. */
import { parseXml } from "./xml.ts";

export interface CamtTransaction {
  amount: number;
  date: string;
  payee_name: string | null;
  imported_payee: string | null;
  notes: string | null;
  imported_id?: string;
}

const findKeys = (object: any, key: string): Array<any> => {
  let result: Array<any> = [];
  for (const name in object) {
    if (!Object.hasOwn(object, name)) continue;
    if (name === key) result = result.concat(object[name]);
    if (typeof object[name] === "object") result = result.concat(findKeys(object[name], key));
  }
  return result;
};

const payeeOf = (details: any, isDebit: boolean): string | null => {
  if (details?.RltdPties === undefined) return null;
  const party = isDebit ? details.RltdPties.Cdtr : details.RltdPties.Dbtr;
  const names = findKeys(party, "Nm");
  return names.length > 0 ? (names[0] as string) : null;
};

const notesOf = (details: any): string | null => {
  if (details?.RmtInf === undefined) return null;
  const unstructured = details.RmtInf.Ustrd;
  return Array.isArray(unstructured) ? unstructured.join(" ") : (unstructured ?? null);
};

const numberOrNull = (value: unknown): number | null => {
  const number = Number(value);
  return Number.isNaN(number) ? null : number;
};

const dayOf = (date: any): string | null => {
  if (date === undefined || date === null) return null;
  if ("DtTm" in date) return String(date.DtTm).slice(0, 10);
  return date.Dt ?? null;
};

/** Decodes XML bytes by the encoding its declaration names, UTF-8 by default. */
export const decodeXmlBytes = (content: Uint8Array): string => {
  const header = new TextDecoder("latin1").decode(content.subarray(0, 500));
  const declared = header.match(/encoding\s*=\s*["']([^"']+)["']/i)?.[1];
  if (declared !== undefined && !/^utf-?8$/i.test(declared)) {
    try {
      return new TextDecoder(declared).decode(content);
    } catch {
      // An unknown label: read it as UTF-8.
    }
  }
  return new TextDecoder("utf-8").decode(content);
};

export const xmlCamt2json = (content: string): Array<CamtTransaction> => {
  const data = parseXml(content, { explicitArray: false });
  const transactions: Array<{
    amount: number | null;
    date: string | null;
    payee_name: string | null;
    imported_payee: string | null;
    notes: string | null;
    imported_id?: string;
  }> = [];
  for (const entry of findKeys(data, "Ntry")) {
    const id: string | undefined = entry.AcctSvcrRef;
    const amount = numberOrNull(entry.Amt?._);
    const isDebit = entry.CdtDbtInd === "DBIT";
    const date = dayOf(entry.ValDt) ?? dayOf(entry.BookgDt);
    // As in Actual, a debit without an amount counts as zero.
    const signed = (value: number | null) => (isDebit ? (value === null ? 0 : -value) : value);

    if (Array.isArray(entry.NtryDtls?.TxDtls)) {
      // A batch becomes one transaction per detail: splits are not imported.
      for (const details of entry.NtryDtls.TxDtls) {
        const payee = payeeOf(details, isDebit);
        const amounts = findKeys(details, "Amt");
        transactions.push({
          amount: signed(amounts.length > 0 ? numberOrNull(amounts[0]._) : null),
          date,
          payee_name: payee,
          imported_payee: payee,
          notes: notesOf(details),
        });
      }
      continue;
    }
    const details = entry.NtryDtls?.TxDtls;
    let payee = payeeOf(details, isDebit);
    if (payee === null && entry.AddtlNtryInf) payee = entry.AddtlNtryInf;
    let notes = notesOf(details);
    if (!notes && entry.AddtlNtryInf && entry.AddtlNtryInf !== payee) notes = entry.AddtlNtryInf;
    if (!payee && !notes && entry.NtryRef) notes = entry.NtryRef;
    if (payee && notes && payee.includes(notes)) notes = null;
    transactions.push({
      amount: signed(amount),
      date,
      payee_name: payee,
      imported_payee: payee,
      notes,
      ...(id ? { imported_id: id } : {}),
    });
  }
  return transactions.filter(
    (trans): trans is CamtTransaction => trans.date != null && trans.amount != null,
  );
};

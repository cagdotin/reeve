/** OFX and QFX statements, ported from Actual's `ofx2json.ts`. */
import { parseXml } from "./xml.ts";

export interface OfxTransaction {
  readonly amount: string | undefined;
  readonly type: string | undefined;
  readonly fitId: string | undefined;
  readonly date: string | null;
  readonly name: string | undefined;
  readonly memo: string | undefined;
}

const sgml2Xml = (sgml: string) =>
  sgml
    .replace(/&/g, "&#038;")
    .replace(/&amp;/g, "&#038;")
    .replace(/>\s+</g, "><")
    .replace(/\s+</g, "<")
    .replace(/>\s+/g, ">")
    .replace(/\.(?=[^<>]*>)/g, "")
    .replace(/<(\w+?)>([^<]+)/g, "<$1>$2</<added>$1>")
    .replace(/<\/<added>(\w+?)>(<\/\1>)?/g, "</$1>");

export const html2Plain = (value: string | undefined): string | undefined =>
  value
    ?.replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/(&amp;|&#038;)/g, "&");

const asArray = (value: unknown): Array<any> =>
  Array.isArray(value) ? value : value === undefined ? [] : [value];

const statementTransactions = (data: any): Array<any> => {
  const ofx = data?.["OFX"];
  if (ofx?.["CREDITCARDMSGSRSV1"] != null)
    return asArray(ofx["CREDITCARDMSGSRSV1"]?.["CCSTMTTRNRS"]).flatMap((s) =>
      asArray(s?.["CCSTMTRS"]?.["BANKTRANLIST"]?.["STMTTRN"]),
    );
  if (ofx?.["INVSTMTMSGSRSV1"] != null)
    return asArray(ofx["INVSTMTMSGSRSV1"]?.["INVSTMTTRNRS"]).flatMap((s) =>
      asArray(
        asArray(s?.["INVSTMTRS"]?.["INVTRANLIST"]?.["INVBANKTRAN"]).flatMap((t) => t?.["STMTTRN"]),
      ),
    );
  return asArray(ofx?.["BANKMSGSRSV1"]?.["STMTTRNRS"]).flatMap((s) =>
    asArray(s?.["STMTRS"]?.["BANKTRANLIST"]?.["STMTTRN"]),
  );
};

const mapTransaction = (stmtTrn: any): OfxTransaction => {
  // YYYYMMDDHHMMSS: only the day counts.
  const posted: string | undefined = stmtTrn["DTPOSTED"];
  const date =
    posted !== undefined && /^\d{8}/.test(posted)
      ? `${posted.slice(0, 4)}-${posted.slice(4, 6)}-${posted.slice(6, 8)}`
      : null;
  return {
    amount: stmtTrn["TRNAMT"],
    type: stmtTrn["TRNTYPE"],
    fitId: stmtTrn["FITID"],
    date,
    name: html2Plain(stmtTrn["NAME"]),
    memo: html2Plain(stmtTrn["MEMO"]),
  };
};

/** Decodes OFX bytes by the encoding or charset its (ASCII) header declares. */
export const decodeOfxBytes = (bytes: Uint8Array): string => {
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  const encoding = header
    .match(/^ENCODING:(.+)/m)?.[1]
    ?.trim()
    .toUpperCase();
  const charset = header
    .match(/^CHARSET:(.+)/m)?.[1]
    ?.trim()
    .toUpperCase();
  if (encoding === "UTF-8") return new TextDecoder("utf-8").decode(bytes);
  if (charset === "8859-1") return new TextDecoder("iso-8859-1").decode(bytes);
  if (charset === "1252") return new TextDecoder("windows-1252").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes);
};

export const ofx2json = (ofx: string) => {
  const [head = "", body = ""] = ofx.split(/<OFX\s?>/, 2);
  const headers: Record<string, string | undefined> = {};
  for (const line of head.split(/\r?\n/)) {
    if (line === "") continue;
    const [key = "", value] = line.split(/:/, 2);
    headers[key] = value;
  }
  const content = `<OFX>${body}`;
  let parsed: unknown;
  try {
    parsed = parseXml(content, { explicitArray: false, trim: true });
  } catch {
    parsed = parseXml(sgml2Xml(content), { explicitArray: false, trim: true });
  }
  return { headers, transactions: statementTransactions(parsed).map(mapTransaction) };
};

/** An OFX amount as a number: currency symbols dropped, parentheses negative; null when unreadable. */
export const parseOfxAmount = (amount: string | undefined): number | null => {
  if (amount === undefined || typeof amount !== "string") return null;
  let cleaned = amount.trim();
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) cleaned = `-${cleaned.slice(1, -1)}`;
  cleaned = cleaned.replace(/[^\d.-]/g, "");
  const point = cleaned.indexOf(".");
  if (point !== -1)
    cleaned = `${cleaned.slice(0, point)}.${cleaned.slice(point + 1).replace(/\./g, "")}`;
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const parsed = parseFloat(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
};

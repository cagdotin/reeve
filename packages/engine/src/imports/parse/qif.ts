/** QIF files, ported from Actual's `qif2json.ts`. */

interface Division {
  category?: string;
  subcategory?: string;
  description?: string;
  amount?: number;
}

export interface QifTransaction {
  date?: string;
  amount?: string;
  number?: string;
  memo?: string;
  address?: Array<string>;
  clearedStatus?: string;
  category?: string;
  subcategory?: string;
  payee?: string;
  division?: Array<Division>;
}

export const qif2json = (qif: string) => {
  const lines = qif.split("\n").filter(Boolean);
  let line = lines.shift() ?? "";
  const type = /!Type:([^$]*)$/.exec(line.trim());
  if (type === null) throw new Error(`File does not appear to be a valid qif file: ${line}`);
  const transactions: Array<QifTransaction> = [];
  let transaction: QifTransaction = {};
  let division: Division = {};

  while ((line = lines.shift() ?? "")) {
    line = line.trim();
    if (line === "^") {
      transactions.push(transaction);
      transaction = {};
      continue;
    }
    const value = line.substring(1);
    switch (line[0]) {
      case "D":
        transaction.date = value;
        break;
      case "T":
        transaction.amount = value;
        break;
      case "N":
        transaction.number = value;
        break;
      case "M":
        transaction.memo = value;
        break;
      case "A":
        transaction.address = [...(transaction.address ?? []), value];
        break;
      case "P":
        transaction.payee = value.replace(/&amp;/g, "&");
        break;
      case "L": {
        const [category, subcategory] = value.split(":");
        transaction.category = category ?? "";
        if (subcategory !== undefined) transaction.subcategory = subcategory;
        break;
      }
      case "C":
        transaction.clearedStatus = value;
        break;
      case "S": {
        const [category, subcategory] = value.split(":");
        division.category = category ?? "";
        if (subcategory !== undefined) division.subcategory = subcategory;
        break;
      }
      case "E":
        division.description = value;
        break;
      case "$":
        division.amount = parseFloat(value);
        transaction.division = [...(transaction.division ?? []), division];
        division = {};
        break;
      default:
        throw new Error(`Unknown Detail Code: ${line[0]}`);
    }
  }
  if (Object.keys(transaction).length > 0) transactions.push(transaction);
  return { type: type[1], transactions };
};

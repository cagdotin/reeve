import { intToDay } from "@reeve/contract/rules";
import { sql } from "drizzle-orm";
import { counterpartyAccount } from "../bank/rows.ts";
import type { Db } from "../db/open.ts";
import type { KeptLine } from "../db/schema.ts";
import { Condition } from "./condition.ts";
import { extractTagsForFilter } from "./fields.ts";
import type { RuleTransaction } from "./rule.ts";

/** One register row, as rules match it: a posting on an asset or liability account. */
export interface RegisterMatch {
  readonly transactionId: string;
  readonly postingId: string;
  readonly accountId: string;
}

interface PostingRow {
  readonly transaction_id: string;
  readonly posting_id: string;
  readonly account_id: string;
  readonly account_type: string;
  readonly account_name: string;
  readonly on_budget: number;
  readonly system: string | null;
  readonly group_id: string | null;
  readonly group_name: string | null;
  readonly amount: number;
  readonly memo: string | null;
  readonly cleared: number;
  readonly reconciled: number;
  readonly date: number;
  readonly created_at: number;
  readonly payee_id: string | null;
  readonly payee_name: string | null;
  readonly imported_payee: string | null;
  readonly notes: string | null;
  readonly schedule_id: string | null;
  readonly kept_line: string | null;
}

const counterpartyOfKept = (json: string | null): string | null =>
  json === null ? null : counterpartyAccount((JSON.parse(json) as KeptLine).line);

/** The other party's account number on the bank line a posting came from. */
export const keptCounterparty = (db: Db, account: string, importedId: string | null) =>
  importedId === null
    ? null
    : counterpartyOfKept(
        db.get<{ readonly line: string | null }>(
          sql`SELECT line FROM seen_imports WHERE account_id = ${account} AND imported_id = ${importedId}`,
        )?.line ?? null,
      );

const isBalance = (row: PostingRow) =>
  row.account_type === "asset" || row.account_type === "liability";

const lineOf = (row: PostingRow) => {
  const balance = isBalance(row);
  const category =
    !balance &&
    row.system === null &&
    (row.account_type === "expense" || row.account_type === "income")
      ? row
      : null;
  return {
    amount: -row.amount,
    category: category?.account_id ?? null,
    categoryName: category?.account_name ?? null,
    group: category?.group_id ?? null,
    groupName: category?.group_name ?? null,
    transfer: balance,
    notes: row.memo,
  };
};

/**
 * Every register row as Actual's rule queries see transactions: a split's parent is not a row,
 * its lines are, each with the parent's payee, date and account. `_names` holds the names that
 * text conditions on id fields read.
 */
export const registerTransactions = (
  db: Db,
  only: { readonly account?: string; readonly transaction?: string } = {},
): Array<{ readonly match: RegisterMatch; readonly rows: Array<RuleTransaction> }> => {
  const { account, transaction } = only;
  const postings = db.all<PostingRow>(
    sql`SELECT p.transaction_id, p.id AS posting_id, p.account_id, a.type AS account_type,
         a.name AS account_name, a.on_budget, a.system, a.group_id, g.name AS group_name,
         p.amount, p.memo, p.cleared, p.reconciled, t.date, t.created_at, t.payee_id,
         pe.name AS payee_name, t.imported_payee, t.notes, t.schedule_id, s.line AS kept_line
       FROM postings p
       JOIN transactions t ON t.id = p.transaction_id
       JOIN accounts a ON a.id = p.account_id
       LEFT JOIN seen_imports s ON s.account_id = p.account_id AND s.imported_id = p.imported_id
       LEFT JOIN category_groups g ON g.id = a.group_id
       LEFT JOIN payees pe ON pe.id = t.payee_id
       WHERE ${transaction === undefined ? sql`1` : sql`t.id = ${transaction}`}
       ORDER BY t.date DESC, t.created_at DESC, p.id DESC, p.sort_order`,
  );
  const byTransaction = Map.groupBy(postings, (row) => row.transaction_id);
  const result: Array<{ match: RegisterMatch; rows: Array<RuleTransaction> }> = [];
  for (const own of postings) {
    if (!isBalance(own) || (account !== undefined && own.account_id !== account)) continue;
    const others = byTransaction.get(own.transaction_id)!.filter((row) => row !== own);
    const lines = others.map(lineOf);
    const base = {
      id: own.transaction_id,
      date: intToDay(own.date),
      account: own.account_id,
      payee: own.payee_id,
      payee_name: own.payee_name,
      imported_payee: own.imported_payee,
      counterparty_account: counterpartyOfKept(own.kept_line),
      cleared: own.cleared === 1,
      reconciled: own.reconciled === 1,
      schedule: own.schedule_id,
      _account: { offbudget: own.on_budget === 1 ? 0 : 1 },
      _names: { account: own.account_name, payee: own.payee_name },
    };
    const rows =
      lines.length === 1
        ? [
            {
              ...base,
              amount: own.amount,
              notes: own.notes,
              category: lines[0]!.category,
              category_group: lines[0]!.group,
              transfer: lines[0]!.transfer,
              parent: false,
              _names: {
                ...base._names,
                category: lines[0]!.categoryName,
                category_group: lines[0]!.groupName,
              },
            },
          ]
        : lines.map((line) => ({
            ...base,
            amount: line.amount,
            notes: line.notes,
            category: line.category,
            category_group: line.group,
            transfer: line.transfer,
            parent: false,
            is_child: true,
            _names: { ...base._names, category: line.categoryName, category_group: line.groupName },
          }));
    result.push({
      match: {
        transactionId: own.transaction_id,
        postingId: own.posting_id,
        accountId: own.account_id,
      },
      rows,
    });
  }
  return result;
};

/** A condition as Actual's `conditionsToAQL` turns it into a query over existing transactions. */
const matchesInQuery = (condition: Condition, row: RuleTransaction): boolean => {
  const { field, op, type, value } = condition;
  if (type === "id" && (op === "contains" || op === "doesNotContain" || op === "matches")) {
    const name: string | null = row["_names"]?.[field] ?? null;
    if (name === null) return false;
    if (op === "matches") {
      try {
        return new RegExp(value).test(name);
      } catch {
        return false;
      }
    }
    const found = name.toLowerCase().includes(String(value).toLowerCase());
    return op === "contains" ? found : !found;
  }
  if ((op === "oneOf" || op === "notOneOf") && value.length === 0) return false;
  if ((op === "hasTags" || op === "hasAnyTag") && extractTagsForFilter(value).length === 0)
    return false;
  if (field === "category" && op === "is" && value === null)
    return condition.eval(row) && row["transfer"] === false && row["parent"] === false;
  if (field === "category" && op === "isNot" && value === null)
    return condition.eval(row) && row["parent"] === false;
  return condition.eval(row);
};

/** Whether a register row matches: conditions must hold together on one of its split lines. */
export const rowMatches = (
  rows: ReadonlyArray<RuleTransaction>,
  conditions: ReadonlyArray<Condition>,
  conditionsOp: "and" | "or",
) =>
  rows.some((row) =>
    conditionsOp === "or"
      ? conditions.some((condition) => matchesInQuery(condition, row))
      : conditions.every((condition) => matchesInQuery(condition, row)),
  );

/** The register rows conditions match, newest first. */
export const matchingRows = (
  db: Db,
  conditions: ReadonlyArray<Condition>,
  conditionsOp: "and" | "or",
  account?: string,
): Array<RegisterMatch> => {
  if (conditions.length === 0) return [];
  return registerTransactions(db, account === undefined ? {} : { account })
    .filter(({ rows }) => rowMatches(rows, conditions, conditionsOp))
    .map(({ match }) => match);
};

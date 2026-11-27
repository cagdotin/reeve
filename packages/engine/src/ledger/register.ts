import type { Counterpart, RegisterPage, RegisterRow, SplitLine } from "@reeve/contract";
import { dayToInt, intToDay } from "@reeve/contract/rules";
import type { SQLInputValue } from "node:sqlite";
import type { Book } from "../book.ts";

export interface RegisterQuery {
  readonly account?: string;
  readonly accounts?: ReadonlyArray<string>;
  readonly categories?: ReadonlyArray<string>;
  readonly payees?: ReadonlyArray<string>;
  readonly status?: ReadonlyArray<"uncleared" | "cleared" | "reconciled">;
  readonly from?: string;
  readonly to?: string;
  readonly query?: string;
  readonly uncategorized?: boolean;
  readonly onBudget?: boolean;
  /** Only these transactions, as a schedule or a rule preview asks. */
  readonly ids?: ReadonlyArray<string>;
  readonly limit?: number;
  readonly offset?: number;
}

interface Row {
  readonly transaction_id: string;
  readonly posting_id: string;
  readonly account_id: string;
  readonly account_name: string;
  readonly date: number;
  readonly payee_id: string | null;
  readonly payee: string | null;
  readonly notes: string | null;
  readonly amount: number;
  readonly cleared: number;
  readonly reconciled: number;
  readonly schedule_id: string | null;
  readonly balance: number | null;
}

interface OtherPosting {
  readonly transaction_id: string;
  readonly id: string;
  readonly account_id: string;
  readonly name: string;
  readonly type: string;
  readonly system: string | null;
  readonly amount: number;
  readonly memo: string | null;
  readonly category_id: string | null;
  readonly category_name: string | null;
}

const kindOf = (other: OtherPosting): SplitLine["kind"] =>
  other.system === "uncategorized"
    ? "uncategorized"
    : other.type === "expense" || other.type === "income"
      ? "category"
      : other.type === "asset" || other.type === "liability"
        ? "transfer"
        : "other";

const counterpartOf = (others: ReadonlyArray<OtherPosting>): Counterpart => {
  if (others.length !== 1) return { kind: "split", count: others.length };
  const other = others[0]!;
  const kind = kindOf(other);
  if (kind === "uncategorized") return { kind };
  return { kind, id: other.account_id, name: other.name };
};

/**
 * Register rows: one per posting on an asset or liability account (in `account` when given),
 * newest first, with the other postings of each transaction as its counterpart or splits. With
 * an account and no other filter, each row carries the account's balance after it.
 */
export const listRegister = (book: Book, query: RegisterQuery): RegisterPage => {
  const where: Array<string> = ["a.type IN ('asset', 'liability')"];
  const params: Array<SQLInputValue> = [];
  const add = (clause: string, ...values: Array<SQLInputValue>) => {
    where.push(clause);
    params.push(...values);
  };
  const oneOf = (values: ReadonlyArray<SQLInputValue>) =>
    values.map(() => "?").join(", ") || "NULL";
  if (query.account !== undefined) add("p.account_id = ?", query.account);
  if (query.accounts !== undefined)
    add(`p.account_id IN (${oneOf(query.accounts)})`, ...query.accounts);
  if (query.categories !== undefined) {
    const list = oneOf(query.categories);
    add(
      `EXISTS (SELECT 1 FROM postings q WHERE q.transaction_id = t.id AND (q.account_id IN (${list}) OR q.category_id IN (${list})))`,
      ...query.categories,
      ...query.categories,
    );
  }
  if (query.payees !== undefined) add(`t.payee_id IN (${oneOf(query.payees)})`, ...query.payees);
  if (query.from !== undefined) add("t.date >= ?", dayToInt(query.from));
  if (query.to !== undefined) add("t.date <= ?", dayToInt(query.to));
  if (query.status !== undefined)
    add(
      `(CASE WHEN p.reconciled = 1 THEN 'reconciled' WHEN p.cleared = 1 THEN 'cleared' ELSE 'uncleared' END) IN (${oneOf(query.status)})`,
      ...query.status,
    );
  if (query.onBudget !== undefined) add("a.on_budget = ?", query.onBudget ? 1 : 0);
  if (query.uncategorized === true)
    add(
      "a.on_budget = 1 AND t.id IN (SELECT q.transaction_id FROM postings q JOIN accounts c ON c.id = q.account_id WHERE c.system = 'uncategorized')",
    );
  if (query.ids !== undefined) add(`t.id IN (${oneOf(query.ids)})`, ...query.ids);
  if (query.query !== undefined && query.query.trim() !== "") {
    const like = `%${query.query.trim().toLowerCase()}%`;
    add(
      `(lower(coalesce(pe.name, '')) LIKE ? OR lower(coalesce(t.notes, '')) LIKE ? OR EXISTS (
         SELECT 1 FROM postings q JOIN accounts c ON c.id = q.account_id
         WHERE q.transaction_id = t.id AND (lower(c.name) LIKE ? OR lower(coalesce(q.memo, '')) LIKE ?)))`,
      like,
      like,
      like,
      like,
    );
  }
  const filtered = where.length > 2 || query.account === undefined;
  const balance =
    query.account !== undefined && !filtered
      ? "sum(p.amount) OVER (ORDER BY t.date, t.created_at, p.id ROWS UNBOUNDED PRECEDING)"
      : "NULL";
  const base = `
    FROM postings p
    JOIN transactions t ON t.id = p.transaction_id
    JOIN accounts a ON a.id = p.account_id
    LEFT JOIN payees pe ON pe.id = t.payee_id
    WHERE ${where.join(" AND ")}`;
  const total = (
    book.client.prepare(`SELECT count(*) AS n ${base}`).get(...params) as { n: number }
  ).n;
  const limit = query.limit ?? 200;
  const offset = query.offset ?? 0;
  const rows = book.client
    .prepare(
      `SELECT * FROM (
        SELECT t.id AS transaction_id, p.id AS posting_id, p.account_id, a.name AS account_name,
          t.date, t.payee_id, pe.name AS payee, t.notes, p.amount, p.cleared, p.reconciled,
          t.schedule_id, ${balance} AS balance, t.created_at
        ${base}
      ) ORDER BY date DESC, created_at DESC, posting_id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as unknown as Array<Row>;

  const transactionIds = [...new Set(rows.map((row) => row.transaction_id))];
  const others = Map.groupBy(
    transactionIds.length === 0
      ? []
      : (book.client
          .prepare(
            `SELECT q.transaction_id, q.id, q.account_id, c.name, c.type, c.system, q.amount, q.memo,
               q.category_id, cc.name AS category_name
             FROM postings q JOIN accounts c ON c.id = q.account_id
             LEFT JOIN accounts cc ON cc.id = q.category_id
             WHERE q.transaction_id IN (${transactionIds.map(() => "?").join(", ")})
             ORDER BY q.sort_order`,
          )
          .all(...transactionIds) as unknown as Array<OtherPosting>),
    (posting) => posting.transaction_id,
  );

  return {
    total,
    rows: rows.map((row): RegisterRow => {
      const rest = (others.get(row.transaction_id) ?? []).filter(
        (posting) => posting.id !== row.posting_id,
      );
      // A transfer across the budget shows its budget category, as Actual does.
      const crossCategory = rest.length === 1 && rest[0]!.category_id !== null ? rest[0]! : null;
      return {
        transactionId: row.transaction_id,
        postingId: row.posting_id,
        accountId: row.account_id,
        accountName: row.account_name,
        date: intToDay(row.date),
        payeeId: row.payee_id,
        payee: row.payee,
        notes: row.notes,
        amount: row.amount,
        cleared: row.cleared === 1,
        reconciled: row.reconciled === 1,
        scheduleId: row.schedule_id,
        counterpart: counterpartOf(rest),
        splits:
          rest.length > 1
            ? rest.map((posting) => ({
                postingId: posting.id,
                accountId: posting.account_id,
                name: posting.name,
                kind: kindOf(posting),
                amount: -posting.amount,
                memo: posting.memo,
              }))
            : crossCategory !== null
              ? [
                  {
                    postingId: crossCategory.id,
                    accountId: crossCategory.category_id!,
                    name: crossCategory.category_name ?? "",
                    kind: "category",
                    amount: -crossCategory.amount,
                    memo: crossCategory.memo,
                  },
                ]
              : [],
        balance: row.balance,
      };
    }),
  };
};

/**
 * Report lines: the ledger as Actual's reports query it. Actual's transactions are one row per
 * account with split children as separate rows; here each posting on an asset or liability account
 * gives one line per other posting of its transaction when it is the transaction's first posting
 * (the split's parent), or one line against that first posting otherwise. A line has the signed
 * amount as the account sees it, its category (or the category a transfer to an off-budget account
 * counts against), and the account on the other side when it is a transfer.
 */
import type { SQLInputValue } from "node:sqlite";
import type { AccountScope } from "@reeve/contract/catalog";
import { addDays, dayToInt, isCalendarDay } from "@reeve/contract/rules";
import { invalid, type Book } from "../book.ts";

export interface Condition {
  readonly field: string;
  readonly op: string;
  readonly value?: unknown;
}

export type ConditionsOp = "and" | "or";

export const LINES = `
  ranked AS (
    SELECT p.id, p.transaction_id, p.account_id, p.amount, p.memo, p.category_id, p.cleared,
      p.reconciled, row_number() OVER (PARTITION BY p.transaction_id ORDER BY p.sort_order, p.id) AS rn
    FROM postings p
  ),
  pairs AS (
    SELECT m.transaction_id, m.account_id AS self, -o.amount AS amount, o.account_id AS other,
      o.category_id AS other_category, coalesce(o.memo, m.memo) AS memo, m.cleared, m.reconciled
    FROM ranked m JOIN ranked o ON o.transaction_id = m.transaction_id AND o.rn > 1
    WHERE m.rn = 1
    UNION ALL
    SELECT o.transaction_id, o.account_id, o.amount, m.account_id, m.category_id, o.memo,
      o.cleared, o.reconciled
    FROM ranked o JOIN ranked m ON m.transaction_id = o.transaction_id AND m.rn = 1
    WHERE o.rn > 1
  ),
  sided AS (
    SELECT pr.*, a.name AS account_name, a.on_budget,
      CASE WHEN c.type IN ('expense', 'income') AND c.system IS NULL THEN c.id
           WHEN c.type IN ('asset', 'liability') AND a.on_budget = 1 THEN pr.other_category
      END AS category_id,
      CASE WHEN c.type IN ('asset', 'liability') THEN c.id END AS transfer_account,
      CASE WHEN c.type IN ('asset', 'liability') THEN c.name END AS transfer_name,
      c.type = 'equity' AS opening
    FROM pairs pr
    JOIN accounts a ON a.id = pr.self AND a.type IN ('asset', 'liability')
    JOIN accounts c ON c.id = pr.other
  ),
  lines AS (
    SELECT s.transaction_id AS tid, t.date, t.payee_id, pe.name AS payee_name,
      t.imported_payee, t.notes, s.self AS account_id, s.account_name, s.on_budget, s.amount,
      s.memo, s.cleared, s.reconciled, s.category_id, cat.name AS category_name,
      coalesce(cat.hidden, 0) AS category_hidden,
      -- Actual books an opening balance to its "Starting Balances" income category.
      CASE WHEN s.opening THEN 1 ELSE coalesce(g.is_income, 0) END AS category_income,
      cat.group_id, g.name AS group_name, coalesce(g.hidden, 0) AS group_hidden,
      s.transfer_account, s.transfer_name
    FROM sided s
    JOIN transactions t ON t.id = s.transaction_id
    LEFT JOIN payees pe ON pe.id = t.payee_id
    LEFT JOIN accounts cat ON cat.id = s.category_id
    LEFT JOIN category_groups g ON g.id = cat.group_id
  )`;

/** A line as the reports read it. */
export interface Line {
  readonly tid: string;
  readonly date: number;
  readonly payee_id: string | null;
  readonly payee_name: string | null;
  readonly notes: string | null;
  readonly account_id: string;
  readonly on_budget: number;
  readonly amount: number;
  readonly category_id: string | null;
  readonly category_hidden: number;
  readonly category_income: number;
  readonly group_id: string | null;
  readonly group_hidden: number;
  readonly transfer_account: string | null;
  readonly transfer_name: string | null;
}

export interface Where {
  readonly sql: string;
  readonly params: Array<SQLInputValue>;
}

const registered = new WeakSet<object>();

/** `#tag` in notes, as Actual's tag filter: not escaped by `##`, ending at a space, `#` or the end. */
const tagPattern = (tag: string) =>
  new RegExp(`(^|[^#])#${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([\\s#]|$)`, "u");

/** Registers the SQL functions the filters use on the book's connection. */
export const prepare = (book: Book) => {
  if (registered.has(book.client)) return;
  registered.add(book.client);
  book.client.function("reeve_regexp", { deterministic: true }, (pattern, text) => {
    if (typeof pattern !== "string") return 0;
    try {
      return new RegExp(pattern).test(text === null || text === undefined ? "" : String(text))
        ? 1
        : 0;
    } catch {
      return 0;
    }
  });
  book.client.function("reeve_has_tag", { deterministic: true }, (notes, tag) =>
    typeof notes === "string" && typeof tag === "string" && tagPattern(tag).test(notes) ? 1 : 0,
  );
};

/** The tags a filter value names: each word, with one `#` (Actual's `extractTagsForFilter`). */
const tagsForFilter = (value: string): Array<string> => [
  ...new Set([...value.matchAll(/#*([^#\s]+)/g)].map((match) => match[1]!)),
];

interface Column {
  readonly type: "id" | "string" | "number" | "date" | "boolean";
  readonly sql: string;
  /** The name an id column's text operators match. */
  readonly name?: string;
}

const COLUMNS: Record<string, Column> = {
  account: { type: "id", sql: "l.account_id", name: "l.account_name" },
  category: { type: "id", sql: "l.category_id", name: "l.category_name" },
  category_group: { type: "id", sql: "l.group_id", name: "l.group_name" },
  payee: { type: "id", sql: "l.payee_id", name: "l.payee_name" },
  payee_name: { type: "string", sql: "l.payee_name" },
  imported_payee: { type: "string", sql: "l.imported_payee" },
  notes: { type: "string", sql: "l.notes" },
  date: { type: "date", sql: "l.date" },
  amount: { type: "number", sql: "l.amount" },
  amount_inflow: { type: "number", sql: "l.amount" },
  amount_outflow: { type: "number", sql: "l.amount" },
  cleared: { type: "boolean", sql: "l.cleared" },
  reconciled: { type: "boolean", sql: "l.reconciled" },
  transfer: { type: "boolean", sql: "(l.transfer_account IS NOT NULL)" },
};

const NOTHING: Where = { sql: "0", params: [] };

const list = (value: unknown): Array<unknown> =>
  Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];

/** A day, month or year filter value as its lowest database day, as Actual compares the text. */
const dateBound = (value: unknown): { low: number; high: number } => {
  const text = typeof value === "string" ? value : "";
  if (/^\d{4}$/.test(text)) return { low: Number(`${text}0000`), high: Number(`${text}9999`) };
  if (/^\d{4}-\d{2}$/.test(text))
    return {
      low: Number(`${text.replace("-", "")}00`),
      high: Number(`${text.replace("-", "")}99`),
    };
  if (isCalendarDay(text)) return { low: dayToInt(text), high: dayToInt(text) };
  return invalid(`A date filter takes a day, month or year, not ${JSON.stringify(value)}`);
};

const numberOf = (value: unknown): number => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : invalid(`Not an amount: ${JSON.stringify(value)}`);
};

const approxThreshold = (number: number) => Math.round(Math.abs(number) * 0.075);

const COMPARE: Record<string, string> = { gt: ">", gte: ">=", lt: "<", lte: "<=" };

const conditionSql = (condition: Condition): Where => {
  const { field, op, value } = condition;
  const column = COLUMNS[field];
  if (column === undefined) return invalid(`Reports cannot filter on ${field}`);
  const c = column.sql;
  if (op === "onBudget") return { sql: "l.on_budget = 1", params: [] };
  if (op === "offBudget") return { sql: "l.on_budget = 0", params: [] };

  switch (column.type) {
    case "number": {
      const amount =
        field === "amount_outflow" ? "-l.amount" : field === "amount_inflow" ? "l.amount" : c;
      const sign =
        field === "amount_outflow"
          ? "l.amount < 0 AND "
          : field === "amount_inflow"
            ? "l.amount > 0 AND "
            : "";
      if (op === "isbetween") {
        const range = (value ?? {}) as { num1?: unknown; num2?: unknown };
        const [low, high] = [numberOf(range.num1), numberOf(range.num2)].sort((a, b) => a - b);
        return { sql: `(${c} >= ? AND ${c} <= ?)`, params: [low!, high!] };
      }
      const number = numberOf(value);
      if (op === "is") return { sql: `(${sign}${amount} = ?)`, params: [number] };
      if (op === "isNot") return { sql: `(${sign}${amount} != ?)`, params: [number] };
      if (op === "isapprox") {
        const threshold = approxThreshold(number);
        return {
          sql: `(${sign}${amount} >= ? AND ${sign}${amount} <= ?)`,
          params: [number - threshold, number + threshold],
        };
      }
      if (op in COMPARE) return { sql: `(${sign}${amount} ${COMPARE[op]} ?)`, params: [number] };
      break;
    }
    case "date": {
      if (op === "isapprox") {
        const day = typeof value === "string" && isCalendarDay(value) ? value : null;
        if (day === null) return invalid("isapprox on a date takes a day");
        return {
          sql: `(${c} >= ? AND ${c} <= ?)`,
          params: [dayToInt(addDays(day, -2)), dayToInt(addDays(day, 2))],
        };
      }
      const { low, high } = dateBound(value);
      if (op === "is") return { sql: `(${c} >= ? AND ${c} <= ?)`, params: [low, high] };
      if (op === "isNot") return { sql: `(${c} < ? OR ${c} > ?)`, params: [low, high] };
      // A month or year compares as its text, so only its lowest day matters.
      if (op in COMPARE) return { sql: `(${c} ${COMPARE[op]} ?)`, params: [low] };
      break;
    }
    case "boolean": {
      if (op === "is") return { sql: `(${c} = ?)`, params: [value ? 1 : 0] };
      if (op === "isNot") return { sql: `(${c} != ?)`, params: [value ? 1 : 0] };
      break;
    }
    case "id":
    case "string": {
      const text = column.type === "id" ? (column.name ?? c) : `lower(${c})`;
      const lower = (each: unknown) =>
        column.type === "string" && typeof each === "string" ? each.toLowerCase() : each;
      const param = (each: unknown) => lower(each) as SQLInputValue;
      switch (op) {
        case "is":
          if (value === null || value === undefined || value === "") {
            // Actual: a category that is nothing is not a transfer's.
            const notTransfer = field === "category" ? " AND l.transfer_account IS NULL" : "";
            return {
              sql: `((${c} IS NULL${column.type === "string" ? ` OR ${c} = ''` : ""})${notTransfer})`,
              params: [],
            };
          }
          return { sql: `(${column.type === "id" ? c : text} = ?)`, params: [param(value)] };
        case "isNot":
          return {
            sql: `(${column.type === "id" ? c : text} IS NOT ?)`,
            params: [param(value ?? null)],
          };
        case "oneOf": {
          const values = list(value);
          if (values.length === 0) return NOTHING;
          return {
            sql: `(${column.type === "id" ? c : text} IN (${values.map(() => "?").join(", ")}))`,
            params: values.map(param),
          };
        }
        case "notOneOf": {
          const values = list(value);
          if (values.length === 0) return NOTHING;
          return {
            sql: `(${values.map(() => `${column.type === "id" ? c : text} IS NOT ?`).join(" AND ")})`,
            params: values.map(param),
          };
        }
        case "contains":
          return {
            sql: `(lower(${column.name ?? c}) LIKE ?)`,
            params: [`%${String(value ?? "").toLowerCase()}%`],
          };
        case "doesNotContain":
          return {
            sql: `(lower(coalesce(${column.name ?? c}, '')) NOT LIKE ?)`,
            params: [`%${String(value ?? "").toLowerCase()}%`],
          };
        case "matches":
          return { sql: `(reeve_regexp(?, ${text}) = 1)`, params: [String(value ?? "")] };
        case "hasTags": {
          const tags = tagsForFilter(String(value ?? ""));
          if (tags.length === 0) return NOTHING;
          return {
            sql: `(${tags.map(() => `reeve_has_tag(${c}, ?) = 1`).join(" AND ")})`,
            params: tags,
          };
        }
      }
      break;
    }
  }
  return invalid(`Reports cannot filter ${field} with ${op}`);
};

/** The SQL that keeps the lines matching all (and) or any (or) of the conditions. */
export const whereOf = (
  conditions: ReadonlyArray<Condition> | undefined,
  op: ConditionsOp | undefined,
): Where => {
  if (conditions === undefined || conditions.length === 0) return { sql: "1", params: [] };
  const parts = conditions.map(conditionSql);
  return {
    sql: `(${parts.map((part) => part.sql).join(op === "or" ? " OR " : " AND ")})`,
    params: parts.flatMap((part) => part.params),
  };
};

/** Combines SQL conditions with AND. */
export const allOf = (...parts: ReadonlyArray<Where>): Where => ({
  sql: parts.map((part) => part.sql).join(" AND ") || "1",
  params: parts.flatMap((part) => part.params),
});

export const sqlOf = (sql: string, ...params: Array<SQLInputValue>): Where => ({ sql, params });

/** The accounts a scope covers; undefined when it covers every account. */
export const scopeIds = (
  book: Book,
  scope: AccountScope | undefined,
): ReadonlyArray<string> | undefined => {
  if (scope === undefined || scope.mode === "all") return undefined;
  if (scope.mode === "selected") return scope.ids;
  return (
    book.client
      .prepare("SELECT id FROM accounts WHERE type IN ('asset', 'liability') AND on_budget = ?")
      .all(scope.mode === "budgeted" ? 1 : 0) as Array<{ id: string }>
  ).map((row) => row.id);
};

/** The lines inside an account scope, to AND with a report's conditions. */
export const scopeWhere = (book: Book, scope: AccountScope | undefined): Where => {
  const ids = scopeIds(book, scope);
  return ids === undefined ? sqlOf("1") : inIds("l.account_id", ids);
};

/** A report's conditions, inside its account scope. */
export const reportFilters = (
  book: Book,
  input: {
    readonly conditions?: ReadonlyArray<Condition> | undefined;
    readonly conditionsOp?: ConditionsOp | undefined;
    readonly scope?: AccountScope | undefined;
  },
): Where => allOf(whereOf(input.conditions, input.conditionsOp), scopeWhere(book, input.scope));

export const inIds = (column: string, ids: ReadonlyArray<string>): Where =>
  sqlOf(`${column} IN (${ids.map(() => "?").join(", ") || "NULL"})`, ...ids);

/** Runs `SELECT <select> FROM lines l WHERE <where> <rest>` over the report lines. */
export const queryLines = <Row>(
  book: Book,
  select: string,
  where: Where,
  rest = "",
): Array<Row> => {
  prepare(book);
  return book.client
    .prepare(`WITH ${LINES} SELECT ${select} FROM lines l WHERE ${where.sql} ${rest}`)
    .all(...where.params) as unknown as Array<Row>;
};

/** The first and last day with a transaction, if any. */
export const transactionBounds = (book: Book): { earliest: number | null; latest: number | null } =>
  book.client
    .prepare("SELECT min(date) AS earliest, max(date) AS latest FROM transactions")
    .get() as {
    earliest: number | null;
    latest: number | null;
  };

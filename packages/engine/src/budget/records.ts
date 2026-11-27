import type { FigureRecords } from "@reeve/contract";
import { monthToInt } from "@reeve/contract/rules";
import { invalid, type Book } from "../book.ts";
import { listRegister } from "../ledger/register.ts";
import { IN_BUDGET } from "./view.ts";

/** A category with every subcategory under it, or every category of a group. */
const SCOPE = {
  category: `WITH RECURSIVE scope(id) AS (
      SELECT id FROM accounts WHERE id = ?
      UNION SELECT a.id FROM accounts a JOIN scope s ON a.parent_id = s.id)
    SELECT id FROM scope`,
  group: "SELECT id FROM accounts WHERE group_id = ? AND type IN ('expense', 'income')",
};

/**
 * The register rows behind a budget figure in a month, as `activityOf` sums it: postings on the
 * categories, and the category a transfer to an off-budget account counts against, in transactions
 * that touch a budget account. Each transaction shows from its budget account's side.
 */
export const budgetTransactions = (
  book: Book,
  input: { readonly category?: string; readonly group?: string; readonly month: string },
): FigureRecords => {
  if ((input.category === undefined) === (input.group === undefined))
    invalid("Give either a category or a group");
  const [scope, id] =
    input.category === undefined ? [SCOPE.group, input.group!] : [SCOPE.category, input.category];
  const month = monthToInt(input.month);
  const counted = book.client
    .prepare(
      `SELECT tid, sum(amount) AS amount FROM (
         SELECT p.transaction_id AS tid, -p.amount AS amount
         FROM postings p JOIN transactions t ON t.id = p.transaction_id
         JOIN accounts a ON a.id = p.account_id
         WHERE p.account_id IN (${scope}) AND a.type IN ('expense', 'income') AND a.system IS NULL
           AND t.date / 100 = ? AND ${IN_BUDGET}
         UNION ALL
         SELECT p.transaction_id, -p.amount
         FROM postings p JOIN transactions t ON t.id = p.transaction_id
         JOIN accounts a ON a.id = p.account_id
         WHERE p.category_id IN (${scope}) AND a.on_budget = 0 AND t.date / 100 = ? AND ${IN_BUDGET}
       ) GROUP BY tid`,
    )
    .all(id, month, id, month) as Array<{ tid: string; amount: number }>;
  const amounts = new Map(counted.map((line) => [line.tid, line.amount]));
  const onBudget = new Set(
    (
      book.client.prepare("SELECT id FROM accounts WHERE on_budget = 1").all() as Array<{
        id: string;
      }>
    ).map((account) => account.id),
  );
  const register = listRegister(book, { ids: [...amounts.keys()], limit: Number.MAX_SAFE_INTEGER });
  const sides = Map.groupBy(register.rows, (row) => row.transactionId);
  const rows = [...sides.values()].map((each) => {
    const row = each.find((side) => onBudget.has(side.accountId)) ?? each[0]!;
    return { counted: amounts.get(row.transactionId)!, row };
  });
  return { total: rows.reduce((sum, each) => sum + each.counted, 0), rows };
};

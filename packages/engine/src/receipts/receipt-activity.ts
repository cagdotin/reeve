/**
 * What the receipts page reads (docs/rules/purchases.md): the overview of a range, and `list_receipts` with
 * the filters and sorts that need each receipt's computed status. Status is computed on read, so
 * both read every receipt once; receipts number in the thousands where transactions do not.
 */
import type {
  ReceiptCheck,
  ReceiptOverview,
  ReceiptSort,
  ReceiptSummary,
} from "@reeve/contract/catalog";
import {
  allocate,
  lineMismatch,
  RECEIPT_STAGES,
  receiptStage,
  type ReceiptStage,
} from "@reeve/contract/receipts";
import { addMonths, dayToInt, monthOf } from "@reeve/contract/rules";
import type { Book } from "../book.ts";
import { daysBetween } from "../ledger/payee-insights.ts";
import { currentDay, subDays } from "../rules/dates.ts";
import { effectiveItemCategory, itemSubtree, loadContext, type Context } from "./context.ts";
import * as r from "./schema.ts";
import { listReceipts, summaries, type ReceiptQuery } from "./view.ts";

const TREND_MONTHS = 12;
const OLD_DAYS = 30;
const NO_STORE = "No store";
const NO_ITEM_CATEGORY = "No item category";

interface Line {
  readonly receiptId: string;
  readonly lineTotal: number;
  readonly quantity: number;
  readonly unitPrice: number | null;
  readonly itemCategoryId: string | null;
  readonly productId: string | null;
  readonly budgetCategoryId: string | null;
}

const allLines = (book: Book): Array<Line> =>
  book.db
    .select({
      receiptId: r.receiptLines.receiptId,
      lineTotal: r.receiptLines.lineTotal,
      quantity: r.receiptLines.quantity,
      unitPrice: r.receiptLines.unitPrice,
      itemCategoryId: r.receiptLines.itemCategoryId,
      productId: r.receiptLines.productId,
      budgetCategoryId: r.receiptLines.budgetCategoryId,
    })
    .from(r.receiptLines)
    .orderBy(r.receiptLines.receiptId, r.receiptLines.position)
    .all();

const mismatchedReceipts = (lines: ReadonlyArray<Line>) =>
  new Set(lines.filter((line) => lineMismatch(line) !== null).map((line) => line.receiptId));

/** Whether a receipt fails a check. The counts and the lists both ask this. */
const fails = (
  check: ReceiptCheck,
  receipt: ReceiptSummary,
  mismatched: ReadonlySet<string>,
  oldBefore: string,
): boolean => {
  const { status } = receipt;
  switch (check) {
    case "off":
      return !status.balanced && status.lineCount > 0;
    case "no_lines":
      return status.lineCount === 0;
    case "no_payment":
      return !status.matched;
    case "uncategorized_lines":
      return status.uncategorizedLines > 0;
    case "unapplied":
      return status.matched && !status.applied;
    case "line_mismatch":
      return mismatched.has(receipt.id);
    case "old":
      return receiptStage(status) !== "finished" && receipt.date < oldBefore;
  }
};

const compareBy: Record<ReceiptSort, (a: ReceiptSummary, b: ReceiptSummary) => number> = {
  date: (a, b) => a.date.localeCompare(b.date),
  store: (a, b) => (a.payee ?? "").localeCompare(b.payee ?? ""),
  lines: (a, b) => a.status.lineCount - b.status.lineCount,
  total: (a, b) => a.total - b.total,
  progress: (a, b) =>
    RECEIPT_STAGES.indexOf(receiptStage(a.status)) - RECEIPT_STAGES.indexOf(receiptStage(b.status)),
};

/** The receipts with a line in an item category's subtree, or with a line in none. */
const receiptsInCategory = (book: Book, id: string | null): Set<string> => {
  const context = loadContext(book);
  const subtree = id === null ? null : itemSubtree(context, id);
  return new Set(
    allLines(book)
      .filter((line) => {
        const own = effectiveItemCategory(context, line);
        return subtree === null ? own === null : own !== null && subtree.has(own);
      })
      .map((line) => line.receiptId),
  );
};

export interface ReceiptPageQuery extends ReceiptQuery {
  readonly noStore?: boolean;
  readonly stage?: ReceiptStage | "unfinished";
  readonly check?: ReceiptCheck;
  readonly itemCategoryId?: string;
  readonly noItemCategory?: boolean;
  readonly sort?: ReceiptSort;
  readonly descending?: boolean;
}

/** `list_receipts`: everything that matches is read, so filters and sorts span all its pages. */
export const receiptPage = (book: Book, input: ReceiptPageQuery) => {
  const {
    noStore = false,
    stage,
    check,
    itemCategoryId,
    noItemCategory = false,
    sort = "date",
    descending = sort === "date",
    limit = 100,
    offset = 0,
    payeeIds,
    ...filters
  } = input;
  let list = listReceipts(book, {
    ...filters,
    ...(payeeIds === undefined || noStore ? {} : { payeeIds }),
    limit: Number.MAX_SAFE_INTEGER,
  }).receipts;
  if (noStore) {
    const stores = new Set(payeeIds ?? []);
    list = list.filter((each) => each.payeeId === null || stores.has(each.payeeId));
  }
  if (stage !== undefined)
    list = list.filter((each) => {
      const at = receiptStage(each.status);
      return stage === "unfinished" ? at !== "finished" : at === stage;
    });
  if (check !== undefined) {
    const mismatched =
      check === "line_mismatch" ? mismatchedReceipts(allLines(book)) : new Set<string>();
    const oldBefore = subDays(currentDay(), OLD_DAYS);
    list = list.filter((each) => fails(check, each, mismatched, oldBefore));
  }
  if (itemCategoryId !== undefined) {
    const within = receiptsInCategory(book, itemCategoryId);
    list = list.filter((each) => within.has(each.id));
  }
  if (noItemCategory) {
    const within = receiptsInCategory(book, null);
    list = list.filter((each) => within.has(each.id));
  }
  // The list arrives newest first, and sort is stable, so ties stay newest first.
  const compare = compareBy[sort];
  const sorted = list.toSorted((a, b) => (descending ? compare(b, a) : compare(a, b)));
  return { receipts: sorted.slice(offset, offset + limit), total: sorted.length };
};

const periodOf = (receipts: ReadonlyArray<ReceiptSummary>) => {
  const purchases = receipts.filter((each) => each.total > 0);
  const paid = purchases.reduce((sum, each) => sum + each.total, 0);
  const refunds = receipts
    .filter((each) => each.total < 0)
    .reduce((sum, each) => sum - each.total, 0);
  return {
    receipts: receipts.length,
    spent: paid - refunds,
    refunds,
    purchases: purchases.length,
    average: purchases.length === 0 ? 0 : Math.round(paid / purchases.length),
  };
};

const rootOf = (context: Context, id: string | null): string | null => {
  if (id === null) return null;
  const seen = new Set<string>();
  let at = id;
  for (;;) {
    const parent = context.itemCategories.get(at)?.parentId ?? null;
    if (parent === null || seen.has(parent)) return at;
    seen.add(at);
    at = parent;
  }
};

const categoryName = (context: Context, id: string | null) =>
  id === null ? NO_ITEM_CATEGORY : (context.itemCategories.get(id)?.name ?? "");

interface CategoryShare {
  readonly date: string;
  readonly root: string | null;
  readonly spent: number;
}

/** Each line's share of what its receipt paid, under its top-level item category. */
const categoryShares = (
  context: Context,
  receipts: ReadonlyArray<ReceiptSummary>,
  lines: ReadonlyArray<Line>,
): Array<CategoryShare> => {
  const byReceipt = Map.groupBy(lines, (line) => line.receiptId);
  return receipts.flatMap((receipt) => {
    const own = byReceipt.get(receipt.id) ?? [];
    const shares = allocate(
      receipt.total,
      own.map((line) => line.lineTotal),
    );
    return own.map((line, index) => ({
      date: receipt.date,
      root: rootOf(context, effectiveItemCategory(context, line)),
      spent: shares[index]!,
    }));
  });
};

const sumBy = <A>(rows: ReadonlyArray<A>, value: (row: A) => number) =>
  rows.reduce((sum, row) => sum + value(row), 0);

/** A range's first and last day as stored; a side left out is open. */
const dayBounds = (since: string | undefined, until: string | undefined) =>
  [
    since === undefined ? 0 : dayToInt(since),
    until === undefined ? Number.MAX_SAFE_INTEGER : dayToInt(until),
  ] as const;

/** Spending the ledger records on expense categories between two days, by payee. */
const recordedSpending = (book: Book, since: string | undefined, until: string | undefined) => {
  const rows = book.client
    .prepare(
      `SELECT t.payee_id AS payee, sum(q.amount) AS spent
       FROM postings q
       JOIN accounts a ON a.id = q.account_id AND a.type = 'expense'
       JOIN transactions t ON t.id = q.transaction_id
       WHERE t.date >= ? AND t.date <= ?
       GROUP BY t.payee_id`,
    )
    .all(...dayBounds(since, until)) as Array<{
    payee: string | null;
    spent: number;
  }>;
  return new Map(rows.map((row) => [row.payee, row.spent]));
};

/**
 * What receipts' payments account for, on transactions between two days. A transaction counts for at
 * most what it posts to expense accounts, the same way round, so that only what is in recorded
 * spending can cover it: a refund paid into an income category covers nothing.
 */
const coveredSpending = (book: Book, since: string | undefined, until: string | undefined) => {
  const rows = book.client
    .prepare(
      `SELECT sum(rp.amount) AS paid,
         (SELECT coalesce(sum(q.amount), 0) FROM postings q
          JOIN accounts a ON a.id = q.account_id AND a.type = 'expense'
          WHERE q.transaction_id = t.id) AS spent
       FROM receipt_payments rp JOIN transactions t ON t.id = rp.transaction_id
       WHERE t.date >= ? AND t.date <= ?
       GROUP BY t.id`,
    )
    .all(...dayBounds(since, until)) as Array<{ paid: number; spent: number }>;
  return sumBy(rows, ({ paid, spent }) =>
    Math.sign(paid) === Math.sign(spent)
      ? Math.sign(paid) * Math.min(Math.abs(paid), Math.abs(spent))
      : 0,
  );
};

export const receiptActivity = (
  book: Book,
  { since, until }: { readonly since?: string; readonly until?: string },
): ReceiptOverview => {
  const today = currentDay();
  const context = loadContext(book);
  const all = summaries(book, book.db.select().from(r.receipts).all()).toSorted((a, b) =>
    a.date.localeCompare(b.date),
  );
  const lines = allLines(book);
  const shares = categoryShares(context, all, lines);
  const previousSince =
    since === undefined ? null : subDays(since, daysBetween(since, until ?? today) + 1);
  const inRange = (day: string) =>
    (since === undefined || day >= since) && (until === undefined || day <= until);
  const inPrevious = (day: string) =>
    previousSince !== null && since !== undefined && day >= previousSince && day < since;
  const inRangeReceipts = all.filter((each) => inRange(each.date));
  const previousReceipts = all.filter((each) => inPrevious(each.date));
  const recorded = recordedSpending(book, since, until);

  const stageCount = (stage: ReceiptStage) =>
    inRangeReceipts.filter((each) => receiptStage(each.status) === stage).length;

  const stores = [...Map.groupBy(all, (each) => each.payeeId)]
    .map(([id, own]) => {
      const current = own.filter((each) => inRange(each.date));
      return {
        id,
        name: own[0]!.payee ?? NO_STORE,
        spent: sumBy(current, (each) => each.total),
        previous: sumBy(
          own.filter((each) => inPrevious(each.date)),
          (each) => each.total,
        ),
        receipts: current.length,
        recorded: id === null ? 0 : (recorded.get(id) ?? 0),
      };
    })
    .filter((store) => store.receipts > 0 || store.previous !== 0)
    .toSorted((a, b) => b.spent - a.spent || a.name.localeCompare(b.name));

  const lineCounts = new Map<string | null, number>();
  const rangeIds = new Set(inRangeReceipts.map((each) => each.id));
  for (const line of lines)
    if (rangeIds.has(line.receiptId)) {
      const root = rootOf(context, effectiveItemCategory(context, line));
      lineCounts.set(root, (lineCounts.get(root) ?? 0) + 1);
    }
  const categories = [...Map.groupBy(shares, (share) => share.root)]
    .map(([id, own]) => ({
      id,
      name: categoryName(context, id),
      spent: sumBy(
        own.filter((share) => inRange(share.date)),
        (share) => share.spent,
      ),
      previous: sumBy(
        own.filter((share) => inPrevious(share.date)),
        (share) => share.spent,
      ),
      lines: lineCounts.get(id) ?? 0,
    }))
    .filter((category) => category.lines > 0 || category.previous !== 0)
    .toSorted((a, b) => b.spent - a.spent || a.name.localeCompare(b.name));

  const thisMonth = monthOf(today);
  const sharesByMonth = Map.groupBy(shares, (share) => monthOf(share.date));
  const receiptsByMonth = Map.groupBy(all, (each) => monthOf(each.date));
  const months = Array.from({ length: TREND_MONTHS }, (_, index) => {
    const month = addMonths(thisMonth, index + 1 - TREND_MONTHS);
    const own = receiptsByMonth.get(month) ?? [];
    const { receipts, spent, average } = periodOf(own);
    return {
      month,
      receipts,
      spent,
      average,
      unfinished: own.filter((each) => receiptStage(each.status) !== "finished").length,
      categories: [...Map.groupBy(sharesByMonth.get(month) ?? [], (share) => share.root)].map(
        ([id, parts]) => ({
          id,
          name: categoryName(context, id),
          spent: sumBy(parts, (part) => part.spent),
        }),
      ),
    };
  });

  const mismatched = mismatchedReceipts(lines);
  const oldBefore = subDays(today, OLD_DAYS);
  const failing = (check: ReceiptCheck) =>
    all.filter((each) => fails(check, each, mismatched, oldBefore));
  const uncategorized = failing("uncategorized_lines");
  const named = new Map(
    all.flatMap((each) =>
      each.payeeId === null ? [] : [[each.payeeId, each.payee ?? ""] as const],
    ),
  );

  return {
    total: all.length,
    earliest: all[0]?.date ?? null,
    summary: {
      ...periodOf(inRangeReceipts),
      previous: since === undefined ? null : periodOf(previousReceipts),
    },
    months,
    pipeline: {
      balance: stageCount("balance"),
      match: stageCount("match"),
      categorize: stageCount("categorize"),
      apply: stageCount("apply"),
      finished: stageCount("finished"),
    },
    unfinished: all.filter((each) => receiptStage(each.status) !== "finished").length,
    stores,
    storeChoices: [...named]
      .map(([id, name]) => ({ id, name }))
      .toSorted((a, b) => a.name.localeCompare(b.name)),
    categories,
    unitemized: sumBy(
      inRangeReceipts.filter((each) => each.status.lineCount === 0),
      (each) => each.total,
    ),
    coverage: {
      recorded: sumBy([...recorded.values()], (spent) => spent),
      covered: coveredSpending(book, since, until),
      unlinked: sumBy(inRangeReceipts, (each) =>
        each.total > 0 ? Math.max(0, each.total - each.status.paidAmount) : 0,
      ),
    },
    attention: {
      off: failing("off").length,
      offAmount: sumBy(failing("off"), (each) => Math.abs(each.status.difference)),
      noLines: failing("no_lines").length,
      noPayment: failing("no_payment").length,
      uncategorizedLines: uncategorized.length,
      uncategorizedLineCount: sumBy(uncategorized, (each) => each.status.uncategorizedLines),
      unapplied: failing("unapplied").length,
      lineMismatch: failing("line_mismatch").length,
      old: failing("old").length,
      oldDays: OLD_DAYS,
    },
  };
};

import type { SplitInput } from "@reeve/contract";
import { dayToInt } from "@reeve/contract/rules";
import { eq, sql } from "drizzle-orm";
import { readSettings } from "../book.ts";
import type { Db } from "../db/open.ts";
import * as t from "../db/schema.ts";
import type { EntryDraft } from "../ledger/transactions.ts";
import type { Action } from "./action.ts";
import {
  extractBalanceOfLiterals,
  formulaPreferencesFor,
  setFormulaPreferences,
} from "./formula.ts";
import type { RuleTransaction } from "./rule.ts";
import type { EntryContext } from "./run.ts";

/** A payee a rule named that does not exist yet; it is created when the entry is written. */
const NEW_PAYEE = "new:";

const payeeByName = (db: Db, name: string | null): string | null => {
  const trimmed = name?.trim() ?? "";
  if (trimmed === "") return null;
  return (
    db
      .select({ id: t.payees.id })
      .from(t.payees)
      .where(sql`lower(${t.payees.name}) = lower(${trimmed})`)
      .get()?.id ?? null
  );
};

const payeeName = (db: Db, id: string | null): string | null =>
  id === null
    ? null
    : (db.select({ name: t.payees.name }).from(t.payees).where(eq(t.payees.id, id)).get()?.name ??
      null);

const accountRow = (db: Db, id: string | null) =>
  id === null ? undefined : db.select().from(t.accounts).where(eq(t.accounts.id, id)).get();

/** The book's number format for formulas. */
export const useBookFormulaPreferences = (db: Db) => {
  const settings = readSettings(db);
  setFormulaPreferences(formulaPreferencesFor(settings.currency, settings.numberFormat));
};

/**
 * The account's balance before a transaction on `date`: every earlier day, and the same day's
 * transactions entered before it (all of them for one not written yet).
 */
export const runningBalance = (
  db: Db,
  account: string,
  date: string,
  transactionId: string | null,
): number => {
  const day = dayToInt(date);
  const created =
    transactionId === null
      ? undefined
      : db
          .select({ createdAt: t.transactions.createdAt })
          .from(t.transactions)
          .where(eq(t.transactions.id, transactionId))
          .get()?.createdAt;
  const row = db
    .select({ total: sql<number | null>`sum(${t.postings.amount})` })
    .from(t.postings)
    .innerJoin(t.transactions, eq(t.transactions.id, t.postings.transactionId))
    .where(
      created === undefined
        ? sql`${t.postings.accountId} = ${account} AND ${t.transactions.date} <= ${day}`
        : sql`${t.postings.accountId} = ${account} AND ${t.transactions.id} <> ${transactionId} AND (${t.transactions.date} < ${day} OR (${t.transactions.date} = ${day} AND ${t.transactions.createdAt} < ${created}))`,
    )
    .get();
  return row?.total ?? 0;
};

const BALANCE_VARIABLE = /\bbalance\b/i;

/** Whether actions read the running balance: `{{balance}}` in a template or `balance` in a formula. */
export const actionsReferenceBalance = (
  actions: ReadonlyArray<{
    readonly options?: { readonly template?: string; readonly formula?: string } | null | undefined;
  }>,
): boolean =>
  actions.some(({ options }) => {
    const { template, formula } = options ?? {};
    return (
      (typeof template === "string" && BALANCE_VARIABLE.test(template)) ||
      (typeof formula === "string" && BALANCE_VARIABLE.test(formula))
    );
  });

/** The balances `BALANCE_OF("...")` reads in these actions' formulas, by account id or name. */
export const prefetchBalanceOf = (
  db: Db,
  trans: RuleTransaction,
  actions: ReadonlyArray<Action>,
): Map<string, number> => {
  const map = new Map<string, number>();
  for (const action of actions) {
    if (typeof action.options?.formula !== "string") continue;
    for (const literal of extractBalanceOfLiterals(action.options.formula)) {
      if (map.has(literal)) continue;
      const account =
        accountRow(db, literal) ??
        db.select().from(t.accounts).where(eq(t.accounts.name, literal)).get();
      map.set(
        literal,
        account === undefined
          ? 0
          : runningBalance(db, account.id, trans["date"], trans["id"] ?? null),
      );
    }
  }
  return map;
};

const categoryInfo = (db: Db, id: string | null) => {
  const row = accountRow(db, id);
  return row === undefined ? undefined : { name: row.name, group: row.groupId };
};

/** Fills in what conditions read beyond the entry: account, payee and category details. */
const enrich = (db: Db, trans: RuleTransaction) => {
  const account = accountRow(db, trans["account"]);
  if (account !== undefined) {
    trans["_account"] = { offbudget: account.onBudget ? 0 : 1 };
    trans["_account_name"] = account.name;
  }
  const category = categoryInfo(db, trans["category"]);
  if (category !== undefined) {
    trans["_category_name"] = category.name;
    trans["category_group"] = category.group;
  }
};

/** A register entry as Actual's rules see a transaction. */
export const toRuleTransaction = (
  db: Db,
  entry: EntryDraft,
  extra: EntryContext = {},
): RuleTransaction => {
  const name = entry.payee?.trim() || null;
  const found = payeeByName(db, name);
  // A payee the entry names that does not exist yet is still a payee, not "nothing".
  const payee = found ?? (name === null ? null : `${NEW_PAYEE}${name}`);
  const trans: RuleTransaction = {
    ...(extra.id === undefined ? {} : { id: extra.id }),
    date: entry.date,
    account: entry.account,
    amount: entry.amount,
    payee,
    payee_name: found === null ? name : payeeName(db, found),
    imported_payee: entry.importedPayee,
    counterparty_account: extra.counterpartyAccount ?? null,
    notes: entry.notes,
    category: entry.splits === null ? entry.category : null,
    cleared: entry.cleared,
    reconciled: extra.reconciled ?? false,
    transfer: entry.transferAccount !== null,
    parent: entry.splits !== null && entry.splits.length > 0,
    schedule: entry.scheduleId,
    balance: 0,
  };
  enrich(db, trans);
  return trans;
};

/** After a rule ran: a payee named by `payee_name` gets its id, and the category its group. */
export const settle = (db: Db, trans: RuleTransaction) => {
  if (trans["payee"] === "new") {
    const name = typeof trans["payee_name"] === "string" ? trans["payee_name"].trim() : "";
    trans["payee"] = name === "" ? null : (payeeByName(db, name) ?? `${NEW_PAYEE}${name}`);
  }
  const category = categoryInfo(db, trans["category"] ?? null);
  if (category === undefined) delete trans["category_group"];
  else trans["category_group"] = category.group;
};

/** A category a rule still names may be gone, from a book older than rules following deletes. */
const existingCategory = (db: Db, id: string | null): string | null =>
  accountRow(db, id) === undefined ? null : id;

/** Only a transfer out of the budget carries a category, so a rule's stays off any other. */
const transferTakesNoCategory = (db: Db, entry: EntryDraft): boolean => {
  const from = accountRow(db, entry.account);
  const to = accountRow(db, entry.transferAccount);
  return from !== undefined && to !== undefined && !(from.onBudget && !to.onBudget);
};

/** The account a rule transfers to, if it can: a rule may name a closed-out or the same account. */
const ruledTransfer = (db: Db, entry: EntryDraft, id: unknown): string | null => {
  const to = accountRow(db, typeof id === "string" ? id : null);
  return to !== undefined &&
    (to.type === "asset" || to.type === "liability") &&
    to.id !== entry.account
    ? to.id
    : null;
};

const splitsOf = (db: Db, trans: RuleTransaction): Array<SplitInput> => {
  const lines: Array<SplitInput> = (trans["subtransactions"] as Array<RuleTransaction>).map(
    (child) => ({
      category: existingCategory(db, child["category"] ?? null),
      amount: child["amount"] ?? 0,
      memo: child["notes"] ?? null,
    }),
  );
  // A double-entry split must add up: what the rule's split lines leave goes uncategorized.
  const difference = trans["error"]?.difference ?? 0;
  return difference === 0 ? lines : [...lines, { category: null, amount: difference }];
};

/** The register entry a rule-changed transaction makes. Null when a rule deleted it. */
export const fromRuleTransaction = (
  db: Db,
  entry: EntryDraft,
  trans: RuleTransaction,
  original: RuleTransaction,
): EntryDraft | null => {
  if (trans["tombstone"] === 1) return null;
  const ruleSplit = trans["is_parent"] === true && Array.isArray(trans["subtransactions"]);
  // A split a person or a receipt made stays: the rule never saw its lines' categories.
  const split = ruleSplit && entry.splits === null;
  // A split moves the payee to its lines; reeve keeps one payee, the first line's.
  const payeeId: unknown = ruleSplit ? trans["subtransactions"][0]?.["payee"] : trans["payee"];
  const payee =
    typeof payeeId === "string" && payeeId.startsWith(NEW_PAYEE)
      ? payeeId.slice(NEW_PAYEE.length)
      : payeeId === original["payee"] && !split
        ? entry.payee
        : payeeName(db, (payeeId as string | null) ?? null);
  const ruled = existingCategory(db, trans["category"] ?? null);
  const transferTo =
    split || trans["transfer_account"] === undefined
      ? null
      : ruledTransfer(db, entry, trans["transfer_account"]);
  const category = split
    ? null
    : transferTo !== null
      ? null
      : transferTakesNoCategory(db, entry) || (ruled === null && trans["category"] != null)
        ? entry.category
        : ruled;
  return {
    ...entry,
    date: trans["date"],
    account: trans["account"],
    amount: trans["amount"],
    payee,
    category: entry.splits !== null && !split ? entry.category : category,
    transferAccount: split ? null : (transferTo ?? entry.transferAccount),
    splits: split ? splitsOf(db, trans) : entry.splits,
    notes: trans["notes"] ?? null,
    cleared: Boolean(trans["cleared"]),
    importedPayee: trans["imported_payee"] ?? null,
    scheduleId: trans["schedule"] ?? null,
  };
};

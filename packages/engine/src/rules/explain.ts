import type { RuleChange, TransactionRules } from "@reeve/contract/catalog";
import { intToDay } from "@reeve/contract/rules";
import { and, eq } from "drizzle-orm";
import { invalid, type Book } from "../book.ts";
import type { Db } from "../db/open.ts";
import * as t from "../db/schema.ts";
import { draftFrom, getTransaction, type EntryDraft } from "../ledger/transactions.ts";
import { keptCounterparty, registerTransactions, rowMatches } from "./query.ts";
import { rankRules, type Rule, type RuleTransaction } from "./rule.ts";
import { runRulesOn } from "./run.ts";
import { loadRules } from "./store.ts";
import { toRuleTransaction, useBookFormulaPreferences } from "./transaction.ts";

type Value = RuleChange["from"];

/** A field a rule can change: read from the rule's view and from the register's, then named. */
interface Field {
  readonly field: RuleChange["field"];
  readonly read: (trans: RuleTransaction) => Value;
  readonly now: (entry: EntryDraft) => Value;
  readonly name?: (value: Value) => Value;
  readonly same?: (a: Value, b: Value) => boolean;
}

const NEW_PAYEE = "new:";

const isSplit = (trans: RuleTransaction) =>
  trans["is_parent"] === true && Array.isArray(trans["subtransactions"]);

const fieldsOf = (db: Db): ReadonlyArray<Field> => {
  const accountName = (value: Value) =>
    typeof value !== "string"
      ? value
      : (db.select({ name: t.accounts.name }).from(t.accounts).where(eq(t.accounts.id, value)).get()
          ?.name ?? null);
  const scheduleName = (value: Value) =>
    typeof value !== "string"
      ? value
      : (db
          .select({ name: t.schedules.name })
          .from(t.schedules)
          .where(eq(t.schedules.id, value))
          .get()?.name ?? "a schedule");
  const payeeName = (id: unknown): string | null =>
    typeof id !== "string"
      ? null
      : id.startsWith(NEW_PAYEE)
        ? id.slice(NEW_PAYEE.length)
        : (db.select({ name: t.payees.name }).from(t.payees).where(eq(t.payees.id, id)).get()
            ?.name ?? null);
  return [
    {
      field: "payee",
      read: (trans) => payeeName(trans["payee"]),
      now: (entry) => entry.payee,
      same: (a, b) => String(a).toLowerCase() === String(b).toLowerCase(),
    },
    {
      field: "imported_payee",
      read: (trans) => trans["imported_payee"] ?? null,
      now: (entry) => entry.importedPayee,
    },
    {
      field: "category",
      read: (trans) => (isSplit(trans) ? null : (trans["category"] ?? null)),
      now: (entry) =>
        entry.splits === null && entry.transferAccount === null ? entry.category : null,
      name: accountName,
    },
    {
      field: "transfer_account",
      read: (trans) => trans["transfer_account"] ?? null,
      now: (entry) => entry.transferAccount,
      name: accountName,
    },
    { field: "split", read: isSplit, now: (entry) => entry.splits !== null },
    { field: "notes", read: (trans) => trans["notes"] ?? null, now: (entry) => entry.notes },
    {
      field: "account",
      read: (trans) => trans["account"],
      now: (entry) => entry.account,
      name: accountName,
    },
    { field: "date", read: (trans) => trans["date"], now: (entry) => entry.date },
    { field: "amount", read: (trans) => trans["amount"], now: (entry) => entry.amount },
    { field: "cleared", read: (trans) => Boolean(trans["cleared"]), now: (entry) => entry.cleared },
    {
      field: "schedule",
      read: (trans) => trans["schedule"] ?? null,
      now: (entry) => entry.scheduleId,
      name: scheduleName,
    },
    { field: "deleted", read: (trans) => trans["tombstone"] === 1, now: () => false },
  ];
};

const changesOf = (
  fields: ReadonlyArray<Field>,
  before: RuleTransaction,
  after: RuleTransaction,
  current: EntryDraft,
): Array<RuleChange> =>
  fields.flatMap(({ field, read, now, name = (value) => value, same = (a, b) => a === b }) => {
    const from = read(before);
    const to = read(after);
    if (same(from, to)) return [];
    return [{ field, from: name(from), to: name(to), holds: same(to, now(current)) }];
  });

/**
 * The transaction as it arrived, before any rule: an imported one with the bank's payee, date and
 * amount and nothing a rule or person added; one entered by hand as it is, without its category.
 */
const arrival = (db: Db, current: EntryDraft, origin: TransactionRules["origin"]): EntryDraft => {
  if (origin === "entered") return { ...current, category: null };
  const seen =
    current.importedId === null
      ? undefined
      : db
          .select({ date: t.seenImports.date, amount: t.seenImports.amount })
          .from(t.seenImports)
          .where(
            and(
              eq(t.seenImports.accountId, current.account),
              eq(t.seenImports.importedId, current.importedId),
            ),
          )
          .get();
  return {
    ...current,
    payee: current.importedPayee ?? current.payee,
    date: seen === undefined ? current.date : intToDay(seen.date),
    amount: seen?.amount ?? current.amount,
    category: null,
    transferAccount: null,
    splits: null,
    scheduleId: null,
  };
};

export const transactionRules = (
  book: Book,
  input: { readonly id: string; readonly account?: string },
): TransactionRules => {
  const { db } = book;
  const transaction = getTransaction(db, input.id);
  const sides = registerTransactions(db, { transaction: input.id });
  const side =
    input.account === undefined
      ? sides[0]
      : sides.find((each) => each.match.accountId === input.account);
  if (side === undefined)
    return invalid(
      input.account === undefined
        ? "The transaction is on no asset or liability account"
        : "The transaction has no posting in that account",
    );
  const { accountId, postingId } = side.match;
  const current = draftFrom(db, input.id, accountId);
  const loaded = loadRules(db);
  const entities = new Map(loaded.map(({ entity, rule }) => [rule, entity]));
  const ranked = rankRules(loaded.map(({ rule }) => rule));

  const origin =
    current.importedId === null && current.importedPayee === null ? "entered" : "imported";
  useBookFormulaPreferences(db);
  const fields = fieldsOf(db);
  const applied: Array<TransactionRules["applied"][number]> = [];
  runRulesOn(
    db,
    toRuleTransaction(db, arrival(db, current, origin), {
      id: input.id,
      reconciled: transaction.postings.find((each) => each.id === postingId)?.reconciled ?? false,
      counterpartyAccount: keptCounterparty(db, accountId, current.importedId),
    }),
    ranked,
    (rule: Rule, before, after) => {
      const changes = changesOf(fields, before, after, current);
      if (changes.length > 0) applied.push({ rule: entities.get(rule)!, changes });
    },
  );

  return {
    origin,
    applied,
    matching: ranked
      .filter(
        (rule) =>
          rule.conditions.length > 0 && rowMatches(side.rows, rule.conditions, rule.conditionsOp),
      )
      .map((rule) => entities.get(rule)!),
  };
};

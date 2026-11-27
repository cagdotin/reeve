/**
 * Rules worth making on a counterparty's account number, read from the kept bank lines
 * (docs/rules/bank.md): a payee every line from the account lands on, or a transfer to one of the
 * person's own linked accounts.
 */
import type { AccountSuggestion } from "@reeve/contract/catalog";
import { sql } from "drizzle-orm";
import { invalid, type Book } from "../book.ts";
import * as t from "../db/schema.ts";
import { ruleHandlers } from "../rules/handlers.ts";
import { loadRules, insertRule } from "../rules/store.ts";
import { offersOf } from "./links.ts";
import { counterpartyAccount, normalAccountNumber } from "./rows.ts";
import { bankConnections } from "./schema.ts";

interface KeptLineRow {
  readonly account_id: string;
  readonly line: string;
  readonly payee_id: string | null;
  readonly payee_name: string | null;
  readonly imported_payee: string | null;
  /** The other asset or liability account of a transfer. */
  readonly transfer_to: string | null;
}

interface LineOnLedger {
  readonly account: string;
  readonly payee: { readonly id: string; readonly name: string } | null;
  readonly importedPayee: string;
  readonly transferTo: string | null;
}

/** Every kept line that still has its posting, by the counterparty's account number. */
const linesByNumber = (book: Book): Map<string, Array<LineOnLedger>> => {
  const rows = book.db.all<KeptLineRow>(
    sql`SELECT s.account_id, s.line, t.payee_id, pe.name AS payee_name, t.imported_payee,
         (SELECT o.account_id FROM postings o JOIN accounts a ON a.id = o.account_id
           WHERE o.transaction_id = p.transaction_id AND o.id <> p.id
             AND a.type IN ('asset', 'liability') LIMIT 1) AS transfer_to
       FROM seen_imports s
       JOIN postings p ON p.account_id = s.account_id AND p.imported_id = s.imported_id
       JOIN transactions t ON t.id = p.transaction_id
       LEFT JOIN payees pe ON pe.id = t.payee_id
       WHERE s.line IS NOT NULL`,
  );
  const byNumber = new Map<string, Array<LineOnLedger>>();
  for (const row of rows) {
    const number = counterpartyAccount((JSON.parse(row.line) as t.KeptLine).line);
    if (number === null) continue;
    const lines = byNumber.get(number) ?? [];
    lines.push({
      account: row.account_id,
      payee:
        row.payee_id === null || row.payee_name === null
          ? null
          : { id: row.payee_id, name: row.payee_name },
      importedPayee: (row.imported_payee ?? "").trim().toLowerCase(),
      transferTo: row.transfer_to,
    });
    byNumber.set(number, lines);
  }
  return byNumber;
};

/** The person's own linked accounts, by the account number their bank gave for them. */
const ownAccounts = (book: Book): Map<string, { readonly id: string; readonly name: string }> => {
  const offers = new Map(
    book.db
      .select()
      .from(bankConnections)
      .all()
      .flatMap((connection) => offersOf(connection).map((offer) => [offer.id, offer] as const)),
  );
  const links = book.db.all<{ account_id: string; provider_account_id: string; name: string }>(
    sql`SELECT l.account_id, l.provider_account_id, a.name
       FROM bank_links l JOIN accounts a ON a.id = l.account_id`,
  );
  return new Map(
    links.flatMap((link) => {
      const number = normalAccountNumber(offers.get(link.provider_account_id)?.iban);
      return number === null ? [] : [[number, { id: link.account_id, name: link.name }] as const];
    }),
  );
};

const coveredByRule = (book: Book) => {
  const conditions = loadRules(book.db).flatMap(({ rule }) =>
    rule.conditions.filter((condition) => condition.field === "counterparty_account"),
  );
  return (number: string) =>
    conditions.some((condition) => condition.eval({ counterparty_account: number }));
};

const dismissed = (book: Book) =>
  new Set(
    book.db
      .select()
      .from(t.dismissedAccountSuggestions)
      .all()
      .map((row) => row.accountNumber),
  );

/** A payee every line lands on, under one imported payee; several lines' worth of evidence. */
const onePayee = (lines: ReadonlyArray<LineOnLedger>) => {
  const [first] = lines;
  if (lines.length < 2 || first?.payee == null) return null;
  const same = lines.every(
    (line) =>
      line.transferTo === null &&
      line.payee?.id === first.payee!.id &&
      line.importedPayee === first.importedPayee,
  );
  return same ? first.payee : null;
};

export const suggestAccountRules = (book: Book): Array<AccountSuggestion> => {
  const own = ownAccounts(book);
  const covered = coveredByRule(book);
  const left = dismissed(book);
  const suggestions: Array<AccountSuggestion> = [];
  for (const [accountNumber, lines] of linesByNumber(book)) {
    if (covered(accountNumber) || left.has(accountNumber)) continue;
    const mine = own.get(accountNumber);
    if (mine !== undefined) {
      const pending = lines.filter(
        (line) => line.account !== mine.id && line.transferTo !== mine.id,
      ).length;
      if (pending > 0)
        suggestions.push({ kind: "transfer", accountNumber, lines: pending, account: mine });
      continue;
    }
    const payee = onePayee(lines);
    if (payee !== null)
      suggestions.push({ kind: "payee", accountNumber, lines: lines.length, payee });
  }
  return suggestions.toSorted(
    (a, b) => b.lines - a.lines || a.accountNumber.localeCompare(b.accountNumber),
  );
};

export const acceptAccountSuggestion = (book: Book, accountNumber: string) => {
  const number = normalAccountNumber(accountNumber);
  const suggestion = suggestAccountRules(book).find((each) => each.accountNumber === number);
  if (suggestion === undefined) return invalid("No rule is suggested for that account number");
  const conditions = [
    { field: "counterparty_account" as const, op: "is" as const, value: suggestion.accountNumber },
  ];
  if (suggestion.kind === "payee") {
    const rule = insertRule(book.db, {
      stage: "pre",
      conditionsOp: "and",
      conditions,
      actions: [{ op: "set", field: "payee", value: suggestion.payee.id }],
    });
    return { rule, transfers: [] };
  }
  const rule = insertRule(book.db, {
    stage: "default",
    conditionsOp: "and",
    conditions,
    actions: [{ op: "set", field: "transfer_account", value: suggestion.account.id }],
  });
  const applied = ruleHandlers.apply_rules(book, { rule: rule.id });
  return { rule, transfers: applied.updated.map((transaction) => transaction.id) };
};

export const dismissAccountSuggestion = (book: Book, accountNumber: string) => {
  const number = normalAccountNumber(accountNumber);
  if (number === null) return invalid("Name an account number");
  book.db
    .insert(t.dismissedAccountSuggestions)
    .values({ accountNumber: number })
    .onConflictDoNothing()
    .run();
  return { dismissed: true };
};

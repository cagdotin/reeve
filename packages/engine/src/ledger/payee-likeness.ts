/**
 * Payees whose words, without digits and punctuation, begin another's words: suggested for a merge,
 * never merged, and never again once kept apart (docs/rules/bank.md).
 */
import type { Payee } from "@reeve/contract";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { invalid, type Book } from "../book.ts";
import * as t from "../db/schema.ts";
import { accountsInScope, hasScope, type AccountScope } from "./account-scope.ts";
import { getPayee, listPayees } from "./payees.ts";

const wordsOf = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\s]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word !== "");

/** A root of one short word ("bh", "a1") would gather payees that only share it. */
const canLead = (words: ReadonlyArray<string>) => words.some((word) => word.length >= 3);

const pairKey = (a: string, b: string) => (a < b ? `${a} ${b}` : `${b} ${a}`);

const payeesOn = (book: Book, accounts: ReadonlyArray<string>): ReadonlySet<string> =>
  new Set(
    book.db
      .selectDistinct({ payee: t.transactions.payeeId })
      .from(t.transactions)
      .innerJoin(t.postings, eq(t.postings.transactionId, t.transactions.id))
      .where(and(isNotNull(t.transactions.payeeId), inArray(t.postings.accountId, accounts)))
      .all()
      .map((row) => row.payee!),
  );

export const suggestPayeeMerges = (book: Book, scope: AccountScope): Array<Array<Payee>> => {
  const scoped = hasScope(scope) ? payeesOn(book, accountsInScope(book, scope)) : null;
  const apart = new Set(
    book.db
      .select()
      .from(t.payeesApart)
      .all()
      .map((pair) => pairKey(pair.payeeId, pair.otherId)),
  );
  const payees = listPayees(book)
    .map((payee) => ({ payee, words: wordsOf(payee.name) }))
    .filter(({ words }) => words.length > 0)
    .toSorted(
      (a, b) =>
        a.words.length - b.words.length || b.payee.transactionCount - a.payee.transactionCount,
    );
  const roots = new Map<string, Array<string>>();
  const groups = new Map<string, Array<Payee>>();
  for (const { payee, words } of payees) {
    const root = words
      .map((_, end) => words.slice(0, end + 1).join(" "))
      .flatMap((prefix) => roots.get(prefix) ?? [])
      .find((id) => !apart.has(pairKey(id, payee.id)));
    if (root !== undefined) groups.get(root)!.push(payee);
    else {
      groups.set(payee.id, [payee]);
      if (canLead(words)) {
        const key = words.join(" ");
        roots.set(key, [...(roots.get(key) ?? []), payee.id]);
      }
    }
  }
  return [...groups.values()]
    .filter(
      (group) =>
        group.length > 1 && (scoped === null || group.some((payee) => scoped.has(payee.id))),
    )
    .map((group) =>
      group.toSorted(
        (a, b) => b.transactionCount - a.transactionCount || a.name.localeCompare(b.name),
      ),
    )
    .toSorted(
      (a, b) =>
        b.reduce((sum, payee) => sum + payee.transactionCount, 0) -
        a.reduce((sum, payee) => sum + payee.transactionCount, 0),
    );
};

export const keepPayeesApart = (book: Book, ids: ReadonlyArray<string>): number => {
  const unique = [...new Set(ids)].toSorted();
  if (unique.length < 2) invalid("Keeping payees apart takes two or more");
  for (const id of unique) getPayee(book.db, id);
  const pairs = unique.flatMap((payeeId, index) =>
    unique.slice(index + 1).map((otherId) => ({ payeeId, otherId })),
  );
  book.db.insert(t.payeesApart).values(pairs).onConflictDoNothing().run();
  return pairs.length;
};

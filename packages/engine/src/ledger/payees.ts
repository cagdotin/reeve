import type { Payee } from "@reeve/contract";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { invalid, newId, notFound, type Book } from "../book.ts";
import type { Db } from "../db/open.ts";
import * as t from "../db/schema.ts";
import { dropFromRules, moveInRules, namedInRule, type RuleItem } from "./rule-references.ts";

const payeeRows = (db: Db, where?: ReturnType<typeof eq>) =>
  db
    .select({
      id: t.payees.id,
      name: t.payees.name,
      description: t.payees.description,
      favorite: t.payees.favorite,
      learnCategories: t.payees.learnCategories,
      transactionCount: sql<number>`(SELECT count(*) FROM ${t.transactions} WHERE ${t.transactions.payeeId} = ${t.payees.id})`,
    })
    .from(t.payees)
    .where(where)
    .orderBy(asc(sql`lower(${t.payees.name})`))
    .all();

export const listPayees = (book: Book): Array<Payee> => payeeRows(book.db);

export const getPayee = (db: Db, id: string): Payee =>
  payeeRows(db, eq(t.payees.id, id))[0] ?? notFound("payee", id);

/** The payee named `name`, ignoring case, created when there is none; null for a blank name. */
export const payeeIdFor = (db: Db, name: string | null | undefined): string | null => {
  const trimmed = name?.trim() ?? "";
  if (trimmed === "") return null;
  const found = db
    .select({ id: t.payees.id })
    .from(t.payees)
    .where(sql`lower(${t.payees.name}) = lower(${trimmed})`)
    .get();
  if (found !== undefined) return found.id;
  const id = newId();
  db.insert(t.payees).values({ id, name: trimmed }).run();
  return id;
};

const cleanDescription = (description: string | null) => description?.trim() || null;

export const createPayee = (
  book: Book,
  input: { readonly name: string; readonly description?: string | null },
): Payee => {
  const id = payeeIdFor(book.db, input.name) ?? invalid("A payee needs a name");
  if (input.description !== undefined)
    book.db
      .update(t.payees)
      .set({ description: cleanDescription(input.description) })
      .where(eq(t.payees.id, id))
      .run();
  return getPayee(book.db, id);
};

const refuseTakenName = (db: Db, id: string, name: string) => {
  const taken = db
    .select({ name: t.payees.name })
    .from(t.payees)
    .where(and(sql`lower(${t.payees.name}) = lower(${name})`, ne(t.payees.id, id)))
    .get();
  if (taken !== undefined) invalid(`There is already a payee named ${taken.name}: merge them`);
};

export const updatePayee = (
  book: Book,
  input: {
    readonly id: string;
    readonly name?: string;
    readonly description?: string | null;
    readonly favorite?: boolean;
    readonly learnCategories?: boolean;
  },
): Payee => {
  getPayee(book.db, input.id);
  const change: Partial<typeof t.payees.$inferInsert> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name === "") invalid("A payee needs a name");
    refuseTakenName(book.db, input.id, name);
    change.name = name;
  }
  if (input.description !== undefined) change.description = cleanDescription(input.description);
  if (input.favorite !== undefined) change.favorite = input.favorite;
  if (input.learnCategories !== undefined) change.learnCategories = input.learnCategories;
  if (Object.keys(change).length > 0)
    book.db.update(t.payees).set(change).where(eq(t.payees.id, input.id)).run();
  return getPayee(book.db, input.id);
};

export type { RuleItem };

export const payeesNamedBy = (rule: typeof t.rules.$inferSelect): ReadonlySet<string> =>
  namedInRule(rule, "payee");

export const mergePayees = (
  book: Book,
  input: { readonly target: string; readonly merge: ReadonlyArray<string> },
): Payee => {
  const target = getPayee(book.db, input.target);
  const others = input.merge.filter((id) => id !== input.target);
  if (others.length === 0) return target;
  const merged = others.map((id) => getPayee(book.db, id));
  book.db
    .update(t.transactions)
    .set({ payeeId: input.target })
    .where(inArray(t.transactions.payeeId, others))
    .run();
  moveInRules(book.db, "payee", new Set(others), input.target);
  const description = target.description ?? merged.find((each) => each.description)?.description;
  if (description !== target.description && description !== undefined)
    book.db.update(t.payees).set({ description }).where(eq(t.payees.id, input.target)).run();
  book.db.delete(t.payees).where(inArray(t.payees.id, others)).run();
  return getPayee(book.db, input.target);
};

/** A schedule lives on its rule, so a payee it names has to leave the schedule first. */
const refuseScheduled = (db: Db, ids: ReadonlySet<string>) => {
  const rows = db
    .select({ rule: t.rules, schedule: t.schedules.name })
    .from(t.schedules)
    .innerJoin(t.rules, eq(t.rules.id, t.schedules.ruleId))
    .all();
  for (const { rule, schedule } of rows) {
    const named = [...payeesNamedBy(rule)].find((id) => ids.has(id));
    if (named !== undefined)
      invalid(
        `${getPayee(db, named).name} is used by ${schedule === null ? "a schedule" : `the schedule ${schedule}`}: change the schedule first`,
      );
  }
};

export const deletePayees = (book: Book, ids: ReadonlyArray<string>) => {
  for (const id of ids) getPayee(book.db, id);
  const gone = new Set(ids);
  refuseScheduled(book.db, gone);
  book.db
    .update(t.transactions)
    .set({ payeeId: null })
    .where(inArray(t.transactions.payeeId, [...ids]))
    .run();
  dropFromRules(book.db, "payee", gone);
  book.db
    .delete(t.payees)
    .where(inArray(t.payees.id, [...ids]))
    .run();
  return { deleted: [...ids] };
};

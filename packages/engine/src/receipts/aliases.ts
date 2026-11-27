/**
 * Product aliases: receipt text (and code) as a store prints it, naming a product. Lines keep the
 * raw text; the alias's key (normalised text) is what they match by (docs/rules/purchases.md).
 */
import { normalizeText } from "@reeve/contract/receipts";
import { and, asc, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import { invalid, newId, notFound, type Book } from "../book.ts";
import type { Db } from "../db/open.ts";
import * as t from "../db/schema.ts";
import * as r from "./schema.ts";
import type { ProductAlias } from "./types.ts";

type AliasRow = typeof r.productAliases.$inferSelect;

const blankToNull = (value: string | null | undefined) =>
  value === undefined || value === null || value.trim() === "" ? null : value.trim();

const aliasRows = (db: Db, where?: SQL) =>
  db
    .select({ alias: r.productAliases, product: r.products.name, payee: t.payees.name })
    .from(r.productAliases)
    .innerJoin(r.products, eq(r.products.id, r.productAliases.productId))
    .leftJoin(t.payees, eq(t.payees.id, r.productAliases.payeeId))
    .where(where)
    .orderBy(asc(r.productAliases.key), asc(r.productAliases.createdAt))
    .all()
    .map(({ alias, product, payee }): ProductAlias => ({
      id: alias.id,
      productId: alias.productId,
      product,
      payeeId: alias.payeeId,
      payee,
      text: alias.text,
      key: alias.key,
      code: alias.code,
      packSize: alias.packSize,
      rejected: alias.rejected,
    }));

export const getAlias = (db: Db, id: string): ProductAlias =>
  aliasRows(db, eq(r.productAliases.id, id))[0] ?? notFound("product alias", id);

export const listAliases = (
  book: Book,
  input: { readonly productId?: string; readonly payeeId?: string; readonly rejected?: boolean },
): Array<ProductAlias> =>
  aliasRows(
    book.db,
    and(
      input.productId === undefined ? undefined : eq(r.productAliases.productId, input.productId),
      input.payeeId === undefined
        ? undefined
        : or(eq(r.productAliases.payeeId, input.payeeId), isNull(r.productAliases.payeeId)),
      input.rejected === undefined ? undefined : eq(r.productAliases.rejected, input.rejected),
    ),
  );

const sameScope = (payeeId: string | null, key: string, code: string | null) =>
  and(
    payeeId === null ? isNull(r.productAliases.payeeId) : eq(r.productAliases.payeeId, payeeId),
    eq(r.productAliases.key, key),
    code === null ? isNull(r.productAliases.code) : eq(r.productAliases.code, code),
  );

/** Creates or updates the alias of (store, text, code) for a product, accepted or rejected. */
export const upsertAlias = (
  book: Book,
  input: {
    readonly productId: string;
    readonly text: string;
    readonly payeeId?: string | null;
    readonly code?: string | null;
    readonly packSize?: number | null;
    readonly rejected: boolean;
  },
): ProductAlias => {
  const { db } = book;
  const key = normalizeText(input.text);
  if (key === "") invalid("An alias needs text");
  if (db.select().from(r.products).where(eq(r.products.id, input.productId)).get() === undefined)
    notFound("product", input.productId);
  const payeeId = input.payeeId ?? null;
  if (
    payeeId !== null &&
    db.select().from(t.payees).where(eq(t.payees.id, payeeId)).get() === undefined
  )
    notFound("payee", payeeId);
  if (input.packSize !== undefined && input.packSize !== null && !(input.packSize > 0))
    invalid("A pack size is more than zero");
  const code = blankToNull(input.code);
  const existing = db
    .select()
    .from(r.productAliases)
    .where(and(sameScope(payeeId, key, code), eq(r.productAliases.productId, input.productId)))
    .get();
  if (existing !== undefined) {
    const change: Partial<AliasRow> = { rejected: input.rejected, text: input.text.trim() };
    if (input.packSize !== undefined) change.packSize = input.packSize;
    db.update(r.productAliases).set(change).where(eq(r.productAliases.id, existing.id)).run();
    return getAlias(db, existing.id);
  }
  const id = newId();
  db.insert(r.productAliases)
    .values({
      id,
      productId: input.productId,
      payeeId,
      text: input.text.trim(),
      key,
      code,
      packSize: input.packSize ?? null,
      rejected: input.rejected,
      createdAt: Date.now(),
    })
    .run();
  return getAlias(db, id);
};

export const deleteAlias = (book: Book, id: string) => {
  getAlias(book.db, id);
  book.db.delete(r.productAliases).where(eq(r.productAliases.id, id)).run();
  return { deleted: id };
};

/** The products rejected for this text (or code) at this store or at any store. */
export const rejectedProducts = (
  db: Db,
  payeeId: string | null,
  text: string,
  code: string | null,
): Set<string> => {
  const key = normalizeText(text);
  return new Set(
    db
      .select({ productId: r.productAliases.productId })
      .from(r.productAliases)
      .where(
        and(
          eq(r.productAliases.rejected, true),
          payeeId === null
            ? isNull(r.productAliases.payeeId)
            : or(eq(r.productAliases.payeeId, payeeId), isNull(r.productAliases.payeeId)),
          code === null
            ? eq(r.productAliases.key, key)
            : or(eq(r.productAliases.key, key), eq(r.productAliases.code, code)),
        ),
      )
      .all()
      .map((row) => row.productId),
  );
};

export interface AliasMatch {
  readonly productId: string;
  readonly packSize: number | null;
  readonly reason: "store-alias" | "alias" | "code";
}

/**
 * The product exact aliases name for a line: the store's alias by code, then by text, then any
 * store's by code, then by text. A step naming two products is ambiguous and names none.
 */
export const aliasMatch = (
  db: Db,
  payeeId: string | null,
  text: string,
  code: string | null,
): AliasMatch | null => {
  const key = normalizeText(text);
  const cleanCode = blankToNull(code);
  const candidates = db
    .select()
    .from(r.productAliases)
    .innerJoin(r.products, eq(r.products.id, r.productAliases.productId))
    .where(
      and(
        eq(r.productAliases.rejected, false),
        eq(r.products.archived, false),
        payeeId === null
          ? isNull(r.productAliases.payeeId)
          : or(eq(r.productAliases.payeeId, payeeId), isNull(r.productAliases.payeeId)),
        cleanCode === null
          ? eq(r.productAliases.key, key)
          : or(eq(r.productAliases.key, key), eq(r.productAliases.code, cleanCode)),
      ),
    )
    .all()
    .map((row) => row.product_aliases);
  const rejected = rejectedProducts(db, payeeId, text, cleanCode);
  const steps: ReadonlyArray<readonly [AliasMatch["reason"], (alias: AliasRow) => boolean]> = [
    ["code", (alias) => alias.payeeId !== null && cleanCode !== null && alias.code === cleanCode],
    ["store-alias", (alias) => alias.payeeId !== null && alias.key === key],
    ["code", (alias) => alias.payeeId === null && cleanCode !== null && alias.code === cleanCode],
    ["alias", (alias) => alias.payeeId === null && alias.key === key],
  ];
  for (const [reason, test] of steps) {
    const found = candidates.filter((alias) => test(alias) && !rejected.has(alias.productId));
    const products = new Set(found.map((alias) => alias.productId));
    if (products.size > 1) return null;
    const [first] = found;
    if (first !== undefined)
      return { productId: first.productId, packSize: first.packSize, reason };
  }
  return null;
};

/** Moves every alias of `from` products to `to`, dropping the ones `to` already has. */
export const moveAliases = (db: Db, from: ReadonlyArray<string>, to: string) => {
  const kept = new Set(
    db
      .select()
      .from(r.productAliases)
      .where(eq(r.productAliases.productId, to))
      .all()
      .map((alias) => `${alias.payeeId}|${alias.key}|${alias.code}`),
  );
  for (const alias of db
    .select()
    .from(r.productAliases)
    .where(inArray(r.productAliases.productId, [...from]))
    .all()) {
    const scope = `${alias.payeeId}|${alias.key}|${alias.code}`;
    if (kept.has(scope)) db.delete(r.productAliases).where(eq(r.productAliases.id, alias.id)).run();
    else {
      kept.add(scope);
      db.update(r.productAliases)
        .set({ productId: to })
        .where(eq(r.productAliases.id, alias.id))
        .run();
    }
  }
};

export const aliasTexts = (db: Db) =>
  db
    .select({
      productId: r.productAliases.productId,
      text: r.productAliases.text,
      payeeId: r.productAliases.payeeId,
      rejected: r.productAliases.rejected,
    })
    .from(r.productAliases)
    .all();

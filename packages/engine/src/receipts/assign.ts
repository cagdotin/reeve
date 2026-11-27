/**
 * Naming the products of receipt lines: suggestions from aliases and names (no AI, never assigned
 * by themselves), assigning a product to a line, and the lines still without one.
 */
import { normalizeText, wordOverlap } from "@reeve/contract/receipts";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { intToDay } from "@reeve/contract/rules";
import type { Book } from "../book.ts";
import type { Db } from "../db/open.ts";
import { aliasMatch, aliasTexts, rejectedProducts, upsertAlias } from "./aliases.ts";
import { loadContext } from "./context.ts";
import { namedBy } from "./product-activity.ts";
import { productRow } from "./products.ts";
import { lineRow } from "./receipts.ts";
import * as r from "./schema.ts";
import type { ProductSuggestion } from "./types.ts";
import { getReceipt, lineView, receiptRow } from "./view.ts";

/** Below this word overlap a name or alias text is not suggested. */
const MIN_OVERLAP = 0.34;

export const suggestProducts = (
  db: Db,
  input: {
    readonly text: string;
    readonly payeeId?: string | null;
    readonly code?: string | null;
    readonly limit?: number;
  },
): Array<ProductSuggestion> => {
  const payeeId = input.payeeId ?? null;
  const code = input.code ?? null;
  const limit = input.limit ?? 5;
  const products = new Map(
    db
      .select({ id: r.products.id, name: r.products.name })
      .from(r.products)
      .where(eq(r.products.archived, false))
      .all()
      .map((row) => [row.id, row.name]),
  );
  const rejected = rejectedProducts(db, payeeId, input.text, code);
  const best = new Map<string, ProductSuggestion>();
  const offer = (suggestion: ProductSuggestion) => {
    if (rejected.has(suggestion.productId) || !products.has(suggestion.productId)) return;
    const known = best.get(suggestion.productId);
    if (known === undefined || known.score < suggestion.score)
      best.set(suggestion.productId, suggestion);
  };
  const exact = aliasMatch(db, payeeId, input.text, code);
  if (exact !== null)
    offer({
      productId: exact.productId,
      product: products.get(exact.productId) ?? "",
      score: 1,
      reason: exact.reason,
      matched: input.text,
    });
  const key = normalizeText(input.text);
  for (const [id, name] of products) {
    const score = normalizeText(name) === key ? 0.95 : wordOverlap(input.text, name) * 0.9;
    if (score >= MIN_OVERLAP * 0.9)
      offer({ productId: id, product: name, score: round(score), reason: "name", matched: name });
  }
  for (const alias of aliasTexts(db)) {
    if (alias.rejected || (alias.payeeId !== null && alias.payeeId !== payeeId)) continue;
    const score = wordOverlap(input.text, alias.text) * 0.85;
    if (score >= MIN_OVERLAP * 0.85)
      offer({
        productId: alias.productId,
        product: products.get(alias.productId) ?? "",
        score: round(score),
        reason: "alias-text",
        matched: alias.text,
      });
  }
  return [...best.values()]
    .toSorted((a, b) => b.score - a.score || a.product.localeCompare(b.product))
    .slice(0, limit);
};

const round = (value: number) => Math.round(value * 1000) / 1000;

export const assignLineProduct = (
  book: Book,
  input: {
    readonly line: string;
    readonly productId: string | null;
    readonly remember?: boolean;
    readonly applyToSimilar?: boolean;
  },
) => {
  const { db } = book;
  const line = lineRow(db, input.line);
  const receipt = receiptRow(book, line.receiptId);
  if (input.productId !== null) productRow(book, input.productId);
  db.update(r.receiptLines)
    .set({ productId: input.productId })
    .where(eq(r.receiptLines.id, line.id))
    .run();
  const alias =
    input.remember === true && input.productId !== null
      ? upsertAlias(book, {
          productId: input.productId,
          text: line.text,
          payeeId: receipt.payeeId,
          code: line.code,
          rejected: false,
        })
      : null;
  let updatedLines: Array<string> = [];
  if (input.applyToSimilar === true && input.productId !== null) {
    const key = normalizeText(line.text);
    updatedLines = db
      .select({ id: r.receiptLines.id, text: r.receiptLines.text })
      .from(r.receiptLines)
      .innerJoin(r.receipts, eq(r.receipts.id, r.receiptLines.receiptId))
      .where(
        and(
          isNull(r.receiptLines.productId),
          receipt.payeeId === null
            ? isNull(r.receipts.payeeId)
            : eq(r.receipts.payeeId, receipt.payeeId),
        ),
      )
      .all()
      .filter((each) => normalizeText(each.text) === key)
      .map((each) => each.id);
    if (updatedLines.length > 0)
      db.update(r.receiptLines)
        .set({ productId: input.productId })
        .where(inArray(r.receiptLines.id, updatedLines))
        .run();
  }
  return { receipt: getReceipt(book, receipt.id), alias, updatedLines };
};

export const unassignedLines = (
  book: Book,
  input: {
    readonly payeeId?: string;
    readonly named?: boolean;
    readonly limit?: number;
    readonly offset?: number;
  },
) => {
  const where = input.payeeId === undefined ? "" : "AND r.payee_id = ?";
  const params = input.payeeId === undefined ? [] : [input.payeeId];
  const all = book.client
    .prepare(
      `SELECT l.id, l.text, l.code, r.date, r.payee_id, p.name AS payee FROM receipt_lines l
       JOIN receipts r ON r.id = l.receipt_id LEFT JOIN payees p ON p.id = r.payee_id
       WHERE l.product_id IS NULL ${where}
       ORDER BY r.date DESC, r.created_at DESC, l.position`,
    )
    .all(...params) as Array<{
    id: string;
    text: string;
    code: string | null;
    date: number;
    payee_id: string | null;
    payee: string | null;
  }>;
  const context = loadContext(book);
  const rows =
    input.named === true
      ? all.filter(namedBy(context, book.db.select().from(r.productAliases).all()))
      : all;
  const offset = input.offset ?? 0;
  const page = rows.slice(offset, offset + (input.limit ?? 100));
  const lines = new Map(
    (page.length === 0
      ? []
      : book.db
          .select()
          .from(r.receiptLines)
          .where(
            inArray(
              r.receiptLines.id,
              page.map((row) => row.id),
            ),
          )
          .all()
    ).map((line) => [line.id, line]),
  );
  return {
    total: rows.length,
    lines: page.map((row) => {
      const line = lines.get(row.id)!;
      return {
        ...lineView(context, line),
        date: intToDay(row.date),
        payeeId: row.payee_id,
        payee: row.payee,
        suggestions: suggestProducts(book.db, {
          text: line.text,
          payeeId: row.payee_id,
          code: line.code,
          limit: 3,
        }),
      };
    }),
  };
};

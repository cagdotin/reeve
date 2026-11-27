/**
 * Active even while purchases is frozen: preserve old references and applied splits.
 * What receipts do when the ledger merges what they point at. `operations.ts` runs these before
 * the ledger's own merge, so the ledger never knows receipts exist. Deleting a payee, a category
 * or a transaction needs nothing here: the foreign keys clear or cascade. A rule that recategorizes
 * leaves alone the transactions an applied receipt split (`receiptAppliedTransactions`).
 */
import { eq, inArray } from "drizzle-orm";
import type { Book } from "../book.ts";
import * as r from "./schema.ts";

export { movePayments as moveTransactionReceipts } from "./matching.ts";
export { receiptAppliedTransactions } from "./view.ts";
export { restorePhotoFiles as restoreLegacyPhotos } from "./photos.ts";

/** Receipts and aliases of merged payees move to the payee they merge into. */
export const movePayeeReceipts = (book: Book, from: ReadonlyArray<string>, to: string) => {
  const others = from.filter((id) => id !== to);
  if (others.length === 0) return;
  book.db.update(r.receipts).set({ payeeId: to }).where(inArray(r.receipts.payeeId, others)).run();
  book.db
    .update(r.productAliases)
    .set({ payeeId: to })
    .where(inArray(r.productAliases.payeeId, others))
    .run();
};

/** Item categories and lines naming a deleted budget category name the one it transfers to. */
export const moveBudgetCategoryReceipts = (book: Book, from: ReadonlyArray<string>, to: string) => {
  for (const id of from.filter((each) => each !== to)) {
    book.db
      .update(r.itemCategories)
      .set({ budgetCategoryId: to })
      .where(eq(r.itemCategories.budgetCategoryId, id))
      .run();
    book.db
      .update(r.receiptLines)
      .set({ budgetCategoryId: to })
      .where(eq(r.receiptLines.budgetCategoryId, id))
      .run();
  }
};

import type { receipts } from "@reeve/contract/catalog";
import type { DomainHandlers } from "../handler.ts";
import { deleteAlias, listAliases, upsertAlias } from "./aliases.ts";
import { applyReceipt, splitPreview } from "./apply.ts";
import { adjustmentReceipt, autoApplying, lineReceipt, type Touched } from "./auto.ts";
import { assignLineProduct, suggestProducts, unassignedLines } from "./assign.ts";
import {
  createItemCategory,
  deleteItemCategory,
  listItemCategories,
  moveItemCategory,
  updateItemCategory,
} from "./categories.ts";
import {
  autoMatch,
  linkPayment,
  suggestMatches,
  transactionReceipts,
  transactionsWithReceipts,
  unlinkPayment,
} from "./matching.ts";
import { attachPhoto, deletePhoto, listPhotos, photoContent } from "./photos.ts";
import { cheapestStores, itemSpending, priceChanges, priceHistory } from "./prices.ts";
import { productActivity, productSummary } from "./product-activity.ts";
import {
  createProduct,
  deleteProduct,
  getProduct,
  listProducts,
  mergeProducts,
  updateProduct,
} from "./products.ts";
import {
  addAdjustment,
  addLines,
  createReceipt,
  deleteAdjustment,
  deleteLines,
  deleteReceipt,
  importReceipts,
  reorderLines,
  updateAdjustment,
  updateLine,
  updateReceipt,
} from "./receipts.ts";
import { receiptActivity, receiptPage } from "./receipt-activity.ts";
import { getReceipt, receiptRow } from "./view.ts";

/** Writes that may change a line's budget category through products or item categories. */
const all = (): Touched => "all";

/** Receipts: itemized purchases reconciled with the ledger, products and prices (docs/rules/purchases.md). */
export const receiptHandlers = {
  create_receipt: autoApplying(
    () => [],
    (book, input) => createReceipt(book, input),
    (result) => [result.receipt.id],
  ),
  import_receipts: autoApplying(
    () => [],
    (book, input) => importReceipts(book, input),
    (results) => results.map((result) => result.receipt.id),
  ),
  get_receipt: (book, input) => getReceipt(book, input.id),
  list_receipts: (book, input) => receiptPage(book, input),
  receipt_activity: (book, input) => receiptActivity(book, input),
  update_receipt: autoApplying((_, input) => [input.id], updateReceipt),
  delete_receipt: (book, input) => deleteReceipt(book, input.id),
  add_receipt_lines: autoApplying((_, input) => [input.receipt], addLines),
  update_receipt_line: autoApplying((book, input) => lineReceipt(book, input.id), updateLine),
  delete_receipt_lines: autoApplying((_, input) => [input.receipt], deleteLines),
  reorder_receipt_lines: (book, input) => reorderLines(book, input),
  add_receipt_adjustment: autoApplying((_, input) => [input.receipt], addAdjustment),
  update_receipt_adjustment: autoApplying(
    (book, input) => adjustmentReceipt(book, input.id),
    updateAdjustment,
  ),
  delete_receipt_adjustment: autoApplying(
    (book, input) => adjustmentReceipt(book, input.id),
    (book, input) => deleteAdjustment(book, input.id),
  ),

  suggest_receipt_matches: (book, input) => suggestMatches(book, input.id, input.limit),
  link_receipt_payment: autoApplying((_, input) => [input.receipt], linkPayment),
  unlink_receipt_payment: autoApplying((_, input) => [input.receipt], unlinkPayment),
  auto_match_receipts: autoApplying(
    () => [],
    autoMatch,
    (result) => result.linked.map((link) => link.receiptId),
  ),
  list_transaction_receipts: (book, input) => transactionReceipts(book, input.transaction),
  transactions_with_receipts: (book, input) => transactionsWithReceipts(book, input),

  receipt_split_preview: (book, input) => splitPreview(book, input),
  apply_receipt_to_transaction: (book, input) => applyReceipt(book, input),

  attach_receipt_photo: (book, input) => {
    receiptRow(book, input.receipt);
    return attachPhoto(book, input);
  },
  list_receipt_photos: (book, input) => {
    receiptRow(book, input.receipt);
    return listPhotos(book, input.receipt);
  },
  get_receipt_photo: (book, input) => photoContent(book, input.id, input.content ?? false),
  delete_receipt_photo: (book, input) => deletePhoto(book, input.id),

  list_item_categories: (book) => listItemCategories(book),
  create_item_category: (book, input) => createItemCategory(book, input),
  update_item_category: autoApplying(all, updateItemCategory),
  move_item_category: autoApplying(all, moveItemCategory),
  delete_item_category: autoApplying(all, (book, input) => deleteItemCategory(book, input.id)),

  list_products: (book, input) => listProducts(book, input),
  get_product: (book, input) => getProduct(book, input.id),
  create_product: (book, input) => createProduct(book, input),
  update_product: autoApplying(all, updateProduct),
  delete_product: autoApplying(all, (book, input) => deleteProduct(book, input.id)),
  merge_products: autoApplying(all, mergeProducts),
  list_aliases: (book, input) => listAliases(book, input),
  create_alias: (book, input) => upsertAlias(book, { ...input, rejected: false }),
  delete_alias: (book, input) => deleteAlias(book, input.id),
  reject_alias: (book, input) => upsertAlias(book, { ...input, rejected: true }),
  assign_line_product: autoApplying(
    (book, input) => (input.applyToSimilar === true ? "all" : lineReceipt(book, input.line)),
    assignLineProduct,
  ),
  suggest_products: (book, input) => suggestProducts(book.db, input),
  list_unassigned_lines: (book, input) => unassignedLines(book, input),

  product_price_history: (book, input) => priceHistory(book, input),
  price_changes: (book, input) => priceChanges(book, input),
  cheapest_stores: (book, input) => cheapestStores(book, input.id),
  item_spending: (book, input) => itemSpending(book, input),
  product_activity: (book, input) => productActivity(book, input),
  product_summary: (book, input) => productSummary(book, input.id),
} satisfies DomainHandlers<typeof receipts>;

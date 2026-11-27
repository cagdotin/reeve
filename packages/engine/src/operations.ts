import {
  availableCatalog,
  checkInput,
  inOneBook,
  isOperationEnabled,
  type Operation,
  type OperationName,
} from "@reeve/contract/catalog";
import { Effect } from "effect";
import { InvalidRequest } from "@reeve/contract";
import type { Handler } from "./handler.ts";
import { importHandlers } from "./imports/handlers.ts";
import { bankHandlers } from "./bank/handlers.ts";
import { receiptHandlers } from "./receipts/handlers.ts";
import { runInBook } from "./run-in-book.ts";
import {
  moveBudgetCategoryReceipts,
  movePayeeReceipts,
  moveTransactionReceipts,
  receiptAppliedTransactions,
  restoreLegacyPhotos,
} from "./receipts/compatibility.ts";
import { reportHandlers } from "./reports/handlers.ts";
import { projectionHandlers } from "./reports/projections.ts";
import { ruleHandlers } from "./rules/handlers.ts";
import { scheduleHandlers } from "./schedules/handlers.ts";
import { templateHandlers } from "./templates/handlers.ts";
import { refuseNoteOnNothing, setNote, writeSettings, readSettings } from "./book.ts";
import { Books } from "./books.ts";
import { reverseLatest } from "./db/open.ts";
import {
  applyBudgetAction,
  coverOverbudgeted,
  coverOverspending,
  holdForNextMonth,
  moveBudget,
  resetHold,
  setBudget,
  setCarryover,
} from "./budget/actions.ts";
import { getBudget } from "./budget/view.ts";
import { budgetTransactions } from "./budget/records.ts";
import {
  closeAccount,
  createAccount,
  listAccounts,
  listLedgerAccounts,
  moveAccount,
  reconcileAccount,
  reopenAccount,
  updateAccount,
} from "./ledger/accounts.ts";
import {
  createCategory,
  createCategoryGroup,
  categoryRow,
  deleteCategory,
  deleteCategoryGroup,
  listCategories,
  checkCategoryDepth,
  moveCategory,
  moveCategoryGroup,
  updateCategory,
  updateCategoryGroup,
} from "./ledger/categories.ts";
import {
  createPayee,
  deletePayees,
  getPayee,
  listPayees,
  mergePayees,
  updatePayee,
} from "./ledger/payees.ts";
import { renameFutureImports } from "./rules/learn.ts";
import { fillRuleCategories } from "./rules/pending.ts";
import { keepPayeesApart, suggestPayeeMerges } from "./ledger/payee-likeness.ts";
import { accountActivity } from "./ledger/account-activity.ts";
import { payeeActivity } from "./ledger/payee-activity.ts";
import { listRegister } from "./ledger/register.ts";
import {
  createJournalEntry,
  createTransaction,
  deleteConfirmed,
  duplicateTransactions,
  getTransaction,
  makeTransfer,
  mergeTransactions,
  updateTransaction,
  updateTransactions,
} from "./ledger/transactions.ts";

export const handlers = {
  list_books: (books) => books.list,
  create_book: (books, input) => books.create(input),
  get_book: (book) => ({ id: book.id, file: book.file, settings: readSettings(book.db) }),
  update_book: (book, input) => {
    if (input.categoryDepth !== undefined) checkCategoryDepth(book, input.categoryDepth);
    writeSettings(book.db, input);
    return readSettings(book.db);
  },
  set_default_book: (books, input) => books.setDefault(input.id),
  delete_book: (books, input) => Effect.as(books.remove(input.id), { deleted: input.id }),
  undo: (book) => {
    const done = reverseLatest(book.client, "undo");
    if (done) restoreLegacyPhotos(book);
    return { done };
  },
  redo: (book) => ({ done: reverseLatest(book.client, "redo") }),
  set_note: (book, input) => {
    refuseNoteOnNothing(book.db, input.id);
    return { id: input.id, note: setNote(book.db, input.id, input.note) };
  },

  list_accounts: (book, input) => listAccounts(book, input),
  account_activity: (book, input) => accountActivity(book, input),
  list_ledger_accounts: (book) => listLedgerAccounts(book),
  create_account: (book, input) => createAccount(book, input),
  update_account: (book, input) => updateAccount(book, input),
  move_account: (book, input) => moveAccount(book, input),
  close_account: (book, input) => closeAccount(book, input),
  reopen_account: (book, input) => reopenAccount(book, input.id),
  reconcile_account: (book, input) => reconcileAccount(book, input),

  list_categories: (book) => listCategories(book),
  create_category_group: (book, input) => createCategoryGroup(book, input),
  update_category_group: (book, input) => updateCategoryGroup(book, input),
  move_category_group: (book, input) => moveCategoryGroup(book, input),
  delete_category_group: (book, input) => {
    if (input.transferCategory !== undefined) {
      categoryRow(book.db, input.transferCategory);
      const members = listCategories(book).find((group) => group.id === input.id)?.categories ?? [];
      moveBudgetCategoryReceipts(
        book,
        members.map((category) => category.id),
        input.transferCategory,
      );
    }
    return deleteCategoryGroup(book, input);
  },
  create_category: (book, input) => createCategory(book, input),
  update_category: (book, input) => updateCategory(book, input),
  move_category: (book, input) => moveCategory(book, input),
  delete_category: (book, input) => {
    if (input.transferCategory !== undefined && input.transferCategory !== input.id) {
      categoryRow(book.db, input.transferCategory);
      moveBudgetCategoryReceipts(book, [input.id], input.transferCategory);
    }
    return deleteCategory(book, input);
  },
  list_payees: (book) => listPayees(book),
  payee_activity: (book, input) => payeeActivity(book, input),
  create_payee: (book, input) => createPayee(book, input),
  update_payee: (book, { renameImports, ...input }) => {
    const before = getPayee(book.db, input.id);
    const payee = updatePayee(book, input);
    if (renameImports === true) renameFutureImports(book.db, payee, [before.name]);
    if (payee.name !== before.name) fillRuleCategories(book, { payee: payee.id });
    return payee;
  },
  merge_payees: (book, { renameImports, name, ...input }) => {
    const before = getPayee(book.db, input.target);
    const formerNames = input.merge.map((id) => getPayee(book.db, id).name);
    movePayeeReceipts(book, input.merge, input.target);
    const merged = mergePayees(book, input);
    const payee =
      name === undefined || name === merged.name
        ? merged
        : updatePayee(book, { id: input.target, name });
    if (renameImports === true) renameFutureImports(book.db, payee, [...formerNames, before.name]);
    fillRuleCategories(book, { payee: payee.id });
    return payee;
  },
  delete_payees: (book, input) => deletePayees(book, input.ids),
  suggest_payee_merges: (book, input) => ({ groups: suggestPayeeMerges(book, input) }),
  keep_payees_apart: (book, input) => ({ pairs: keepPayeesApart(book, input.payees) }),

  list_transactions: (book, input) => listRegister(book, input),
  get_transaction: (book, input) => getTransaction(book.db, input.id),
  create_transaction: (book, input) => createTransaction(book, input),
  create_journal_entry: (book, input) => createJournalEntry(book, input),
  update_transaction: (book, input) => updateTransaction(book, input),
  update_transactions: (book, input) => updateTransactions(book, input),
  delete_transactions: (book, input) => deleteConfirmed(book, input),
  duplicate_transactions: (book, input) => duplicateTransactions(book, input.ids),
  merge_transactions: (book, input) => {
    if (input.keep !== input.drop) {
      getTransaction(book.db, input.keep);
      moveTransactionReceipts(book, input.drop, input.keep);
    }
    return mergeTransactions(book, input);
  },
  make_transfer: (book, input) => {
    if (input.from !== input.to) {
      getTransaction(book.db, input.from);
      moveTransactionReceipts(book, input.to, input.from);
    }
    return makeTransfer(book, input);
  },

  get_budget: (book, input) => getBudget(book, input),
  budget_transactions: (book, input) => budgetTransactions(book, input),
  set_budget: (book, input) => setBudget(book, input),
  set_carryover: (book, input) => setCarryover(book, input),
  move_budget: (book, input) => moveBudget(book, input),
  cover_overspending: (book, input) => coverOverspending(book, input),
  cover_overbudgeted: (book, input) => coverOverbudgeted(book, input),
  hold_for_next_month: (book, input) => holdForNextMonth(book, input),
  reset_hold: (book, input) => resetHold(book, input),
  apply_budget_action: (book, input) => applyBudgetAction(book, input),
  ...ruleHandlers,
  ...scheduleHandlers,
  ...importHandlers,
  ...reportHandlers,
  ...projectionHandlers,
  ...templateHandlers,
  ...receiptHandlers,
  ...bankHandlers,
  create_rule: (book, input) => ruleHandlers.create_rule(book, input, receiptAppliedTransactions),
  update_rule: (book, input) => ruleHandlers.update_rule(book, input, receiptAppliedTransactions),
  preview_rule: (book, input) => ruleHandlers.preview_rule(book, input, receiptAppliedTransactions),
} satisfies { readonly [K in OperationName]: Handler<K> };

/** The book a path names to mean the default book, as a client that omits it sends. */
export const DEFAULT_BOOK = "~";

/**
 * Runs the operation `name` on its decoded input, in the book it names or the default one. The
 * input is checked here, whatever surface it came from: a key it does not know is an error.
 */
export const runOperation = (
  name: string,
  given: Record<string, unknown>,
): Effect.Effect<unknown, unknown, Books> =>
  Effect.gen(function* () {
    if (!isOperationEnabled(name))
      return yield* new InvalidRequest({ message: "Purchases is frozen and unavailable." });
    const books = yield* Books;
    const operation = availableCatalog()[name];
    const handler = (handlers as Record<string, (...args: Array<unknown>) => unknown>)[name];
    if (operation === undefined || handler === undefined)
      return yield* Effect.die(`No operation ${name}`);
    const input = yield* checkInput(operation, given);
    if (!inOneBook(operation))
      return yield* handler(books, input) as Effect.Effect<unknown, unknown>;
    const { book: bookId, ...rest } = input as { readonly book?: string };
    const book = yield* books.open(bookId === DEFAULT_BOOK ? undefined : bookId);
    if ((operation as Operation).network === true)
      return yield* handler(book, rest, books) as Effect.Effect<unknown, unknown>;
    // Undo and redo run their own transaction.
    const ownTransaction = name === "undo" || name === "redo";
    return yield* runInBook(books, book, operation.readonly || ownTransaction, () =>
      handler(book, rest),
    ).pipe(Effect.tap(() => (ownTransaction ? books.changed(book.id) : Effect.void)));
  });

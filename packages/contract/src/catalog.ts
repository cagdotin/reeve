/**
 * Every operation reeve offers, declared once (docs/rules/boundaries.md). HTTP endpoints, MCP tools, CLI
 * commands and the agent skill are generated from these entries; the engine binds each name to its
 * handler. Each domain declares its operations in `catalog/`.
 */
import { accounts } from "./catalog/accounts.ts";
import { bank } from "./catalog/bank.ts";
import { books } from "./catalog/books.ts";
import { budget } from "./catalog/budget.ts";
import { categories } from "./catalog/categories.ts";
import { imports } from "./catalog/imports.ts";
import { projections } from "./catalog/projections.ts";
import { receipts } from "./catalog/receipts.ts";
import { reports } from "./catalog/reports.ts";
import { rules } from "./catalog/rules.ts";
import { schedules } from "./catalog/schedules.ts";
import { templates } from "./catalog/templates.ts";
import { transactions } from "./catalog/transactions.ts";
import type { Operation } from "./operation.ts";
import { FEATURES } from "./features.ts";
import { Schema } from "effect";

export * from "./operation.ts";
export * from "./catalog/bank.ts";
export * from "./catalog/imports.ts";
export * from "./catalog/projections.ts";
export * from "./catalog/receipts.ts";
export * from "./catalog/reports.ts";
export * from "./catalog/rules.ts";
export * from "./catalog/schedules.ts";
export * from "./catalog/templates.ts";
export { bank, rules, schedules, imports, reports, projections, templates, receipts };

export const catalog = {
  ...books,
  ...accounts,
  ...categories,
  ...transactions,
  ...budget,
  ...rules,
  ...schedules,
  ...imports,
  ...bank,
  ...reports,
  ...projections,
  ...templates,
  ...receipts,
} satisfies Record<string, Operation>;

const purchasesOperations = new Set(Object.keys(receipts));

export const isOperationEnabled = (name: string): boolean =>
  FEATURES.purchases || !purchasesOperations.has(name);

/** The public catalog; frozen definitions remain above for types and opt-in tests. */
export const availableCatalog = (): Record<string, Operation> => {
  const operations: Record<string, Operation> = Object.fromEntries(
    Object.entries(catalog).filter(([name]) => isOperationEnabled(name)),
  );
  if (!FEATURES.purchases) {
    const { autoApplyReceipts: _frozen, ...fields } = books.update_book.input.fields;
    operations.update_book = { ...books.update_book, input: Schema.Struct(fields) };
  }
  return operations;
};

export type Catalog = typeof catalog;
export type OperationName = keyof Catalog;

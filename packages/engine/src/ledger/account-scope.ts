import { and, eq, inArray, type SQL } from "drizzle-orm";
import { notFound, type Book } from "../book.ts";
import * as t from "../db/schema.ts";

export interface AccountScope {
  readonly account?: string;
  readonly onBudget?: boolean;
}

export const hasScope = (scope: AccountScope) =>
  scope.account !== undefined || scope.onBudget !== undefined;

/** The asset and liability accounts in a scope, closed ones too, as the register lists them. */
export const accountsInScope = (book: Book, scope: AccountScope): Array<string> => {
  const where: Array<SQL> = [inArray(t.accounts.type, ["asset", "liability"])];
  if (scope.account !== undefined) where.push(eq(t.accounts.id, scope.account));
  const named = book.db
    .select({ id: t.accounts.id, onBudget: t.accounts.onBudget })
    .from(t.accounts)
    .where(and(...where))
    .all();
  if (scope.account !== undefined && named.length === 0) notFound("account", scope.account);
  return named
    .filter((each) => scope.onBudget === undefined || each.onBudget === scope.onBudget)
    .map((each) => each.id);
};

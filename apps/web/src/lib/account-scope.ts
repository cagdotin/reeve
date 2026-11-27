import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { REGISTER_ALL } from "./nav.ts";
import { isView, VIEWS } from "./register.ts";

/** Which accounts the Accounts tabs cover: all, a group or one account's id. */
export type AccountScope = "all" | "budgeted" | "offbudget" | (string & {});

/** The register's address holds the scope; the other tabs keep it in `?account=`. */
export const scopeAt = (path: string, search: Readonly<Record<string, unknown>>): AccountScope => {
  const register = /^\/accounts\/([^/]+)/.exec(path)?.[1];
  if (register === "uncategorized") return "budgeted";
  if (register !== undefined) return decodeURIComponent(register);
  const account = search["account"];
  return typeof account === "string" ? account : "all";
};

export const useAccountScope = (): AccountScope =>
  useRouterState({
    select: ({ location }) => scopeAt(location.pathname, location.search),
  });

export const scopeSearch = (scope: AccountScope): { account?: string } =>
  scope === "all" ? {} : { account: scope };

export const validateScopeSearch = (search: Record<string, unknown>): { account?: string } =>
  typeof search["account"] === "string" ? { account: search["account"] } : {};

/** The same tab's address under a scope. */
export const scopedLink = (to: string, scope: AccountScope) =>
  to === REGISTER_ALL ? { to: `/accounts/${scope}` } : { to, search: scopeSearch(scope) };

/** What an operation's `account` and `onBudget` take. */
export const scopeInput = (scope: AccountScope) =>
  scope !== "uncategorized" && isView(scope) ? VIEWS[scope].filter : { account: scope };

const GROUP_PHRASES: Readonly<Record<string, string>> = {
  all: "every account",
  budgeted: "budget accounts",
  offbudget: "off-budget accounts",
};

/** The scope inside a sentence ("on budget accounts"), given the name of the account it may name. */
export const scopePhrase = (scope: AccountScope, accountName: string | undefined) =>
  GROUP_PHRASES[scope] ?? accountName ?? "this account";

/** The account a scope names, if it names one. */
export const scopedAccount = (scope: AccountScope) => (isView(scope) ? undefined : scope);

/**
 * Runs `reset` in the render where the scope changes, for what belonged to the old scope. The page
 * stays mounted across a change, so a `key` would throw away what should stay.
 */
export const useResetOnScope = (scope: string, reset: () => void) => {
  const [seen, setSeen] = useState(scope);
  if (seen === scope) return;
  setSeen(scope);
  reset();
};

/**
 * Changes the scope on the page in view and keeps its filters, as a filter does. The register moves
 * to the scope's address; its Account filter goes, since it picks among the old scope's accounts.
 */
export const useSetAccountScope = () => {
  const navigate = useNavigate();
  const onRegister = useRouterState({
    select: ({ location }) => location.pathname.startsWith("/accounts/"),
  });
  return (scope: AccountScope) =>
    void (onRegister
      ? navigate({
          to: "/accounts/$account",
          params: { account: scope },
          search: (previous: Record<string, unknown>) => {
            const { accounts: _accounts, ...rest } = previous;
            return rest;
          },
        })
      : navigate({
          to: ".",
          search: (previous: Record<string, unknown>) => {
            const { account: _account, ...rest } = previous;
            return { ...rest, ...scopeSearch(scope) };
          },
        }));
};

import type { Account } from "@reeve/contract";
import { today } from "@reeve/contract/rules";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { EllipsisIcon, PlusIcon, StickyNoteIcon } from "lucide-react";
import { useState } from "react";
import { AccountDialog } from "@/components/account-dialog";
import { AccountBankStatus } from "@/components/bank/account-bank-status";
import { NotesButton } from "@/components/notes-button";
import { SuggestedMerges } from "@/components/payees/suggested-merges";
import { MobileRegister } from "@/components/mobile/mobile-register";
import { Page, QueryBody } from "@/components/page";
import { AccountMenu } from "@/components/register/account-menu";
import { AccountContext, type RegisterTable } from "@/components/register/account-context";
import { PendingRules } from "@/components/register/pending-rules";
import { RegisterFilters } from "@/components/register/register-filters";
import { usePaneLeave } from "@/components/split-panel";
import { Register } from "@/components/register/register-table";
import type { Editing } from "@/lib/register";
import { useIsMobile } from "@reeve/ui/hooks/use-media-query";
import { Button } from "@reeve/ui/components/button";
import { useResetOnScope } from "@/lib/account-scope";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import type { FacetValue } from "@/lib/facets";
import {
  type Check,
  emptyWords,
  isFiltered,
  isView,
  PAGE,
  registerInput,
  searchFrom,
  summedAccounts,
  validateRegisterSearch,
  type ViewName,
  VIEWS,
} from "@/lib/register";

export const Route = createFileRoute("/accounts/$account")({
  validateSearch: validateRegisterSearch,
  component: RegisterRoute,
});

function RegisterRoute() {
  const { account } = Route.useParams();
  return <RegisterPage param={account} />;
}

/** The filters, month and check, which live in the URL so that a link or a reload keeps them. */
function useRegisterSearch(): RegisterTable {
  const { month, check, ...filters } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const setSearch = (
    nextFilters: FacetValue,
    nextMonth: string | undefined,
    nextCheck: Check | undefined,
  ) => {
    void navigate({ search: searchFrom(nextFilters, nextMonth, nextCheck), replace: true });
  };
  return {
    filters,
    month,
    check,
    onFilters: (next) => setSearch(next, month, check),
    onMonth: (next) => setSearch(filters, next, check),
    onCheck: (next) => setSearch(filters, month, next),
  };
}

function RegisterPage({ param }: { param: string }) {
  const { id: book } = useBook();
  const accountId = isView(param) ? undefined : param;
  const accounts = useQuery(bookQuery(book, "list_accounts", { closed: true }));
  const account = accounts.data?.find((each) => each.id === accountId);
  const [editing, setEditing] = useState<Editing | null>(null);
  const leave = usePaneLeave();
  useResetOnScope(param, () => setEditing(null));
  if (accountId !== undefined && accounts.isSuccess && account === undefined)
    return (
      <Page title="Transactions">
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          No such account.
        </div>
      </Page>
    );
  if (accounts.data?.length === 0) return <NoAccounts />;
  const view = isView(param) ? param : null;
  return (
    <Page
      width="window"
      title={view === null ? (account?.name ?? "Transactions") : VIEWS[view].title}
      actions={
        <RegisterActions
          view={view}
          account={account}
          onAdd={
            view !== "uncategorized" && account?.closed !== true
              ? () => leave(() => setEditing({ kind: "new" }))
              : undefined
          }
        />
      }
    >
      <SuggestedMerges />
      <PendingRules param={param} />
      <RegisterBody
        param={param}
        view={view}
        account={account}
        // The balances wait for the account they sum.
        showContext={view !== null || account !== undefined}
        all={accounts.data ?? []}
        accountsError={accounts.error}
        editing={editing}
        onEditing={setEditing}
      />
    </Page>
  );
}

/** The table and everything over it, a phone's or a computer's. */
function RegisterBody({
  param,
  view,
  account,
  showContext,
  all,
  accountsError,
  editing,
  onEditing,
}: {
  param: string;
  view: ViewName | null;
  account: Account | undefined;
  showContext: boolean;
  all: ReadonlyArray<Account>;
  accountsError: Error | null;
  editing: Editing | null;
  onEditing: (editing: Editing | null) => void;
}) {
  const { id: book } = useBook();
  const [query, setQuery] = useState("");
  const table = useRegisterSearch();
  const { filters, month, check } = table;
  const [limit, setLimit] = useState(PAGE);
  useResetOnScope(param, () => setLimit(PAGE));
  const mobile = useIsMobile();
  const categories = useQuery(bookQuery(book, "list_categories", {}));
  // Only the transaction form needs every payee, so they load once it opens.
  const payees = useQuery({ ...bookQuery(book, "list_payees", {}), enabled: editing !== null });
  const register = useQuery({
    ...bookQuery(book, "list_transactions", {
      ...registerInput(param, query, filters, month, check, today()),
      limit,
    }),
    placeholderData: keepPreviousData,
  });
  const loaded = register.data &&
    categories.data && { page: register.data, categories: categories.data };
  return (
    <QueryBody
      query={{
        data: loaded,
        error: register.error ?? categories.error ?? payees.error ?? accountsError,
      }}
    >
      {(data) => {
        const shared = {
          scope: param,
          rows: data.page.rows,
          total: data.page.total,
          account: view === null ? param : undefined,
          multiAccount: view !== null,
          accounts: all,
          canAdd: view !== "uncategorized" && account?.closed !== true,
          empty: emptyWords(view, isFiltered(query, filters, month, check)),
          context: showContext && (
            <AccountContext
              param={param}
              view={view}
              account={account}
              accounts={summedAccounts(view, all, account)}
              table={table}
            />
          ),
          filters: (
            <RegisterFilters
              accounts={view === null ? undefined : summedAccounts(view, all, undefined)}
              query={query}
              onQuery={setQuery}
              value={filters}
              onChange={table.onFilters}
              month={month}
              onClearMonth={() => table.onMonth(undefined)}
              check={check}
              onClearCheck={() => table.onCheck(undefined)}
            />
          ),
          onMore: () => setLimit(limit + PAGE),
          categories: data.categories,
          payees: payees.data ?? [],
        };
        return mobile ? (
          <MobileRegister {...shared} editing={editing} onEditing={onEditing} />
        ) : (
          <Register {...shared} editing={editing} onEditing={onEditing} onMonth={table.onMonth} />
        );
      }}
    </QueryBody>
  );
}

/** The first thing to do in an empty book. */
function NoAccounts() {
  const [adding, setAdding] = useState(false);
  return (
    <Page title="Transactions">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        No accounts yet.
        <Button variant="outline" onClick={() => setAdding(true)}>
          <PlusIcon />
          Add your first account
        </Button>
      </div>
      <AccountDialog open={adding} onOpenChange={setAdding} />
    </Page>
  );
}

function RegisterActions({
  view,
  account,
  onAdd,
}: {
  view: ViewName | null;
  account: Account | undefined;
  /** Absent where nothing can be added: the uncategorized queue or a closed account. */
  onAdd: (() => void) | undefined;
}) {
  return (
    <>
      {onAdd && (
        <Button variant="ghost" className="max-md:hidden" onClick={onAdd}>
          <PlusIcon />
          Add transaction
        </Button>
      )}
      {account ? (
        <>
          <AccountBankStatus account={account.id} />
          <NotesButton id={account.id} notes={account.notes} className="opacity-100" />
          <AccountMenu account={account} />
        </>
      ) : (
        view === null && (
          <>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Add note"
              className="shrink-0 text-muted-foreground"
              disabled
            >
              <StickyNoteIcon />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Account actions" disabled>
              <EllipsisIcon />
            </Button>
          </>
        )
      )}
    </>
  );
}

import type { Account } from "@reeve/contract";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronDownIcon, LandmarkIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { AccountDialog } from "@/components/account-dialog";
import { Money } from "@/components/money";
import { Button } from "@reeve/ui/components/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@reeve/ui/components/menu";
import { useAccountScope, useSetAccountScope } from "@/lib/account-scope";
import { bookQuery } from "@/lib/api";
import { bankProblem, useBankLink } from "@/lib/bank";
import { useBook } from "@/lib/book";
import { isView, VIEWS } from "@/lib/register";

const total = (accounts: ReadonlyArray<Account>) =>
  accounts.reduce((sum, account) => sum + account.balance, 0);

function ScopeItem({
  value,
  label,
  amount,
  problem,
}: {
  value: string;
  label: string;
  amount?: number;
  problem?: string | undefined;
}) {
  return (
    <MenuRadioItem value={value} closeOnClick>
      <span className="flex w-full min-w-0 items-baseline justify-between gap-6">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate">{label}</span>
          {problem !== undefined && (
            <span title={problem} className="size-1.5 shrink-0 rounded-full bg-warning">
              <span className="sr-only">{problem}</span>
            </span>
          )}
        </span>
        {amount !== undefined && <Money amount={amount} className="text-xs" />}
      </span>
    </MenuRadioItem>
  );
}

function AccountItem({ account }: { account: Account }) {
  const link = useBankLink(account.id);
  return (
    <ScopeItem
      value={account.id}
      label={account.name}
      problem={link && bankProblem(link)}
      {...(account.closed ? {} : { amount: account.balance })}
    />
  );
}

function AccountsGroup({
  label,
  view,
  accounts,
}: {
  label: string;
  view?: { readonly value: string; readonly label: string };
  accounts: ReadonlyArray<Account>;
}) {
  if (accounts.length === 0) return null;
  return (
    <MenuGroup>
      <MenuGroupLabel>{label}</MenuGroupLabel>
      {view !== undefined && <ScopeItem {...view} amount={total(accounts)} />}
      {accounts.map((account) => (
        <AccountItem key={account.id} account={account} />
      ))}
    </MenuGroup>
  );
}

/** The accounts that Transactions, Schedules, Payees and Rules cover, and the way to add more, by hand or from a bank. */
export function AccountScopeMenu() {
  const { id: book } = useBook();
  const accounts = useQuery(bookQuery(book, "list_accounts", { closed: true })).data ?? [];
  const scope = useAccountScope();
  const setScope = useSetAccountScope();
  const onQueue = useRouterState({
    select: ({ location }) => location.pathname === "/accounts/uncategorized",
  });
  const [adding, setAdding] = useState(false);
  const here = onQueue ? "uncategorized" : scope;
  const live = accounts.filter((account) => !account.closed);
  const label = isView(here)
    ? VIEWS[here].title
    : (accounts.find((account) => account.id === here)?.name ?? "Account");
  return (
    <>
      <Menu>
        <MenuTrigger render={<Button variant="ghost" className="max-w-52 shrink-0 app-no-drag" />}>
          <span className="sr-only">Accounts shown: </span>
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDownIcon />
        </MenuTrigger>
        <MenuPopup align="start" className="min-w-64 [&_svg]:size-3.5!">
          <MenuRadioGroup value={here} onValueChange={(next: string) => setScope(next)}>
            <MenuGroupLabel>Accounts shown</MenuGroupLabel>
            <ScopeItem value="all" label={VIEWS.all.title} amount={total(live)} />
            {onQueue && <ScopeItem value="uncategorized" label={VIEWS.uncategorized.title} />}
            <AccountsGroup
              label="For budget"
              view={{ value: "budgeted", label: VIEWS.budgeted.title }}
              accounts={live.filter((account) => account.onBudget)}
            />
            <AccountsGroup
              label="Off budget"
              view={{ value: "offbudget", label: VIEWS.offbudget.title }}
              accounts={live.filter((account) => !account.onBudget)}
            />
            <AccountsGroup label="Closed" accounts={accounts.filter((account) => account.closed)} />
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuItem onClick={() => setAdding(true)}>
            <PlusIcon />
            Add account…
          </MenuItem>
          <MenuItem render={<Link to="/settings/$section" params={{ section: "banks" }} />}>
            <LandmarkIcon />
            Bank connections
          </MenuItem>
        </MenuPopup>
      </Menu>
      <AccountDialog open={adding} onOpenChange={setAdding} />
    </>
  );
}

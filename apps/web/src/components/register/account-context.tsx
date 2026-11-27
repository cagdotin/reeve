import type { Account } from "@reeve/contract";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckCircle2Icon, LockIcon } from "lucide-react";
import { AttentionAlerts } from "@/components/insights/attention-alerts";
import { Money } from "@/components/money";
import { PageAlert } from "@/components/page-alert";
import { useAttention } from "@/components/register/register-attention";
import { Button } from "@reeve/ui/components/button";
import { scopeSearch } from "@/lib/account-scope";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import type { FacetValue } from "@/lib/facets";
import { activityInput, type Check, type ViewName } from "@/lib/register";

export interface RegisterTable {
  readonly filters: FacetValue;
  readonly month: string | undefined;
  readonly check: Check | undefined;
  readonly onFilters: (filters: FacetValue) => void;
  readonly onMonth: (month: string | undefined) => void;
  readonly onCheck: (check: Check | undefined) => void;
}

function Figure({ label, amount, strong }: { label: string; amount: number; strong?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>
        <Money amount={amount} className={strong ? "text-base font-medium" : "text-[13px]"} />
      </dd>
    </div>
  );
}

/** The scope's balances and reconciling in one line over the table; its open checks are page alerts. */
export function AccountContext({
  param,
  view,
  account,
  accounts,
  table,
}: {
  param: string;
  view: ViewName | null;
  account: Account | undefined;
  /** The open accounts the page sums. */
  accounts: ReadonlyArray<Account>;
  table: RegisterTable;
}) {
  const { id: book, formatDay } = useBook();
  const activity = useQuery({
    ...bookQuery(book, "account_activity", activityInput(param, 1, undefined)),
    enabled: view !== "uncategorized",
    placeholderData: keepPreviousData,
  }).data;
  const attention = useAttention(activity, { view, account, table });
  if (view === "uncategorized") return null;
  const sum = (key: "balance" | "cleared" | "uncleared") =>
    accounts.reduce((total, each) => total + each[key], 0);
  const missed = attention.items.find((item) => item.id === "missed");
  const lastReconciled = activity?.attention.lastReconciled ?? null;
  return (
    <>
      <AttentionAlerts
        items={attention.items.filter((item) => item !== missed)}
        isActive={attention.isActive}
        onChoose={attention.choose}
      />
      {missed !== undefined && missed.count > 0 && (
        <PageAlert
          variant="warning"
          title={`${missed.count} ${missed.open}`}
          action={
            <Button variant="ghost" render={<Link to="/schedules" search={scopeSearch(param)} />}>
              Open Schedules
            </Button>
          }
        />
      )}
      <dl
        aria-label="Balances"
        className="flex min-h-11 flex-wrap items-center gap-x-5 gap-y-1 border-b px-3 py-1.5 tabular-nums"
      >
        <Figure label="Balance" amount={sum("balance")} strong />
        <Figure label="Cleared" amount={sum("cleared")} />
        <Figure label="Uncleared" amount={sum("uncleared")} />
        {lastReconciled !== null && view === null && (
          <div className="text-xs text-muted-foreground">
            Reconciled through {formatDay(lastReconciled)}
          </div>
        )}
        {account?.closed === true && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <LockIcon className="size-3.5" /> Closed
          </div>
        )}
        {attention.allClear !== null && (
          <div
            className="flex items-center gap-1 text-xs text-muted-foreground"
            title={attention.allClear}
          >
            <CheckCircle2Icon className="size-3.5 text-success" />
            All clear
          </div>
        )}
      </dl>
    </>
  );
}

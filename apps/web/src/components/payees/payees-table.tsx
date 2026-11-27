import type { PayeeActivity } from "@reeve/contract";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  CalendarClockIcon,
  ListIcon,
  MergeIcon,
  PencilIcon,
  StarIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react";
import { HelpCard } from "@/components/insights/help-card";
import { RowMenu, SortHeader, TableHeader, TableRow } from "@/components/insights/table";
import type { PayeeRequest } from "@/components/payees/payee-dialogs";
import { Button } from "@reeve/ui/components/button";
import { Checkbox } from "@reeve/ui/components/checkbox";
import { MenuItem, MenuSeparator } from "@reeve/ui/components/menu";
import { Switch } from "@reeve/ui/components/switch";
import { cn } from "@reeve/ui/lib/utils";
import { scopeSearch, useAccountScope } from "@/lib/account-scope";
import { useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { categorySummary, type PayeeSort, type PayeeSortKey } from "@/lib/payees";

/**
 * The columns, shared by the header and every row. They fold on the width the page has:
 * first the description, then all but the payee, its use and last.
 */
const SELECT = "flex w-4 shrink-0";
const STAR = "w-6 shrink-0 @max-3xl:hidden";
const NAME = "w-1/4 shrink-0 @max-[56rem]:w-auto @max-[56rem]:min-w-0 @max-[56rem]:flex-1";
const DESCRIPTION = "min-w-0 flex-1 truncate @max-[56rem]:hidden";
const CATEGORY = "w-32 shrink-0 truncate @max-3xl:hidden";
const RULES = "flex w-12 shrink-0 items-center justify-center gap-1 tabular-nums @max-3xl:hidden";
const COUNT = "flex w-12 shrink-0 justify-end tabular-nums";
const SPENT = "flex w-20 shrink-0 justify-end tabular-nums @max-3xl:hidden";
const LAST = "flex w-22 shrink-0 justify-end tabular-nums";
const LEARN = "flex w-14 shrink-0 justify-center @max-3xl:hidden";
const OPTIONS = "flex w-6 shrink-0 justify-center";

export function PayeesHeader({
  sort,
  onSort,
}: {
  sort: PayeeSort;
  onSort: (key: PayeeSortKey) => void;
}) {
  const shared = { sort, onSort };
  return (
    <TableHeader>
      <span className={SELECT} />
      <span className={STAR} />
      <span className={NAME}>
        <SortHeader {...shared} column="name" label="Payee" />
      </span>
      <span className={DESCRIPTION}>Description</span>
      <span className={CATEGORY}>
        <SortHeader {...shared} column="category" label="Category" />
      </span>
      <span className={RULES}>
        <SortHeader {...shared} column="rules" label="Rules" />
      </span>
      <span className={COUNT}>
        <SortHeader
          {...shared}
          end
          column="transactions"
          label="Txns"
          title="Transactions in the range"
        />
      </span>
      <span className={SPENT}>
        <SortHeader {...shared} end column="spent" label="Spent" title="Spent in the range" />
      </span>
      <span className={LAST}>
        <SortHeader {...shared} end column="last" label="Last" title="Last transaction" />
      </span>
      <span className={LEARN}>
        <HelpCard
          label="Learn categories: what this does"
          title="Learn categories"
          body={[
            "When you categorize a transaction, reeve looks at this payee's last 5 from about the past six months. If 3 or more share a category, it makes or updates the rule “payee is this → set that category”. Past transactions stay as they are.",
            "Off, reeve stops updating the rule. A rule it already has stays and keeps applying.",
          ]}
        >
          Learn
        </HelpCard>
      </span>
      <span className={OPTIONS} />
    </TableHeader>
  );
}

export function PayeeRow({
  payee,
  selected,
  onSelect,
  onRequest,
}: {
  payee: PayeeActivity;
  selected: boolean;
  onSelect: () => void;
  onRequest: (request: PayeeRequest) => void;
}) {
  const { id: book, format, formatDay } = useBook();
  const update = useBookMutation(book, "update_payee");
  const navigate = useNavigate();
  const scope = useAccountScope();
  const summary = categorySummary(payee.categories);
  return (
    <TableRow
      onOpen={() => onRequest({ kind: "edit", payee })}
      className={cn(selected && "bg-accent/60")}
    >
      <span className={SELECT}>
        <Checkbox
          aria-label={`Select ${payee.name}`}
          checked={selected}
          onCheckedChange={onSelect}
        />
      </span>
      <span className={STAR}>
        <Button
          size="icon-xs"
          variant="ghost"
          className="flex"
          aria-label={`${payee.favorite ? "Unfavorite" : "Favorite"} ${payee.name}`}
          onClick={() => update.mutate({ id: payee.id, favorite: !payee.favorite })}
        >
          <StarIcon
            className={cn(
              "size-3.5 opacity-100",
              payee.favorite ? "fill-warning text-warning" : "text-muted-foreground/50",
            )}
          />
        </Button>
      </span>
      <button
        type="button"
        className={cn(NAME, "cursor-pointer truncate text-left hover:underline")}
        title={payee.name}
        onClick={() => onRequest({ kind: "edit", payee })}
      >
        {payee.name}
      </button>
      <span
        className={cn(DESCRIPTION, "text-muted-foreground")}
        title={payee.description ?? undefined}
      >
        {payee.description}
      </span>
      <span
        className={cn(CATEGORY, summary?.mixed && "text-muted-foreground")}
        title={payee.categories.map((each) => `${each.name}: ${each.transactions}`).join("\n")}
      >
        {summary?.label}
        {summary !== null && summary.others > 0 && (
          <span className="ms-1 text-xs text-muted-foreground">+{summary.others}</span>
        )}
      </span>
      <span className={cn(RULES, "text-muted-foreground")}>
        {payee.ruleCount > 0 && (
          <Link
            to="/rules"
            search={{ payee: [payee.id], ...scopeSearch(scope) }}
            aria-label={`${payee.name} rules`}
            className="rounded-sm outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {payee.ruleCount}
          </Link>
        )}
        {payee.scheduled && (
          <span title="On a schedule" aria-label="On a schedule">
            <CalendarClockIcon className="size-3.5" />
          </span>
        )}
      </span>
      <span className={cn(COUNT, "text-muted-foreground")}>{payee.rangeTransactions || ""}</span>
      <span className={cn(SPENT, "text-muted-foreground")}>
        {payee.rangeSpent === 0 ? "" : format(payee.rangeSpent)}
      </span>
      <span className={cn(LAST, "text-muted-foreground")}>
        {payee.lastTransaction === null ? "" : formatDay(payee.lastTransaction)}
      </span>
      <span className={LEARN}>
        <Switch
          aria-label={`Learn categories for ${payee.name}`}
          checked={payee.learnCategories}
          onCheckedChange={(learnCategories) => update.mutate({ id: payee.id, learnCategories })}
        />
      </span>
      <span className={OPTIONS}>
        <RowMenu label={`${payee.name} options`}>
          <MenuItem onClick={() => onRequest({ kind: "edit", payee })}>
            <PencilIcon />
            Edit…
          </MenuItem>
          <MenuItem
            onClick={() =>
              void navigate({
                to: "/accounts/$account",
                params: { account: scope },
                search: { payees: [payee.id] },
              })
            }
          >
            <ListIcon />
            View transactions
          </MenuItem>
          {payee.ruleCount > 0 && (
            <MenuItem
              onClick={() =>
                void navigate({
                  to: "/rules",
                  search: { payee: [payee.id], ...scopeSearch(scope) },
                })
              }
            >
              <WandSparklesIcon />
              View rules
            </MenuItem>
          )}
          <MenuItem onClick={() => onRequest({ kind: "merge", payees: [payee] })}>
            <MergeIcon />
            Merge into…
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            variant="destructive"
            onClick={() => onRequest({ kind: "delete", payees: [payee] })}
          >
            <Trash2Icon />
            Delete…
          </MenuItem>
        </RowMenu>
      </span>
    </TableRow>
  );
}

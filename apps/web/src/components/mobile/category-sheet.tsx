import type { BudgetCategoryMonth, Category } from "@reeve/contract";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeftIcon, ShieldIcon, TargetIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import type { AmountRequest } from "@/components/budget/amount-dialog";
import { BalancePill } from "@/components/budget/budget-grid";
import { hasTargets, useCategoryTargets } from "@/components/budget/targets/use-targets";
import type { TargetRequest } from "@/components/budget/targets/target-dialog";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { TransactionList } from "@/components/mobile/transaction-list";
import { Money } from "@/components/money";
import { Button } from "@reeve/ui/components/button";
import { Input } from "@reeve/ui/components/input";
import { Label } from "@reeve/ui/components/label";
import { Spinner } from "@reeve/ui/components/spinner";
import { Switch } from "@reeve/ui/components/switch";
import { cn } from "@reeve/ui/lib/utils";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { monthDays, monthLabel } from "@/lib/months";

/** The category a sheet is open on, with its figures for the month. */
export interface CategoryTarget {
  readonly category: Category;
  readonly cell: BudgetCategoryMonth;
  readonly hasChildren: boolean;
  readonly income: boolean;
}

/**
 * A category's month on a phone, as Actual's category sheet: what it budgets (to edit), spends and
 * has left, moving money in or out, rollover, and the month's transactions.
 */
export function CategorySheet({
  target,
  month,
  tracking,
  onClose,
  onAmountRequest,
  onTargetRequest,
}: {
  target: CategoryTarget | null;
  month: string;
  tracking: boolean;
  onClose: () => void;
  onAmountRequest: (request: AmountRequest) => void;
  onTargetRequest: (request: TargetRequest) => void;
}) {
  return (
    <BottomSheet
      open={target !== null}
      onOpenChange={(open) => !open && onClose()}
      title={target?.category.name ?? ""}
      description={monthLabel(month)}
    >
      {target && (
        <CategoryMonth
          target={target}
          month={month}
          tracking={tracking}
          onClose={onClose}
          onAmountRequest={onAmountRequest}
          onTargetRequest={onTargetRequest}
        />
      )}
    </BottomSheet>
  );
}

function CategoryMonth({
  target,
  month,
  tracking,
  onClose,
  onAmountRequest,
  onTargetRequest,
}: {
  target: CategoryTarget;
  month: string;
  tracking: boolean;
  onClose: () => void;
  onAmountRequest: (request: AmountRequest) => void;
  onTargetRequest: (request: TargetRequest) => void;
}) {
  const { id: book } = useBook();
  const { category, cell, hasChildren, income } = target;
  const setCarryover = useBookMutation(book, "set_carryover");
  const move = useBookMutation(book, "move_budget");
  const cover = useBookMutation(book, "cover_overspending");
  const envelope = !tracking && !income;
  const canBudget = !income || tracking;

  const request = (next: AmountRequest) => {
    onClose();
    onAmountRequest(next);
  };

  return (
    <div className="grid gap-4">
      {canBudget && (
        <BudgetForm key={cell.budgeted} category={category} month={month} cell={cell} />
      )}
      <MonthFigures cell={cell} income={income} canBudget={canBudget} hasChildren={hasChildren} />
      {canBudget && (
        <TargetSummary
          category={category}
          onOpen={() => {
            onClose();
            onTargetRequest({ category, month });
          }}
        />
      )}
      {envelope && (
        <div className="grid gap-2">
          {cell.balance > 0 && (
            <Button
              variant="outline"
              onClick={() =>
                request({
                  title: `Transfer from ${category.name}`,
                  submit: "Transfer",
                  amount: cell.balance,
                  category: { label: "To", toBudget: true, exclude: category.id },
                  onSubmit: ({ amount, category: to }) =>
                    move.mutate({ month, from: category.id, to: to!, amount }),
                })
              }
            >
              <ArrowRightLeftIcon />
              Transfer to another category
            </Button>
          )}
          {cell.balance < 0 && (
            <Button
              variant="outline"
              onClick={() =>
                request({
                  title: `Cover ${category.name}'s overspending`,
                  description: "The whole overspending is covered from the category you pick.",
                  submit: "Cover",
                  noAmount: true,
                  category: { label: "From", toBudget: true, exclude: category.id },
                  onSubmit: ({ category: from }) =>
                    cover.mutate({ month, category: category.id, from: from! }),
                })
              }
            >
              <ShieldIcon />
              Cover overspending
            </Button>
          )}
          <Label className="flex items-center justify-between gap-3 rounded-xl border bg-background px-3 py-2.5 font-normal">
            Rollover overspending
            <Switch
              checked={cell.carryover}
              onCheckedChange={(carryover) =>
                setCarryover.mutate({ month, category: category.id, carryover })
              }
            />
          </Label>
        </div>
      )}
      <MonthTransactions category={category.id} month={month} />
    </div>
  );
}

function MonthFigures({
  cell,
  income,
  canBudget,
  hasChildren,
}: {
  cell: BudgetCategoryMonth;
  income: boolean;
  canBudget: boolean;
  hasChildren: boolean;
}) {
  return (
    <dl className="grid grid-cols-2 gap-3 rounded-xl border bg-background p-3">
      {canBudget && hasChildren && (
        <Figure label="Budgeted" total={cell.total.budgeted}>
          <Money amount={cell.budgeted} tone="none" />
        </Figure>
      )}
      <Figure
        label={income ? "Received" : "Spent"}
        total={hasChildren ? cell.total.spent : undefined}
      >
        <Money amount={cell.spent} tone="none" />
      </Figure>
      {!income && (
        <Figure label="Balance" total={hasChildren ? cell.total.balance : undefined}>
          <BalancePill amount={cell.balance} carryover={cell.carryover} goal={cell.goal} />
        </Figure>
      )}
      {cell.goal !== null && (
        <Figure label="Goal">
          <Money amount={cell.goal} tone="none" />
        </Figure>
      )}
    </dl>
  );
}

/** The category's targets as sentences, and the way into the target editor. */
function TargetSummary({ category, onOpen }: { category: Category; onOpen: () => void }) {
  const targets = useCategoryTargets(category.id);
  const has = hasTargets(targets);
  return (
    <section
      aria-label="Targets"
      className="flex items-start gap-3 rounded-xl border bg-background p-3"
    >
      <TargetIcon
        className={cn("mt-0.5 size-4 shrink-0", has ? "text-primary" : "text-muted-foreground")}
      />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-sm font-medium">Target</span>
        {has ? (
          <ul className="grid gap-0.5 text-xs text-muted-foreground">
            {targets.sentences.map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
        ) : (
          <span className="text-xs text-muted-foreground">
            Say what this category needs, and reeve fills in the budget.
          </span>
        )}
      </div>
      <Button variant="outline" onClick={onOpen}>
        {has ? "Edit" : "Set a target"}
      </Button>
    </section>
  );
}

function Figure({
  label,
  total,
  children,
}: {
  label: string;
  /** The rolled-up figure with subcategories, for a parent. */
  total?: number | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-base">{children}</dd>
      {total !== undefined && (
        <dd className="text-xs text-muted-foreground">
          With subcategories <Money amount={total} tone="none" />
        </dd>
      )}
    </div>
  );
}

function BudgetForm({
  category,
  month,
  cell,
}: {
  category: Category;
  month: string;
  cell: BudgetCategoryMonth;
}) {
  const { id: book, format, parse } = useBook();
  const setBudget = useBookMutation(book, "set_budget");
  const [text, setText] = useState(() => (cell.budgeted === 0 ? "" : format(cell.budgeted)));
  const amount = text.trim() === "" ? 0 : parse(text);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (amount === null || amount === cell.budgeted) return;
    setBudget.mutate({ month, category: category.id, amount });
  };
  return (
    <form onSubmit={submit} className="grid gap-1.5">
      <Label htmlFor="mobile-budgeted" className="text-xs text-muted-foreground">
        Budgeted
      </Label>
      <div className="flex gap-2">
        <Input
          id="mobile-budgeted"
          inputMode="decimal"
          enterKeyHint="done"
          aria-label={`${category.name} budgeted`}
          placeholder={format(0)}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          aria-invalid={amount === null || undefined}
          className="flex-1 text-right tabular-nums text-lg"
        />
        <Button
          type="submit"
          disabled={amount === null || amount === cell.budgeted}
          loading={setBudget.isPending}
        >
          Save
        </Button>
      </div>
    </form>
  );
}

function MonthTransactions({ category, month }: { category: string; month: string }) {
  const { id: book } = useBook();
  const rows = useQuery(
    bookQuery(book, "list_transactions", {
      categories: [category],
      ...monthDays(month),
      limit: 100,
    }),
  );
  return (
    <section className="grid gap-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">Transactions</h3>
      {rows.data === undefined ? (
        <div className="flex justify-center p-4">
          <Spinner />
        </div>
      ) : rows.data.rows.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          None this month.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-background">
          <TransactionList rows={rows.data.rows} multiAccount />
        </div>
      )}
    </section>
  );
}

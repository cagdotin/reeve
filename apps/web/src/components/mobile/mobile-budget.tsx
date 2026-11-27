import type {
  BudgetCategoryMonth,
  BudgetGroupMonth,
  BudgetView,
  CategoryGroup,
} from "@reeve/contract";
import { ChevronRightIcon, TargetIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Folding } from "@/components/budget/use-folding";
import { CategoryCard, GroupCard, type CardTrigger } from "@/components/categories/category-card";
import type { CategoryRequest } from "@/components/categories/category-dialog";
import { Button } from "@reeve/ui/components/button";
import { AmountDialog, type AmountRequest } from "@/components/budget/amount-dialog";
import { BalancePill } from "@/components/budget/budget-grid";
import { hasTargets, useCategoryTargets } from "@/components/budget/targets/use-targets";
import { TargetDialog, type TargetRequest } from "@/components/budget/targets/target-dialog";
import { treeRows, type TreeRow } from "@/components/budget/tree";
import { MonthSummary } from "@/components/budget/month-summary";
import { CategorySheet } from "@/components/mobile/category-sheet";
import { Money } from "@/components/money";
import { cn } from "@reeve/ui/lib/utils";
import { useBook } from "@/lib/book";

const NUMBER = "w-[4.25rem] shrink-0 text-right";

/**
 * The budget on a phone, one month at a time as Actual's mobile budget: the month's summary with
 * To Budget on top, then each group and its categories with budgeted, spent and balance. Tapping
 * a category opens its sheet.
 */
export function MobileBudget({
  view,
  showHidden,
  folding,
  onCategoryRequest,
}: {
  view: BudgetView;
  showHidden: boolean;
  folding: Folding;
  onCategoryRequest: (request: CategoryRequest) => void;
}) {
  const { collapsed, collapsedRows } = folding;
  const [amountRequest, setAmountRequest] = useState<AmountRequest | null>(null);
  const [open, setOpen] = useState<{ id: string; income: boolean } | null>(null);
  const [targetRequest, setTargetRequest] = useState<TargetRequest | null>(null);
  const month = view.months[0];
  if (month === undefined) return null;
  const tracking = view.budgetType === "tracking";
  const cells = new Map(month.categories.map((each) => [each.id, each]));
  const totals = new Map(month.groups.map((each) => [each.id, each]));
  const groups = view.groups.filter((group) => showHidden || !group.hidden);

  const openCategory = view.groups
    .flatMap((group) => group.categories)
    .find((category) => category.id === open?.id);
  const openCell = open === null ? undefined : cells.get(open.id);

  const section = (group: CategoryGroup) => {
    const rows = treeRows(group, showHidden, collapsedRows);
    return (
      <GroupSection
        key={group.id}
        group={group}
        rows={collapsed.has(group.id) ? [] : rows}
        total={totals.get(group.id)}
        cells={cells}
        tracking={tracking}
        collapsed={collapsed.has(group.id)}
        onToggle={() => folding.toggleGroup(group.id)}
        onToggleRow={folding.toggleRow}
        onOpen={(id) => setOpen({ id, income: group.isIncome })}
        month={month.month}
        onTargetRequest={setTargetRequest}
        onCategoryRequest={onCategoryRequest}
      />
    );
  };

  return (
    <div>
      <div className="border-b px-4 py-3">
        <MonthSummary month={month} onRequest={setAmountRequest} />
      </div>
      {groups.filter((group) => !group.isIncome).length > 0 && (
        <ColumnHeader labels={["Budgeted", "Spent", "Balance"]} />
      )}
      {groups.filter((group) => !group.isIncome).map(section)}
      {groups.some((group) => group.isIncome) && (
        <ColumnHeader
          className="mt-4"
          title="Income"
          labels={tracking ? ["Budgeted", "Received"] : ["Received"]}
        />
      )}
      {groups.filter((group) => group.isIncome).map(section)}
      {groups.length === 0 && (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No categories yet.{" "}
          <Button variant="link" onClick={() => onCategoryRequest({ kind: "create-group" })}>
            Add a group
          </Button>
        </div>
      )}
      <CategorySheet
        target={
          openCategory && openCell
            ? {
                category: openCategory,
                cell: openCell,
                hasChildren: hasChildren(view, openCategory.id),
                income: open?.income === true,
              }
            : null
        }
        month={month.month}
        tracking={tracking}
        onClose={() => setOpen(null)}
        onAmountRequest={setAmountRequest}
        onTargetRequest={setTargetRequest}
      />
      <TargetDialog
        request={targetRequest}
        groups={view.groups}
        onClose={() => setTargetRequest(null)}
      />
      <AmountDialog
        request={amountRequest}
        groups={view.groups}
        onClose={() => setAmountRequest(null)}
      />
    </div>
  );
}

const hasChildren = (view: BudgetView, id: string) =>
  view.groups.some((group) => group.categories.some((category) => category.parentId === id));

function ColumnHeader({
  title = "Category",
  labels,
  className,
}: {
  title?: string;
  labels: ReadonlyArray<string>;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky top-(--sticky-top) z-10 flex items-center gap-1 border-y bg-background/95 py-1.5 ps-4 pe-3 text-[11px] text-muted-foreground backdrop-blur-sm",
        className,
      )}
    >
      <span className="min-w-0 flex-1">{title}</span>
      {labels.map((label) => (
        <span key={label} className={NUMBER}>
          {label}
        </span>
      ))}
    </div>
  );
}

function GroupSection({
  group,
  rows,
  total,
  cells,
  tracking,
  collapsed,
  onToggle,
  onToggleRow,
  onOpen,
  month,
  onTargetRequest,
  onCategoryRequest,
}: {
  group: CategoryGroup;
  rows: ReadonlyArray<TreeRow>;
  total: BudgetGroupMonth | undefined;
  cells: ReadonlyMap<string, BudgetCategoryMonth>;
  tracking: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onToggleRow: (id: string) => void;
  onOpen: (id: string) => void;
  month: string;
  onTargetRequest: (request: TargetRequest) => void;
  onCategoryRequest: (request: CategoryRequest) => void;
}) {
  const income = group.isIncome;
  const canTarget = !income || tracking;
  return (
    <section aria-label={group.name}>
      <div className="flex min-h-11 items-center gap-1 border-b ps-2 pe-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground"
        >
          <ChevronRightIcon
            className={cn("size-4 transition-transform", !collapsed && "rotate-90")}
          />
        </button>
        <GroupCard
          group={group}
          months={[month]}
          onRequest={onCategoryRequest}
          trigger={{
            as: (
              <button
                type="button"
                aria-label={`${group.name} options`}
                className={cn(
                  "line-clamp-2 min-h-8 min-w-0 flex-1 cursor-pointer text-left text-sm font-medium break-words outline-none focus-visible:underline",
                  group.hidden && "opacity-60",
                )}
              />
            ),
            label: group.name,
          }}
        />
        <Figures
          income={income}
          tracking={tracking}
          budgeted={total?.budgeted ?? 0}
          spent={total?.spent ?? 0}
          balance={total?.balance ?? 0}
          strong
        />
      </div>
      {rows.map((row) => {
        const cell = cells.get(row.category.id);
        if (cell === undefined) return null;
        return (
          <CategoryItem
            key={row.category.id}
            row={row}
            cell={cell}
            income={income}
            tracking={tracking}
            onToggle={() => onToggleRow(row.category.id)}
            onOpen={() => onOpen(row.category.id)}
            card={(trigger) => (
              <CategoryCard
                category={row.category}
                group={group}
                level={row.level}
                months={[month]}
                onTargets={
                  canTarget ? () => onTargetRequest({ category: row.category, month }) : undefined
                }
                onRequest={onCategoryRequest}
                trigger={trigger}
              />
            )}
          />
        );
      })}
    </section>
  );
}

/** A row's numbers: budgeted, spent and balance, or what income shows. */
function Figures({
  income,
  tracking,
  budgeted,
  spent,
  balance,
  strong = false,
  carryover = false,
  goal = null,
}: {
  income: boolean;
  tracking: boolean;
  budgeted: number;
  spent: number;
  balance: number;
  strong?: boolean;
  carryover?: boolean;
  goal?: number | null;
}) {
  const weight = strong ? "font-medium" : undefined;
  return (
    <>
      {(!income || tracking) && (
        <Money amount={budgeted} tone="none" className={cn(NUMBER, "text-[13px]", weight)} />
      )}
      <Money
        amount={spent}
        tone="none"
        className={cn(NUMBER, "text-[13px]", !income && "text-muted-foreground", weight)}
      />
      {!income && (
        <span className={cn(NUMBER, "flex justify-end")}>
          {strong ? (
            <Money amount={balance} tone="balance" className={cn("pe-1.5 text-[13px]", weight)} />
          ) : (
            <BalancePill amount={balance} carryover={carryover} goal={goal} />
          )}
        </span>
      )}
    </>
  );
}

function CategoryItem({
  row,
  cell,
  income,
  tracking,
  onToggle,
  onOpen,
  card,
}: {
  row: TreeRow;
  cell: BudgetCategoryMonth;
  income: boolean;
  tracking: boolean;
  onToggle: () => void;
  onOpen: () => void;
  card: (trigger: CardTrigger) => ReactNode;
}) {
  const { format } = useBook();
  const { category, level, hasChildren, collapsed } = row;
  const targeted = hasTargets(useCategoryTargets(category.id));
  const label = income
    ? `${category.name}: received ${format(cell.spent)}`
    : `${category.name}: budgeted ${format(cell.budgeted)}, spent ${format(cell.spent)}, balance ${format(cell.balance)}`;
  return (
    <div
      className={cn("flex items-stretch border-b", category.hidden && "opacity-60")}
      style={{ paddingInlineStart: `${0.5 + level * 0.875}rem` }}
    >
      {hasChildren ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${category.name}` : `Collapse ${category.name}`}
          className="flex w-8 shrink-0 cursor-pointer items-center justify-center text-muted-foreground"
        >
          <ChevronRightIcon
            className={cn("size-4 transition-transform", !collapsed && "rotate-90")}
          />
        </button>
      ) : (
        <span className="w-8 shrink-0" />
      )}
      {card({
        as: (
          <button
            type="button"
            aria-label={`${category.name} options`}
            className="flex min-h-12 min-w-0 flex-1 cursor-pointer flex-col justify-center py-1.5 pe-1 text-left leading-tight outline-none active:bg-muted/60 focus-visible:bg-muted/60"
          />
        ),
        label: (
          <>
            <span className="flex min-w-0 items-center gap-1">
              <span className="line-clamp-2 text-sm break-words">{category.name}</span>
              {targeted && (
                <TargetIcon aria-label="Has a target" className="size-3.5 shrink-0 text-primary" />
              )}
            </span>
            {hasChildren && (
              <span className="truncate text-[11px] text-muted-foreground">
                incl. subcategories
              </span>
            )}
          </>
        ),
      })}
      <button
        type="button"
        onClick={onOpen}
        aria-label={label}
        className="flex shrink-0 cursor-pointer flex-col items-end justify-center gap-0.5 py-1.5 pe-3 outline-none active:bg-muted/60 focus-visible:bg-muted/60"
      >
        <span className="flex items-center gap-1">
          <Figures
            income={income}
            tracking={tracking}
            budgeted={cell.budgeted}
            spent={cell.spent}
            balance={cell.balance}
            carryover={cell.carryover}
            goal={cell.goal}
          />
        </span>
        {hasChildren && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            {(!income || tracking) && (
              <Money amount={cell.total.budgeted} tone="none" className={NUMBER} />
            )}
            <Money amount={cell.total.spent} tone="none" className={NUMBER} />
            {!income && (
              <Money amount={cell.total.balance} tone="none" className={cn(NUMBER, "pe-1.5")} />
            )}
          </span>
        )}
      </button>
    </div>
  );
}

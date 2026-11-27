import type {
  BudgetCategoryMonth,
  BudgetMonth,
  BudgetView,
  Category,
  CategoryGroup,
} from "@reeve/contract";
import { currentMonth } from "@reeve/contract/rules";
import { ChevronRightIcon, EllipsisIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AmountInput } from "@/components/amount-input";
import { AmountDialog, type AmountRequest } from "@/components/budget/amount-dialog";
import { BUDGET_ACTIONS } from "@/components/budget/actions";
import { type BudgetFigure, categoryFigure, groupFigure } from "@/components/budget/budget-figure";
import { BudgetRecords } from "@/components/budget/budget-records";
import { MonthSummary } from "@/components/budget/month-summary";
import { Money } from "@/components/money";
import { TargetButton } from "@/components/budget/targets/target-button";
import { TargetDialog, type TargetRequest } from "@/components/budget/targets/target-dialog";
import { CategoryCard, GroupCard } from "@/components/categories/category-card";
import {
  CategoryDnd,
  DragHandle,
  DropMark,
  useDragRow,
  useDragState,
} from "@/components/categories/category-dnd";
import type { CategoryRequest } from "@/components/categories/category-dialog";
import type { Dragged } from "@/components/categories/drop";
import { monthLabel } from "@/lib/months";
import { Button } from "@reeve/ui/components/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "@reeve/ui/components/menu";
import { cn } from "@reeve/ui/lib/utils";
import { useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { treeRows, type TreeRow } from "@/components/budget/tree";
import type { Folding } from "@/components/budget/use-folding";

const NAME = "w-64 shrink-0 sticky left-0 z-10 border-r bg-background group-hover/row:bg-row-hover";

/** Each month's cells, by category and by group id. */
const monthColumns = (view: BudgetView) =>
  view.months.map((month) => ({
    month,
    categories: new Map(month.categories.map((each) => [each.id, each])),
    groups: new Map(month.groups.map((each) => [each.id, each])),
  }));

type Column = ReturnType<typeof monthColumns>[number];

interface Requests {
  readonly onAmountRequest: (request: AmountRequest) => void;
  readonly onTargetRequest: (request: TargetRequest) => void;
  readonly onCategoryRequest: (request: CategoryRequest) => void;
  readonly onRecordsRequest: (figure: BudgetFigure) => void;
}

/** The month a target editor previews and applies to: this month when it shows, else the first. */
const targetMonth = (columns: ReadonlyArray<Column>) => {
  const months = columns.map((column) => column.month.month);
  return months.find((month) => month === currentMonth()) ?? months[0] ?? currentMonth();
};

/** Actual's budget table: categories down the side, and per month budgeted, spent and balance. */
export function BudgetGrid({
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
  const { book } = useBook();
  const [amountRequest, setAmountRequest] = useState<AmountRequest | null>(null);
  const [targetRequest, setTargetRequest] = useState<TargetRequest | null>(null);
  const [records, setRecords] = useState<BudgetFigure | null>(null);
  const tracking = view.budgetType === "tracking";
  const { collapsed, collapsedRows } = folding;

  const groups = view.groups.filter((group) => showHidden || !group.hidden);
  const columns = monthColumns(view);
  const requests = {
    onAmountRequest: setAmountRequest,
    onTargetRequest: setTargetRequest,
    onCategoryRequest,
    onRecordsRequest: setRecords,
  };
  const section = (group: CategoryGroup): SectionProps => ({
    group,
    rows: treeRows(group, showHidden, collapsedRows),
    columns,
    tracking,
    collapsed: collapsed.has(group.id),
    onToggle: () => folding.toggleGroup(group.id),
    onToggleRow: folding.toggleRow,
    ...requests,
  });

  const draggedCell = (dragged: Dragged) => {
    const group = view.groups.find((each) =>
      dragged.kind === "group"
        ? each.id === dragged.id
        : each.categories.some((category) => category.id === dragged.id),
    );
    if (group === undefined) return null;
    const props = section(group);
    if (dragged.kind === "group") return <GroupName {...props} />;
    const row = props.rows.find((each) => each.category.id === dragged.id);
    return row === undefined ? null : <CategoryName {...props} row={row} />;
  };

  return (
    <div className="min-w-fit text-sm [&_div.border-l:nth-child(2)]:border-l-0">
      {records !== null && <BudgetRecords figure={records} onClose={() => setRecords(null)} />}
      <GridHeader months={view.months} onRequest={setAmountRequest} />
      <CategoryDnd
        groups={view.groups}
        maxDepth={book.settings.categoryDepth}
        renderDragged={draggedCell}
      >
        {groups
          .filter((group) => !group.isIncome)
          .map((group) => (
            <ExpenseGroup key={group.id} {...section(group)} />
          ))}
        {groups
          .filter((group) => group.isIncome)
          .map((group) => (
            <IncomeGroup key={group.id} {...section(group)} />
          ))}
      </CategoryDnd>

      {groups.length === 0 && (
        <div className="p-8 text-center text-sm text-muted-foreground">
          No categories yet.{" "}
          <Button variant="link" onClick={() => onCategoryRequest({ kind: "create-group" })}>
            Add a group
          </Button>
        </div>
      )}

      <AmountDialog
        request={amountRequest}
        groups={view.groups}
        onClose={() => setAmountRequest(null)}
      />
      <TargetDialog
        request={targetRequest}
        groups={view.groups}
        onClose={() => setTargetRequest(null)}
      />
    </div>
  );
}

function GridHeader({
  months,
  onRequest,
}: {
  months: ReadonlyArray<BudgetMonth>;
  onRequest: (request: AmountRequest) => void;
}) {
  return (
    <div className="sticky top-(--sticky-top) z-20 bg-background">
      <div className="flex border-b">
        <div className={NAME} />
        {months.map((month) => (
          <div key={month.month} className="min-w-72 flex-1 border-l p-2">
            <MonthSummary month={month} onRequest={onRequest} />
          </div>
        ))}
      </div>
      <div className="flex border-b bg-background text-xs text-muted-foreground">
        <div className={cn(NAME, "ps-6 pe-2 py-1.5")}>Category</div>
        {months.map((month) => (
          <div
            key={month.month}
            className="grid min-w-72 flex-1 grid-cols-3 gap-1 border-l px-1 py-1.5 text-right"
          >
            <span className="px-1.5">Budgeted</span>
            <span className="px-1.5">Spent</span>
            <span className="px-1.5">Balance</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface SectionProps extends Requests {
  readonly group: CategoryGroup;
  readonly rows: ReadonlyArray<TreeRow>;
  readonly columns: ReadonlyArray<Column>;
  readonly tracking: boolean;
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly onToggleRow: (id: string) => void;
}

function Total({
  amount,
  tone = "none",
  label,
}: {
  amount: number | undefined;
  tone?: "none" | "balance";
  label?: string;
}) {
  return (
    <Money
      amount={amount ?? 0}
      tone={tone}
      {...(label === undefined ? {} : { label })}
      className="px-1.5 text-right text-[13px] font-medium"
    />
  );
}

/** A group's rows. */
function Section({
  group,
  className,
  children,
}: {
  group: CategoryGroup;
  className?: string;
  children: ReactNode;
}) {
  const { dragging } = useDragState();
  return (
    <div
      className={cn(
        "relative [&>div>div:not(:first-child)]:min-w-72",
        dragging.has(group.id) && "opacity-40",
        className,
      )}
    >
      {children}
      <DropMark row={`section:${group.id}`} />
    </div>
  );
}

function ExpenseGroup(props: SectionProps) {
  const { group, collapsed } = props;
  return (
    <Section group={group}>
      <GroupRow {...props}>
        {({ month, groups: totals }) => {
          const sum = totals.get(group.id);
          return (
            <>
              <Total amount={sum?.budgeted} />
              <RecordsButton
                onOpen={() => props.onRecordsRequest(groupFigure(group, month.month, false))}
              >
                <Total amount={sum?.spent} label={`${group.name} spent in ${month.month}`} />
              </RecordsButton>
              <Total amount={sum?.balance} tone="balance" />
            </>
          );
        }}
      </GroupRow>
      {!collapsed &&
        props.rows.map((row) => <CategoryRow key={row.category.id} {...props} row={row} />)}
    </Section>
  );
}

function IncomeGroup(props: SectionProps) {
  const { group, columns, tracking, collapsed } = props;
  return (
    <Section group={group} className="mt-6">
      <div className="flex border-y text-xs text-muted-foreground">
        <div className={cn(NAME, "ps-6 pe-3 py-1.5")}>Income</div>
        {columns.map(({ month }) => (
          <div
            key={month.month}
            className={cn(
              "grid min-w-72 flex-1 gap-1 border-l px-1 py-1.5 text-right",
              tracking ? "grid-cols-3" : "grid-cols-1",
            )}
          >
            {tracking && <span className="px-1.5">Budgeted</span>}
            <span className={cn("px-1.5", tracking && "col-span-2")}>Received</span>
          </div>
        ))}
      </div>
      <GroupRow {...props}>
        {({ month, groups: totals }) => {
          const sum = totals.get(group.id);
          const received = (
            <RecordsButton
              className={tracking ? "col-span-2" : "col-span-3"}
              onOpen={() => props.onRecordsRequest(groupFigure(group, month.month, true))}
            >
              <Total amount={sum?.spent} label={`${group.name} received in ${month.month}`} />
            </RecordsButton>
          );
          return tracking ? (
            <>
              <Total amount={sum?.budgeted} />
              {received}
            </>
          ) : (
            received
          );
        }}
      </GroupRow>
      {!collapsed &&
        props.rows.map((row) => <IncomeRow key={row.category.id} {...props} row={row} />)}
    </Section>
  );
}

type Handle = ReturnType<typeof useDragRow>["handle"];

function GroupName({
  group,
  columns,
  collapsed,
  onToggle,
  onCategoryRequest,
  handle,
}: SectionProps & { handle?: Handle }) {
  return (
    <div
      className={cn(NAME, "flex h-9 items-center gap-1 pe-1")}
      style={{ paddingInlineStart: `${GUTTER}rem` }}
    >
      <DragHandle label={group.name} handle={handle} />
      <Chevron label={group.name} collapsed={collapsed} onToggle={onToggle} />
      <span
        title={group.name}
        className={cn("min-w-0 truncate text-[13px] font-medium", group.hidden && "opacity-60")}
      >
        {group.name}
      </span>
      <span className="flex-1" />
      <GroupCard
        group={group}
        months={columns.map((column) => column.month.month)}
        onRequest={onCategoryRequest}
      />
    </div>
  );
}

function GroupRow({
  children,
  ...props
}: SectionProps & { children: (column: Column) => ReactNode }) {
  const { group, columns } = props;
  const { ref, handle } = useDragRow(
    { kind: "group", id: group.id },
    { kind: "group", id: group.id },
  );
  return (
    <div ref={ref} className="group/row relative flex border-b hover:bg-row-hover">
      <GroupName {...props} handle={handle} />
      {columns.map((column) => (
        <div
          key={column.month.month}
          className="grid flex-1 grid-cols-3 items-center gap-1 border-l px-1"
        >
          {children(column)}
        </div>
      ))}
      <DropMark row={`group:${group.id}`} />
    </div>
  );
}

interface RowProps extends SectionProps {
  readonly row: TreeRow;
}

/** The gutter at the start of every name cell, in rem. */
const GUTTER = 1.5;

/** A chevron and its gap, in rem: chevrons hang before names, so names line up by level. */
const STEP = 1.5;

/** Where a category's name starts: level 0 lines up with its group's name. */
const nameInset = (level: number) => GUTTER + STEP + level * STEP;

/** A drop among a group's top categories spans the row; a nested one starts where its level's names do. */
const dropLineStart = (level: number) => (level === 0 ? 0 : nameInset(level));

function Chevron({
  label,
  collapsed,
  onToggle,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
      aria-expanded={!collapsed}
    >
      <ChevronRightIcon
        className={cn("size-3.5 transition-transform", !collapsed && "rotate-90")}
      />
    </button>
  );
}

/** A category's row: its name cell, the months in `children`, and what dragging it needs. */
function CategoryRowFrame({ children, ...props }: RowProps & { children: ReactNode }) {
  const { row, group } = props;
  const { category, hasChildren, collapsed } = row;
  const { dragging } = useDragState();
  const { ref, handle } = useDragRow(
    { kind: "category", id: category.id },
    { kind: "category", id: category.id, groupId: group.id, expanded: hasChildren && !collapsed },
  );
  return (
    <div
      ref={ref}
      className={cn(
        "group/row relative flex border-b hover:bg-row-hover",
        category.hidden && "opacity-60",
        dragging.has(category.id) && "opacity-40",
      )}
    >
      <CategoryName {...props} handle={handle} />
      {children}
      <DropMark row={`category:${category.id}`} lineStart={dropLineStart} />
    </div>
  );
}

/** A category's name cell: indented by depth, a chevron when it has subcategories, a mark when it has targets, its menu on hover. */
function CategoryName({
  row,
  group,
  columns,
  tracking,
  handle,
  onTargetRequest,
  onCategoryRequest,
  onToggleRow,
}: RowProps & { handle?: Handle }) {
  const { category, level, hasChildren, collapsed } = row;
  const canTarget = !group.isIncome || tracking;
  const openTargets = () => onTargetRequest({ category, month: targetMonth(columns) });
  return (
    <div
      className={cn(NAME, "flex items-center gap-1 pe-1", hasChildren ? "h-12" : "h-9")}
      style={{ paddingInlineStart: `${nameInset(level) - (hasChildren ? STEP : 0)}rem` }}
    >
      <DragHandle label={category.name} handle={handle} />
      {hasChildren && (
        <Chevron
          label={category.name}
          collapsed={collapsed}
          onToggle={() => onToggleRow(category.id)}
        />
      )}
      <span className="flex min-w-0 flex-col leading-tight">
        <span title={category.name} className="truncate text-[13px]">
          {category.name}
        </span>
        {hasChildren && (
          <span className="truncate text-[11px] text-muted-foreground">incl. subcategories</span>
        )}
      </span>
      <span className="flex-1" />
      {canTarget && <TargetButton category={category} onOpen={openTargets} />}
      <CategoryCard
        category={category}
        group={group}
        level={level}
        months={columns.map((column) => column.month.month)}
        onTargets={canTarget ? openTargets : undefined}
        onRequest={onCategoryRequest}
      />
    </div>
  );
}

/** A parent's own figure with its rolled-up total, muted, beneath it. */
function WithTotal({
  show,
  total,
  children,
  className,
}: {
  show: boolean;
  total: number;
  children: ReactNode;
  className?: string;
}) {
  if (!show) return children;
  return (
    <div className={cn("flex min-w-0 flex-col items-stretch", className)}>
      {children}
      <Money
        amount={total}
        tone="none"
        className="px-1.5 text-right text-[11px] leading-4 text-muted-foreground"
      />
    </div>
  );
}

function BudgetedInput({
  month,
  category,
  amount,
}: {
  month: string;
  category: Category;
  amount: number;
}) {
  const { id: book } = useBook();
  const setBudget = useBookMutation(book, "set_budget");
  const action = useBookMutation(book, "apply_budget_action");
  return (
    <div className="group/cell relative">
      <AmountInput
        label={`${category.name} budgeted in ${month}`}
        value={amount}
        zeroAsBlank
        onCommit={(next) => setBudget.mutate({ month, category: category.id, amount: next })}
      />
      <Menu>
        <MenuTrigger
          className="absolute inset-y-0 left-0 flex w-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none group-hover/cell:opacity-100 hover:bg-accent focus-visible:opacity-100 data-popup-open:opacity-100"
          aria-label={`${category.name} budget actions for ${month}`}
        >
          <EllipsisIcon className="size-3.5" />
        </MenuTrigger>
        <MenuPopup align="start">
          <MenuGroup>
            <MenuGroupLabel>
              {category.name}, {monthLabel(month)}
            </MenuGroupLabel>
            {BUDGET_ACTIONS.map(([key, label]) => (
              <MenuItem
                key={key}
                onClick={() => action.mutate({ month, action: key, category: category.id })}
              >
                {label}
              </MenuItem>
            ))}
          </MenuGroup>
        </MenuPopup>
      </Menu>
    </div>
  );
}

function CategoryRow(props: RowProps) {
  const { row, columns } = props;
  const { category, hasChildren } = row;
  return (
    <CategoryRowFrame {...props}>
      {columns.map(({ month, categories }) => {
        const cell = categories.get(category.id);
        if (cell === undefined) return <div key={month.month} className="flex-1" />;
        return (
          <div
            key={month.month}
            className="grid flex-1 grid-cols-3 items-center gap-1 border-l px-1"
          >
            <WithTotal show={hasChildren} total={cell.total.budgeted}>
              <BudgetedInput month={month.month} category={category} amount={cell.budgeted} />
            </WithTotal>
            <RecordsButton
              onOpen={() =>
                props.onRecordsRequest(categoryFigure(props.group, category, month.month, false))
              }
            >
              <WithTotal show={hasChildren} total={cell.total.spent}>
                <Money
                  amount={cell.spent}
                  tone="none"
                  label={`${category.name} spent in ${month.month}`}
                  className="px-1.5 text-right text-[13px] text-muted-foreground"
                />
              </WithTotal>
            </RecordsButton>
            <WithTotal show={hasChildren} total={cell.total.balance}>
              <BalanceMenu {...props} month={month} cell={cell} />
            </WithTotal>
          </div>
        );
      })}
    </CategoryRowFrame>
  );
}

/**
 * A figure that opens the transactions behind it in the pane. It stays out of the tab order, so Tab
 * still moves from one budgeted amount to the next.
 */
function RecordsButton({
  onOpen,
  className,
  children,
}: {
  onOpen: () => void;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      draggable={false}
      onClick={onOpen}
      className={cn("block w-full min-w-0 cursor-pointer text-right hover:underline", className)}
    >
      {children}
    </button>
  );
}

function IncomeRow(props: RowProps) {
  const { row, columns, tracking } = props;
  const { category, hasChildren } = row;
  return (
    <CategoryRowFrame {...props}>
      {columns.map(({ month, categories }) => {
        const cell = categories.get(category.id);
        return (
          <div
            key={month.month}
            className={cn(
              "grid flex-1 items-center gap-1 border-l px-1",
              tracking ? "grid-cols-3" : "grid-cols-1",
            )}
          >
            {tracking && cell && (
              <WithTotal show={hasChildren} total={cell.total.budgeted}>
                <BudgetedInput month={month.month} category={category} amount={cell.budgeted} />
              </WithTotal>
            )}
            {cell && (
              <RecordsButton
                className={cn(tracking && "col-span-2")}
                onOpen={() =>
                  props.onRecordsRequest(categoryFigure(props.group, category, month.month, true))
                }
              >
                <WithTotal show={hasChildren} total={cell.total.spent}>
                  <Money
                    amount={cell.spent}
                    tone="none"
                    label={`${category.name} received in ${month.month}`}
                    className="px-1.5 text-right text-[13px]"
                  />
                </WithTotal>
              </RecordsButton>
            )}
          </div>
        );
      })}
    </CategoryRowFrame>
  );
}

function BalanceMenu({
  row: { category },
  tracking,
  onAmountRequest,
  month,
  cell,
}: RowProps & { month: BudgetMonth; cell: BudgetCategoryMonth }) {
  const { id: book } = useBook();
  const setCarryover = useBookMutation(book, "set_carryover");
  const move = useBookMutation(book, "move_budget");
  const cover = useBookMutation(book, "cover_overspending");
  return (
    <Menu>
      <MenuTrigger
        className="flex h-7 w-full cursor-pointer items-center justify-end rounded-md px-1.5 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${category.name} balance`}
      >
        <BalancePill amount={cell.balance} carryover={cell.carryover} goal={cell.goal} />
      </MenuTrigger>
      <MenuPopup align="end">
        {!tracking && cell.balance > 0 && (
          <MenuItem
            onClick={() =>
              onAmountRequest({
                title: `Transfer from ${category.name}`,
                submit: "Transfer",
                amount: cell.balance,
                category: { label: "To", toBudget: true, exclude: category.id },
                onSubmit: ({ amount, category: to }) =>
                  move.mutate({ month: month.month, from: category.id, to: to!, amount }),
              })
            }
          >
            Transfer to another category
          </MenuItem>
        )}
        {!tracking && cell.balance < 0 && (
          <MenuItem
            onClick={() =>
              onAmountRequest({
                title: `Cover ${category.name}'s overspending`,
                description: "The whole overspending is covered from the category you pick.",
                submit: "Cover",
                noAmount: true,
                category: { label: "From", toBudget: true, exclude: category.id },
                onSubmit: ({ category: from }) =>
                  cover.mutate({ month: month.month, category: category.id, from: from! }),
              })
            }
          >
            Cover overspending
          </MenuItem>
        )}
        <MenuCheckboxItem
          checked={cell.carryover}
          onCheckedChange={(carryover) =>
            setCarryover.mutate({ month: month.month, category: category.id, carryover })
          }
        >
          Rollover overspending
        </MenuCheckboxItem>
      </MenuPopup>
    </Menu>
  );
}

/** A balance as Actual shows it: green when there is money, red when overspent, an arrow when it rolls over. */
export function BalancePill({
  amount,
  carryover,
  goal,
}: {
  amount: number;
  carryover: boolean;
  goal: number | null;
}) {
  const { format } = useBook();
  return (
    <span className="flex items-center gap-1">
      <span
        className={cn(
          "rounded-md px-1.5 text-[13px] tabular-nums",
          amount < 0 && "bg-destructive/10 text-destructive-foreground",
          amount > 0 && "bg-success/10 text-success-foreground",
          amount === 0 && "text-muted-foreground",
          goal !== null && amount >= 0 && amount < goal && "bg-warning/10 text-warning-foreground",
        )}
      >
        {format(amount)}
      </span>
      {carryover && (
        <span className="text-xs text-muted-foreground" aria-label="Rolls over">
          →
        </span>
      )}
    </span>
  );
}

/** What the budget can do with a category: set its targets and apply them. */

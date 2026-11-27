import type { BudgetMonth } from "@reeve/contract";
import { EllipsisIcon } from "lucide-react";
import type { AmountRequest } from "@/components/budget/amount-dialog";
import { TO_BUDGET } from "@/components/category-select";
import { Money } from "@/components/money";
import { NotesButton } from "@/components/notes-button";
import { BUDGET_ACTIONS } from "@/components/budget/actions";
import { toastTemplates } from "@/components/budget/templates";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@reeve/ui/components/menu";
import { toastManager } from "@reeve/ui/components/toast";
import { cn } from "@reeve/ui/lib/utils";
import { useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { monthLabel } from "@/lib/months";

const CLEANUP = {
  "cleanup-applied": "Cleanup done",
  "cleanup-up-to-date": "Nothing to clean up",
  "cleanup-no-funds": "No funds left to distribute",
} as const;

/** The month's header: its name and actions, and the envelope's To Budget or tracking's totals. */
export function MonthSummary({
  month,
  onRequest,
}: {
  month: BudgetMonth;
  onRequest: (request: AmountRequest) => void;
}) {
  const { id: book } = useBook();
  const action = useBookMutation(book, "apply_budget_action");
  const apply = useBookMutation(book, "apply_templates");
  const overwrite = useBookMutation(book, "overwrite_templates");
  const cleanup = useBookMutation(book, "cleanup_templates");
  const check = useBookMutation(book, "check_templates");
  const summary = month.summary;
  return (
    <div className="group/row flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <span className="flex-1 text-sm font-semibold">{monthLabel(month.month)}</span>
        <NotesButton id={`budget-${month.month}`} notes={month.note} />
        <Menu>
          <MenuTrigger
            className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`${monthLabel(month.month)} actions`}
          >
            <EllipsisIcon className="size-3.5" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuGroup>
              <MenuGroupLabel>Every category in {monthLabel(month.month)}</MenuGroupLabel>
              {BUDGET_ACTIONS.map(([key, label]) => (
                <MenuItem
                  key={key}
                  onClick={() => action.mutate({ month: month.month, action: key })}
                >
                  {label}
                </MenuItem>
              ))}
            </MenuGroup>
            <MenuSeparator />
            <MenuItem
              onClick={() => apply.mutate({ month: month.month }, { onSuccess: toastTemplates })}
            >
              Apply budget targets
            </MenuItem>
            <MenuItem
              onClick={() =>
                overwrite.mutate({ month: month.month }, { onSuccess: toastTemplates })
              }
            >
              Overwrite with budget targets
            </MenuItem>
            {summary.type === "envelope" && (
              <MenuItem
                onClick={() =>
                  cleanup.mutate(
                    { month: month.month },
                    {
                      onSuccess: (result) =>
                        toastManager.add({
                          type: result.warnings.length > 0 ? "warning" : "success",
                          title: CLEANUP[result.message],
                          description: result.warnings.join("\n") || undefined,
                        }),
                    },
                  )
                }
              >
                End of month cleanup
              </MenuItem>
            )}
            <MenuItem
              onClick={() =>
                check.mutate(
                  {},
                  {
                    onSuccess: (result) =>
                      toastManager.add({
                        type: result.ok ? "success" : "warning",
                        title: result.ok ? "All targets are valid" : "Some targets have problems",
                        description: result.problems
                          .map((problem) => `${problem.name}: ${problem.message}`)
                          .join("\n"),
                      }),
                  },
                )
              }
            >
              Check targets
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      {summary.type === "envelope" ? (
        <Envelope month={month} summary={summary} onRequest={onRequest} />
      ) : (
        <dl className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-0.5 text-xs">
          <span />
          <span className="text-right text-muted-foreground">Budgeted</span>
          <span className="text-right text-muted-foreground">Actual</span>
          <dt className="text-muted-foreground">Income</dt>
          <Money amount={summary.budgetedIncome} tone="none" className="text-right" />
          <Money amount={summary.income} tone="none" className="text-right" />
          <dt className="text-muted-foreground">Expenses</dt>
          <Money amount={summary.budgetedExpenses} tone="none" className="text-right" />
          <Money amount={summary.spent} tone="none" className="text-right" />
          <dt className="font-medium">Saved</dt>
          <Money amount={summary.budgetedSaved} className="text-right font-medium" />
          <Money amount={summary.saved} className="text-right font-medium" />
        </dl>
      )}
    </div>
  );
}

function Envelope({
  month,
  summary,
  onRequest,
}: {
  month: BudgetMonth;
  summary: Extract<BudgetMonth["summary"], { type: "envelope" }>;
  onRequest: (request: AmountRequest) => void;
}) {
  const { id: book } = useBook();
  const move = useBookMutation(book, "move_budget");
  const hold = useBookMutation(book, "hold_for_next_month");
  const resetHold = useBookMutation(book, "reset_hold");
  const coverOver = useBookMutation(book, "cover_overbudgeted");
  const line = (label: string, amount: number) => (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <Money amount={amount} tone="none" className="text-right" />
    </>
  );
  return (
    <div className="flex items-center gap-3">
      <dl className="grid flex-1 grid-cols-[1fr_auto] gap-x-3 text-xs">
        {line("Available funds", summary.income)}
        {line("Overspent last month", -summary.lastMonthOverspent)}
        {line("Budgeted", summary.totalBudgeted)}
        {line("For next month", -summary.hold)}
      </dl>
      <Menu>
        <MenuTrigger
          className={cn(
            "flex min-w-28 cursor-pointer flex-col items-center rounded-lg px-3 py-1.5 outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring",
            summary.toBudget < 0
              ? "bg-destructive/10 text-destructive-foreground"
              : summary.toBudget > 0
                ? "bg-success/10 text-success-foreground"
                : "bg-muted text-muted-foreground",
          )}
        >
          <span className="text-[11px]">{summary.toBudget < 0 ? "Overbudgeted" : "To Budget"}</span>
          <Money amount={summary.toBudget} tone="none" className="text-base font-semibold" />
        </MenuTrigger>
        <MenuPopup align="end">
          {summary.toBudget > 0 && (
            <MenuItem
              onClick={() =>
                onRequest({
                  title: "Move to a category",
                  submit: "Move",
                  amount: summary.toBudget,
                  category: { label: "To" },
                  onSubmit: ({ amount, category }) =>
                    move.mutate({ month: month.month, from: TO_BUDGET, to: category!, amount }),
                })
              }
            >
              Move to a category
            </MenuItem>
          )}
          {summary.toBudget > 0 && (
            <MenuItem
              onClick={() =>
                onRequest({
                  title: "Hold for next month",
                  description:
                    "Held money leaves this month's To Budget and arrives in next month's.",
                  submit: "Hold",
                  amount: summary.toBudget,
                  onSubmit: ({ amount }) => hold.mutate({ month: month.month, amount }),
                })
              }
            >
              Hold for next month
            </MenuItem>
          )}
          {summary.hold > 0 && (
            <MenuItem onClick={() => resetHold.mutate({ month: month.month })}>
              Reset next month's buffer
            </MenuItem>
          )}
          {summary.toBudget < 0 && (
            <MenuItem
              onClick={() =>
                onRequest({
                  title: "Cover overbudgeting",
                  description: "The overbudgeted amount comes out of the category you pick.",
                  submit: "Cover",
                  noAmount: true,
                  category: { label: "From" },
                  onSubmit: ({ category }) =>
                    coverOver.mutate({ month: month.month, category: category! }),
                })
              }
            >
              Cover from a category
            </MenuItem>
          )}
          {summary.toBudget === 0 && summary.hold === 0 && (
            <MenuItem disabled>Nothing left to budget</MenuItem>
          )}
        </MenuPopup>
      </Menu>
    </div>
  );
}

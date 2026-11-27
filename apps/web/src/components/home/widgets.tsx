import type { BudgetView } from "@reeve/contract";
import { addDays, currentMonth, today } from "@reeve/contract/rules";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { type BudgetFigure, categoryFigure } from "@/components/budget/budget-figure";
import { BudgetRecords } from "@/components/budget/budget-records";
import { Meter } from "@/components/meter";
import { Money } from "@/components/money";
import { WidgetQuery, type WidgetBodyProps } from "@/components/reports/card-body";
import { FlowBar } from "@/components/reports/recent-transactions";
import { Button } from "@reeve/ui/components/button";
import { cn } from "@reeve/ui/lib/utils";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import { categoryPaces, monthInsight, monthProgress, type Part, type Tone } from "@/lib/home";

const TONE: Record<Tone, string> = {
  positive: "text-success-foreground",
  negative: "text-destructive-foreground",
  neutral: "text-muted-foreground",
};

const useMonthBudget = () => {
  const { id: book } = useBook();
  return useQuery(bookQuery(book, "get_budget", { month: currentMonth(), count: 1 }));
};

function Sentence({ parts }: { parts: ReadonlyArray<Part> }) {
  const { format } = useBook();
  return (
    <p className="text-xl leading-[1.35] font-semibold tracking-[-0.01em]">
      {parts.map((part, index) => (
        // The parts of a sentence never reorder.
        // react-doctor-disable-next-line react-doctor/no-array-index-as-key
        <span
          key={index}
          className={part.tone && part.tone !== "neutral" ? TONE[part.tone] : undefined}
        >
          {"money" in part ? format(part.money) : part.text}
        </span>
      ))}
    </p>
  );
}

function Chip({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Button variant="secondary" className="gap-1.5" render={<Link to={to} />}>
      {children}
    </Button>
  );
}

function MonthStatus({ view }: { view: BudgetView }) {
  const { format } = useBook();
  const month = view.months[0]!;
  const insight = monthInsight({ view, month, ...monthProgress() });
  const toBudget = month.summary.type === "envelope" ? month.summary.toBudget : null;
  const uncategorized = view.uncategorized.count;
  const Arrow =
    insight.tone === "negative"
      ? ArrowDownRightIcon
      : insight.tone === "positive"
        ? ArrowUpRightIcon
        : MinusIcon;
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-between gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" className="gap-0 font-normal" render={<Link to="/budget" />}>
          This month you are&nbsp;
          <span className={cn("font-semibold", TONE[insight.tone])}>{insight.verdict}</span>
        </Button>
        <span className="flex size-8 items-center justify-center rounded-lg bg-secondary">
          <Arrow className={cn("size-4", TONE[insight.tone])} />
        </span>
      </div>
      <div className="grid gap-3">
        <div className="text-xs font-medium text-muted-foreground">What you need to know today</div>
        <Sentence parts={insight.sentence} />
        <div className="flex flex-wrap gap-1.5 pt-1">
          {toBudget !== null && (
            <Chip to="/budget">
              To budget{" "}
              <span className={toBudget < 0 ? TONE.negative : TONE.positive}>
                {format(toBudget)}
              </span>
            </Chip>
          )}
          {uncategorized > 0 && (
            <Chip to="/accounts/uncategorized">
              Uncategorized <span className="text-warning-foreground">{uncategorized}</span>
            </Chip>
          )}
        </div>
      </div>
    </div>
  );
}

/** Where the month stands, in one sentence of the budget's own figures, with what needs a hand. */
export function MonthStatusBody() {
  const budget = useMonthBudget();
  return (
    <WidgetQuery query={budget} hasLinks>
      {(view) => <MonthStatus view={view} />}
    </WidgetQuery>
  );
}

function PercentPill({ percent, over }: { percent: number | null; over: boolean }) {
  return (
    <span
      className={cn(
        "w-11 text-end text-[13px] tabular-nums",
        percent === null ? "text-muted-foreground" : over ? TONE.negative : TONE.positive,
      )}
    >
      {percent === null ? "–" : `${percent}%`}
    </span>
  );
}

/** Each expense category with money this month and how much of its budget is spent. */
export function CategoryPaceBody({ meta }: WidgetBodyProps<{ readonly limit?: number }>) {
  const budget = useMonthBudget();
  const [figure, setFigure] = useState<BudgetFigure | null>(null);
  const paces = (view: BudgetView) =>
    categoryPaces(view, view.months[0]!).slice(0, meta.limit ?? 14);
  const open = (view: BudgetView, id: string) => {
    const group = view.groups.find((each) => each.categories.some((child) => child.id === id))!;
    const category = group.categories.find((each) => each.id === id)!;
    setFigure(categoryFigure(group, category, view.months[0]!.month, false));
  };
  return (
    <WidgetQuery
      query={budget}
      hasLinks
      isEmpty={(view) => paces(view).length === 0}
      empty="Nothing budgeted or spent this month yet."
    >
      {(view) => (
        <div className="@container min-h-0 flex-1 overflow-hidden">
          <ul className="grid gap-x-8 @lg:grid-cols-2">
            {paces(view).map((pace) => (
              <li key={pace.id} className="border-b last:border-b-0">
                <button
                  type="button"
                  onClick={() => open(view, pace.id)}
                  className="flex h-9 w-full items-center gap-2 text-start text-[13px] outline-none hover:text-foreground focus-visible:underline"
                >
                  <span className="min-w-0 flex-1 truncate">{pace.name}</span>
                  <PercentPill percent={pace.percent} over={pace.over} />
                  <Meter
                    percent={pace.percent ?? 0}
                    tone={pace.over ? "negative" : "positive"}
                    className="max-sm:hidden"
                  />
                </button>
              </li>
            ))}
          </ul>
          {figure !== null && <BudgetRecords figure={figure} onClose={() => setFigure(null)} />}
        </div>
      )}
    </WidgetQuery>
  );
}

/** Net worth and every open account's balance. */
export function AccountBalancesBody() {
  const { id: book } = useBook();
  const accounts = useQuery(bookQuery(book, "list_accounts", {}));
  return (
    <WidgetQuery
      query={accounts}
      hasLinks
      isEmpty={(rows) => rows.length === 0}
      empty="No accounts yet."
    >
      {(rows) => (
        <ul className="min-h-0 flex-1 overflow-hidden">
          <li className="flex h-10 items-center gap-3 px-3 text-[13px]">
            <span className="flex-1 font-semibold">Net worth</span>
            <Money
              amount={rows.reduce((sum, account) => sum + account.balance, 0)}
              className="font-semibold"
            />
          </li>
          {rows.map((account) => (
            <li key={account.id}>
              <Link
                to="/accounts/$account"
                params={{ account: account.id }}
                className="flex h-10 items-center gap-3 rounded-lg border-b px-3 text-[13px] outline-none hover:border-transparent hover:shadow-[inset_0_0_0_1px_var(--border)] focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1 truncate font-semibold">{account.name}</span>
                <span className="text-xs text-muted-foreground max-sm:hidden">
                  {account.onBudget ? "Budget" : "Off budget"}
                </span>
                <Money amount={account.balance} className="w-24 text-end" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetQuery>
  );
}

export const UPCOMING_DAYS = 31;

/** The next scheduled transactions, soonest first, within `daysAhead` days. */
export function UpcomingTransactionsBody({
  meta,
}: WidgetBodyProps<{ readonly daysAhead?: number; readonly limit?: number }>) {
  const { id: book, format, formatDay } = useBook();
  const days = meta.daysAhead ?? UPCOMING_DAYS;
  const scheduled = useQuery(
    bookQuery(book, "list_scheduled_transactions", { upcomingLength: `${days}-day` }),
  );
  const horizon = addDays(today(), days);
  const due = (rows: NonNullable<typeof scheduled.data>) =>
    rows
      .filter((row) => row.date <= horizon)
      .toSorted((a, b) => a.date.localeCompare(b.date))
      .slice(0, meta.limit ?? 6);
  return (
    <WidgetQuery
      query={scheduled}
      isEmpty={(rows) => due(rows).length === 0}
      empty={`Nothing due in the next ${days === 1 ? "day" : `${days} days`}.`}
    >
      {(rows) => (
        <ul className="min-h-0 flex-1 overflow-hidden">
          {due(rows).map((row) => (
            <li
              key={row.id}
              className="flex h-9 items-center gap-3 border-b text-[13px] last:border-b-0"
            >
              <FlowBar tone={row.amount > 0 ? "in" : "out"} />
              <span className="min-w-0 flex-1 truncate font-semibold">
                {row.scheduleName ?? row.payee ?? "Schedule"}
              </span>
              <span className="text-muted-foreground tabular-nums">{formatDay(row.date)}</span>
              <span className="w-20 text-end tabular-nums">{format(row.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </WidgetQuery>
  );
}

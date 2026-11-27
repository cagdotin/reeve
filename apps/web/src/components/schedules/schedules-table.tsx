import { Link, useNavigate } from "@tanstack/react-router";
import { format as formatDate, parseISO } from "date-fns";
import {
  ArrowUpRightIcon,
  CalendarCheck2Icon,
  CheckIcon,
  FastForwardIcon,
  ListIcon,
  PencilIcon,
  RotateCcwIcon,
  SendHorizontalIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  RowMenu,
  SortHeader,
  TableHeader,
  TableRow,
  TABLE_SECTION,
} from "@/components/insights/table";
import { useChartTheme } from "@/components/reports/chart-theme";
import { Button } from "@reeve/ui/components/button";
import { MenuItem, MenuSeparator } from "@reeve/ui/components/menu";
import { cn } from "@reeve/ui/lib/utils";
import { scopeSearch, useAccountScope } from "@/lib/account-scope";
import { useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import {
  amountLabel,
  amountMeaning,
  displayName,
  relativeDay,
  URGENCY,
  type Row,
  type ScheduleSort,
  type ScheduleSortKey,
} from "@/lib/schedules";

/** The columns; they fold on the page's width, down to the name, next date and amount. */
const DOT = "flex w-2 shrink-0 justify-center";
const NAME = "min-w-0 flex-1";
const PAYEE = "w-28 shrink-0 truncate @max-3xl:hidden";
const ACCOUNT = "w-24 shrink-0 truncate @max-3xl:hidden";
const REPEATS = "w-44 shrink-0 truncate @max-[62rem]:hidden";
const NEXT = "flex w-32 shrink-0 items-baseline gap-1.5 @max-md:w-auto";
const RECENT = "flex w-14 shrink-0 items-center @max-[62rem]:hidden";
const LAST = "relative flex w-16 shrink-0 justify-end gap-0.5 tabular-nums @max-[62rem]:hidden";
const AMOUNT = "flex w-24 shrink-0 justify-end tabular-nums @max-md:w-24";
const MONTHLY = "flex w-16 shrink-0 justify-end tabular-nums @max-3xl:hidden";
const OPTIONS = "flex w-6 shrink-0 justify-center";

export function SchedulesHeader({
  sort,
  onSort,
}: {
  sort: ScheduleSort;
  onSort: (key: ScheduleSortKey) => void;
}) {
  const shared = { sort, onSort };
  return (
    <TableHeader>
      <span className={DOT} />
      <span className={NAME}>
        <SortHeader {...shared} column="name" label="Name" />
      </span>
      <span className={PAYEE}>
        <SortHeader {...shared} column="payee" label="Payee" />
      </span>
      <span className={ACCOUNT}>
        <SortHeader {...shared} column="account" label="Account" />
      </span>
      <span className={REPEATS}>Repeats</span>
      <span className={NEXT}>
        <SortHeader {...shared} column="next" label="Next" title="Next date" />
      </span>
      <span className={RECENT} title="Recent charges, oldest first. The line is what it expects.">
        Recent
      </span>
      <span className={LAST} title="The latest charge">
        Last
      </span>
      <span className={AMOUNT}>
        <SortHeader {...shared} end column="amount" label="Amount" title="Expected amount" />
      </span>
      <span className={MONTHLY}>
        <SortHeader {...shared} end column="monthly" label="Monthly" title="Cost per month" />
      </span>
      <span className={OPTIONS} />
    </TableHeader>
  );
}

export function GroupHeader({ label, count, sum }: { label: string; count: number; sum: string }) {
  return (
    <div className={cn(TABLE_SECTION, "gap-3")}>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium text-foreground">{label}</span>
        <span className="ms-2 tabular-nums">{count}</span>
      </span>
      <span className={AMOUNT}>{sum}</span>
      <span className={MONTHLY} />
      <span className={OPTIONS} />
    </div>
  );
}

const DOT_STYLE: Record<Row["status"], string> = {
  missed: "bg-destructive-foreground",
  due: "bg-warning",
  upcoming: "bg-foreground/60",
  scheduled: "bg-muted-foreground/30",
  paid: "bg-success",
  completed: "border border-muted-foreground/50",
};

const statusLabel = (status: Row["status"]) =>
  URGENCY.find((each) => each.status === status)?.label ?? status;

/**
 * Recent charges as a line against what the schedule expects, on a scale no tighter than a fifth of
 * it, so a few cents do not look like a change. In colour when most of them are linked to it.
 */
function Sparkline({ row }: { row: Row }) {
  const { format, formatDay } = useBook();
  const theme = useChartTheme();
  const charges = row.charges;
  if (charges.length < 2) return null;
  const expected = Math.abs(row.expected);
  const amounts = charges.map((each) => Math.abs(each.amount));
  const span = Math.max(
    Math.max(...amounts, expected) - Math.min(...amounts, expected),
    expected / 5,
    1,
  );
  const middle = (Math.max(...amounts, expected) + Math.min(...amounts, expected)) / 2;
  const yOf = (amount: number) => 50 - ((amount - middle) / span) * 80;
  const xOf = (index: number) => (index / (charges.length - 1)) * 100;
  const linked = charges.filter((each) => each.linked).length * 2 >= charges.length;
  const stroke = !linked ? theme.tick : charges[0]!.amount < 0 ? theme.out : theme.series[0];
  const title = [
    ...charges.map(
      (each) =>
        `${formatDay(each.date)}: ${format(Math.abs(each.amount))}${each.linked ? "" : " (not linked)"}`,
    ),
    `Expected ${amountLabel(row.amount, format)}`,
  ].join("\n");
  return (
    <span title={title} className="relative block h-5 w-full">
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 size-full overflow-visible"
      >
        <line
          x1={0}
          x2={100}
          y1={yOf(expected)}
          y2={yOf(expected)}
          stroke={theme.axis}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={amounts.map((amount, index) => `${xOf(index)},${yOf(amount)}`).join(" ")}
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className="absolute right-0 size-1 translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ top: `${yOf(amounts.at(-1)!)}%`, backgroundColor: stroke }}
      />
    </span>
  );
}

const IconAction = ({
  label,
  title,
  onClick,
  children,
}: {
  label: string;
  title: string;
  onClick: () => void;
  children: ReactNode;
}) => (
  <Button variant="ghost" aria-label={label} title={title} onClick={onClick}>
    {children}
  </Button>
);

export type ScheduleRequest =
  | { readonly kind: "edit"; readonly schedule: Row }
  | { readonly kind: "delete"; readonly schedule: Row };

const useRowActions = (row: Row) => {
  const { id: book } = useBook();
  const post = useBookMutation(book, "post_schedule_transaction");
  const skip = useBookMutation(book, "skip_schedule_date");
  const complete = useBookMutation(book, "complete_schedule");
  const restore = useBookMutation(book, "restore_schedule");
  return {
    post: () => post.mutate({ id: row.id }),
    postToday: () => post.mutate({ id: row.id, today: true }),
    skip: () => skip.mutate({ id: row.id }),
    complete: () => complete.mutate({ id: row.id }),
    restore: () => restore.mutate({ id: row.id }),
  };
};

type RowActions = ReturnType<typeof useRowActions>;

const canPost = (row: Row) => !row.completed && row.accountId !== null && row.nextDate !== null;

const isRecurring = (row: Row) => typeof row.date === "object";

/** The next date, and how far off it is. */
function NextCell({ row, today }: { row: Row; today: string }) {
  const { formatDay } = useBook();
  if (row.nextDate === null) return <span className={cn(NEXT, "truncate")} />;
  return (
    <span className={cn(NEXT, "truncate")} title={formatDay(row.nextDate)}>
      <span className="tabular-nums">{formatDate(parseISO(row.nextDate), "MMM d")}</span>
      <span
        className={cn(
          "truncate text-xs text-muted-foreground @max-md:hidden",
          row.status === "missed" && "text-destructive-foreground",
          row.status === "due" && "text-warning-foreground",
        )}
      >
        {row.completed ? "" : relativeDay(row.nextDate, today)}
      </span>
    </span>
  );
}

/** What the last charge says: its amount, a drift from what is expected, or that it went quiet. */
const lastChargeTitle = (
  row: Row,
  format: (value: number) => string,
  formatDay: (day: string) => string,
) => {
  if (row.drift !== null)
    return `Charged about ${format(Math.abs(row.drift.actual))} since ${formatDay(row.drift.since)}; this schedule expects ${amountLabel(row.amount, format)}`;
  if (row.quiet !== null)
    return `${row.quiet.dates} dates passed with no charge${row.quiet.lastCharge === null ? "" : `; the last was on ${formatDay(row.quiet.lastCharge)}`}`;
  const last = row.charges.at(-1);
  return last === undefined ? undefined : formatDay(last.date);
};

/** Post and skip, on the row while the pointer is over it. */
function HoverActions({ row, name, actions }: { row: Row; name: string; actions: RowActions }) {
  const { formatDay } = useBook();
  const recurring = isRecurring(row);
  const posts = canPost(row);
  if (row.completed || (!posts && !recurring)) return null;
  return (
    <span className="absolute top-1/2 right-0 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-background px-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 max-md:hidden">
      {posts && row.status !== "paid" && (
        <IconAction
          label={`Post ${name}`}
          title={`Add the transaction on ${formatDay(row.nextDate!)}${recurring ? " and move to the next date" : ""}`}
          onClick={actions.post}
        >
          <SendHorizontalIcon />
          Post
        </IconAction>
      )}
      {recurring && (
        <IconAction
          label={`Skip ${name}`}
          title={`Skip ${row.nextDate === null ? "the next date" : formatDay(row.nextDate)}`}
          onClick={actions.skip}
        >
          <FastForwardIcon />
          Skip
        </IconAction>
      )}
    </span>
  );
}

function LastCell({ row, name, actions }: { row: Row; name: string; actions: RowActions }) {
  const { format, formatDay } = useBook();
  const last = row.charges.at(-1);
  return (
    <span
      className={cn(LAST, "text-muted-foreground", row.drift !== null && "text-warning-foreground")}
      title={lastChargeTitle(row, format, formatDay)}
    >
      {row.drift !== null && <ArrowUpRightIcon className="size-3.5 shrink-0 self-center" />}
      {row.quiet !== null ? "Quiet" : last === undefined ? "" : format(Math.abs(last.amount))}
      <HoverActions row={row} name={name} actions={actions} />
    </span>
  );
}

/** The things to do with an open schedule, or restoring a completed one. */
function LifecycleItems({ row, actions }: { row: Row; actions: RowActions }) {
  if (row.completed)
    return (
      <MenuItem onClick={actions.restore}>
        <RotateCcwIcon />
        Restore
      </MenuItem>
    );
  return (
    <>
      {canPost(row) && (
        <>
          <MenuItem onClick={actions.post}>
            <SendHorizontalIcon />
            Post transaction
          </MenuItem>
          <MenuItem onClick={actions.postToday}>
            <CalendarCheck2Icon />
            Post transaction today
          </MenuItem>
        </>
      )}
      {isRecurring(row) && (
        <MenuItem onClick={actions.skip}>
          <FastForwardIcon />
          Skip next date
        </MenuItem>
      )}
      <MenuItem onClick={actions.complete}>
        <CheckIcon />
        Complete
      </MenuItem>
    </>
  );
}

function ScheduleMenu({
  row,
  name,
  actions,
  onRequest,
}: {
  row: Row;
  name: string;
  actions: RowActions;
  onRequest: (request: ScheduleRequest) => void;
}) {
  const navigate = useNavigate();
  const scope = useAccountScope();
  return (
    <RowMenu label={`${name} options`}>
      <LifecycleItems row={row} actions={actions} />
      <MenuItem onClick={() => onRequest({ kind: "edit", schedule: row })}>
        <PencilIcon />
        Edit…
      </MenuItem>
      {row.payeeId !== null && (
        <MenuItem
          onClick={() =>
            void navigate({
              to: "/accounts/$account",
              params: { account: row.accountId ?? "all" },
              search: { payees: [row.payeeId!] },
            })
          }
        >
          <ListIcon />
          View transactions
        </MenuItem>
      )}
      {row.payeeId !== null && (
        <MenuItem
          render={<Link to="/rules" search={{ payee: [row.payeeId], ...scopeSearch(scope) }} />}
        >
          <WandSparklesIcon />
          View rules
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem variant="destructive" onClick={() => onRequest({ kind: "delete", schedule: row })}>
        <Trash2Icon />
        Delete…
      </MenuItem>
    </RowMenu>
  );
}

export function ScheduleRow({
  row,
  today,
  onRequest,
}: {
  row: Row;
  today: string;
  onRequest: (request: ScheduleRequest) => void;
}) {
  const { format } = useBook();
  const actions = useRowActions(row);
  const name = displayName(row);
  return (
    <TableRow
      onOpen={() => onRequest({ kind: "edit", schedule: row })}
      className={cn((row.completed || row.status === "paid") && "text-muted-foreground")}
    >
      <span className={DOT} aria-label={statusLabel(row.status)} title={statusLabel(row.status)}>
        <span className={cn("size-1.5 rounded-full", DOT_STYLE[row.status])} />
      </span>
      <button
        type="button"
        className={cn(NAME, "cursor-pointer truncate text-left hover:underline")}
        title={row.notes === null ? name : `${name}\n${row.notes}`}
        onClick={() => onRequest({ kind: "edit", schedule: row })}
      >
        {name}
      </button>
      <span className={cn(PAYEE, "text-muted-foreground")} title={row.payee ?? undefined}>
        {row.payee}
      </span>
      <span className={cn(ACCOUNT, "text-muted-foreground")} title={row.account ?? undefined}>
        {row.account}
      </span>
      <span className={cn(REPEATS, "text-muted-foreground")} title={row.description}>
        {isRecurring(row) ? row.description : "Once"}
      </span>
      <NextCell row={row} today={today} />
      <span className={RECENT}>
        <Sparkline row={row} />
      </span>
      <LastCell row={row} name={name} actions={actions} />
      <span className={AMOUNT} title={amountMeaning(row.amount)}>
        <span className={cn(row.expected > 0 && !row.completed && "text-success-foreground")}>
          {amountLabel(row.amount, format)}
        </span>
      </span>
      <span
        className={cn(MONTHLY, "text-muted-foreground")}
        title={row.monthly === 0 ? undefined : `${format(Math.abs(row.monthly) * 12)} a year`}
      >
        {row.monthly === 0 ? "" : format(Math.abs(row.monthly))}
      </span>
      <span className={OPTIONS}>
        <ScheduleMenu row={row} name={name} actions={actions} onRequest={onRequest} />
      </span>
    </TableRow>
  );
}

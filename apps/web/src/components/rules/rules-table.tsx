import type { RuleActivity } from "@reeve/contract/catalog";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  CalendarClockIcon,
  CopyIcon,
  GlobeIcon,
  ListIcon,
  PencilIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { HelpCard } from "@/components/insights/help-card";
import {
  RowMenu,
  SortHeader,
  TableHeader,
  TableRow,
  TABLE_SECTION,
} from "@/components/insights/table";
import { useChartTheme } from "@/components/reports/chart-theme";
import type { Names } from "@/components/rules/rule-model";
import { Checkbox } from "@reeve/ui/components/checkbox";
import { MenuItem, MenuSeparator } from "@reeve/ui/components/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@reeve/ui/components/tooltip";
import { cn } from "@reeve/ui/lib/utils";
import { scopeSearch, useAccountScope } from "@/lib/account-scope";
import { useBook } from "@/lib/book";
import { monthInRange } from "@/lib/insights";
import {
  actionClause,
  conditionClause,
  problemsOf,
  ruleSentence,
  STAGES,
  type Clause,
  type RuleSort,
  type RuleSortKey,
} from "@/lib/rules";

/**
 * The columns, shared by the header and every row. They fold on the width the page has:
 * the trend goes first, then the last match, and at the narrowest
 * the two halves of the sentence stack.
 */
const SELECT = "flex w-4 shrink-0";
const RUN = "flex w-8 shrink-0 items-center gap-1 tabular-nums @max-3xl:hidden";
const SENTENCE =
  "grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 @max-[52rem]:grid-cols-1 @max-[52rem]:gap-0";
const MARKS = "flex w-9 shrink-0 items-center justify-end gap-1.5";
const TREND = "flex w-20 shrink-0 justify-end @max-[42rem]:hidden";
const COUNT = "flex w-16 shrink-0 items-center justify-end gap-1 tabular-nums";
const LAST = "flex w-22 shrink-0 justify-end tabular-nums @max-[34rem]:hidden";
const OPTIONS = "flex w-6 shrink-0 justify-center";

export function RulesHeader({
  sort,
  onSort,
  allSelected,
  someSelected,
  onSelectAll,
}: {
  sort: RuleSort;
  onSort: (key: RuleSortKey) => void;
  allSelected: boolean;
  someSelected: boolean;
  onSelectAll: (selected: boolean) => void;
}) {
  const shared = { sort, onSort };
  return (
    <TableHeader>
      <span className={SELECT}>
        <Checkbox
          aria-label="Select every rule shown"
          checked={allSelected}
          indeterminate={someSelected && !allSelected}
          onCheckedChange={onSelectAll}
        />
      </span>
      <span className={RUN}>
        <SortHeader {...shared} column="run" label="Run" title="Run order" />
      </span>
      <span className={SENTENCE}>
        <span>
          <SortHeader {...shared} column="condition" label="If" title="Conditions" />
        </span>
        <span className="@max-[52rem]:hidden">
          <SortHeader {...shared} column="action" label="Then" title="What it does" />
        </span>
      </span>
      <span className={MARKS} />
      <span className={TREND}>12 months</span>
      <span className={COUNT}>
        <SortHeader {...shared} end column="matches" label="Matches" title="Matches in the range" />
        <HelpCard
          label="Matches: what this counts"
          title="Matches"
          body={[
            "The existing transactions a rule's conditions match today. reeve keeps no log of rules running, so this does not say a rule changed them.",
            "A match may predate the rule. A rule that changes what it reads, such as one that renames the payee it looks for, stops matching what it has changed.",
          ]}
        />
      </span>
      <span className={LAST}>
        <SortHeader {...shared} end column="last" label="Last" title="Last match" />
      </span>
      <span className={OPTIONS} />
    </TableHeader>
  );
}

/** A heading above a stage's rules while the table is in run order. */
export function StageHeading({ stage, count }: { stage: RuleActivity["stage"]; count: number }) {
  const own = STAGES.find((each) => each.value === stage);
  return (
    <div className={cn(TABLE_SECTION, "gap-2")}>
      <span className="font-medium text-foreground">{own?.label}</span>
      <span className="truncate">{own?.about}</span>
      <span className="ms-auto tabular-nums">{count}</span>
    </div>
  );
}

/** Twelve months of matches, in one mark per row so hundreds of rules stay light. */
function MatchBars({
  rule,
  months,
  since,
}: {
  rule: RuleActivity;
  months: ReadonlyArray<string>;
  since: string | undefined;
}) {
  const theme = useChartTheme();
  const most = Math.max(1, ...rule.months);
  const width = 6;
  const height = 20;
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${rule.months.length * width} ${height}`}
      className="h-5 w-18"
    >
      {rule.months.map((count, index) => {
        const month = months[index] ?? "";
        const tall = count === 0 ? 1 : Math.max(2, (count / most) * height);
        const inRange = monthInRange(month, since);
        return (
          <rect
            key={month}
            x={index * width}
            y={height - tall}
            width={width - 1}
            height={tall}
            rx={1}
            className={cn((!inRange || count === 0) && "fill-muted-foreground/25")}
            style={inRange && count > 0 ? { fill: theme.series[0] } : undefined}
          >
            <title>{`${month}: ${count}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function ClauseText({
  clauses,
  joiner,
  prefix,
}: {
  clauses: ReadonlyArray<Clause>;
  joiner: string;
  prefix: string;
}) {
  return (
    <span className="truncate text-muted-foreground">
      <span className="@min-[52rem]:hidden">{prefix} </span>
      {clauses.map((clause, index) => (
        <span key={`${clause.lead}:${clause.value}:${index}`}>
          {index > 0 && ` ${joiner} `}
          {clause.lead}
          {clause.value !== "" && (
            <>
              {" "}
              <span className="text-foreground group-data-[quiet=true]/row:text-muted-foreground">
                {clause.value}
              </span>
            </>
          )}
        </span>
      ))}
    </span>
  );
}

export function RuleRow({
  rule,
  months,
  names,
  since,
  selected,
  scoped,
  onSelect,
  onEdit,
  onDuplicate,
  onMatches,
  onDelete,
}: {
  rule: RuleActivity;
  scoped: boolean;
  months: ReadonlyArray<string>;
  names: Names;
  since: string | undefined;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onMatches: () => void;
  onDelete: () => void;
}) {
  const { format, formatDay } = useBook();
  const navigate = useNavigate();
  const scope = useAccountScope();
  const sentence = ruleSentence(rule, names, format);
  const problems = problemsOf(rule, names);
  const stage = STAGES.find((each) => each.value === rule.stage);
  const scheduleName = rule.schedule?.name ?? "its schedule";
  return (
    <TableRow
      onOpen={onEdit}
      data-quiet={rule.matches === 0}
      className={cn("h-auto min-h-9 @max-[52rem]:py-1", selected && "bg-accent/60")}
    >
      <span className={SELECT}>
        <Checkbox
          aria-label={`Select rule ${rule.position}`}
          checked={selected}
          onCheckedChange={onSelect}
        />
      </span>
      <span
        className={cn(RUN, "text-xs text-muted-foreground")}
        title={`${stage?.label ?? rule.stage} stage. Runs number ${rule.position}.`}
      >
        {rule.position}
      </span>
      <button
        type="button"
        title={sentence}
        className={cn(
          SENTENCE,
          "cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        onClick={onEdit}
      >
        <ClauseText
          prefix="If"
          joiner={rule.conditionsOp === "and" ? "and" : "or"}
          clauses={
            rule.conditions.length === 0
              ? [{ lead: "no conditions", value: "" }]
              : rule.conditions.map((each) => conditionClause(each, names, format))
          }
        />
        <ClauseText
          prefix="then"
          joiner="and"
          clauses={
            rule.actions.length === 0
              ? [{ lead: "nothing", value: "" }]
              : rule.actions.map((each) => actionClause(each, names, format))
          }
        />
      </button>
      <span className={MARKS}>
        {scoped && rule.everyAccount && (
          <span title="Applies to every account" className="flex text-muted-foreground">
            <GlobeIcon aria-label="Applies to every account" className="size-3.5" />
          </span>
        )}
        {problems.length > 0 && (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={`Needs attention: ${problems.join(" ")}`}
                  className="flex cursor-help rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              }
            >
              <TriangleAlertIcon className="size-3.5 text-warning" />
            </TooltipTrigger>
            <TooltipPopup className="max-w-72">
              {problems.map((problem) => (
                <p key={problem}>{problem}</p>
              ))}
            </TooltipPopup>
          </Tooltip>
        )}
        {rule.schedule !== null && (
          <Link
            to="/schedules"
            search={scopeSearch(scope)}
            aria-label={`Belongs to the schedule ${scheduleName}`}
            title={`Belongs to the schedule ${scheduleName}`}
            className="flex rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CalendarClockIcon className="size-3.5" />
          </Link>
        )}
      </span>
      <span className={TREND}>
        <MatchBars rule={rule} months={months} since={since} />
      </span>
      <span
        className={cn(COUNT, "text-muted-foreground")}
        title={`${rule.matches} in the range, ${rule.totalMatches} over all time`}
      >
        {rule.matches}
      </span>
      <span className={cn(LAST, "text-muted-foreground")}>
        {rule.lastMatch === null ? "Never" : formatDay(rule.lastMatch)}
      </span>
      <span className={OPTIONS}>
        <RowMenu label={`Rule ${rule.position} options`}>
          <MenuItem onClick={onEdit}>
            <PencilIcon />
            Edit…
          </MenuItem>
          <MenuItem onClick={onMatches}>
            <ListIcon />
            View matching transactions
          </MenuItem>
          <MenuItem onClick={onDuplicate}>
            <CopyIcon />
            Duplicate…
          </MenuItem>
          {rule.schedule !== null && (
            <MenuItem
              onClick={() => void navigate({ to: "/schedules", search: scopeSearch(scope) })}
            >
              <CalendarClockIcon />
              Go to schedules
            </MenuItem>
          )}
          <MenuSeparator />
          {rule.schedule === null ? (
            <MenuItem variant="destructive" onClick={onDelete}>
              <Trash2Icon />
              Delete…
            </MenuItem>
          ) : (
            <MenuItem disabled title="It goes when you delete its schedule">
              <Trash2Icon />
              Delete with its schedule
            </MenuItem>
          )}
        </RowMenu>
      </span>
    </TableRow>
  );
}

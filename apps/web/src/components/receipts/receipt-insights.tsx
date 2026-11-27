import type { ReceiptOverview } from "@reeve/contract/catalog";
import { format as formatDate, parseISO } from "date-fns";
import { useState } from "react";
import { AttentionAlerts } from "@/components/insights/attention-alerts";
import {
  InsightCard,
  InsightEmpty,
  InsightGrid,
  InsightPanel,
  InsightTabs,
} from "@/components/insights/insight-card";
import { RankedBars } from "@/components/insights/ranked-bars";
import {
  STAT_TILE,
  StatAllClear,
  StatBody,
  StatButton,
  StatStrip,
} from "@/components/insights/stat-strip";
import { ReceiptPipeline } from "@/components/receipts/receipt-pipeline";
import type { ReceiptView } from "@/components/receipts/use-receipt-view";
import { slot, useChartTheme } from "@/components/reports/chart-theme";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@reeve/ui/components/tooltip";
import { cn } from "@reeve/ui/lib/utils";
import { useBook } from "@/lib/book";
import { monthInRange } from "@/lib/insights";
import {
  attentionItems,
  categoryStack,
  monthLabel,
  sameFocus,
  stageIs,
  topCategories,
  topStores,
  type CategoryFocus,
  type StackMonth,
} from "@/lib/receipt-pages";

const monthName = (month: string) => formatDate(parseISO(`${month}-01`), "MMM");

/** The range in numbers: each against the period before it, over twelve months of the same. */
function ReceiptSummaryTiles({
  overview,
  allClear,
  unfinishedActive,
  onUnfinished,
}: {
  overview: ReceiptOverview;
  allClear: number | null;
  unfinishedActive: boolean;
  onUnfinished: () => void;
}) {
  const { format } = useBook();
  const { summary, unfinished, pipeline } = overview;
  const { previous } = summary;
  const inRange = unfinished === 0 ? null : summary.receipts - pipeline.finished;
  return (
    <StatStrip columns={allClear === null ? "@4xl:grid-cols-4" : "@4xl:grid-cols-5"}>
      <div className={STAT_TILE}>
        <StatBody
          label="Receipts"
          value={String(summary.receipts)}
          change={previous === null ? null : summary.receipts - previous.receipts}
        />
      </div>
      <div
        className={STAT_TILE}
        title={`What was paid on these receipts, tax and tips included, whether or not a transaction pays them yet. ${summary.refunds > 0 ? `${format(summary.refunds)} of refunds is taken off.` : "Refunds would be taken off."}`}
      >
        <StatBody
          label="Spent on them"
          value={format(summary.spent)}
          change={previous === null ? null : summary.spent - previous.spent}
          format={format}
        />
      </div>
      <div
        className={STAT_TILE}
        title={`What a purchase comes to on average, over ${summary.purchases} ${summary.purchases === 1 ? "purchase" : "purchases"}. Refunds are left out.`}
      >
        <StatBody
          label="Average basket"
          value={format(summary.average)}
          change={previous === null ? null : summary.average - previous.average}
          format={format}
        />
      </div>
      <StatButton
        label={`${unfinished} still to finish`}
        title="Across the book, whatever the range. Bars: the receipts of each month that are not finished today."
        active={unfinishedActive}
        disabled={unfinished === 0}
        onClick={onUnfinished}
      >
        <StatBody
          label="Still to finish"
          value={String(unfinished)}
          note={inRange === null ? "None open" : `${inRange} in this range`}
        />
      </StatButton>
      {allClear !== null && <StatAllClear count={allClear} />}
    </StatStrip>
  );
}

function TopStores({
  overview,
  storeFilter,
  onStore,
}: {
  overview: ReceiptOverview;
  storeFilter: ReadonlyArray<string>;
  onStore: (id: string | null) => void;
}) {
  const { format } = useBook();
  const top = topStores(overview.stores);
  return (
    <InsightCard title="Top stores" aside="spent, tick is the period before">
      {top.length === 0 ? (
        <InsightEmpty>Nothing spent in this range.</InsightEmpty>
      ) : (
        <RankedBars
          bars={top.map((store) => ({
            id: store.id ?? "none",
            label: store.name,
            value: store.spent,
            previous: Math.max(0, store.previous),
            shown: format(store.spent),
            tooltip: (
              <>
                {store.receipts} {store.receipts === 1 ? "receipt" : "receipts"},{" "}
                {format(store.previous)} the period before
                {store.recorded > 0 && `. The ledger records ${format(store.recorded)} here.`}
              </>
            ),
            active: storeFilter.length === 1 && storeFilter[0] === (store.id ?? "none"),
            onClick: () => onStore(store.id),
          }))}
        />
      )}
    </InsightCard>
  );
}

/** Twelve months of spending by category; a month narrows the table to it. */
function MonthStack({
  stack,
  since,
  until,
  month,
  onMonth,
}: {
  stack: ReturnType<typeof categoryStack>;
  since: string | undefined;
  until: string | undefined;
  month: string | null;
  onMonth: (month: string) => void;
}) {
  const theme = useChartTheme();
  const { format } = useBook();
  const most = Math.max(1, ...stack.months.map((each) => each.total));
  return (
    <div className="grid gap-2 px-1.5">
      <div className="flex h-32 items-end gap-1">
        {stack.months.map((each) => (
          <MonthColumn
            key={each.month}
            month={each}
            most={most}
            dim={!monthInRange(each.month, since, until)}
            active={month === each.month}
            color={(index) => slot(theme, index)}
            format={format}
            onClick={() => onMonth(each.month)}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        {stack.legend.map((each) => (
          <li key={each.key} className="flex items-center gap-1">
            <span
              aria-hidden
              className="size-2 rounded-[2px]"
              style={{ backgroundColor: slot(theme, each.slot) }}
            />
            {each.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MonthColumn({
  month,
  most,
  dim,
  active,
  color,
  format,
  onClick,
}: {
  month: StackMonth;
  most: number;
  dim: boolean;
  active: boolean;
  color: (slot: number) => string;
  format: (amount: number) => string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-pressed={active}
            aria-label={`${monthLabel(month.month)}, ${format(month.total)}`}
            className={cn(
              "flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-end gap-0.5 rounded-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
              active && "bg-accent",
            )}
            onClick={onClick}
          />
        }
      >
        <span
          className={cn(
            "flex min-h-0 flex-col-reverse gap-px overflow-hidden rounded-t-[3px]",
            dim && "opacity-35",
          )}
          style={{ height: `calc((100% - 1rem) * ${month.total / most})` }}
        >
          {month.parts.map((part) => (
            <span
              key={part.key}
              className="min-h-px"
              style={{ flexGrow: part.spent, backgroundColor: color(part.slot) }}
            />
          ))}
        </span>
        <span className="h-3.5 shrink-0 truncate text-center text-[10px] leading-3.5 text-muted-foreground">
          {monthName(month.month)}
        </span>
      </TooltipTrigger>
      <TooltipPopup>
        <p className="font-medium">
          {monthLabel(month.month)}: {format(month.total)}
        </p>
        <ul className="mt-1 grid gap-0.5">
          {month.parts.toReversed().map((part) => (
            <li key={part.key} className="flex items-center gap-1.5 tabular-nums">
              <span
                aria-hidden
                className="size-2 rounded-[2px]"
                style={{ backgroundColor: color(part.slot) }}
              />
              {part.name} {format(part.spent)}
            </li>
          ))}
        </ul>
      </TooltipPopup>
    </Tooltip>
  );
}

const VIEWS = [
  { value: "range", label: "This range" },
  { value: "months", label: "By month" },
] as const;

/** What the money bought, by top-level item category: this range ranked, or twelve months. */
function WhereItWent({
  overview,
  since,
  until,
  category,
  onCategory,
  month,
  onMonth,
}: {
  overview: ReceiptOverview;
  since: string | undefined;
  until: string | undefined;
  category: CategoryFocus | null;
  onCategory: (category: CategoryFocus) => void;
  month: string | null;
  onMonth: (month: string) => void;
}) {
  const { format } = useBook();
  const [view, setView] = useState<(typeof VIEWS)[number]["value"]>("range");
  const top = topCategories(overview.categories);
  const stack = categoryStack(overview.months);
  return (
    <InsightCard
      title="Where it went"
      aside={<InsightTabs label="Show" items={VIEWS} value={view} onChange={setView} />}
    >
      {view === "months" ? (
        <MonthStack stack={stack} since={since} until={until} month={month} onMonth={onMonth} />
      ) : top.length === 0 ? (
        <InsightEmpty>No lines in this range.</InsightEmpty>
      ) : (
        <RankedBars
          bars={top.map((each) => ({
            id: each.id ?? "none",
            label: each.name,
            value: each.spent,
            previous: Math.max(0, each.previous),
            shown: format(each.spent),
            tooltip: (
              <>
                {each.lines} {each.lines === 1 ? "line" : "lines"}, {format(each.previous)} the
                period before. Tax and discounts are shared out over the lines.
              </>
            ),
            active: category?.id === each.id && category?.name === each.name,
            onClick: () => onCategory({ id: each.id, name: each.name }),
          }))}
        />
      )}
      {view === "range" && overview.unitemized > 0 && (
        <p className="mt-auto px-1.5 pt-1.5 text-xs text-muted-foreground tabular-nums">
          {format(overview.unitemized)} is on receipts with no lines
        </p>
      )}
    </InsightCard>
  );
}

/** What scrolls away above the table: the tiles, the pipeline, and the three cards. */
export function ReceiptInsights({
  overview,
  view,
  onAutoMatch,
  matching,
}: {
  overview: ReceiptOverview;
  view: ReceiptView;
  onAutoMatch: () => void;
  matching: boolean;
}) {
  const { since, until, focus, category, month } = view.state;
  const { format } = useBook();
  const items = attentionItems(overview.attention, format);
  const open = items.filter((item) => item.count > 0);
  return (
    <InsightPanel>
      <ReceiptSummaryTiles
        overview={overview}
        allClear={open.length === 0 ? items.length : null}
        unfinishedActive={stageIs(focus, "unfinished")}
        onUnfinished={view.chooseUnfinished}
      />
      <ReceiptPipeline
        overview={overview}
        isActive={(stage) => stageIs(focus, stage)}
        onStage={view.chooseStage}
        onAutoMatch={onAutoMatch}
        matching={matching}
      />
      <AttentionAlerts
        items={items}
        isActive={(item) => sameFocus(focus, { kind: "check", check: item.check })}
        onChoose={(item) => view.chooseCheck(item.check)}
      />
      <InsightGrid>
        <TopStores overview={overview} storeFilter={view.stores} onStore={view.toggleStore} />
        <WhereItWent
          overview={overview}
          since={since}
          until={until}
          category={category}
          onCategory={view.toggleCategory}
          month={month}
          onMonth={view.toggleMonth}
        />
      </InsightGrid>
    </InsightPanel>
  );
}

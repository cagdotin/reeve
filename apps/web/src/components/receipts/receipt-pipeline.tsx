import type { ReceiptOverview } from "@reeve/contract/catalog";
import type { ReceiptStage } from "@reeve/contract/receipts";
import { SparklesIcon } from "lucide-react";
import { HelpCard } from "@/components/insights/help-card";
import { InsightEmpty } from "@/components/insights/insight-card";
import { useChartTheme } from "@/components/reports/chart-theme";
import { Button } from "@reeve/ui/components/button";
import { cn } from "@reeve/ui/lib/utils";
import { useBook } from "@/lib/book";
import { coverageShare, flowPaths, pipelineFlow, STEPS, type FlowStage } from "@/lib/receipt-pages";

const words = (stage: ReceiptStage) =>
  STEPS.find((step) => step.stage === stage)?.waiting ?? "finished";

const passed = (flow: FlowStage) => {
  const step = STEPS.find((each) => each.stage === flow.stage);
  return step === undefined
    ? `${flow.waiting} of ${flow.arriving} have done every step`
    : `${flow.passing} of ${flow.arriving} that came this far are ${step.done.toLowerCase()}`;
};

/** The band of receipts narrowing through the steps, with what each step keeps left above it. */
function FlowBand({ flow }: { flow: ReadonlyArray<FlowStage> }) {
  const theme = useChartTheme();
  const { width, band, waiting } = flowPaths(flow);
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} 100`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-x-0 top-0 h-14 w-full @max-xl:hidden"
    >
      {waiting.map((path) => (
        <path key={path} d={path} className="fill-muted-foreground/25" />
      ))}
      <path d={band} fill={theme.series[0]} fillOpacity={0.22} />
    </svg>
  );
}

function StageButton({
  flow,
  most,
  active,
  onChoose,
}: {
  flow: FlowStage;
  most: number;
  active: boolean;
  onChoose: () => void;
}) {
  const theme = useChartTheme();
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${flow.waiting} ${words(flow.stage)}`}
      title={passed(flow)}
      disabled={flow.waiting === 0 && !active}
      className={cn(
        "grid min-w-0 gap-0 rounded-md px-1.5 pb-1 text-left outline-none enabled:cursor-pointer enabled:hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
        "@xl:pt-15 @max-xl:grid-cols-[2rem_6rem_minmax(0,1fr)] @max-xl:items-center @max-xl:gap-2 @max-xl:py-1",
        active && "bg-accent",
        flow.waiting === 0 && "text-muted-foreground",
      )}
      onClick={onChoose}
    >
      <span className="text-xl leading-7 font-medium tabular-nums @max-xl:text-right @max-xl:text-base">
        {flow.waiting}
      </span>
      <span className="truncate text-xs text-muted-foreground">{words(flow.stage)}</span>
      <span className="flex h-2 rounded-full bg-muted-foreground/15 @xl:hidden">
        <span
          className="rounded-full"
          style={{
            width: `${flow.waiting * (100 / most)}%`,
            backgroundColor: theme.series[0],
          }}
        />
      </span>
    </button>
  );
}

/** How much recorded spending has receipts behind it: money out, so the meter is red. */
function Coverage({ coverage }: { coverage: ReceiptOverview["coverage"] }) {
  const theme = useChartTheme();
  const { format } = useBook();
  const share = coverageShare(coverage);
  if (share === null) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-1.5 pt-2 text-xs text-muted-foreground">
      <span className="flex h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted-foreground/15">
        <span className="rounded-full" style={{ width: `${share}%`, backgroundColor: theme.out }} />
      </span>
      <span className="tabular-nums">
        <span className="font-medium text-foreground">{share}%</span> of recorded spending has
        receipts behind it: {format(coverage.covered)} of {format(coverage.recorded)}
      </span>
      {coverage.unlinked > 0 && (
        <span className="tabular-nums">
          {format(coverage.unlinked)} more on receipts with no payment
        </span>
      )}
      <HelpCard
        label="What recorded spending counts"
        title="Recorded spending"
        align="start"
        body={[
          "Everything the ledger records on expense categories in the range, by the transaction's day, rent and bills included: most of those will never have a receipt.",
          "Receipts count what their linked payments pay. A receipt with no payment has no transaction to set against it, so it is named apart; it may be cash the ledger never saw.",
        ]}
      />
    </div>
  );
}

/** Where the range's receipts stand: each at the first step it has not done. */
export function ReceiptPipeline({
  overview,
  isActive,
  onStage,
  onAutoMatch,
  matching,
}: {
  overview: ReceiptOverview;
  isActive: (stage: ReceiptStage) => boolean;
  onStage: (stage: ReceiptStage) => void;
  onAutoMatch: () => void;
  matching: boolean;
}) {
  const flow = pipelineFlow(overview.pipeline);
  const most = flow[0]?.arriving ?? 0;
  return (
    <section aria-label="Receipt pipeline" className="rounded-xl border bg-card p-3">
      <header className="mb-2 flex min-h-6 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1.5">
        <h2 className="flex items-center gap-1.5 text-[13px] font-medium">
          Receipt pipeline
          <HelpCard
            label="How the pipeline counts"
            title="How the pipeline counts"
            align="start"
            className="font-normal text-muted-foreground"
            body={[
              "A receipt is finished in four steps: it adds up, a payment is tied to it, every line has a budget category, and its transaction carries the split.",
              "Steps can happen in any order, so each receipt counts once, at the first step it has not done. A receipt with several steps left counts only at the first, so a check below, which asks one thing of every receipt in the book, can count more than a step here.",
            ]}
          />
        </h2>
        <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
          {most} {most === 1 ? "receipt" : "receipts"} in this range
          {overview.attention.noPayment > 0 && (
            <Button
              variant="outline"
              loading={matching}
              title="Across the book, links a receipt only to a transaction that is its one exact match, within three days, at the same or a similar payee. It applies nothing unless the setting to apply receipts automatically is on."
              onClick={onAutoMatch}
            >
              <SparklesIcon />
              Auto-match
            </Button>
          )}
        </span>
      </header>
      {most === 0 ? (
        <InsightEmpty>No receipts in this range.</InsightEmpty>
      ) : (
        <div className="relative grid @xl:grid-cols-5">
          <FlowBand flow={flow} />
          {flow.map((each) => (
            <StageButton
              key={each.stage}
              flow={each}
              most={most}
              active={isActive(each.stage)}
              onChoose={() => onStage(each.stage)}
            />
          ))}
        </div>
      )}
      <Coverage coverage={overview.coverage} />
    </section>
  );
}

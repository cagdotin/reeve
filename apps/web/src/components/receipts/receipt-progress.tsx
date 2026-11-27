import type { ReceiptStatus } from "@reeve/contract/catalog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@reeve/ui/components/tooltip";
import { useChartTheme } from "@/components/reports/chart-theme";
import { STEPS, statusWords } from "@/lib/receipt-pages";
import { cn } from "@reeve/ui/lib/utils";

/** The four steps as one small mark: each done step filled. Its words are on hover and read out. */
export function ReceiptProgress({ status }: { status: ReceiptStatus }) {
  const theme = useChartTheme();
  const words = statusWords(status);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={words.join(", ")}
            className="relative z-10 flex h-5 cursor-default items-center gap-0.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        {STEPS.map((step) => (
          <span
            key={step.stage}
            className={cn(
              "h-1.5 w-2.5 rounded-full",
              !status[step.flag] && "bg-muted-foreground/25",
            )}
            style={status[step.flag] ? { backgroundColor: theme.series[0] } : undefined}
          />
        ))}
      </TooltipTrigger>
      <TooltipPopup>
        <ul className="grid gap-0.5">
          {STEPS.map((step, index) => (
            <li key={step.stage} className={cn(!status[step.flag] && "text-muted-foreground")}>
              {words[index]}
            </li>
          ))}
        </ul>
      </TooltipPopup>
    </Tooltip>
  );
}

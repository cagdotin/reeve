import type { RuleOverview } from "@reeve/contract/catalog";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { AttentionAlerts } from "@/components/insights/attention-alerts";
import { PageAlert } from "@/components/page-alert";
import { Button } from "@reeve/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@reeve/ui/components/dialog";
import { useBook } from "@/lib/book";
import { sameFilters, type FacetValue } from "@/lib/facets";
import { attentionItems } from "@/lib/rules";

/** The payees most worth a rule; choosing one opens the editor with the rule filled in. */
function WorthARule({
  overview,
  uncategorizedOnly,
  open,
  onOpenChange,
  onPayee,
}: {
  overview: RuleOverview;
  uncategorizedOnly: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPayee: (payee: string, category: string | null) => void;
}) {
  const { formatDay } = useBook();
  const shown = overview.suggestions.filter((each) => !uncategorizedOnly || each.uncategorized > 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Payees worth a rule</DialogTitle>
          <DialogDescription>
            {uncategorizedOnly
              ? "Payees with uncategorized transactions and no rule that sets a category."
              : "Payees whose recent transactions no category rule matches. Pick one to write its rule."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="divide-y rounded-lg border">
            {shown.map((payee) => (
              <button
                key={payee.id}
                type="button"
                aria-label={`New rule for ${payee.name}`}
                title={`${payee.unmatched} recent transactions no category rule matches, ${payee.uncategorized} uncategorized, last on ${formatDay(payee.lastTransaction)}`}
                className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left text-[13px] hover:bg-muted/40"
                onClick={() => {
                  onOpenChange(false);
                  onPayee(payee.id, payee.category);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{payee.name}</span>
                <span className="max-w-[40%] shrink truncate text-muted-foreground">
                  {payee.categoryName ?? (payee.uncategorized > 0 ? "Uncategorized" : "Mixed")}
                </span>
                <span className="w-8 shrink-0 text-right tabular-nums">{payee.unmatched}</span>
                <PlusIcon className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Close</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** What needs attention and the payees worth a rule, as strips along the page's top. */
export function RuleAlerts({
  overview,
  filters,
  onFilters,
  onPayee,
}: {
  overview: RuleOverview;
  filters: FacetValue;
  onFilters: (filters: FacetValue) => void;
  onPayee: (payee: string, category: string | null) => void;
}) {
  const [listing, setListing] = useState<"all" | "uncategorized" | null>(null);
  const checks = attentionItems(overview).map((item) => ({
    ...item,
    title: `${item.count} ${item.open}`,
  }));
  const worth = overview.suggestionCount;
  return (
    <>
      <AttentionAlerts
        items={checks}
        isActive={(item) =>
          item.filters === null ? listing === "uncategorized" : sameFilters(filters, item.filters)
        }
        onChoose={({ filters: own }) => {
          if (own === null) setListing("uncategorized");
          else onFilters(sameFilters(filters, own) ? {} : own);
        }}
      />
      {worth > 0 && (
        <PageAlert
          variant="info"
          title={`${worth} ${worth === 1 ? "payee is" : "payees are"} worth a rule`}
          action={
            <Button variant="ghost" onClick={() => setListing("all")}>
              Review
            </Button>
          }
        />
      )}
      <WorthARule
        overview={overview}
        uncategorizedOnly={listing === "uncategorized"}
        open={listing !== null}
        onOpenChange={(open) => !open && setListing(null)}
        onPayee={onPayee}
      />
    </>
  );
}

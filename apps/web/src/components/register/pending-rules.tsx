import { useQuery } from "@tanstack/react-query";
import { PageAlert } from "@/components/page-alert";
import { Button } from "@reeve/ui/components/button";
import { toastManager } from "@reeve/ui/components/toast";
import { scopeInput } from "@/lib/account-scope";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";

const transactions = (count: number) => `${count} transaction${count === 1 ? "" : "s"}`;

/** Uncategorized transactions a category rule matches, categorized in one step (docs/rules/rules-and-payees.md). */
export function PendingRules({ param }: { param: string }) {
  const { id: book } = useBook();
  const scope = param === "uncategorized" ? { onBudget: true } : scopeInput(param);
  const pending = useQuery(bookQuery(book, "pending_rule_categories", scope)).data?.transactions;
  const apply = useBookMutation(book, "apply_rule_categories");
  if (pending === undefined || pending.length === 0) return null;
  return (
    <PageAlert
      variant="info"
      title={`${transactions(pending.length)} without a category match a category rule`}
      action={
        <Button
          variant="ghost"
          loading={apply.isPending}
          onClick={() =>
            apply.mutate(scope, {
              onSuccess: ({ categorized }) =>
                toastManager.add({
                  type: "success",
                  title: `Categorized ${transactions(categorized.length)} by their rules`,
                }),
            })
          }
        >
          Apply rules
        </Button>
      }
    >
      Sets only the category. Categories you picked stay.
    </PageAlert>
  );
}

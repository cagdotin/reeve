import { requirePurchases } from "@/lib/purchases";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { Page } from "@/components/page";
import { DeleteReceiptDialog } from "@/components/receipts/delete-receipt-dialog";
import { NewReceiptDialog } from "@/components/receipts/new-receipt-dialog";
import { ReceiptInsights } from "@/components/receipts/receipt-insights";
import { ReceiptTableSection } from "@/components/receipts/receipt-table-section";
import { useReceiptView } from "@/components/receipts/use-receipt-view";
import { Button } from "@reeve/ui/components/button";
import { toastManager } from "@reeve/ui/components/toast";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { useHotkeys } from "@/lib/hotkeys";
import { listInput, type DeleteTarget } from "@/lib/receipt-pages";

export const Route = createFileRoute("/receipts/")({
  beforeLoad: requirePurchases,
  component: ReceiptsPage,
});

function ReceiptsPage() {
  const { id: book } = useBook();
  const view = useReceiptView();
  const { since, until } = view.state;
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null);
  useHotkeys({ n: () => setCreating(true) });

  const overview = useQuery({
    ...bookQuery(book, "receipt_activity", {
      ...(since === undefined ? {} : { since }),
      ...(until === undefined ? {} : { until }),
    }),
    placeholderData: keepPreviousData,
  });
  const list = useQuery({
    ...bookQuery(book, "list_receipts", listInput(view.state)),
    placeholderData: keepPreviousData,
  });
  const autoMatch = useBookMutation(book, "auto_match_receipts");
  const runAutoMatch = () =>
    autoMatch.mutate(
      {},
      {
        onSuccess: (result) =>
          toastManager.add({
            type: result.linked.length > 0 ? "success" : "info",
            title: `Linked ${result.linked.length} ${result.linked.length === 1 ? "receipt" : "receipts"}`,
            description: `${result.ambiguous.length} ambiguous, ${result.unmatched.length} without a sure match`,
          }),
      },
    );

  return (
    <>
      <Page
        title="Receipts"
        query={{ data: overview.data, error: overview.error ?? list.error }}
        actions={
          <Button
            variant="ghost"
            disabled={overview.data === undefined}
            onClick={() => setCreating(true)}
          >
            <PlusIcon />
            New receipt
          </Button>
        }
      >
        {(data) => (
          <>
            {data.total > 0 && (
              <ReceiptInsights
                overview={data}
                view={view}
                onAutoMatch={runAutoMatch}
                matching={autoMatch.isPending}
              />
            )}
            <ReceiptTableSection
              overview={data}
              view={view}
              rows={list.data?.receipts ?? []}
              total={list.data?.total ?? 0}
              loaded={list.data !== undefined}
              loading={list.isPlaceholderData}
              onDelete={setDeleting}
            />
          </>
        )}
      </Page>
      <NewReceiptDialog open={creating} onOpenChange={setCreating} />
      <DeleteReceiptDialog target={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}

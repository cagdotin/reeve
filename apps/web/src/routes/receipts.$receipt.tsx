import { requirePurchases } from "@/lib/purchases";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { EllipsisIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Page } from "@/components/page";
import { DeleteReceiptDialog } from "@/components/receipts/delete-receipt-dialog";
import { FinishSteps } from "@/components/receipts/finish-steps";
import { LinesTable } from "@/components/receipts/lines-table";
import { Photos } from "@/components/receipts/photos";
import { ReceiptHeader } from "@/components/receipts/receipt-header";
import { ReceiptSummary } from "@/components/receipts/receipt-summary";
import { Button } from "@reeve/ui/components/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@reeve/ui/components/menu";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import { liveStatus } from "@/lib/receipt-pages";

export const Route = createFileRoute("/receipts/$receipt")({
  beforeLoad: requirePurchases,
  component: ReceiptRoute,
});

/** A new editor for each receipt, so typed totals never carry over. */
function ReceiptRoute() {
  const { receipt } = Route.useParams();
  return <ReceiptEditor key={receipt} id={receipt} />;
}

function ReceiptEditor({ id }: { id: string }) {
  const { id: book } = useBook();
  const receipt = useQuery(bookQuery(book, "get_receipt", { id }));
  const groups = useQuery(bookQuery(book, "list_categories", {})).data ?? [];
  const itemCategories = useQuery(bookQuery(book, "list_item_categories", {})).data ?? [];
  const [liveTotals, setLiveTotals] = useState<ReadonlyMap<string, number>>(new Map());
  const onLiveTotal = (line: string, total: number | null) =>
    setLiveTotals((current) => {
      const next = new Map(current);
      if (total === null) next.delete(line);
      else next.set(line, total);
      return next;
    });

  const [deleting, setDeleting] = useState(false);
  const loaded = receipt.data;
  return (
    <>
      <Page
        title={loaded === undefined ? "" : (loaded.payee ?? "No store")}
        query={receipt}
        actions={<ReceiptMenu disabled={loaded === undefined} onDelete={() => setDeleting(true)} />}
      >
        {(data) => (
          <div
            className={
              data.photos.length > 0
                ? "grid items-start gap-3 @5xl:grid-cols-[minmax(0,1fr)_20rem]"
                : "grid gap-3"
            }
          >
            <div className="contents @5xl:grid @5xl:min-w-0 @5xl:gap-3">
              <div className="order-1 min-w-0">
                <ReceiptSummary receipt={data} status={liveStatus(data, liveTotals)}>
                  <ReceiptHeader receipt={data} />
                  {data.photos.length === 0 && <Photos receipt={data} />}
                </ReceiptSummary>
              </div>
              <div className="order-3 min-w-0">
                <LinesTable
                  receipt={data}
                  groups={groups}
                  itemCategories={itemCategories}
                  onLiveTotal={onLiveTotal}
                />
              </div>
              <div className="order-4 min-w-0">
                <FinishSteps receipt={data} status={liveStatus(data, liveTotals)} groups={groups} />
              </div>
            </div>
            {data.photos.length > 0 && (
              <div className="order-2 min-w-0 @5xl:sticky @5xl:top-[calc(var(--sticky-top)+0.75rem)]">
                <Photos receipt={data} />
              </div>
            )}
          </div>
        )}
      </Page>
      <DeleteReceiptDialog
        leave
        target={
          deleting && loaded !== undefined
            ? {
                id: loaded.id,
                payee: loaded.payee,
                date: loaded.date,
                photoCount: loaded.photos.length,
                paymentCount: loaded.payments.length,
                applied: loaded.status.applied,
              }
            : null
        }
        onClose={() => setDeleting(false)}
      />
    </>
  );
}

function ReceiptMenu({ disabled, onDelete }: { disabled: boolean; onDelete: () => void }) {
  return (
    <Menu>
      <MenuTrigger
        disabled={disabled}
        render={<Button size="icon" variant="ghost" aria-label="Receipt actions" />}
      >
        <EllipsisIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem variant="destructive" onClick={onDelete}>
          <Trash2Icon />
          Delete receipt…
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}

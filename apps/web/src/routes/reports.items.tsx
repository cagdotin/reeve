import { requirePurchases } from "@/lib/purchases";
import { lastDayOfMonth, parseISO, format as formatDate } from "date-fns";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Money } from "@/components/money";
import { DataTable, Figure } from "@/components/reports/chart-parts";
import { useEarliestMonth } from "@/components/reports/choices";
import { Segmented, TimeFramePicker } from "@/components/reports/controls";
import { ItemSpendingGraph } from "@/components/reports/item-spending";
import { defaultFrame, resolveFrame, type TimeFrame } from "@/components/reports/meta";
import { TableEmpty } from "@/components/insights/table";
import { QueryBody } from "@/components/page";
import { ReportShell } from "@/components/reports/report-shell";
import { Button } from "@reeve/ui/components/button";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";

export const Route = createFileRoute("/reports/items")({
  beforeLoad: requirePurchases,
  component: ItemSpendingPage,
});

type GroupBy = "item_category" | "product" | "store";

const GROUPS: ReadonlyArray<{ value: GroupBy; label: string; plural: string }> = [
  { value: "item_category", label: "Item category", plural: "Item categories" },
  { value: "product", label: "Product", plural: "Products" },
  { value: "store", label: "Store", plural: "Stores" },
];

/** The days a time frame covers: the first of its first month to the last of its last. */
const frameDays = (frame: TimeFrame) => {
  const { start, end } = resolveFrame(frame);
  return {
    from: `${start}-01`,
    to: formatDate(lastDayOfMonth(parseISO(`${end}-01`)), "yyyy-MM-dd"),
  };
};

/** What receipts' items cost, by item category, product or store, from their lines. */
function ItemSpendingPage() {
  const { id: book } = useBook();
  const [frame, setFrame] = useState<TimeFrame>(() => defaultFrame(3));
  const [groupBy, setGroupBy] = useState<GroupBy>("item_category");
  const [allocate, setAllocate] = useState(true);
  const report = useQuery({
    ...bookQuery(book, "item_spending", { ...frameDays(frame), groupBy, allocate }),
    placeholderData: keepPreviousData,
  });
  const earliest = useEarliestMonth(book);
  const group = GROUPS.find((each) => each.value === groupBy) ?? GROUPS[0]!;

  return (
    <ReportShell
      name="Item spending"
      controls={
        <>
          <TimeFramePicker frame={frame} onChange={setFrame} earliest={earliest} />
          <Segmented label="Group by" items={GROUPS} value={groupBy} onChange={setGroupBy} />
          <Button
            variant={allocate ? "secondary" : "outline"}
            title="Spread each receipt's tax and discounts over its lines, so the groups add up to what was paid"
            onClick={() => setAllocate(!allocate)}
          >
            {allocate ? "With tax and discounts" : "Line totals only"}
          </Button>
        </>
      }
    >
      <QueryBody query={report}>
        {(data) =>
          data.groups.length === 0 ? (
            <TableEmpty>
              No receipt lines in this range.{" "}
              <Link to="/receipts" className="underline">
                Add receipts
              </Link>{" "}
              to see what their items cost.
            </TableEmpty>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-8">
                <Figure label="Spent on items">
                  <Money amount={data.total} tone="none" className="font-sans text-2xl" />
                </Figure>
                <Figure label={group.plural}>{data.groups.length}</Figure>
              </div>
              <ItemSpendingGraph report={data} fetching={report.isFetching} />
              <DataTable
                rows={data.groups.toSorted((a, b) => b.amount - a.amount)}
                rowKey={(group) => group.id ?? "none"}
                columns={[
                  { key: "name", label: group.label, value: (row) => row.name },
                  {
                    key: "lines",
                    label: "Lines",
                    align: "right",
                    value: (group) => group.lines,
                  },
                  {
                    key: "amount",
                    label: "Spent",
                    align: "right",
                    value: (group) => <Money amount={group.amount} tone="none" />,
                  },
                  {
                    key: "share",
                    label: "Share",
                    align: "right",
                    value: (group) =>
                      data.total === 0 ? "—" : `${((group.amount / data.total) * 100).toFixed(1)}%`,
                  },
                ]}
              />
            </>
          )
        }
      </QueryBody>
    </ReportShell>
  );
}

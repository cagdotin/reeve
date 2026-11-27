import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLinkIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";
import { FilterBar, FilterChip } from "@/components/insights/filter-bar";
import { TABLE_HEAD, TABLE_ROW, TableEmpty } from "@/components/insights/table";
import { Money } from "@/components/money";
import { ProductPicker } from "@/components/receipts/product-picker";
import { Button } from "@reeve/ui/components/button";
import { Spinner } from "@reeve/ui/components/spinner";
import { cn } from "@reeve/ui/lib/utils";
import { bookQuery, useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { groupLines, matchesLine } from "@/lib/products";

const PAGE = 200;

const DATE = "w-22 shrink-0 tabular-nums text-muted-foreground @max-xl:hidden";
const LINE = "min-w-0 flex-1 truncate";
const STORE = "w-28 shrink-0 truncate text-muted-foreground @max-3xl:hidden";
const TOTAL = "flex w-18 shrink-0 justify-end tabular-nums";
const ASSIGN =
  "flex w-[28rem] shrink-0 items-center gap-2 @max-3xl:order-last @max-3xl:w-full @max-3xl:basis-full";
const SUGGESTED = "flex min-w-0 flex-1 items-center gap-1 overflow-hidden";
const PICKER = "w-36 shrink-0";
const OPEN = "flex w-6 shrink-0 justify-center";

/**
 * Receipt lines without a product, with the engine's suggestions. Lines printed alike at one store
 * are one row, since assigning any of them fills in the rest: one click assigns a suggestion to
 * them all and remembers it for the store.
 */
export function UnassignedLines({
  namedOnly,
  onNamedOnly,
  onLeave,
}: {
  namedOnly: boolean;
  onNamedOnly: (only: boolean) => void;
  onLeave: () => void;
}) {
  const { id: book, formatDay } = useBook();
  const [limit, setLimit] = useState(PAGE);
  const [query, setQuery] = useState("");
  const lines = useQuery({
    ...bookQuery(book, "list_unassigned_lines", { limit, ...(namedOnly ? { named: true } : {}) }),
    placeholderData: keepPreviousData,
  });
  const assign = useBookMutation(book, "assign_line_product");
  const loaded = lines.data?.lines ?? [];
  const total = lines.data?.total ?? 0;
  const shown = loaded.filter((line) => matchesLine(line, query));
  const groups = groupLines(shown);

  return (
    <>
      <FilterBar
        testId="unassigned-filters"
        search="Search lines"
        query={query}
        onQuery={setQuery}
        shown={shown.length}
        total={total}
        head={
          <div className={TABLE_HEAD}>
            <span className={DATE}>Last</span>
            <span className={LINE}>Line</span>
            <span className={STORE}>Store</span>
            <span className={TOTAL}>Total</span>
            <span className={cn(ASSIGN, "@max-3xl:hidden")}>
              <span className={SUGGESTED}>Suggested</span>
              <span className={PICKER}>Product</span>
            </span>
            <span className={OPEN} />
          </div>
        }
      >
        <FilterChip label="Unassigned lines" clearLabel="Back to all products" onClear={onLeave} />
        {namedOnly && (
          <FilterChip
            label="Matches a name or alias"
            clearLabel="Show every unassigned line"
            onClear={() => onNamedOnly(false)}
          />
        )}
      </FilterBar>
      {lines.data === undefined && (
        <div className="flex justify-center p-10">
          <Spinner />
        </div>
      )}
      {groups.map(({ key, line, lines: count, total: amount }) => (
        <div key={key} className={cn(TABLE_ROW, "min-h-9 flex-wrap gap-y-1 py-1")}>
          <span className={DATE}>{formatDay(line.date)}</span>
          <span className={LINE} title={line.text}>
            {line.text}
            {line.code !== null && (
              <span className="ms-1.5 font-mono text-xs text-muted-foreground">{line.code}</span>
            )}
            {count > 1 && (
              <span
                className="ms-1.5 text-xs text-muted-foreground"
                title={`${count} lines printed alike at this store`}
              >
                × {count}
              </span>
            )}
          </span>
          <span className={STORE}>{line.payee ?? "No store"}</span>
          <span className={TOTAL}>
            <Money amount={amount} tone="none" />
          </span>
          <span className={ASSIGN}>
            <span className={SUGGESTED}>
              {line.suggestions.slice(0, 2).map((suggestion) => (
                <Button
                  key={suggestion.productId}
                  variant="outline"
                  className="min-w-0 max-w-full"
                  aria-label={`Assign ${suggestion.product} to ${line.text}`}
                  title={`Matched “${suggestion.matched}”; remembers it for the store`}
                  onClick={() =>
                    assign.mutate({
                      line: line.id,
                      productId: suggestion.productId,
                      remember: line.payeeId !== null,
                      applyToSimilar: true,
                    })
                  }
                >
                  <SparklesIcon />
                  <span className="truncate">{suggestion.product}</span>
                  <span className="text-muted-foreground">
                    {Math.round(suggestion.score * 100)}%
                  </span>
                </Button>
              ))}
            </span>
            <span className={PICKER}>
              <ProductPicker line={line} payeeId={line.payeeId} />
            </span>
          </span>
          <span className={OPEN}>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Open the receipt of ${line.text}`}
              className="text-muted-foreground"
              render={<Link to="/receipts/$receipt" params={{ receipt: line.receiptId }} />}
            >
              <ExternalLinkIcon />
            </Button>
          </span>
        </div>
      ))}
      {lines.isSuccess && groups.length === 0 && (
        <TableEmpty>
          {total === 0 ? "Every receipt line has a product." : "No unassigned line matches."}
        </TableEmpty>
      )}
      {loaded.length < total && (
        <div className="flex items-center justify-center gap-3 p-4">
          <span className="text-xs text-muted-foreground tabular-nums">
            {loaded.length} of {total} loaded
          </span>
          <Button
            variant="outline"
            loading={lines.isPlaceholderData}
            onClick={() => setLimit(limit + PAGE)}
          >
            Load more
          </Button>
        </div>
      )}
    </>
  );
}

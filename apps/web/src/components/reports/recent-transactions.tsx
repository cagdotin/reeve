import type { RegisterRow } from "@reeve/contract";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@reeve/ui/lib/utils";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import { WidgetQuery, type WidgetBodyProps } from "./card-body";

export function FlowBar({ tone }: { tone: "in" | "out" | "transfer" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "h-4 w-[3px] shrink-0 rounded-full",
        tone === "in" ? "bg-success" : tone === "out" ? "bg-[#7b84e0]" : "bg-muted-foreground/40",
      )}
    />
  );
}

const counterpartOf = (row: RegisterRow) => {
  const other = row.counterpart;
  if (other.kind === "category" || other.kind === "other") return other.name;
  if (other.kind === "transfer") return `Transfer: ${other.name}`;
  if (other.kind === "split") return "Split";
  return "Uncategorized";
};

/** The latest register lines across every account, newest first. */
export function RecentTransactionsBody({ meta }: WidgetBodyProps<{ readonly limit?: number }>) {
  const { id: book, format, formatDay } = useBook();
  const recent = useQuery(bookQuery(book, "list_transactions", { limit: meta.limit ?? 6 }));
  return (
    <WidgetQuery
      query={recent}
      isEmpty={(data) => data.rows.length === 0}
      empty="No transactions yet."
    >
      {(data) => (
        <ul className="min-h-0 flex-1 overflow-hidden">
          {data.rows.map((row) => (
            <li
              key={row.postingId}
              className="flex h-9 items-center gap-3 border-b text-[13px] last:border-b-0"
            >
              <FlowBar
                tone={
                  row.counterpart.kind === "transfer" ? "transfer" : row.amount > 0 ? "in" : "out"
                }
              />
              <span className="min-w-0 flex-1 truncate">
                <span className="font-semibold">{row.payee ?? row.accountName}</span>{" "}
                <span className="text-muted-foreground">{counterpartOf(row)}</span>
              </span>
              <span className="text-muted-foreground tabular-nums max-sm:hidden">
                {formatDay(row.date)}
              </span>
              <span
                className={cn(
                  "w-20 text-end tabular-nums",
                  row.amount > 0 && "text-success-foreground",
                )}
              >
                {format(row.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </WidgetQuery>
  );
}

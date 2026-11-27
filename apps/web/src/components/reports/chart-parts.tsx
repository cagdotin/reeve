import type { ReactNode } from "react";
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import -- the reports routes are code-split, so recharts loads only with them.
import { ResponsiveContainer } from "recharts";
import { ScrollArea } from "@reeve/ui/components/scroll-area";
import { cn } from "@reeve/ui/lib/utils";
import { useBook } from "@/lib/book";

export interface TooltipRow {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  readonly color?: string | undefined;
  /** How the key mark is drawn: a short stroke (lines, the default) or a swatch. */
  readonly mark?: "line" | "rect" | "none" | undefined;
}

/** The hover readout: the values lead, the series names follow. */
export function TooltipCard({
  title,
  rows,
}: {
  title: ReactNode;
  rows: ReadonlyArray<TooltipRow>;
}) {
  const { format } = useBook();
  return (
    <div className="min-w-40 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg/5">
      <div className="mb-1 font-medium text-muted-foreground">{title}</div>
      <div className="grid gap-1">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-2">
            {row.mark !== "none" && (
              <span
                aria-hidden
                className={cn(
                  "shrink-0",
                  row.mark === "rect" ? "size-2.5 rounded-[3px]" : "h-0.5 w-3 rounded-full",
                )}
                style={{ backgroundColor: row.color }}
              />
            )}
            <span className="font-medium tabular-nums">{format(row.value)}</span>
            <span className="ms-auto ps-3 text-muted-foreground">{row.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface LegendItem {
  readonly label: string;
  readonly color: string;
  readonly mark?: "line" | "rect" | "dashed" | undefined;
}

/** A legend above a chart, its keys mirroring the marks. */
export function ChartLegend({
  items,
  className,
}: {
  items: ReadonlyArray<LegendItem>;
  className?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              "shrink-0",
              item.mark === "line"
                ? "h-0.5 w-3.5 rounded-full"
                : item.mark === "dashed"
                  ? "h-0 w-3.5 border-t-2 border-dashed bg-transparent!"
                  : "size-2.5 rounded-[3px]",
            )}
            style={
              item.mark === "dashed" ? { borderColor: item.color } : { backgroundColor: item.color }
            }
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/** Sizes a chart to its box; while new data loads it keeps the old render, dimmed. */
export function ChartBox({
  children,
  fetching = false,
  className,
}: {
  children: React.ReactElement;
  fetching?: boolean | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cn("min-h-0 min-w-0 transition-opacity", fetching && "opacity-60", className)}>
      <ResponsiveContainer
        width="100%"
        height="100%"
        minWidth={0}
        minHeight={0}
        initialDimension={{ width: 1, height: 1 }}
      >
        {children}
      </ResponsiveContainer>
    </div>
  );
}

export interface Column<Row> {
  readonly key: string;
  readonly label: string;
  readonly value: (row: Row) => ReactNode;
  readonly align?: "left" | "right" | undefined;
  readonly className?: string | undefined;
}

/** The table view of a chart: every value it plots, reachable without hovering. */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  footer,
  className,
}: {
  columns: ReadonlyArray<Column<Row>>;
  rows: ReadonlyArray<Row>;
  rowKey: (row: Row) => string;
  footer?: Row | undefined;
  className?: string | undefined;
}) {
  const cells = (row: Row) =>
    columns.map((column) => (
      <td
        key={column.key}
        className={cn(
          "h-8 px-3 whitespace-nowrap",
          column.align === "right" && "text-right tabular-nums",
          column.className,
        )}
      >
        {column.value(row)}
      </td>
    ));
  return (
    <ScrollArea className={cn("h-auto rounded-lg border", className)}>
      <table className="w-full text-[13px]">
        <thead className="bg-muted/60 text-xs text-muted-foreground">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn(
                  "h-8 px-3 font-normal whitespace-nowrap",
                  column.align === "right" ? "text-right" : "text-left",
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-t hover:bg-row-hover">
              {cells(row)}
            </tr>
          ))}
        </tbody>
        {footer !== undefined && (
          <tfoot>
            <tr className="border-t bg-muted/40 font-medium">{cells(footer)}</tr>
          </tfoot>
        )}
      </table>
    </ScrollArea>
  );
}

/** A labelled figure in a report's summary row. */
export function Figure({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={cn("grid gap-0.5", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold">{children}</span>
    </div>
  );
}

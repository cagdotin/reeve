import type { SankeyReport } from "@reeve/contract/catalog";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
// react-doctor-disable-next-line react-doctor/prefer-dynamic-import -- the reports routes are code-split, so recharts loads only with them.
import { Layer, Rectangle, Sankey, Tooltip, type TooltipContentProps } from "recharts";
import { cn } from "@reeve/ui/lib/utils";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import { WidgetQuery, type WidgetBodyProps } from "./card-body";
import { TooltipCard } from "./chart-parts";
import { slot, useChartTheme, type ChartTheme } from "./chart-theme";
import { nodesThatFit, sankeyInput } from "./inputs";
import { rangeLabel, type SankeyMeta } from "./meta";

type Node = SankeyReport["nodes"][number];

/** The box's size, as it changes. */
export const useSize = () => {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((element: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!element) return;
    observer.current = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry?.contentRect.width ?? 0);
      const height = Math.floor(entry?.contentRect.height ?? 0);
      setSize((old) => (old.width === width && old.height === height ? old : { width, height }));
    });
    observer.current.observe(element);
  }, []);
  return [ref, size] as const;
};

/** A node's color: a series slot picked by its key, as Actual's, or what its tone stands for. */
const colorOf = (theme: ChartTheme, node: Node | undefined) => {
  if (node === undefined) return theme.tick;
  switch (node.tone) {
    case "positive":
      return slot(theme, 2);
    case "negative":
      return theme.out;
    case "neutral":
      return theme.tick;
    case "primary":
      return slot(theme, 0);
    case "series": {
      const hex = node.key.replace(/[^0-9a-f]/gi, "").slice(0, 3);
      return slot(theme, Number.parseInt(hex || "0", 16) % theme.series.length);
    }
  }
};

/** Where money comes from and goes, column by column; padding nodes and links stay invisible. */
export function SankeyGraph({
  report,
  showPercentages = false,
  compact = false,
  fetching,
  className,
}: {
  report: SankeyReport;
  showPercentages?: boolean | undefined;
  compact?: boolean | undefined;
  fetching?: boolean | undefined;
  className?: string | undefined;
}) {
  const theme = useChartTheme();
  const { format } = useBook();
  const [measure, box] = useSize();
  const [hovered, setHovered] = useState<number | null>(null);
  const drawn = report.nodes.some((node) => !node.hidden && node.value > 0);
  const data = {
    nodes: report.nodes.map((node) => ({ name: node.name })),
    links: report.links.map((link) => ({
      source: link.source,
      target: link.target,
      value: link.value,
    })),
  };

  const tooltip = ({ active, payload }: TooltipContentProps) => {
    const entry = payload[0];
    if (!active || entry === undefined || typeof entry.value !== "number" || entry.value <= 0)
      return null;
    const folded = hovered === null ? [] : (report.links[hovered]?.tooltip ?? []);
    return (
      <TooltipCard
        title={String(entry.name ?? "")}
        rows={[
          { key: "value", label: "", value: entry.value, mark: "none" },
          ...folded.map((each) => ({
            key: each.name,
            label: each.name,
            value: each.value,
            mark: "none" as const,
          })),
        ]}
      />
    );
  };

  return (
    <div
      ref={measure}
      className={cn(
        "min-h-0 min-w-0 transition-opacity",
        fetching && "opacity-60",
        className ?? "h-[32rem]",
      )}
    >
      {!drawn ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          No money moved in this range.
        </div>
      ) : (
        box.width > 0 &&
        box.height > 0 && (
          <Sankey
            width={box.width}
            height={box.height}
            data={data}
            sort={false}
            iterations={128}
            nodePadding={compact ? 14 : 23}
            nodeWidth={compact ? 8 : 10}
            margin={{ left: 0, right: 0, top: 10, bottom: compact ? 10 : 25 }}
            node={({ x, y, width, height, index, payload }) => {
              const node = report.nodes[index];
              if (node === undefined || node.hidden || payload.value <= 0) return null;
              const out = x + width + 6 > box.width;
              const textX = out ? x - 6 : x + width + 6;
              const anchor = out ? "end" : "start";
              return (
                <Layer key={`node-${index}`}>
                  <Rectangle
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    fill={colorOf(theme, node)}
                    radius={2}
                  />
                  <text
                    x={textX}
                    y={y + height / 2}
                    textAnchor={anchor}
                    fontSize={compact ? 11 : 13}
                    fill={theme.ink}
                  >
                    {node.name}
                  </text>
                  {!compact && (
                    <text
                      x={textX}
                      y={y + height / 2 + 14}
                      textAnchor={anchor}
                      fontSize={11}
                      fill={theme.tick}
                      className="tabular-nums"
                    >
                      {showPercentages && node.percentage !== null
                        ? `${node.percentage.toFixed(1)}%`
                        : format(payload.value)}
                    </text>
                  )}
                </Layer>
              );
            }}
            link={({
              sourceX,
              sourceY,
              sourceControlX,
              targetX,
              targetY,
              targetControlX,
              linkWidth,
              index,
            }) => {
              const link = report.links[index];
              if (link === undefined || link.value <= 0) return <path d="" />;
              const color =
                link.colorNode === null ? theme.tick : colorOf(theme, report.nodes[link.colorNode]);
              return (
                <path
                  d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={linkWidth}
                  strokeOpacity={hovered === index ? 0.85 : 0.45}
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(null)}
                />
              );
            }}
          >
            {!compact && <Tooltip content={tooltip} isAnimationActive={false} />}
          </Sankey>
        )
      )}
    </div>
  );
}

/** The dashboard card: its range and view, and the flows sized to the card. */
export function SankeyBody({ meta }: WidgetBodyProps<SankeyMeta>) {
  const { id: book } = useBook();
  const [measure, box] = useSize();
  const fits = nodesThatFit(box.height);
  const report = useQuery({
    ...bookQuery(book, "sankey_report", sankeyInput(meta, fits)),
    enabled: box.height > 0,
    placeholderData: keepPreviousData,
  });
  return (
    <>
      {report.data && (
        <span className="text-xs text-muted-foreground">
          {rangeLabel(report.data.start, report.data.end)} (
          {report.data.view === "budgeted" ? "Budgeted" : "Spent"})
        </span>
      )}
      <div ref={measure} className="flex min-h-0 flex-1 flex-col">
        <WidgetQuery query={report}>
          {(data) => (
            <SankeyGraph
              report={data}
              showPercentages={meta.showPercentages}
              compact
              className="min-h-0 flex-1"
            />
          )}
        </WidgetQuery>
      </div>
    </>
  );
}

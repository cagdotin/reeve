import { useEffect, useId, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import { ScrollArea } from "@reeve/ui/components/scroll-area";

const token = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Mermaid is heavy, so it loads with the first diagram; until then, or if it fails, the source. */
export function MermaidDiagram({ chart }: { chart: string }) {
  const { resolvedTheme } = useTheme();
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          fontFamily: "Geist Variable, sans-serif",
          themeVariables: {
            darkMode: resolvedTheme === "dark",
            background: token("--background"),
            primaryColor: token("--card"),
            primaryTextColor: token("--foreground"),
            primaryBorderColor: token("--ink"),
            secondaryColor: token("--muted"),
            tertiaryColor: token("--muted"),
            lineColor: token("--muted-foreground"),
            edgeLabelBackground: token("--background"),
          },
        });
        const result = await mermaid.render(id, chart);
        if (current) setSvg(result.svg);
      })
      .catch(() => {
        if (current) setSvg(null);
      });
    return () => {
      current = false;
    };
  }, [chart, id, resolvedTheme]);

  if (svg === null)
    return (
      <pre className="my-4 overflow-hidden rounded-lg border bg-card p-3 font-mono text-xs whitespace-pre-wrap">
        {chart}
      </pre>
    );
  return (
    <ScrollArea className="my-4 h-auto rounded-lg border bg-card" clampContentMinWidth={false}>
      <figure
        aria-label="Diagram"
        className="m-0 flex w-max min-w-full justify-center p-4"
        // oxlint-disable-next-line react/no-danger -- Mermaid sanitizes its SVG (securityLevel: strict), drawn from our own docs.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </ScrollArea>
  );
}

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Moves the vendored devl blocks to the landing page's look: one pass, safe to rerun. */
const SWAPS: ReadonlyArray<readonly [from: string, to: string]> = [
  [
    "font-medium text-muted-foreground text-xs uppercase tracking-widest",
    "inline-flex w-fit rounded-full bg-muted px-3 py-1 font-medium text-foreground text-sm",
  ],
  [
    "font-medium font-mono text-muted-foreground text-xs uppercase tracking-widest",
    "inline-flex w-fit rounded-full bg-muted px-3 py-1 font-medium text-foreground text-sm",
  ],
  [
    "mt-2 text-balance font-heading font-semibold text-3xl tracking-tight sm:text-4xl",
    "mt-5 text-balance font-heading font-bold text-4xl leading-[1.04] tracking-[-0.045em] sm:text-[3.5rem]",
  ],
  ["max-w-[1100px]", "max-w-[1328px]"],
  ["max-w-[1264px]", "max-w-[1328px]"],
  ["font-heading font-semibold text-[2.5rem]", "font-heading font-bold text-[2.5rem]"],
  [
    "font-heading font-semibold text-[clamp(3rem,18cqi,12rem)]",
    "font-heading font-bold text-[clamp(3rem,16cqi,11rem)]",
  ],
  [
    "max-w-lg text-balance font-heading font-medium text-2xl",
    "max-w-lg text-balance font-heading font-semibold text-2xl",
  ],
  [
    "@container rounded-2xl border bg-card font-mono",
    "@container rounded-3xl border bg-card p-2 font-mono",
  ],
  [
    "group relative flex flex-col overflow-hidden rounded-2xl border bg-card shadow-xs/5",
    "group relative flex flex-col overflow-hidden rounded-3xl border bg-card",
  ],
  [
    "relative m-2 mb-0 h-48 overflow-hidden rounded-lg bg-muted/60 bg-[radial-gradient(var(--color-border)_1px,transparent_1px)] [background-size:14px_14px]",
    "relative m-2 mb-0 h-56 overflow-hidden rounded-2xl border border-foreground/5 bg-muted",
  ],
  [
    '<div className="flex flex-1 flex-col p-5 pt-4">',
    '<div className="flex flex-1 flex-col p-6 pt-5">',
  ],
  [
    '<h3 className="font-medium text-[0.9375rem]">',
    '<h3 className="font-semibold text-lg tracking-tight">',
  ],
  ["text-violet-", "text-emerald-"],
];

const dir = join(import.meta.dirname, "../src/components");
for (const file of [
  "faq.tsx",
  "feature-bento.tsx",
  "mega-footer.tsx",
  "stats-band.tsx",
  "versus-table.tsx",
  "assistant-app.tsx",
]) {
  const path = join(dir, file);
  const before = readFileSync(path, "utf8");
  const after = SWAPS.reduce((text, [from, to]) => text.replaceAll(from, to), before);
  if (after !== before) writeFileSync(path, after);
  console.log(file, after === before ? "unchanged" : "restyled");
}

import { BRASS, COLORS, FOREST, PARCHMENT, PINE, SAGE } from "@/components/brand/assets";
import { useCopy } from "@/components/brand/copy-button";
import { CHART_SERIES } from "@/components/reports/chart-colors";
import { contrast, hslOf, rgbOf, wcagLevel } from "@/lib/contrast";
import { cn } from "@reeve/ui/lib/utils";

const inkOn = (hex: string) =>
  contrast(hex, FOREST) >= contrast(hex, PARCHMENT) ? FOREST : PARCHMENT;

/** Sized to how much of a screen each color takes: the mosaic is the usage guide. */
const AREAS: Record<string, string> = {
  Parchment: "max-xl:col-span-2 xl:col-span-5 xl:col-start-1 xl:row-span-2 xl:row-start-1",
  Forest: "max-xl:col-span-2 xl:col-span-7 xl:col-start-6 xl:row-start-1",
  Pine: "xl:col-span-3 xl:col-start-6 xl:row-start-2",
  Sage: "xl:col-span-2 xl:col-start-9 xl:row-start-2",
  Brass: "max-xl:col-span-2 xl:col-span-2 xl:col-start-11 xl:row-start-2",
};

function Swatch({ name, hex, role }: { name: string; hex: string; role: string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      aria-label={`Copy ${name} ${hex}`}
      onClick={() => copy(hex)}
      style={{ backgroundColor: hex, color: inkOn(hex) }}
      className={cn(
        "flex min-h-32 cursor-pointer flex-col justify-between rounded-xl border p-4 text-start outline-hidden transition-transform hover:scale-[1.01] focus-visible:ring-2 focus-visible:ring-ring",
        AREAS[name],
      )}
    >
      <span>
        <span className="block text-lg font-semibold">{name}</span>
        <span className="mt-1 block max-w-64 text-xs opacity-80">{role}</span>
      </span>
      <span className="mt-4 block text-xs tabular-nums">
        <span className="block font-medium">{copied ? "Copied" : hex}</span>
        <span className="block opacity-75">RGB {rgbOf(hex)}</span>
        <span className="block opacity-75">HSL {hslOf(hex)}</span>
      </span>
    </button>
  );
}

export function ColorMosaic() {
  return (
    <div className="my-6 grid grid-cols-2 gap-3 xl:auto-rows-fr xl:grid-cols-12">
      {COLORS.map((color) => (
        <Swatch key={color.name} {...color} />
      ))}
    </div>
  );
}

const PAIRS = [
  { text: FOREST, on: PARCHMENT, label: "Forest on Parchment" },
  { text: PARCHMENT, on: FOREST, label: "Parchment on Forest" },
  { text: PINE, on: PARCHMENT, label: "Pine on Parchment" },
  { text: SAGE, on: FOREST, label: "Sage on Forest" },
  { text: BRASS, on: FOREST, label: "Brass on Forest" },
  { text: PARCHMENT, on: PINE, label: "Parchment on Pine" },
  { text: FOREST, on: SAGE, label: "Forest on Sage" },
  { text: BRASS, on: PARCHMENT, label: "Brass on Parchment" },
];

export function ColorPairings() {
  return (
    <ul className="my-5 grid grid-cols-4 gap-3 max-lg:grid-cols-2">
      {PAIRS.map((pair) => {
        const ratio = contrast(pair.text, pair.on);
        return (
          <li key={pair.label} className="overflow-hidden rounded-lg border">
            <div
              aria-hidden="true"
              className="flex h-20 items-center justify-center text-3xl font-semibold"
              style={{ backgroundColor: pair.on, color: pair.text }}
            >
              Aa
            </div>
            <div className="bg-card p-2.5 text-xs">
              <div className="font-medium">{pair.label}</div>
              <div className="mt-0.5 text-muted-foreground tabular-nums">
                {ratio.toFixed(1)}:1 · {wcagLevel(ratio)}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function DataSwatch({ hex }: { hex: string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      aria-label={`Copy ${hex}`}
      onClick={() => copy(hex)}
      className="flex min-w-0 cursor-pointer flex-col gap-1 rounded-md text-start outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="h-9 w-full rounded-md" style={{ backgroundColor: hex }} />
      <span className="truncate text-[11px] text-muted-foreground tabular-nums">
        {copied ? "Copied" : hex.toUpperCase()}
      </span>
    </button>
  );
}

export function DataColors() {
  return (
    <div className="my-5 grid gap-4">
      {(
        [
          ["On light", CHART_SERIES.light],
          ["On dark", CHART_SERIES.dark],
        ] as const
      ).map(([label, series]) => (
        <div key={label}>
          <div className="mb-1.5 text-xs font-medium">{label}</div>
          <div className="grid grid-cols-8 gap-2 max-md:grid-cols-4">
            {series.map((hex) => (
              <DataSwatch key={hex} hex={hex} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

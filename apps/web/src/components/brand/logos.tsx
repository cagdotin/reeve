import { DownloadIcon } from "lucide-react";
import { assetUrl, FOREST, PARCHMENT, svgSource } from "@/components/brand/assets";
import { CopyButton } from "@/components/brand/copy-button";
import { Button } from "@reeve/ui/components/button";
import { cn } from "@reeve/ui/lib/utils";

const panelColor = { light: PARCHMENT, dark: FOREST } as const;

function DownloadLink({ path, label }: { path: string; label: string }) {
  return (
    <Button
      variant="ghost"
      render={
        <a
          href={assetUrl(path)}
          download={path.split("/").at(-1)}
          aria-label={`Download ${path.split("/").at(-1)}`}
        />
      }
    >
      <DownloadIcon data-icon="inline-start" />
      {label}
    </Button>
  );
}

function Logo({
  name,
  png,
  panel,
  alt,
  imageClass,
}: {
  name: string;
  png: string;
  panel: "light" | "dark";
  alt: string;
  imageClass: string;
}) {
  return (
    <div>
      <div
        className="flex h-48 items-center justify-center rounded-lg border max-md:h-36"
        style={{ backgroundColor: panelColor[panel] }}
      >
        <img src={assetUrl(`svg/${name}.svg`)} alt={alt} className={imageClass} />
      </div>
      <div className="mt-1.5 flex flex-wrap gap-0.5">
        <CopyButton text={svgSource(name)}>Copy SVG</CopyButton>
        <DownloadLink path={`svg/${name}.svg`} label="SVG" />
        <DownloadLink path={`png/${png}.png`} label="PNG" />
      </div>
    </div>
  );
}

function LogoCard({
  title,
  text,
  light,
  dark,
  imageClass,
}: {
  title: string;
  text: string;
  light: { name: string; png: string };
  dark: { name: string; png: string };
  imageClass: string;
}) {
  return (
    <section className="mt-8 first:mt-6">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      <p className="mt-1 mb-3 max-w-2xl text-[13px] text-muted-foreground">{text}</p>
      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        <Logo {...light} panel="light" alt={`${title}, on light`} imageClass={imageClass} />
        <Logo {...dark} panel="dark" alt={`${title}, on dark`} imageClass={imageClass} />
      </div>
    </section>
  );
}

export function LogoCards() {
  return (
    <>
      <LogoCard
        title="Full logo"
        text="Our definitive mark and name together. Use it when people may not know reeve yet."
        light={{ name: "logo-light", png: "logo-light" }}
        dark={{ name: "logo-dark", png: "logo-dark" }}
        imageClass="h-16 w-auto max-md:h-12"
      />
      <LogoCard
        title="Mark"
        text="The ledger R on its own, for places where the name is already clear."
        light={{ name: "mark", png: "mark-1024" }}
        dark={{ name: "mark-parchment", png: "mark-parchment-1024" }}
        imageClass="h-20 w-auto max-md:h-16"
      />
      <LogoCard
        title="Wordmark"
        text="The name alone, set in Nunito Bold and outlined."
        light={{ name: "wordmark", png: "wordmark" }}
        dark={{ name: "wordmark-parchment", png: "wordmark-parchment" }}
        imageClass="h-12 w-auto max-md:h-10"
      />
    </>
  );
}

const MARK = { width: 632, height: 584, x: 112 };

/** The mark on its construction lines, one ledger row (x) of clear space on each side. */
export function LogoConstruction() {
  const { width, height, x } = MARK;
  const guides = [0, width, -x, width + x];
  const rows = [0, height, -x, height + x];
  return (
    <div className="my-5 grid grid-cols-[1fr_1.4fr] gap-3 max-md:grid-cols-1">
      <figure
        aria-label="Clear space around the mark"
        className="m-0 flex items-center justify-center rounded-lg border p-6"
        style={{ backgroundColor: PARCHMENT, color: FOREST }}
      >
        <svg
          viewBox={`${-x - 60} ${-x - 60} ${width + 2 * x + 120} ${height + 2 * x + 120}`}
          className="h-52 w-auto max-w-full"
        >
          <g stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" strokeDasharray="8 8">
            {guides.map((at) => (
              <line key={at} x1={at} x2={at} y1={-x - 60} y2={height + x + 60} />
            ))}
            {rows.map((at) => (
              <line key={at} y1={at} y2={at} x1={-x - 60} x2={width + x + 60} />
            ))}
          </g>
          <image href={assetUrl("svg/mark.svg")} width={width} height={height} />
          <g fill="currentColor" fontSize="64" fontWeight="500" textAnchor="middle">
            <text x={-x / 2} y={height / 2 + 20}>
              x
            </text>
            <text x={width + x / 2} y={height / 2 + 20}>
              x
            </text>
            <text x={width / 2} y={-x / 2 + 14}>
              x
            </text>
            <text x={width / 2} y={height + x / 2 + 14}>
              x
            </text>
          </g>
        </svg>
      </figure>
      <div
        className="flex flex-wrap items-center justify-center gap-x-8 gap-y-5 rounded-lg border p-6"
        style={{ backgroundColor: PARCHMENT, color: FOREST }}
      >
        {[
          { label: "48", size: "h-12" },
          { label: "32", size: "h-8" },
          { label: "24", size: "h-6" },
          { label: "16", size: "h-4" },
        ].map((step) => (
          <figure key={step.label} className="m-0 flex flex-col items-center gap-2">
            <img
              src={assetUrl("svg/mark.svg")}
              alt={`The mark at ${step.label}px`}
              className={cn(step.size, "w-auto")}
            />
            <figcaption className="text-xs tabular-nums opacity-70">{step.label}px</figcaption>
          </figure>
        ))}
        <figure className="m-0 flex flex-col items-center gap-2">
          <img
            src={assetUrl("svg/logo-light.svg")}
            alt="The full logo at its minimum"
            className="h-5 w-auto"
          />
          <figcaption className="text-xs tabular-nums opacity-70">
            Full logo, 20px minimum
          </figcaption>
        </figure>
      </div>
    </div>
  );
}

const SIZES = [256, 128, 64, 32, 16];

export function AppIcons() {
  return (
    <div className="my-6 grid grid-cols-2 gap-3 max-md:grid-cols-1">
      {(["light", "dark"] as const).map((plate) => (
        <div key={plate}>
          <div
            className="flex flex-wrap items-end justify-center gap-5 rounded-lg border p-6"
            style={{ backgroundColor: plate === "light" ? "#E9E7DB" : "#072A21" }}
          >
            {SIZES.map((size) => (
              <figure key={size} className="m-0 flex flex-col items-center gap-1.5">
                <img
                  src={assetUrl(`png/icon-${plate}-${size}.png`)}
                  srcSet={`${assetUrl(`png/icon-${plate}-${size}.png`)} 1x, ${assetUrl(`png/icon-${plate}-${size * 2}.png`)} 2x`}
                  alt={`The ${plate} app icon at ${size}px`}
                  width={Math.min(size, 112)}
                  height={Math.min(size, 112)}
                />
                <figcaption
                  className="text-[11px] tabular-nums"
                  style={{ color: plate === "light" ? FOREST : PARCHMENT }}
                >
                  {size}
                </figcaption>
              </figure>
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-0.5">
            <CopyButton text={svgSource(`icon-${plate}`)}>Copy SVG</CopyButton>
            <DownloadLink path={`svg/icon-${plate}.svg`} label="SVG" />
            <DownloadLink path={`png/icon-${plate}-1024.png`} label="PNG" />
          </div>
        </div>
      ))}
    </div>
  );
}

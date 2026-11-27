import { Link } from "@tanstack/react-router";
import { GaugeIcon, LayersIcon, SparkleIcon, TargetIcon } from "lucide-react";
import { assetUrl, FOREST, PARCHMENT, SAGE } from "@/components/brand/assets";
import { Button } from "@reeve/ui/components/button";

/** The board's hero: the icon, the name and the line on Forest. */
export function BrandHero() {
  return (
    <div
      className="relative my-8 flex items-center border gap-8 overflow-hidden rounded-2xl p-12 max-md:flex-col max-md:items-start max-md:gap-5 max-md:p-7"
      style={{ backgroundColor: FOREST, color: PARCHMENT }}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 400 300"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-y-0 right-0 h-full w-1/2"
        fill="none"
        stroke={SAGE}
        strokeOpacity="0.2"
        strokeWidth="1"
      >
        <path d="M400 0C260 60 140 170 90 300" />
        <path d="M400 80C300 130 220 210 190 300" />
      </svg>
      <img src={assetUrl("svg/icon-light.svg")} alt="" className="size-32 max-md:size-20" />
      <div>
        <img
          src={assetUrl("svg/wordmark-parchment.svg")}
          alt="reeve"
          className="h-13 w-auto max-md:h-9"
        />
        <p className="mt-4 text-sm font-medium tracking-[0.22em] uppercase opacity-85 max-md:text-xs">
          Your financial steward
        </p>
      </div>
    </div>
  );
}

const SECTIONS = [
  ["At a glance", "at-a-glance"],
  ["Logo", "logo"],
  ["App icon", "app-icon"],
  ["Color", "color"],
  ["Typography", "typography"],
  ["Best practices", "best-practices"],
  ["In use", "in-use"],
  ["Brand kit", "brand-kit"],
] as const;

export function BrandNav() {
  return (
    <nav
      aria-label="On this page"
      className="sticky top-(--sticky-top) z-10 -mx-2 flex flex-wrap gap-1 bg-background px-2 py-2 max-md:static"
    >
      {SECTIONS.map(([label, hash]) => (
        <Button
          key={hash}
          variant="ghost"
          className="font-normal text-muted-foreground hover:text-foreground"
          render={<Link to="." hash={hash} />}
        >
          {label}
        </Button>
      ))}
    </nav>
  );
}

const GLANCE = [
  {
    icon: <LayersIcon />,
    title: "Meaning",
    text: "A financial steward: organizing, tracking and managing your money.",
  },
  {
    icon: <TargetIcon />,
    title: "Personality",
    text: "Trustworthy, structured, intelligent, calm.",
  },
  {
    icon: <SparkleIcon />,
    title: "Use case",
    text: "Receipts, invoices, budgeting, investments and agent-driven finance.",
  },
  {
    icon: <GaugeIcon />,
    title: "Visual style",
    text: "Minimal and modern, with a subtle ledger-inspired structure.",
  },
];

export function BrandGlance() {
  return (
    <dl className="my-6 grid grid-cols-4 gap-3 max-lg:grid-cols-2 max-md:grid-cols-1">
      {GLANCE.map((item) => (
        <div key={item.title} className="rounded-xl border bg-card p-5">
          <dt className="flex items-center gap-2 font-medium [&>svg]:size-4 [&>svg]:text-(--ink)">
            {item.icon}
            {item.title}
          </dt>
          <dd className="mt-2 text-[13px] text-muted-foreground">{item.text}</dd>
        </div>
      ))}
    </dl>
  );
}

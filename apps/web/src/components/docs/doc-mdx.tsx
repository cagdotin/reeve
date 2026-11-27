import type { MDXComponents } from "mdx/types";
import { type ComponentType, useMemo } from "react";
import { BrandKit } from "@/components/brand/kit";
import { AppIcons, LogoCards, LogoConstruction } from "@/components/brand/logos";
import { ColorMosaic, ColorPairings, DataColors } from "@/components/brand/colors";
import { BrandGlance, BrandHero, BrandNav } from "@/components/brand/overview";
import { Typography } from "@/components/brand/typography";
import { BestPractices, InUse } from "@/components/brand/usage";
import { useDocComponents } from "@/components/docs/doc-markdown";
import { headingId } from "@/lib/doc-headings";

const BLOCKS: MDXComponents = {
  AppIcons,
  BestPractices,
  BrandGlance,
  BrandHero,
  BrandKit,
  BrandNav,
  ColorMosaic,
  ColorPairings,
  DataColors,
  InUse,
  LogoCards,
  LogoConstruction,
  Typography,
};

/** A page with components of its own: larger headings and quieter text, for a wider layout. */
const WIDE: MDXComponents = {
  ...BLOCKS,
  h2: ({ children }) => (
    <h2
      id={headingId(children)}
      className="mt-20 scroll-mt-6 md:scroll-mt-24 text-3xl font-semibold tracking-tight max-md:mt-14 max-md:text-2xl"
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3
      id={headingId(children)}
      className="mt-12 scroll-mt-6 md:scroll-mt-24 text-lg font-semibold"
    >
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">{children}</p>
  ),
};

export function DocMdx({
  file,
  Content,
}: {
  file: string;
  Content: ComponentType<{ components: MDXComponents }>;
}) {
  const base = useDocComponents(file);
  const components = useMemo(() => ({ ...base, ...WIDE }), [base]);
  return (
    <article className="text-sm text-foreground">
      <Content components={components} />
    </article>
  );
}

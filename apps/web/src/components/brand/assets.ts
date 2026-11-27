import colors from "../../../../../docs/brand/tokens/colors.json";

const ROOT = "../../../../../docs/brand/";

/** Every file of the kit, by its path under `docs/brand/`, so a new one lists itself. */
const urls = import.meta.glob<string>("../../../../../docs/brand/{svg,png,tokens}/*", {
  query: "?url",
  import: "default",
  eager: true,
});

const svgs = import.meta.glob<string>("../../../../../docs/brand/svg/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});

export const assetUrl = (path: string) => urls[`${ROOT}${path}`] ?? "";

export const svgSource = (name: string) => svgs[`${ROOT}svg/${name}.svg`] ?? "";

export const KIT_FILES = Object.keys(urls)
  .map((key) => key.slice(ROOT.length))
  .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

export const KIT_ZIP = "/reeve-brand-kit.zip";

export interface BrandColor {
  readonly name: string;
  readonly hex: string;
  readonly role: string;
}

export const COLORS: ReadonlyArray<BrandColor> = colors;

const hexOf = (name: string) => COLORS.find((color) => color.name === name)?.hex ?? "#000000";

/** The brand's own colors: these panels show the brand as it is, whichever theme the app is in. */
export const FOREST = hexOf("Forest");
export const PINE = hexOf("Pine");
export const SAGE = hexOf("Sage");
export const PARCHMENT = hexOf("Parchment");
export const BRASS = hexOf("Brass");

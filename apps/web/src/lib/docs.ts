import type { MDXComponents } from "mdx/types";
import type { ComponentType } from "react";
import { docPath, docSlug, resolveInDocs } from "./doc-paths.ts";

const ROOT = "../../../../docs/";

/** The repo's `docs/`, built into the app, so the desktop app and any server carry them. */
const sources = import.meta.glob<string>("../../../../docs/**/*.{md,mdx}", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Documents with components of their own, compiled. */
const compiled = import.meta.glob<{ default: ComponentType<{ components: MDXComponents }> }>(
  "../../../../docs/**/*.mdx",
  { eager: true },
);

const images = import.meta.glob<string>("../../../../docs/**/*.{svg,png,jpg,jpeg,gif,webp}", {
  query: "?url",
  import: "default",
  eager: true,
});

export interface Doc {
  readonly file: string;
  readonly slug: string;
  readonly path: string;
  readonly title: string;
  readonly source: string;
  /** Set for an `.mdx` document, which renders itself; others render `source`. */
  readonly Content: ComponentType<{ components: MDXComponents }> | undefined;
}

const titleOf = (source: string, file: string) =>
  /^#\s+(.+)$/m.exec(source)?.[1]?.replace(/[`*_]/g, "") ?? file.replace(/\.mdx?$/, "");

const isReadme = (file: string) => /(^|\/)README\.mdx?$/.test(file);

/** A folder's README sorts before its other files, and the root's before everything. */
const sortKey = (doc: { readonly file: string }) => doc.file.replace(/README\.mdx?$/, "\0");

/** How a document reads in a list: a section's own README only needs to say it opens the section. */
export const docLabel = (doc: Doc, inSection: boolean) =>
  inSection && isReadme(doc.file) ? "Overview" : doc.title;

export const DOCS: ReadonlyArray<Doc> = Object.entries(sources)
  .map(([key, source]) => {
    const file = key.slice(ROOT.length);
    const slug = docSlug(file);
    return {
      file,
      slug,
      path: docPath(slug),
      title: titleOf(source, file),
      source,
      Content: compiled[key]?.default,
    };
  })
  .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));

export const docBySlug = (slug: string) => DOCS.find((doc) => doc.slug === slug.replace(/\/$/, ""));

export const docImage = (file: string, src: string) => {
  const target = resolveInDocs(file, src);
  return target === null ? undefined : images[`${ROOT}${target}`];
};

export interface DocSection {
  readonly label: string;
  readonly docs: ReadonlyArray<Doc>;
}

const folderOf = (doc: Doc) => doc.file.split("/").slice(0, -1).join("/");

/** Documents at the top, and each folder with more than a README as a section of its own. */
export const docTree = (() => {
  const folders = Map.groupBy(DOCS, folderOf);
  const top: Array<Doc> = [];
  const sections: Array<DocSection> = [];
  for (const [folder, docs] of folders) {
    if (folder === "" || docs.length === 1) top.push(...docs);
    else sections.push({ label: docs[0]!.title, docs });
  }
  return { top, sections };
})();

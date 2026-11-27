/** Where a document under `docs/` lives in the app: its README is its folder's page. */
export const docSlug = (file: string) => file.replace(/\.mdx?$/, "").replace(/(^|\/)README$/, "");

export const docPath = (slug: string) => (slug === "" ? "/docs" : `/docs/${slug}`);

export type DocLink =
  | { readonly kind: "external"; readonly href: string }
  | { readonly kind: "anchor"; readonly hash: string }
  | { readonly kind: "doc"; readonly to: string; readonly hash: string | undefined }
  | { readonly kind: "outside" };

/** `file` joined to a relative `path`, or null when it climbs out of `docs/`. */
export const resolveInDocs = (file: string, path: string): string | null => {
  const parts = file.split("/").slice(0, -1);
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
};

/** What a link written in `file` points at. Anything else in the repo has no page in the app. */
export const resolveDocLink = (file: string, href: string): DocLink => {
  if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return { kind: "external", href };
  const [path = "", hash] = href.split("#");
  if (path === "") return hash ? { kind: "anchor", hash } : { kind: "outside" };
  const target = resolveInDocs(file, path);
  if (target === null) return { kind: "outside" };
  if (/\.mdx?$/.test(path)) return { kind: "doc", to: docPath(docSlug(target)), hash };
  return path.endsWith("/") ? { kind: "doc", to: docPath(target), hash } : { kind: "outside" };
};

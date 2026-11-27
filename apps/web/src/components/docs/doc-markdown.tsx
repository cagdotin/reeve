import { Link } from "@tanstack/react-router";
import { Children, type ComponentProps, type ReactElement, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidDiagram } from "@/components/docs/mermaid-diagram";
import { headingId, textOf } from "@/lib/doc-headings";
import { resolveDocLink } from "@/lib/doc-paths";
import { docImage } from "@/lib/docs";
import { ScrollArea } from "@reeve/ui/components/scroll-area";

const LINK =
  "font-medium text-(--ink) underline decoration-(--ink)/30 underline-offset-2 hover:decoration-(--ink)";

function Pre({ children }: ComponentProps<"pre">) {
  const code = Children.toArray(children)[0] as ReactElement<ComponentProps<"code">> | undefined;
  const source = textOf(code?.props.children).replace(/\n$/, "");
  if (code?.props.className === "language-mermaid") return <MermaidDiagram chart={source} />;
  return (
    <ScrollArea className="my-4 h-auto rounded-lg border bg-card" clampContentMinWidth={false}>
      <pre className="w-max min-w-full p-3 font-mono text-xs leading-relaxed">{source}</pre>
    </ScrollArea>
  );
}

/** The markdown's parts, with links and images resolved from `file`. */
const docComponents = (file: string): Components => ({
  h1: () => null,
  h2: ({ children }) => (
    <h2
      id={headingId(children)}
      className="mt-9 mb-3 scroll-mt-6 border-b pb-1.5 text-lg font-semibold tracking-tight"
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 id={headingId(children)} className="mt-6 mb-2 scroll-mt-6 text-[15px] font-semibold">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 id={headingId(children)} className="mt-5 mb-1.5 scroll-mt-6 text-sm font-semibold">
      {children}
    </h4>
  ),
  p: ({ children }) => <p className="my-3">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 ps-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 ps-5">{children}</ol>,
  li: ({ children }) => <li className="ps-1 [&>p]:my-1.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-s-2 border-(--ink)/50 ps-4 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-8" />,
  a: ({ href = "", children }) => {
    const target = resolveDocLink(file, href);
    switch (target.kind) {
      case "external":
        return (
          <a href={target.href} target="_blank" rel="noreferrer" className={LINK}>
            {children}
          </a>
        );
      case "anchor":
        return (
          <Link to="." hash={target.hash} className={LINK}>
            {children}
          </Link>
        );
      case "doc":
        return (
          <Link to={target.to} {...(target.hash ? { hash: target.hash } : {})} className={LINK}>
            {children}
          </Link>
        );
      case "outside":
        return <span>{children}</span>;
    }
  },
  img: ({ src = "", alt = "" }) => (
    <img
      src={docImage(file, src) ?? src}
      alt={alt}
      loading="lazy"
      className="my-4 h-auto max-h-48 max-w-full"
    />
  ),
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] break-words">
      {children}
    </code>
  ),
  pre: Pre,
  table: ({ children }) => (
    <ScrollArea className="my-4 h-auto rounded-lg border" clampContentMinWidth={false}>
      <table className="w-full min-w-full text-[13px] max-md:w-xl">{children}</table>
    </ScrollArea>
  ),
  thead: ({ children }) => <thead className="bg-band">{children}</thead>,
  tr: ({ children }) => <tr className="border-b last:border-b-0">{children}</tr>,
  th: ({ children, style }) => (
    <th style={style} className="px-3 py-2 text-start font-medium">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="px-3 py-2 align-top">
      {children}
    </td>
  ),
});

const PLUGINS = [remarkGfm];

/** The parts of a document in `file`, for a renderer of its own to extend. */
export const useDocComponents = (file: string) => useMemo(() => docComponents(file), [file]);

/** A document of `docs/`, in GitHub's markdown, with its links and images resolved in the app. */
export function DocMarkdown({ file, source }: { file: string; source: string }) {
  const parts = useDocComponents(file);
  return (
    <article className="text-sm leading-relaxed text-foreground">
      <ReactMarkdown remarkPlugins={PLUGINS} components={parts}>
        {source}
      </ReactMarkdown>
    </article>
  );
}

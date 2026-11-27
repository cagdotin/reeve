import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { ListIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { DocMarkdown } from "@/components/docs/doc-markdown";
import { DocMdx } from "@/components/docs/doc-mdx";
import { Page } from "@/components/page";
import { SectionTitle, SidebarLayerList } from "@/components/section-sidebar";
import { BottomSheet } from "@/components/mobile/bottom-sheet";
import { headingId } from "@/lib/doc-headings";
import { type Doc, docBySlug, docLabel, docTree } from "@/lib/docs";
import { Button } from "@reeve/ui/components/button";
import { useIsMobile } from "@reeve/ui/hooks/use-media-query";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@reeve/ui/components/empty";
import { cn } from "@reeve/ui/lib/utils";

const LABEL = "Documentation";

export const Route = createFileRoute("/docs/$")({ component: DocsPage });

function DocsPage() {
  const { _splat: slug = "" } = Route.useParams();
  const hash = useLocation({ select: (location) => location.hash });
  const doc = docBySlug(slug);
  const mobile = useIsMobile();

  useEffect(() => {
    if (hash !== "") document.getElementById(hash)?.scrollIntoView();
  }, [hash, slug]);

  return (
    <Page
      title={doc?.title ?? "No such document"}
      width="window"
      actions={mobile && <PhoneContents />}
    >
      <Contents />
      {doc ? (
        <>
          <SectionTitle
            title={
              <span id={headingId(doc.title)} className="block scroll-mt-6">
                {doc.title}
              </span>
            }
            subtitle={doc.file}
          />
          <div
            className={cn(
              "px-(--page-gutter) pt-5 pb-9",
              doc.Content ? "max-w-[calc(64rem+4rem)]" : "max-w-[calc(48rem+4rem)]",
            )}
          >
            {doc.Content ? (
              <DocMdx file={doc.file} Content={doc.Content} />
            ) : (
              <DocMarkdown file={doc.file} source={doc.source} />
            )}
          </div>
        </>
      ) : (
        <Empty className="min-h-96">
          <EmptyHeader>
            <EmptyTitle>No such document</EmptyTitle>
            <EmptyDescription>
              <Link to="/docs/$" params={{ _splat: "" }}>
                Back to the docs
              </Link>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </Page>
  );
}

const CONTENTS_GROUPS = [
  { items: docTree.top.map((doc) => ({ doc, inSection: false })) },
  ...docTree.sections.map((section) => ({
    label: section.label,
    items: section.docs.map((doc) => ({ doc, inSection: true })),
  })),
];

/** Every document, in the sidebar beside the one being read. */
function Contents() {
  const path = useLocation({ select: (location) => location.pathname }).replace(/\/$/, "");
  return (
    <SidebarLayerList
      title="Docs"
      navLabel="Documents"
      groups={CONTENTS_GROUPS.map((group) => ({
        ...group,
        items: group.items.map(({ doc, inSection }) => ({
          to: doc.path,
          label: docLabel(doc, inSection),
          title: doc.title,
          keywords: doc.title,
          active: path === doc.path,
        })),
      }))}
    />
  );
}

/** A phone has no room beside the document, so the list is a sheet. */
function PhoneContents() {
  const [open, setOpen] = useState(false);
  const row = (doc: Doc, inSection: boolean) => (
    <li key={doc.file} className="border-b last:border-b-0">
      <Link
        to={doc.path}
        onClick={() => setOpen(false)}
        className="flex min-h-11 items-center px-3 py-2 text-[15px] outline-none active:bg-muted focus-visible:bg-muted"
      >
        {docLabel(doc, inSection)}
      </Link>
    </li>
  );
  return (
    <>
      <Button variant="ghost" className="text-[13px]" onClick={() => setOpen(true)}>
        <ListIcon data-icon="inline-start" />
        Contents
      </Button>
      <BottomSheet open={open} onOpenChange={setOpen} title={LABEL}>
        <ul className="overflow-hidden rounded-xl border bg-background">
          {docTree.top.map((doc) => row(doc, false))}
        </ul>
        {docTree.sections.map((section) => (
          <section key={section.label} className="mt-4">
            <h3 className="mb-1.5 px-1 text-xs text-muted-foreground">{section.label}</h3>
            <ul className="overflow-hidden rounded-xl border bg-background">
              {section.docs.map((doc) => row(doc, true))}
            </ul>
          </section>
        ))}
      </BottomSheet>
    </>
  );
}

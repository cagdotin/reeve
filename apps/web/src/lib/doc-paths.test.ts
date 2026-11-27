import { describe, expect, it } from "vitest";
import { docPath, docSlug, resolveDocLink } from "./doc-paths.ts";

describe("docSlug", () => {
  it("makes a README its folder's page", () => {
    expect(docSlug("README.md")).toBe("");
    expect(docSlug("rules/README.md")).toBe("rules");
    expect(docSlug("brand/README.mdx")).toBe("brand");
    expect(docSlug("rules/scope.md")).toBe("rules/scope");
  });
});

describe("docPath", () => {
  it("puts the root README at /docs", () => {
    expect(docPath("")).toBe("/docs");
    expect(docPath("brand")).toBe("/docs/brand");
  });
});

describe("resolveDocLink", () => {
  it("follows relative links between documents", () => {
    expect(resolveDocLink("README.md", "rules/README.md")).toEqual({
      kind: "doc",
      to: "/docs/rules",
      hash: undefined,
    });
    expect(resolveDocLink("rules/README.md", "scope.md#context")).toEqual({
      kind: "doc",
      to: "/docs/rules/scope",
      hash: "context",
    });
    expect(resolveDocLink("rules/scope.md", "../architecture.md")).toEqual({
      kind: "doc",
      to: "/docs/architecture",
      hash: undefined,
    });
    expect(resolveDocLink("README.md", "brand/README.mdx")).toEqual({
      kind: "doc",
      to: "/docs/brand",
      hash: undefined,
    });
    expect(resolveDocLink("README.md", "rules/")).toEqual({
      kind: "doc",
      to: "/docs/rules",
      hash: undefined,
    });
  });

  it("keeps a heading link in the page", () => {
    expect(resolveDocLink("README.md", "#layout")).toEqual({ kind: "anchor", hash: "layout" });
  });

  it("sends web addresses outside the app", () => {
    expect(resolveDocLink("README.md", "https://example.com/a.md")).toEqual({
      kind: "external",
      href: "https://example.com/a.md",
    });
    expect(resolveDocLink("README.md", "mailto:me@example.com").kind).toBe("external");
  });

  it("has no page for what lies outside docs/", () => {
    expect(resolveDocLink("README.md", "../AGENTS.md")).toEqual({ kind: "outside" });
    expect(resolveDocLink("README.md", "../packages/ui/src/styles.css")).toEqual({
      kind: "outside",
    });
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routes = new URL("../routes/", import.meta.url);
const NOT_PAGES = new Set([
  "__root.tsx",
  "accounts.index.tsx",
  "settings.index.tsx",
  "reports.library.tsx",
]);
const PHONE_SWITCHES = ["accounts.$account.tsx", "budget.index.tsx", "docs.$.tsx"];

const files = readdirSync(routes).filter((file) => file.endsWith(".tsx"));
const source = (file: string) => readFileSync(new URL(file, routes), "utf8");
const pages = files.filter((file) => !NOT_PAGES.has(file));

describe("a route's page", () => {
  it("finds the routes", () => {
    expect(pages.length).toBeGreaterThan(25);
  });

  it("renders through Page, or through ReportShell, which does", () => {
    const skipped = pages.filter((file) => !/<(Page|ReportShell)[\s>]/.test(source(file)));
    expect(skipped).toEqual([]);
    expect(
      readFileSync(new URL("../components/reports/report-shell.tsx", import.meta.url), "utf8"),
    ).toMatch(/<Page[\s>]/);
  });

  it("names the report shown in the report selector on every page under Reports", () => {
    const reports = pages.filter((file) => file.startsWith("reports."));
    expect(reports.length).toBeGreaterThan(10);
    expect(
      reports.filter((file) => !/<ReportShell[\s>]|<ReportSelector[\s>]/.test(source(file))),
    ).toEqual([]);
  });

  it("leaves main and its width to Page", () => {
    expect(files.filter((file) => /<main[\s>]|data-bleed/.test(source(file)))).toEqual([]);
  });

  it("switches to a phone component only where docs/rules/shell.md's three routes do", () => {
    expect(files.filter((file) => source(file).includes("useIsMobile("))).toEqual(PHONE_SWITCHES);
  });
});
